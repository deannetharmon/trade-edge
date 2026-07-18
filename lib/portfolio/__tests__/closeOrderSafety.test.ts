// lib/portfolio/__tests__/closeOrderSafety.test.ts
//
// ES-0001: regression tests for the canonical close-order identity,
// quantity-consistent grouping, break-even math, and the safety gate.
//
// Fixture note: the "merged distinct spreads" scenarios below (e.g.
// AAPL_MERGED_TWO_SPREADS) are an ANONYMIZED, SYNTHETIC reproduction of the
// failure SHAPE that this ticket investigates -- two independently-opened
// spreads sharing a symbol/expiration but differing in strike and/or
// quantity, merged by the old `${symbol}::${expiration}`-only grouping key.
// These are not a copy of any real account's positions or transaction data;
// no such real data exists in this repository to draw from.

import { describe, expect, it } from 'vitest';
import {
  groupEconomicLegs,
  buildCanonicalCloseIdentity,
  computeBreakEvenLimitPrice,
  runCloseOrderSafetyGate,
  type RawEconomicLeg,
  type CanonicalCloseIdentity,
} from '../closeOrderSafety';

function leg(overrides: Partial<RawEconomicLeg>): RawEconomicLeg {
  return {
    symbol: 'AAPL240816P00200000',
    optionType: 'P',
    strikePrice: 200,
    direction: 'Short',
    quantity: 1,
    avgOpenPrice: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupEconomicLegs
// ---------------------------------------------------------------------------

describe('groupEconomicLegs', () => {
  it('keeps the legacy `${symbol}::${expiration}` key when every leg shares one quantity (single BPS, no regression)', () => {
    const legs = [
      leg({ symbol: 'AAPL240816P00200000', strikePrice: 200, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'AAPL240816P00195000', strikePrice: 195, direction: 'Long', quantity: 2 }),
    ];
    const groups = groupEconomicLegs('AAPL', '2024-08-16', legs);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('AAPL::2024-08-16');
    expect(groups[0].quantity).toBe(2);
    expect(groups[0].legs).toHaveLength(2);
  });

  it('keeps a genuine 4-leg iron condor merged when all four legs share one quantity', () => {
    const legs = [
      leg({ symbol: 'SPY240816P00500000', optionType: 'P', strikePrice: 500, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'SPY240816P00495000', optionType: 'P', strikePrice: 495, direction: 'Long', quantity: 3 }),
      leg({ symbol: 'SPY240816C00560000', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'SPY240816C00565000', optionType: 'C', strikePrice: 565, direction: 'Long', quantity: 3 }),
    ];
    const groups = groupEconomicLegs('SPY', '2024-08-16', legs);
    expect(groups).toHaveLength(1);
    expect(groups[0].legs).toHaveLength(4);
    expect(groups[0].quantity).toBe(3);
  });

  it('SPLITS two independently-opened spreads with different quantities at the same symbol+expiration (the confirmed danger case)', () => {
    // Anonymized/synthetic failure-shape fixture: a 2-lot BPS at 200/195 and
    // an unrelated 3-lot BPS at 190/185, both AAPL, both same expiration.
    const legs = [
      leg({ symbol: 'AAPL240816P00200000', strikePrice: 200, direction: 'Short', quantity: 2, avgOpenPrice: 1.20 }),
      leg({ symbol: 'AAPL240816P00195000', strikePrice: 195, direction: 'Long', quantity: 2, avgOpenPrice: 0.60 }),
      leg({ symbol: 'AAPL240816P00190000', strikePrice: 190, direction: 'Short', quantity: 3, avgOpenPrice: 0.90 }),
      leg({ symbol: 'AAPL240816P00185000', strikePrice: 185, direction: 'Long', quantity: 3, avgOpenPrice: 0.40 }),
    ];
    const groups = groupEconomicLegs('AAPL', '2024-08-16', legs);
    expect(groups).toHaveLength(2);
    const qtys = groups.map(g => g.quantity).sort((a, b) => a - b);
    expect(qtys).toEqual([2, 3]);
    // New split keys are suffixed so they never collide with any pre-existing
    // (and, for this bug shape, previously-incorrect) merged key.
    expect(groups.every(g => g.key.startsWith('AAPL::2024-08-16::'))).toBe(true);
    expect(new Set(groups.map(g => g.key)).size).toBe(2);
  });

  it('splits three-way when three distinct quantities are present', () => {
    const legs = [
      leg({ symbol: 'A1', direction: 'Short', quantity: 1 }),
      leg({ symbol: 'A2', direction: 'Long', quantity: 1 }),
      leg({ symbol: 'B1', direction: 'Short', quantity: 2 }),
      leg({ symbol: 'B2', direction: 'Long', quantity: 2 }),
      leg({ symbol: 'C1', direction: 'Short', quantity: 5 }),
      leg({ symbol: 'C2', direction: 'Long', quantity: 5 }),
    ];
    const groups = groupEconomicLegs('XYZ', '2024-09-20', legs);
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.quantity)).toEqual([1, 2, 5]);
  });

  it('treats quantity sign/magnitude consistently -- negative-looking quantities never wrongly split a coherent group', () => {
    const legs = [
      leg({ symbol: 'A1', direction: 'Short', quantity: 2 }),
      leg({ symbol: 'A2', direction: 'Long', quantity: -2 as unknown as number }), // defensive: some feeds could carry signed values
    ];
    const groups = groupEconomicLegs('AAPL', '2024-08-16', legs);
    expect(groups).toHaveLength(1);
    expect(groups[0].quantity).toBe(2);
  });

  it('returns an empty array for an empty leg list', () => {
    expect(groupEconomicLegs('AAPL', '2024-08-16', [])).toEqual([]);
  });

  it('treats a zero-quantity leg as its own group rather than crashing', () => {
    const legs = [leg({ symbol: 'A1', quantity: 0 })];
    const groups = groupEconomicLegs('AAPL', '2024-08-16', legs);
    expect(groups).toHaveLength(1);
    expect(groups[0].quantity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCanonicalCloseIdentity / computeBreakEvenLimitPrice
// ---------------------------------------------------------------------------

describe('buildCanonicalCloseIdentity', () => {
  it('computes creditPerContract from the canonical (uniform) quantity, not an arbitrary leg', () => {
    const legs = [
      leg({ symbol: 'AAPL240816P00200000', direction: 'Short', quantity: 4 }),
      leg({ symbol: 'AAPL240816P00195000', direction: 'Long', quantity: 4 }),
    ];
    const group = { key: 'AAPL::2024-08-16', underlying: 'AAPL', expiration: '2024-08-16', quantity: 4, legs };
    const identity = buildCanonicalCloseIdentity(group, 240); // $240 total credit, 4 contracts
    expect(identity.quantity).toBe(4);
    expect(identity.creditPerContract).toBeCloseTo(0.6, 5); // 240 / (4*100)
  });

  it('falls back to quantity=1 (never divides by zero) if the group quantity is 0', () => {
    const group = { key: 'AAPL::2024-08-16', underlying: 'AAPL', expiration: '2024-08-16', quantity: 0, legs: [] };
    const identity = buildCanonicalCloseIdentity(group, 0);
    expect(identity.quantity).toBe(1);
    expect(identity.creditPerContract).toBe(0);
  });

  it('demonstrates the CONFIRMED bug shape: the old "first Short leg" idiom produces a different, wrong number when a group is a merge of two spreads, while the canonical split fixes it', () => {
    // Reproduces production code's old idiom: creditReceived (aggregate) / (firstShortLeg.quantity * 100)
    const mergedLegs = [
      leg({ symbol: 'AAPL240816P00200000', strikePrice: 200, direction: 'Short', quantity: 2, avgOpenPrice: 1.20 }),
      leg({ symbol: 'AAPL240816P00195000', strikePrice: 195, direction: 'Long', quantity: 2, avgOpenPrice: 0.60 }),
      leg({ symbol: 'AAPL240816P00190000', strikePrice: 190, direction: 'Short', quantity: 3, avgOpenPrice: 0.90 }),
      leg({ symbol: 'AAPL240816P00185000', strikePrice: 185, direction: 'Long', quantity: 3, avgOpenPrice: 0.40 }),
    ];
    // Aggregate entry credit exactly as the app's calculateSpreadCredit computes it:
    // sum(Short: +price*qty, Long: -price*qty) * 100
    const aggregateCredit =
      (1.20 * 2 - 0.60 * 2 + 0.90 * 3 - 0.40 * 3) * 100; // = 270
    const oldFirstShortLeg = mergedLegs.find(l => l.direction === 'Short')!; // qty=2
    const oldCreditPerContract = aggregateCredit / (oldFirstShortLeg.quantity * 100);
    expect(oldCreditPerContract).toBeCloseTo(1.35, 5); // wrong: mixes both spreads' economics

    const groups = groupEconomicLegs('AAPL', '2024-08-16', mergedLegs);
    expect(groups).toHaveLength(2);
    const twoLot = groups.find(g => g.quantity === 2)!;
    const threeLot = groups.find(g => g.quantity === 3)!;
    const twoLotCredit = (1.20 - 0.60) * 2 * 100; // 120
    const threeLotCredit = (0.90 - 0.40) * 3 * 100; // 150
    const twoLotIdentity = buildCanonicalCloseIdentity(twoLot, twoLotCredit);
    const threeLotIdentity = buildCanonicalCloseIdentity(threeLot, threeLotCredit);
    expect(twoLotIdentity.creditPerContract).toBeCloseTo(0.6, 5);
    expect(threeLotIdentity.creditPerContract).toBeCloseTo(0.5, 5);
    // Neither canonical per-spread number equals the old merged/mis-attributed figure.
    expect(twoLotIdentity.creditPerContract).not.toBeCloseTo(oldCreditPerContract, 2);
    expect(threeLotIdentity.creditPerContract).not.toBeCloseTo(oldCreditPerContract, 2);
  });
});

describe('computeBreakEvenLimitPrice', () => {
  it('returns the per-contract entry credit as the break-even limit', () => {
    const identity: CanonicalCloseIdentity = {
      key: 'AAPL::2024-08-16', underlying: 'AAPL', expiration: '2024-08-16',
      quantity: 2, legs: [], creditReceived: 120, creditPerContract: 0.6,
    };
    expect(computeBreakEvenLimitPrice(identity)).toBeCloseTo(0.6, 5);
  });

  it('floors the break-even price at $0.01 (never zero or negative)', () => {
    const identity: CanonicalCloseIdentity = {
      key: 'AAPL::2024-08-16', underlying: 'AAPL', expiration: '2024-08-16',
      quantity: 1, legs: [], creditReceived: 0, creditPerContract: 0,
    };
    expect(computeBreakEvenLimitPrice(identity)).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// runCloseOrderSafetyGate
// ---------------------------------------------------------------------------

function okIdentity(overrides: Partial<CanonicalCloseIdentity> = {}): CanonicalCloseIdentity {
  return {
    key: 'AAPL::2024-08-16',
    underlying: 'AAPL',
    expiration: '2024-08-16',
    quantity: 2,
    legs: [
      leg({ symbol: 'AAPL240816P00200000', direction: 'Short', quantity: 2 }),
      leg({ symbol: 'AAPL240816P00195000', direction: 'Long', quantity: 2 }),
    ],
    creditReceived: 120,
    creditPerContract: 0.6,
    ...overrides,
  };
}

describe('runCloseOrderSafetyGate', () => {
  it('passes (ok=true, no block issues) for a fully coherent single-spread close', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
    });
    expect(result.ok).toBe(true);
    expect(result.issues.filter(i => i.severity === 'block')).toHaveLength(0);
  });

  it('BLOCKS with ZERO_OR_NEGATIVE_QUANTITY when identity.quantity is 0', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity({ quantity: 0 }),
      requestedClosingQuantity: 0,
      requestedLimitPrice: 0.6,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('ZERO_OR_NEGATIVE_QUANTITY');
  });

  it('BLOCKS with EMPTY_LEG_SET when there are no legs', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity({ legs: [] }),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('EMPTY_LEG_SET');
  });

  it('BLOCKS with LEG_QUANTITY_MISMATCH when a leg quantity disagrees with the canonical quantity (the confirmed danger shape)', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity({
        legs: [
          leg({ symbol: 'AAPL240816P00200000', direction: 'Short', quantity: 2 }),
          leg({ symbol: 'AAPL240816P00190000', direction: 'Short', quantity: 3 }), // mismatched
        ],
      }),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('LEG_QUANTITY_MISMATCH');
  });

  it('BLOCKS with REQUESTED_QTY_MISMATCH when the order-under-construction targets a different quantity than the position', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 5,
      requestedLimitPrice: 0.6,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REQUESTED_QTY_MISMATCH');
  });

  it('BLOCKS with LIMIT_PRICE_NON_POSITIVE for a zero limit price', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('LIMIT_PRICE_NON_POSITIVE');
  });

  it('BLOCKS with LIMIT_PRICE_NON_POSITIVE for a negative limit price', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: -0.5,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('LIMIT_PRICE_NON_POSITIVE');
  });

  it('accumulates multiple simultaneous block issues rather than stopping at the first', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity({ quantity: 0, legs: [] }),
      requestedClosingQuantity: 5,
      requestedLimitPrice: -1,
    });
    expect(result.ok).toBe(false);
    const ids = result.issues.map(i => i.ruleId);
    expect(ids).toEqual(expect.arrayContaining([
      'ZERO_OR_NEGATIVE_QUANTITY', 'EMPTY_LEG_SET', 'REQUESTED_QTY_MISMATCH', 'LIMIT_PRICE_NON_POSITIVE',
    ]));
  });

  it('WARNS (does not block) on a one-sided quote', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
      quoteIsOneSided: true,
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find(i => i.ruleId === 'ONE_SIDED_QUOTE');
    expect(issue?.severity).toBe('warn');
  });

  it('WARNS (does not block) on a stale quote past the default 5-minute threshold', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
      quoteAgeMs: 6 * 60 * 1000,
    });
    expect(result.ok).toBe(true);
    const issue = result.issues.find(i => i.ruleId === 'STALE_QUOTE');
    expect(issue?.severity).toBe('warn');
  });

  it('does not warn on a quote younger than the staleness threshold', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
      quoteAgeMs: 10_000,
    });
    expect(result.issues.map(i => i.ruleId)).not.toContain('STALE_QUOTE');
  });

  it('respects a custom maxQuoteAgeMs override', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
      quoteAgeMs: 5000,
      maxQuoteAgeMs: 1000,
    });
    expect(result.issues.map(i => i.ruleId)).toContain('STALE_QUOTE');
  });

  it('a warn-only result still reports ok=true (warnings alone never block submission)', () => {
    const result = runCloseOrderSafetyGate({
      identity: okIdentity(),
      requestedClosingQuantity: 2,
      requestedLimitPrice: 0.6,
      quoteIsOneSided: true,
      quoteAgeMs: 10 * 60 * 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.issues.every(i => i.severity === 'warn')).toBe(true);
  });

  it('end-to-end: the anonymized merged-spread fixture is blocked before it can be treated as one coherent close', () => {
    // Simulates constructing a close order directly off the OLD merged group
    // (pre-fix behavior) and running it through the new gate.
    const mergedLegs = [
      leg({ symbol: 'AAPL240816P00200000', direction: 'Short', quantity: 2 }),
      leg({ symbol: 'AAPL240816P00195000', direction: 'Long', quantity: 2 }),
      leg({ symbol: 'AAPL240816P00190000', direction: 'Short', quantity: 3 }),
      leg({ symbol: 'AAPL240816P00185000', direction: 'Long', quantity: 3 }),
    ];
    const oldMergedIdentity: CanonicalCloseIdentity = {
      key: 'AAPL::2024-08-16', underlying: 'AAPL', expiration: '2024-08-16',
      quantity: 2, // old code's arbitrary "first Short leg" quantity
      legs: mergedLegs,
      creditReceived: 270,
      creditPerContract: 1.35, // old, wrong, mis-attributed figure
    };
    const result = runCloseOrderSafetyGate({
      identity: oldMergedIdentity,
      requestedClosingQuantity: 2,
      requestedLimitPrice: computeBreakEvenLimitPrice(oldMergedIdentity),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('LEG_QUANTITY_MISMATCH');
  });
});
