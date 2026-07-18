// lib/paper-trading/__tests__/pricing.test.ts

import { describe, expect, it } from 'vitest';
import {
  buildFillEvidence,
  computeMarketableFill,
  isStale,
  oldestQuoteAgeSeconds,
  resolveClosingAction,
  STALE_QUOTE_THRESHOLD_SECONDS,
  validateQuoteSnapshot,
} from '../pricing';
import { PaperTradingError } from '../types';
import type { PaperLeg, PaperQuoteSnapshot } from '../types';

const NOW = new Date('2026-08-01T15:00:00.000Z');
const FRESH_TS = new Date(NOW.getTime() - 30_000).toISOString();
const STALE_TS = new Date(NOW.getTime() - (STALE_QUOTE_THRESHOLD_SECONDS + 60) * 1000).toISOString();

const shortLeg: PaperLeg = { legId: 'short', optionType: 'put', strike: 500, expiration: '2026-08-21', openAction: 'sell_to_open' };
const longLeg: PaperLeg = { legId: 'long', optionType: 'put', strike: 490, expiration: '2026-08-21', openAction: 'buy_to_open' };
const legs = [shortLeg, longLeg];

function snapshot(overrides: Partial<Record<'short' | 'long', { bid: number | null; ask: number | null }>> = {}, ts = FRESH_TS): PaperQuoteSnapshot {
  const short = overrides.short ?? { bid: 3.0, ask: 3.2 };
  const long = overrides.long ?? { bid: 1.0, ask: 1.2 };
  return {
    source: 'manual',
    legs: [
      { legId: 'short', bid: short.bid, ask: short.ask, mid: null, quoteTimestamp: ts },
      { legId: 'long', bid: long.bid, ask: long.ask, mid: null, quoteTimestamp: ts },
    ],
  };
}

describe('resolveClosingAction', () => {
  it('maps sell_to_open -> buy_to_close and buy_to_open -> sell_to_close', () => {
    expect(resolveClosingAction('sell_to_open')).toBe('buy_to_close');
    expect(resolveClosingAction('buy_to_open')).toBe('sell_to_close');
  });
});

describe('computeMarketableFill direction conventions', () => {
  it('OPEN: sell_to_open uses bid, buy_to_open uses ask', () => {
    const snap = snapshot();
    const { netValue } = computeMarketableFill(legs, snap, 'open', 1, 100);
    // short put opens at bid (3.0, +) and long put opens at ask (1.2, -)
    expect(netValue).toBeCloseTo((3.0 - 1.2) * 100, 5);
  });

  it('CLOSE: buy_to_close (was short) uses ask, sell_to_close (was long) uses bid', () => {
    const snap = snapshot();
    const { netValue } = computeMarketableFill(legs, snap, 'close', 1, 100);
    // closing the short put costs the ask (3.2, +debit), closing the long put returns the bid (1.0, -debit)
    expect(netValue).toBeCloseTo((3.2 - 1.0) * 100, 5);
  });

  it('keeps mid separate from the marketable fill and computes slippage as the difference', () => {
    const snap: PaperQuoteSnapshot = {
      source: 'manual',
      legs: [
        { legId: 'short', bid: 3.0, ask: 3.2, mid: 3.1, quoteTimestamp: FRESH_TS },
        { legId: 'long', bid: 1.0, ask: 1.2, mid: 1.1, quoteTimestamp: FRESH_TS },
      ],
    };
    const { netValue, midNetValue, slippage } = computeMarketableFill(legs, snap, 'open', 1, 100);
    expect(midNetValue).toBeCloseTo((3.1 - 1.1) * 100, 5);
    expect(slippage).toBeCloseTo(Math.abs(midNetValue! - netValue), 5);
  });
});

describe('validateQuoteSnapshot invalid-quote rejection (section 7.3)', () => {
  it('rejects a missing bid/ask needed for the action', () => {
    const snap = snapshot({ short: { bid: null, ask: 3.2 } });
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(PaperTradingError);
  });

  it('rejects a zero price', () => {
    const snap = snapshot({ short: { bid: 0, ask: 3.2 } });
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(/non-positive/);
  });

  it('rejects a negative price', () => {
    const snap = snapshot({ short: { bid: -1, ask: 3.2 } });
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(/non-positive/);
  });

  it('rejects a crossed quote (bid > ask)', () => {
    const snap = snapshot({ short: { bid: 5, ask: 3.2 } });
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(/crossed/i);
  });

  it('rejects a missing leg identity', () => {
    const snap: PaperQuoteSnapshot = { source: 'manual', legs: [{ legId: 'short', bid: 3, ask: 3.2, mid: null, quoteTimestamp: FRESH_TS }] };
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(/Missing quote evidence/);
  });

  it('rejects an unparsable quote timestamp', () => {
    const snap = snapshot({}, 'not-a-timestamp');
    expect(() => validateQuoteSnapshot(legs, snap, 'open')).toThrow(/timestamp/i);
  });
});

describe('stale-quote policy (section 7.4)', () => {
  it('classifies a quote older than the threshold as stale', () => {
    const age = oldestQuoteAgeSeconds(snapshot({}, STALE_TS), NOW);
    expect(isStale(age)).toBe(true);
  });

  it('classifies a fresh quote as not stale', () => {
    const age = oldestQuoteAgeSeconds(snapshot({}, FRESH_TS), NOW);
    expect(isStale(age)).toBe(false);
  });

  it('buildFillEvidence requires explicit confirmation for a stale quote', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: snapshot({}, STALE_TS),
        side: 'open',
        staleConfirmed: false,
        manualOverride: null,
        now: NOW,
      }),
    ).toThrow(PaperTradingError);
  });

  it('buildFillEvidence accepts a confirmed stale quote and labels it stale_confirmed', () => {
    const evidence = buildFillEvidence({
      legs,
      quantity: 1,
      contractMultiplier: 100,
      quoteSnapshot: snapshot({}, STALE_TS),
      side: 'open',
      staleConfirmed: true,
      manualOverride: null,
      now: NOW,
    });
    expect(evidence.pricingSource).toBe('stale_confirmed');
    expect(evidence.staleQuoteConfirmed).toBe(true);
  });
});

