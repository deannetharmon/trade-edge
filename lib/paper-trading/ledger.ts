// lib/paper-trading/ledger.ts
//
// PT-0001: pure account-ledger mutations and invariants (section 6.1).
// Every function here is pure — no I/O, no Redis, no Date.now() side effects
// beyond an explicitly passed `now`. Locking/persistence lives in
// persistence/store.ts, which wraps these functions in an atomic
// read-modify-write.
//
// Accounting model (documented in full in
// docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md):
//   - cash increases by entryCredit when a position opens, decreases by the
//     closing debit when a position closes. It reflects only REALIZED cash
//     movement — it does not move just because a mark is refreshed.
//   - reservedCapital is the sum of capitalReserved across open positions.
//     It represents buying power set aside, not a change in equity.
//   - availableCapital = cash - reservedCapital.
//   - currentEquity = startingBalance + realizedPnl + unrealizedPnl. This is
//     algebraically identical to "cash minus the cost to close every open
//     position now" (the wording used in the sprint spec) whenever every
//     open position has a current mark; a position with no mark yet
//     (currentMark === null) contributes 0 to unrealizedPnl until the user
//     explicitly refreshes it — never a fabricated number.
//   - realizedPnl = sum of closedPositions[].realizedPnl.
//   - unrealizedPnl = sum of openPositions[].unrealizedPnl (treating an
//     unmarked position as 0).

import { computeCapitalRequirement, requireSufficientCapital } from './capital';
import { PaperTradingError } from './types';
import type {
  PaperFillEvidence,
  PaperLeg,
  PaperStrategy,
  PaperTradingLedger,
  PaperTradingLedgerView,
  PaperTradingPosition,
} from './types';

export function createInitialLedger(userId: string, startingBalance: number, now: Date = new Date()): PaperTradingLedger {
  const iso = now.toISOString();
  return {
    schemaVersion: 1,
    userId,
    startingBalance,
    cash: startingBalance,
    reservedCapital: 0,
    peakEquity: startingBalance,
    openPositions: [],
    closedPositions: [],
    equityHistory: [{ timestamp: iso, equity: startingBalance }],
    createdAt: iso,
    updatedAt: iso,
  };
}

export function deriveLedgerView(ledger: PaperTradingLedger): PaperTradingLedgerView {
  const realizedPnl = ledger.closedPositions.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);
  const unrealizedPnl = ledger.openPositions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
  const currentEquity = ledger.startingBalance + realizedPnl + unrealizedPnl;
  const availableCapital = ledger.cash - ledger.reservedCapital;
  const openRisk = ledger.openPositions.reduce((sum, p) => sum + Math.max(0, p.theoreticalMaxLoss), 0);
  return { ledger, availableCapital, currentEquity, realizedPnl, unrealizedPnl, openRisk };
}

function touch(ledger: PaperTradingLedger, now: Date): PaperTradingLedger {
  const view = deriveLedgerView(ledger);
  const nextPeak = Math.max(ledger.peakEquity, view.currentEquity);
  const iso = now.toISOString();
  return {
    ...ledger,
    peakEquity: nextPeak,
    updatedAt: iso,
    equityHistory: [...ledger.equityHistory, { timestamp: iso, equity: view.currentEquity }].slice(-500),
  };
}

export interface OpenPositionArgs {
  positionId: string;
  idempotencyKey: string;
  userId: string;
  symbol: string;
  strategy: PaperStrategy;
  legs: PaperLeg[];
  expiration: string;
  quantity: number;
  contractMultiplier: number;
  entryFill: PaperFillEvidence;
  entryRationale: string | null;
  auditRefs?: string[];
  now?: Date;
}

