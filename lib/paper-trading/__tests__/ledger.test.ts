// lib/paper-trading/__tests__/ledger.test.ts
//
// PT-0001 accounting invariants (section 6.1 / 14 "Capital and accounting").

import { describe, expect, it } from 'vitest';
import { closePosition, createInitialLedger, deriveLedgerView, markPosition, openPosition, resetLedger } from '../ledger';
import { PaperTradingError } from '../types';
import type { PaperFillEvidence, PaperLeg } from '../types';

const NOW = new Date('2026-08-01T15:00:00.000Z');

function fill(value: number, source: PaperFillEvidence['pricingSource'] = 'marketable'): PaperFillEvidence {
  return {
    pricingSource: source,
    midValue: value,
    marketableValue: value,
    simulatedFillValue: value,
    slippage: 0,
    quoteAgeSeconds: 10,
    staleQuoteConfirmed: false,
    manualOverride: null,
    quoteSnapshot: null,
    evaluatedAt: NOW.toISOString(),
  };
}

const cspLegs: PaperLeg[] = [{ legId: 'p', optionType: 'put', strike: 400, expiration: '2026-08-21', openAction: 'sell_to_open' }];

describe('ledger accounting invariants', () => {
  it('entry credit increases cash', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const { next } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    expect(next.cash).toBe(100000 + 300);
  });

  it('reserved capital reduces available capital but not current equity', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const before = deriveLedgerView(ledger);
    const { next } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    const after = deriveLedgerView(next);
    // reserved capital = strike(400) * 100 * 1 = 40000
    expect(next.reservedCapital).toBe(40000);
    expect(after.availableCapital).toBe(after.ledger.cash - 40000);
    // Equity should reflect only unrealized P/L, not the reservation itself.
    // With no mark yet, unrealizedPnl defaults to 0, so equity == starting balance.
    expect(after.currentEquity).toBe(before.currentEquity);
  });

  it('rejects opening a position that exceeds available capital', () => {
    const ledger = createInitialLedger('u1', 1000, NOW); // too small for a $400 strike CSP
    expect(() =>
      openPosition(ledger, {
        positionId: 'pos1',
        idempotencyKey: 'k1',
        userId: 'u1',
        symbol: 'SPY',
        strategy: 'CSP',
        legs: cspLegs,
        expiration: '2026-08-21',
        quantity: 1,
        contractMultiplier: 100,
        entryFill: fill(300),
        entryRationale: null,
        now: NOW,
      }),
    ).toThrow(PaperTradingError);
  });

  it('marking a position updates unrealized P/L and equity without touching cash', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const { next: afterOpen } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    const cashBeforeMark = afterOpen.cash;
    const { next: afterMark } = markPosition(afterOpen, 'pos1', fill(500), NOW); // now costs more to close -> unrealized loss
    expect(afterMark.cash).toBe(cashBeforeMark);
    const view = deriveLedgerView(afterMark);
    expect(view.unrealizedPnl).toBe(300 - 500);
    expect(view.currentEquity).toBe(100000 + (300 - 500));
  });

  it('close debit reduces cash and releases reserved capital; realized P/L reconciles', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const { next: afterOpen } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    const cashAfterOpen = afterOpen.cash;
    const reservedAfterOpen = afterOpen.reservedCapital;

    const { next: afterClose, position: closed } = closePosition(afterOpen, { positionId: 'pos1', closeFill: fill(100), now: NOW });

    expect(afterClose.cash).toBe(cashAfterOpen - 100);
    expect(afterClose.reservedCapital).toBe(reservedAfterOpen - closed.capitalReserved);
    expect(afterClose.reservedCapital).toBe(0);
    expect(closed.realizedPnl).toBe(300 - 100);

    const view = deriveLedgerView(afterClose);
    expect(view.realizedPnl).toBe(200);
    expect(view.currentEquity).toBe(100000 + 200);
  });

  it('rejects closing an already-closed position', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const { next: afterOpen } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    const { next: afterClose } = closePosition(afterOpen, { positionId: 'pos1', closeFill: fill(100), now: NOW });
    expect(() => closePosition(afterClose, { positionId: 'pos1', closeFill: fill(50), now: NOW })).toThrow(/already been closed/);
  });

  it('rejects closing a position that does not exist', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    expect(() => closePosition(ledger, { positionId: 'nope', closeFill: fill(50), now: NOW })).toThrow(/not found/i);
  });

  it('peak equity only ever increases, tracking the high-water mark', () => {
    const ledger = createInitialLedger('u1', 100000, NOW);
    const { next: afterOpen } = openPosition(ledger, {
      positionId: 'pos1',
      idempotencyKey: 'k1',
      userId: 'u1',
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: '2026-08-21',
      quantity: 1,
      contractMultiplier: 100,
      entryFill: fill(300),
      entryRationale: null,
      now: NOW,
    });
    const { next: markedUp } = markPosition(afterOpen, 'pos1', fill(50), NOW); // big unrealized gain
    expect(markedUp.peakEquity).toBeGreaterThan(100000);
    const peakAfterGain = markedUp.peakEquity;

    const { next: markedDown } = markPosition(markedUp, 'pos1', fill(2000), NOW); // now a big unrealized loss
    expect(markedDown.peakEquity).toBe(peakAfterGain); // peak never decreases
  });

  it('reset produces a fresh ledger with the new starting balance and no positions', () => {
    const fresh = resetLedger('u1', 50000, NOW);
    expect(fresh.startingBalance).toBe(50000);
    expect(fresh.cash).toBe(50000);
    expect(fresh.reservedCapital).toBe(0);
    expect(fresh.openPositions).toHaveLength(0);
    expect(fresh.closedPositions).toHaveLength(0);
    expect(deriveLedgerView(fresh).currentEquity).toBe(50000);
  });
});
