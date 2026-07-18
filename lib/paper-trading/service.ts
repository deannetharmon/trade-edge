// lib/paper-trading/service.ts
//
// PT-0001: the single orchestration layer API routes call. Combines
// validation, pricing, capital, ledger mutation, idempotency, and audit
// under one lock acquisition per request (see persistence/store.ts's
// mutatePaperTradingLedger) so a duplicate/concurrent submission can never
// race the check for either the idempotency record or capital availability.
//
// No function in this file (or anything it imports) calls, imports, or is
// imported by the broker order-submission module or its order builders. See
// __tests__/liveIsolation.test.ts for the enforced boundary test.

import { appendPaperAuditEvent } from './audit';
import { computeCapitalRequirement } from './capital';
import { checkIdempotency, storeIdempotencyResult } from './idempotency';
import { closePosition, deriveLedgerView, markPosition, openPosition, resetLedger } from './ledger';
import { mutatePaperTradingLedger } from './persistence/store';
import { buildFillEvidence, resolveClosingAction } from './pricing';
import {
  PaperTradingError,
  type PaperFillEvidence,
  type PaperLeg,
  type PaperManualFillOverride,
  type PaperQuoteSnapshot,
  type PaperStrategy,
  type PaperTradingLedgerView,
  type PaperTradingPosition,
} from './types';
import { validateTicket } from './validation';

const CONTRACT_MULTIPLIER = 100;