describe('manual override (section 7.5)', () => {
  it('requires explicit confirmation fields', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: null,
        side: 'open',
        staleConfirmed: false,
        manualOverride: { manualPrice: 200, reason: '', confirmedAt: '', confirmedByUser: '' },
        now: NOW,
      }),
    ).toThrow(/confirmation/i);
  });

  it('is never labeled marketable, and never used as an automatic fallback for a missing quote', () => {
    const evidence = buildFillEvidence({
      legs,
      quantity: 1,
      contractMultiplier: 100,
      quoteSnapshot: null,
      side: 'open',
      staleConfirmed: false,
      manualOverride: { manualPrice: 200, reason: 'after hours', confirmedAt: NOW.toISOString(), confirmedByUser: 'dean' },
      now: NOW,
    });
    expect(evidence.pricingSource).toBe('manual_paper_fill');
    expect(evidence.marketableValue).toBeNull();
    expect(evidence.simulatedFillValue).toBe(200);
  });

  it('without an override and without a quote snapshot, the fill is rejected rather than silently falling back', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: null,
        side: 'open',
        staleConfirmed: false,
        manualOverride: null,
        now: NOW,
      }),
    ).toThrow(PaperTradingError);
  });
});

describe('fill-value economic validation (corrective round fix #5)', () => {
  const confirmedOverride = (manualPrice: number) => ({
    manualPrice,
    reason: 'test',
    confirmedAt: NOW.toISOString(),
    confirmedByUser: 'u1',
  });

  it('rejects a zero manual entry credit', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: null,
        side: 'open',
        staleConfirmed: false,
        manualOverride: confirmedOverride(0),
        now: NOW,
      }),
    ).toThrow(/positive/i);
  });

  it('rejects a negative manual entry credit', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: null,
        side: 'open',
        staleConfirmed: false,
        manualOverride: confirmedOverride(-50),
        now: NOW,
      }),
    ).toThrow(/positive/i);
  });

  it('rejects a zero quote-derived entry credit (net-zero vertical spread)', () => {
    // short bid == long ask -> net entry credit is exactly zero.
    const snap = snapshot({ short: { bid: 1.2, ask: 1.4 }, long: { bid: 1.0, ask: 1.2 } });
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: snap,
        side: 'open',
        staleConfirmed: false,
        manualOverride: null,
        now: NOW,
      }),
    ).toThrow(/positive/i);
  });

  it('rejects a negative quote-derived entry credit (a debit vertical masquerading as a credit strategy)', () => {
    // short bid (1.0) < long ask (1.2) -> negative net entry credit.
    const snap = snapshot({ short: { bid: 1.0, ask: 1.1 }, long: { bid: 1.1, ask: 1.2 } });
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: snap,
        side: 'open',
        staleConfirmed: false,
        manualOverride: null,
        now: NOW,
      }),
    ).toThrow(/positive/i);
  });

  it('rejects a negative closing debit (a malformed/crossed close that would pay the trader cash it never owed)', () => {
    // short ask (1.0) < long bid (1.2) -> negative net closing debit.
    const snap = snapshot({ short: { bid: 0.9, ask: 1.0 }, long: { bid: 1.2, ask: 1.3 } });
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: snap,
        side: 'close',
        staleConfirmed: false,
        manualOverride: null,
        now: NOW,
      }),
    ).toThrow(/non-negative|closing debit/i);
  });

  it('rejects a negative manual closing debit', () => {
    expect(() =>
      buildFillEvidence({
        legs,
        quantity: 1,
        contractMultiplier: 100,
        quoteSnapshot: null,
        side: 'close',
        staleConfirmed: false,
        manualOverride: confirmedOverride(-10),
        now: NOW,
      }),
    ).toThrow(/non-negative|closing debit/i);
  });

  it('accepts a valid positive entry credit', () => {
    const evidence = buildFillEvidence({
      legs,
      quantity: 1,
      contractMultiplier: 100,
      quoteSnapshot: snapshot(),
      side: 'open',
      staleConfirmed: false,
      manualOverride: null,
      now: NOW,
    });
    expect(evidence.simulatedFillValue).toBeGreaterThan(0);
  });

  it('accepts a valid zero closing debit (retained policy: zero is acceptable for a close given valid pricing evidence)', () => {
    // short ask (1.0) == long bid (1.0) -> net closing debit is exactly zero.
    const snap = snapshot({ short: { bid: 0.9, ask: 1.0 }, long: { bid: 1.0, ask: 1.1 } });
    const evidence = buildFillEvidence({
      legs,
      quantity: 1,
      contractMultiplier: 100,
      quoteSnapshot: snap,
      side: 'close',
      staleConfirmed: false,
      manualOverride: null,
      now: NOW,
    });
    // toBeCloseTo (not toBe) -- floating-point cancellation can legitimately
    // produce -0 here, which is mathematically equal to 0 for this policy.
    expect(evidence.simulatedFillValue).toBeCloseTo(0, 8);
  });

  it('accepts a valid positive closing debit', () => {
    const evidence = buildFillEvidence({
      legs,
      quantity: 1,
      contractMultiplier: 100,
      quoteSnapshot: snapshot(),
      side: 'close',
      staleConfirmed: false,
      manualOverride: null,
      now: NOW,
    });
    expect(evidence.simulatedFillValue).toBeGreaterThan(0);
  });
});