export function openPosition(ledger: PaperTradingLedger, args: OpenPositionArgs): { next: PaperTradingLedger; position: PaperTradingPosition } {
  const now = args.now ?? new Date();
  const entryCredit = args.entryFill.simulatedFillValue;
  const { reservedCapital, theoreticalMaxLoss } = computeCapitalRequirement(
    args.strategy,
    args.legs,
    args.quantity,
    args.contractMultiplier,
    entryCredit,
  );

  const view = deriveLedgerView(ledger);
  requireSufficientCapital(view.availableCapital, reservedCapital);

  const position: PaperTradingPosition = {
    positionId: args.positionId,
    idempotencyKey: args.idempotencyKey,
    userId: args.userId,
    symbol: args.symbol,
    strategy: args.strategy,
    legs: args.legs,
    expiration: args.expiration,
    quantity: args.quantity,
    contractMultiplier: args.contractMultiplier,
    entryTimestamp: now.toISOString(),
    entryFill: args.entryFill,
    entryCredit,
    capitalReserved: reservedCapital,
    theoreticalMaxLoss,
    entryRationale: args.entryRationale,
    status: 'open',
    currentMark: null,
    unrealizedPnl: null,
    closeTimestamp: null,
    closeFill: null,
    realizedPnl: null,
    auditRefs: args.auditRefs ?? [],
  };

  const nextLedger = touch(
    {
      ...ledger,
      cash: ledger.cash + entryCredit,
      reservedCapital: ledger.reservedCapital + reservedCapital,
      openPositions: [...ledger.openPositions, position],
    },
    now,
  );

  return { next: nextLedger, position };
}

export interface ClosePositionArgs {
  positionId: string;
  closeFill: PaperFillEvidence;
  auditRefs?: string[];
  now?: Date;
}

export function closePosition(ledger: PaperTradingLedger, args: ClosePositionArgs): { next: PaperTradingLedger; position: PaperTradingPosition } {
  const now = args.now ?? new Date();
  const openIndex = ledger.openPositions.findIndex((p) => p.positionId === args.positionId);

  if (openIndex === -1) {
    const alreadyClosed = ledger.closedPositions.some((p) => p.positionId === args.positionId);
    if (alreadyClosed) {
      throw new PaperTradingError('POSITION_ALREADY_CLOSED', 'This position has already been closed.', { positionId: args.positionId });
    }
    throw new PaperTradingError('POSITION_NOT_FOUND', 'Paper position not found.', { positionId: args.positionId });
  }

  const openPos = ledger.openPositions[openIndex];
  const closingDebit = args.closeFill.simulatedFillValue;
  const realizedPnl = openPos.entryCredit - closingDebit;

  const closedPosition: PaperTradingPosition = {
    ...openPos,
    status: 'closed',
    closeTimestamp: now.toISOString(),
    closeFill: args.closeFill,
    realizedPnl,
    unrealizedPnl: null,
    currentMark: null,
    auditRefs: [...openPos.auditRefs, ...(args.auditRefs ?? [])],
  };

  const remainingOpen = ledger.openPositions.filter((_, i) => i !== openIndex);

  const nextLedger = touch(
    {
      ...ledger,
      cash: ledger.cash - closingDebit,
      reservedCapital: ledger.reservedCapital - openPos.capitalReserved,
      openPositions: remainingOpen,
      closedPositions: [...ledger.closedPositions, closedPosition],
    },
    now,
  );

  return { next: nextLedger, position: closedPosition };
}

export function markPosition(
  ledger: PaperTradingLedger,
  positionId: string,
  markFill: import('./types').PaperFillEvidence,
  now: Date = new Date(),
): { next: PaperTradingLedger; position: PaperTradingPosition } {
  const index = ledger.openPositions.findIndex((p) => p.positionId === positionId);
  if (index === -1) throw new PaperTradingError('POSITION_NOT_FOUND', 'Paper position not found.', { positionId });

  const position = ledger.openPositions[index];
  const unrealizedPnl = position.entryCredit - markFill.simulatedFillValue;
  const updated: PaperTradingPosition = { ...position, currentMark: markFill, unrealizedPnl };

  const nextOpen = [...ledger.openPositions];
  nextOpen[index] = updated;

  const nextLedger = touch({ ...ledger, openPositions: nextOpen }, now);
  return { next: nextLedger, position: updated };
}

export function resetLedger(userId: string, startingBalance: number, now: Date = new Date()): PaperTradingLedger {
  return createInitialLedger(userId, startingBalance, now);
}