function createPositionId(): string {
  return `paper_pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface OpenPaperPositionRequest {
  userId: string;
  idempotencyKey: string;
  symbol: string;
  strategy: PaperStrategy;
  legs: PaperLeg[];
  expiration: string;
  quantity: number;
  quoteSnapshot: PaperQuoteSnapshot | null;
  staleConfirmed: boolean;
  manualOverride: PaperManualFillOverride | null;
  entryRationale: string | null;
}

export interface PaperMutationResult {
  position: PaperTradingPosition;
  ledgerView: PaperTradingLedgerView;
  replay: boolean;
}

export async function openPaperPosition(req: OpenPaperPositionRequest): Promise<PaperMutationResult> {
  const idempotencyPayload = {
    symbol: req.symbol,
    strategy: req.strategy,
    legs: req.legs,
    expiration: req.expiration,
    quantity: req.quantity,
    quoteSnapshot: req.quoteSnapshot,
    manualOverride: req.manualOverride,
  };

  validateTicket({
    symbol: req.symbol,
    strategy: req.strategy,
    expiration: req.expiration,
    quantity: req.quantity,
    legs: req.legs,
  });

  return mutatePaperTradingLedger(req.userId, (current) => {
    const view = deriveLedgerView(current);

    return (async () => {
      const idem = await checkIdempotency<PaperMutationResult>(req.userId, 'open', req.idempotencyKey, idempotencyPayload);
      if (idem.replay && idem.result) {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'entry_duplicate_replayed',
          operation: 'open',
          positionId: idem.result.position.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_idempotent_replay'],
        });
        return { next: current, extra: { ...idem.result, replay: true } };
      }

      let entryFill: PaperFillEvidence;
      try {
        entryFill = buildFillEvidence({
          legs: req.legs,
          quantity: req.quantity,
          contractMultiplier: CONTRACT_MULTIPLIER,
          quoteSnapshot: req.quoteSnapshot,
          side: 'open',
          staleConfirmed: req.staleConfirmed,
          manualOverride: req.manualOverride,
        });
      } catch (e) {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'entry_rejected',
          operation: 'open',
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_fill_evidence_rejected'],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        });
        throw e;
      }

      let openResult;
      try {
        openResult = openPosition(current, {
          positionId: createPositionId(),
          idempotencyKey: req.idempotencyKey,
          userId: req.userId,
          symbol: req.symbol,
          strategy: req.strategy,
          legs: req.legs,
          expiration: req.expiration,
          quantity: req.quantity,
          contractMultiplier: CONTRACT_MULTIPLIER,
          entryFill,
          entryRationale: req.entryRationale,
        });
      } catch (e) {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'entry_rejected',
          operation: 'open',
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_capital_or_ledger_rejected'],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
          capitalBefore: view.availableCapital,
        });
        throw e;
      }

      const nextView = deriveLedgerView(openResult.next);
      const result: PaperMutationResult = { position: openResult.position, ledgerView: nextView, replay: false };

      await appendPaperAuditEvent(req.userId, {
        userId: req.userId,
        eventType: 'entry_accepted',
        operation: 'open',
        positionId: openResult.position.positionId,
        timestamp: new Date().toISOString(),
        idempotencyKey: req.idempotencyKey,
        pricingSource: entryFill.pricingSource,
        quoteAgeSeconds: entryFill.quoteAgeSeconds,
        capitalBefore: view.availableCapital,
        capitalAfter: nextView.availableCapital,
        cashBefore: current.cash,
        cashAfter: openResult.next.cash,
        ruleIds: ['pt_entry_accepted'],
      });

      if (entryFill.pricingSource === 'stale_confirmed') {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'stale_quote_confirmed',
          operation: 'open',
          positionId: openResult.position.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          quoteAgeSeconds: entryFill.quoteAgeSeconds,
          ruleIds: ['pt_stale_quote_confirmed'],
        });
      }
      if (entryFill.pricingSource === 'manual_paper_fill') {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'manual_fill_override_confirmed',
          operation: 'open',
          positionId: openResult.position.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_manual_fill_override'],
        });
      }

      await storeIdempotencyResult(req.userId, 'open', req.idempotencyKey, idempotencyPayload, result);

      return { next: openResult.next, extra: result };
    })();
  });
}

export interface ClosePaperPositionRequest {
  userId: string;
  idempotencyKey: string;
  positionId: string;
  quoteSnapshot: PaperQuoteSnapshot | null;
  staleConfirmed: boolean;
  manualOverride: PaperManualFillOverride | null;
}

export async function closePaperPosition(req: ClosePaperPositionRequest): Promise<PaperMutationResult> {
  const idempotencyPayload = {
    positionId: req.positionId,
    quoteSnapshot: req.quoteSnapshot,
    manualOverride: req.manualOverride,
  };

  return mutatePaperTradingLedger(req.userId, (current) => {
    return (async () => {
      const idem = await checkIdempotency<PaperMutationResult>(req.userId, 'close', req.idempotencyKey, idempotencyPayload);
      if (idem.replay && idem.result) {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'close_duplicate_replayed',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_idempotent_replay'],
        });
        return { next: current, extra: { ...idem.result, replay: true } };
      }

      const openPos = current.openPositions.find((p) => p.positionId === req.positionId);
      if (!openPos) {
        const alreadyClosed = current.closedPositions.some((p) => p.positionId === req.positionId);
        const code = alreadyClosed ? 'POSITION_ALREADY_CLOSED' : 'POSITION_NOT_FOUND';
        const message = alreadyClosed ? 'This position has already been closed.' : 'Paper position not found.';
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'close_rejected',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_close_target_invalid'],
          failureReason: code,
        });
        throw new PaperTradingError(code, message, { positionId: req.positionId });
      }

      let closeFill: PaperFillEvidence;
      try {
        closeFill = buildFillEvidence({
          legs: openPos.legs,
          quantity: openPos.quantity,
          contractMultiplier: openPos.contractMultiplier,
          quoteSnapshot: req.quoteSnapshot,
          side: 'close',
          staleConfirmed: req.staleConfirmed,
          manualOverride: req.manualOverride,
        });
      } catch (e) {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'close_rejected',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_fill_evidence_rejected'],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        });
        throw e;
      }

      const view = deriveLedgerView(current);
      const closeResult = closePosition(current, { positionId: req.positionId, closeFill });
      const nextView = deriveLedgerView(closeResult.next);
      const result: PaperMutationResult = { position: closeResult.position, ledgerView: nextView, replay: false };

      await appendPaperAuditEvent(req.userId, {
        userId: req.userId,
        eventType: 'close_accepted',
        operation: 'close',
        positionId: req.positionId,
        timestamp: new Date().toISOString(),
        idempotencyKey: req.idempotencyKey,
        pricingSource: closeFill.pricingSource,
        quoteAgeSeconds: closeFill.quoteAgeSeconds,
        capitalBefore: view.availableCapital,
        capitalAfter: nextView.availableCapital,
        cashBefore: current.cash,
        cashAfter: closeResult.next.cash,
        ruleIds: ['pt_close_accepted'],
      });

      if (closeFill.pricingSource === 'stale_confirmed') {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'stale_quote_confirmed',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          quoteAgeSeconds: closeFill.quoteAgeSeconds,
          ruleIds: ['pt_stale_quote_confirmed'],
        });
      }
      if (closeFill.pricingSource === 'manual_paper_fill') {
        await appendPaperAuditEvent(req.userId, {
          userId: req.userId,
          eventType: 'manual_fill_override_confirmed',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_manual_fill_override'],
        });
      }

      await storeIdempotencyResult(req.userId, 'close', req.idempotencyKey, idempotencyPayload, result);

      return { next: closeResult.next, extra: result };
    })();
  });
}

export interface ResetPaperLedgerRequest {
  userId: string;
  idempotencyKey: string;
  startingBalance: number;
}

export async function resetPaperLedger(req: ResetPaperLedgerRequest): Promise<{ ledgerView: PaperTradingLedgerView; replay: boolean }> {
  if (!Number.isFinite(req.startingBalance) || req.startingBalance <= 0) {
    throw new PaperTradingError('VALIDATION_ERROR', 'Starting balance must be a positive number.', {
      startingBalance: req.startingBalance,
    });
  }

  const idempotencyPayload = { startingBalance: req.startingBalance };

  return mutatePaperTradingLedger(req.userId, (current) => {
    return (async () => {
      const idem = await checkIdempotency<{ ledgerView: PaperTradingLedgerView; replay: boolean }>(
        req.userId,
        'reset',
        req.idempotencyKey,
        idempotencyPayload,
      );
      if (idem.replay && idem.result) {
        return { next: current, extra: { ...idem.result, replay: true } };
      }

      const next = resetLedger(req.userId, req.startingBalance);
      const result = { ledgerView: deriveLedgerView(next), replay: false };

      await appendPaperAuditEvent(req.userId, {
        userId: req.userId,
        eventType: 'account_reset',
        operation: 'reset',
        timestamp: new Date().toISOString(),
        idempotencyKey: req.idempotencyKey,
        cashBefore: current.cash,
        cashAfter: next.cash,
        ruleIds: ['pt_account_reset'],
      });

      await storeIdempotencyResult(req.userId, 'reset', req.idempotencyKey, idempotencyPayload, result);

      return { next, extra: result };
    })();
  });
}

export interface RefreshMarkRequest {
  userId: string;
  positionId: string;
  quoteSnapshot: PaperQuoteSnapshot | null;
  manualOverride: PaperManualFillOverride | null;
  staleConfirmed: boolean;
}

/**
 * Mark refresh is NOT idempotency-guarded (section 9.1 lists open/close/
 * reset only) — it is a read-mostly, non-cumulative operation: refreshing
 * twice with the same quote just recomputes the same mark. Still runs under
 * the same mutation lock for atomicity with any concurrent open/close.
 */
export async function refreshPaperMark(req: RefreshMarkRequest): Promise<PaperMutationResult> {
  return mutatePaperTradingLedger(req.userId, (current) => {
    const position = current.openPositions.find((p) => p.positionId === req.positionId);
    if (!position) throw new PaperTradingError('POSITION_NOT_FOUND', 'Paper position not found.', { positionId: req.positionId });

    const closingLegs = position.legs.map((l) => ({ ...l, openAction: l.openAction }));
    const markFill = buildFillEvidence({
      legs: closingLegs,
      quantity: position.quantity,
      contractMultiplier: position.contractMultiplier,
      quoteSnapshot: req.quoteSnapshot,
      side: 'close',
      staleConfirmed: req.staleConfirmed,
      manualOverride: req.manualOverride,
    });

    const { next, position: updated } = markPosition(current, req.positionId, markFill);
    const ledgerView = deriveLedgerView(next);
    return { next, extra: { position: updated, ledgerView, replay: false } };
  });
}

export { resolveClosingAction, computeCapitalRequirement };
