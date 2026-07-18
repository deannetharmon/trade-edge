// lib/portfolio/__tests__/closeOrderSafety.test.ts
//
// ES-0001 corrective round 2: regression tests for deterministic economic-
// structure analysis, the canonical close-order identity (credit AND debit
// entry economics, in broker option-price POINTS, never dollars), the
// immutable close plan, and the hard-blocking live safety gate.
//
// Round-1-corrective introduced a CRITICAL 100x price-unit defect:
// `entryPricePerUnit` was computed as `|netPerShare| * contractMultiplier`
// (dollars, e.g. 60 for a $0.60 credit) and then fed back into
// `closePricePerUnit` as if it were broker option-price points -- which
// `buildClosePlan` then multiplied by `contractMultiplier` AGAIN. Every test
// below that checks a dollar or points value uses a LITERAL expected number
// (not a value re-derived by the same formula under test), specifically so a
// reintroduced double-multiplication would fail these tests rather than
// passing a self-consistent-but-wrong assertion.
//
// Fixture note: the "ambiguous same-quantity independent spreads" scenario
// below is an ANONYMIZED, SYNTHETIC reproduction of the failure SHAPE this
// ticket investigates -- two independently-opened spreads sharing a symbol,
// expiration, AND quantity. This is not a copy of any real account's
// positions or transaction data; no such real data exists in this
// repository to draw from.

import { describe, expect, it } from 'vitest';
import {
  analyzePositionStructure,
  strategyLabelForStructure,
  buildCanonicalCloseIdentity,
  computeBreakEvenClose,
  buildClosePlan,
  buildBreakEvenPlan,
  runLiveCloseOrderSafetyGate,
  structureAnalysisToBlockingIssue,
  type RawEconomicLeg,
  type CanonicalCloseIdentity,
  type EconomicStructure,
  type LiveCloseOrderSafetyInput,
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
// analyzePositionStructure
// ---------------------------------------------------------------------------

describe('analyzePositionStructure', () => {
  it('resolves a single bull put spread (1 short + 1 long put, same qty) as one VERTICAL -- no regression', () => {
    const legs = [
      leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity: 2 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(1);
      expect(result.structures[0].structureType).toBe('VERTICAL');
      expect(strategyLabelForStructure(result.structures[0])).toBe('BPS');
    }
  });

  it('resolves a bear call spread as one VERTICAL labeled BCS', () => {
    const legs = [
      leg({ symbol: 'S', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 1 }),
      leg({ symbol: 'L', optionType: 'C', strikePrice: 565, direction: 'Long', quantity: 1 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(strategyLabelForStructure(result.structures[0])).toBe('BCS');
    }
  });

  it('resolves a single naked short put as one NAKED structure labeled PUT', () => {
    const result = analyzePositionStructure([leg({ direction: 'Short', quantity: 1 })]);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(1);
      expect(result.structures[0].structureType).toBe('NAKED');
      expect(strategyLabelForStructure(result.structures[0])).toBe('PUT');
    }
  });

  it('resolves a genuine 4-leg iron condor (put vertical + call vertical, same qty) as ONE IRON_CONDOR structure', () => {
    const legs = [
      leg({ symbol: 'PS', optionType: 'P', strikePrice: 500, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'PL', optionType: 'P', strikePrice: 495, direction: 'Long', quantity: 3 }),
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 565, direction: 'Long', quantity: 3 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(1);
      expect(result.structures[0].structureType).toBe('IRON_CONDOR');
      expect(result.structures[0].legs).toHaveLength(4);
      expect(strategyLabelForStructure(result.structures[0])).toBe('IC');
    }
  });

  it('does NOT merge a put vertical and a call vertical of DIFFERENT quantities into an iron condor', () => {
    const legs = [
      leg({ symbol: 'PS', optionType: 'P', strikePrice: 500, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'PL', optionType: 'P', strikePrice: 495, direction: 'Long', quantity: 2 }),
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 565, direction: 'Long', quantity: 3 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(2);
      expect(result.structures.every(s => s.structureType === 'VERTICAL')).toBe(true);
    }
  });

  it('resolves two independent same-TYPE, DIFFERENT-quantity spreads unambiguously (quantity alone still discriminates when it happens to differ)', () => {
    const legs = [
      leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L1', strikePrice: 195, direction: 'Long', quantity: 2 }),
      leg({ symbol: 'S2', strikePrice: 190, direction: 'Short', quantity: 3 }),
      leg({ symbol: 'L2', strikePrice: 185, direction: 'Long', quantity: 3 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(2);
    }
  });

  it('CONFIRMED DANGER CASE: two independent same-quantity bull put spreads (same symbol/expiration/quantity, different strikes) are AMBIGUOUS, not silently merged', () => {
    const legs = [
      leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L1', strikePrice: 195, direction: 'Long', quantity: 2 }),
      leg({ symbol: 'S2', strikePrice: 190, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L2', strikePrice: 185, direction: 'Long', quantity: 2 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      expect(result.ambiguousBuckets).toHaveLength(1);
      expect(result.ambiguousBuckets[0].shorts).toHaveLength(2);
      expect(result.ambiguousBuckets[0].longs).toHaveLength(2);
    }
    // Strike adjacency must NEVER be used as a tiebreaker -- confirm no
    // structures are produced at all, not even a "best guess" pairing.
    expect((result as any).structures).toBeUndefined();
  });

  it('flags 3 shorts + 3 longs of the same type/quantity as AMBIGUOUS', () => {
    const legs = [
      leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 1 }),
      leg({ symbol: 'S2', strikePrice: 195, direction: 'Short', quantity: 1 }),
      leg({ symbol: 'S3', strikePrice: 190, direction: 'Short', quantity: 1 }),
      leg({ symbol: 'L1', strikePrice: 185, direction: 'Long', quantity: 1 }),
      leg({ symbol: 'L2', strikePrice: 180, direction: 'Long', quantity: 1 }),
      leg({ symbol: 'L3', strikePrice: 175, direction: 'Long', quantity: 1 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('AMBIGUOUS');
  });

  it('resolves two independent naked shorts of the same type/quantity as two unambiguous NAKED structures (nothing to pair against)', () => {
    const legs = [
      leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 1 }),
      leg({ symbol: 'S2', strikePrice: 190, direction: 'Short', quantity: 1 }),
    ];
    const result = analyzePositionStructure(legs);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(2);
      expect(result.structures.every(s => s.structureType === 'NAKED')).toBe(true);
    }
  });

  it('flags a zero-quantity leg as UNSUPPORTED', () => {
    const result = analyzePositionStructure([leg({ quantity: 0 })]);
    expect(result.status).toBe('UNSUPPORTED');
  });

  it('resolves an empty leg array to RESOLVED with zero structures', () => {
    const result = analyzePositionStructure([]);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.structures).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildCanonicalCloseIdentity -- LITERAL price-unit regression tests
// ---------------------------------------------------------------------------

describe('buildCanonicalCloseIdentity -- price units (points vs dollars)', () => {
  it('a $0.60 credit spread (short @1.05, long @0.45) produces entryPricePointsPerUnit === 0.60 exactly -- NOT 60', () => {
    const legs = [
      leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity: 2, avgOpenPrice: 1.05 }),
      leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity: 2, avgOpenPrice: 0.45 }),
    ];
    const analysis = analyzePositionStructure(legs);
    expect(analysis.status).toBe('RESOLVED');
    if (analysis.status !== 'RESOLVED') return;
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.entryPriceEffect).toBe('Credit');
    // LITERAL expected value -- 0.60, never 60 (the round-1-corrective defect).
    expect(result.identity.entryPricePointsPerUnit).toBeCloseTo(0.60, 5);
    // Whole-position cash flow for 2 contracts: 0.60 * 100 * 2 = $120 (LITERAL).
    expect(result.identity.entryTotalCashFlowDollars).toBeCloseTo(120, 5);
  });

  it('a $0.50 debit spread (short @0.60, long @1.10) produces a NEGATIVE, correctly-signed entryTotalCashFlowDollars -- fixes the old Math.max(0,...) flooring defect', () => {
    const legs = [
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3, avgOpenPrice: 0.60 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 555, direction: 'Long', quantity: 3, avgOpenPrice: 1.10 }),
    ];
    const analysis = analyzePositionStructure(legs);
    expect(analysis.status).toBe('RESOLVED');
    if (analysis.status !== 'RESOLVED') return;
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-09-20');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.entryPriceEffect).toBe('Debit');
    expect(result.identity.entryPricePointsPerUnit).toBeCloseTo(0.50, 5);
    // 3 contracts, $0.50/share debit: -0.50 * 100 * 3 = -$150 (LITERAL, NOT floored to 0).
    expect(result.identity.entryTotalCashFlowDollars).toBeCloseTo(-150, 5);
    expect(result.identity.entryTotalCashFlowDollars).toBeLessThan(0);
  });

  it('blocks ENTRY_PRICE_EFFECT_INVALID when entry legs net to exactly zero', () => {
    const legs = [
      leg({ symbol: 'S', direction: 'Short', quantity: 1, avgOpenPrice: 1.00 }),
      leg({ symbol: 'L', direction: 'Long', quantity: 1, avgOpenPrice: 1.00 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('ENTRY_PRICE_EFFECT_INVALID');
  });

  it('blocks ENTRY_ECONOMICS_UNAVAILABLE when a leg has a non-finite entry price', () => {
    const legs = [leg({ direction: 'Short', quantity: 1, avgOpenPrice: NaN })];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('ENTRY_ECONOMICS_UNAVAILABLE');
  });

  it('blocks CONTRACT_MULTIPLIER_INVALID for a zero/negative multiplier', () => {
    const legs = [leg({ direction: 'Short', quantity: 1, avgOpenPrice: 1.0 })];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('CONTRACT_MULTIPLIER_INVALID');
  });

  it('blocks REQUESTED_QTY_INVALID for a zero-quantity structure', () => {
    const structure: EconomicStructure = { structureType: 'NAKED', quantity: 0, legs: [leg({ quantity: 0 })] };
    const result = buildCanonicalCloseIdentity(structure, 'K', 'AAPL', '2024-08-16');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('REQUESTED_QTY_INVALID');
  });
});

// ---------------------------------------------------------------------------
// computeBreakEvenClose -- LITERAL points regression
// ---------------------------------------------------------------------------

describe('computeBreakEvenClose', () => {
  function creditIdentity(): CanonicalCloseIdentity {
    const legs = [
      leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity: 2, avgOpenPrice: 1.05 }),
      leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity: 2, avgOpenPrice: 0.45 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    if (!result.ok) throw new Error('fixture error: ' + result.message);
    return result.identity;
  }

  it('mirrors a $0.60 Credit entry to a 0.60-point Debit break-even close -- LITERAL, never $60', () => {
    const be = computeBreakEvenClose(creditIdentity());
    expect(be.priceEffect).toBe('Debit');
    expect(be.pricePointsPerUnit).toBeCloseTo(0.60, 5);
  });

  it('mirrors a Debit entry to a Credit break-even close', () => {
    const legs = [
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 1, avgOpenPrice: 0.60 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 555, direction: 'Long', quantity: 1, avgOpenPrice: 1.10 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-09-20');
    if (!result.ok) throw new Error('fixture error');
    const be = computeBreakEvenClose(result.identity);
    expect(be.priceEffect).toBe('Credit');
    expect(be.pricePointsPerUnit).toBeCloseTo(0.50, 5);
  });
});

// ---------------------------------------------------------------------------
// buildClosePlan / buildBreakEvenPlan -- LITERAL dollar-value regressions
// ---------------------------------------------------------------------------

describe('buildClosePlan / buildBreakEvenPlan', () => {
  function creditIdentity(quantity = 2): CanonicalCloseIdentity {
    const legs = [
      leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity, avgOpenPrice: 1.05 }),
      leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity, avgOpenPrice: 0.45 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    if (!result.ok) throw new Error('fixture error: ' + result.message);
    return result.identity;
  }

  it('a full break-even close of a 2-contract $0.60 credit position realizes $0.00 EXACTLY (LITERAL) -- the 0.60 broker limit, never 60', () => {
    const identity = creditIdentity(2);
    const result = buildBreakEvenPlan(identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.closePricePointsPerUnit).toBeCloseTo(0.60, 5);
    expect(result.plan.requestedClosePriceEffect).toBe('Debit');
    expect(result.plan.expectedRealizedPnlDollars).toBeCloseTo(0, 5);
    expect(result.plan.pricingIntent).toBe('BREAK_EVEN');
  });

  it('a profitable close at 0.30 points produces $30 realized P/L for ONE contract (LITERAL) before fees', () => {
    const identity = creditIdentity(2); // 2-contract position, entry 0.60 credit
    const result = buildClosePlan(identity, 1, 2, 0.30, 'Debit', 'PROFIT_TARGET');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Entry cash flow prorated to 1 contract: 0.60 * 100 * 1 = $60.
    // Close cash flow for 1 contract at 0.30 Debit: -0.30 * 100 * 1 = -$30.
    // Expected P/L: 60 - 30 = $30 (LITERAL).
    expect(result.plan.expectedRealizedPnlDollars).toBeCloseTo(30, 5);
    expect(result.plan.closeTotalCashFlowDollars).toBeCloseTo(-30, 5);
  });

  it('1-contract partial close from a 5-contract position scales legs to quantity 1, not 5', () => {
    const identity = creditIdentity(5);
    const result = buildClosePlan(identity, 1, 5, 0.30, 'Debit', 'CUSTOM');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.legPayload.every(l => l.quantity === 1)).toBe(true);
  });

  it('blocks REQUESTED_QTY_EXCEEDS_POSITION for an over-close', () => {
    const identity = creditIdentity(2);
    const result = buildClosePlan(identity, 5, 2, 0.30, 'Debit');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('REQUESTED_QTY_EXCEEDS_POSITION');
  });

  it('blocks REQUESTED_QTY_INVALID for zero, negative, or non-integer quantity', () => {
    const identity = creditIdentity(2);
    for (const bad of [0, -1, 1.5]) {
      const result = buildClosePlan(identity, bad, 2, 0.30, 'Debit');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.ruleId).toBe('REQUESTED_QTY_INVALID');
    }
  });

  it('blocks LIMIT_PRICE_INVALID for a zero/negative/non-finite points price', () => {
    const identity = creditIdentity(2);
    for (const bad of [0, -0.5, NaN]) {
      const result = buildClosePlan(identity, 1, 2, bad, 'Debit');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.ruleId).toBe('LIMIT_PRICE_INVALID');
    }
  });

  it('blocks LIMIT_TICK_INVALID for a sub-penny points price', () => {
    const identity = creditIdentity(2);
    const result = buildClosePlan(identity, 1, 2, 0.303, 'Debit');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.ruleId).toBe('LIMIT_TICK_INVALID');
  });

  it('a debit-opened position\'s break-even close realizes $0.00 EXACTLY (LITERAL)', () => {
    const legs = [
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3, avgOpenPrice: 0.60 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 555, direction: 'Long', quantity: 3, avgOpenPrice: 1.10 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const idResult = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-09-20');
    if (!idResult.ok) throw new Error('fixture error');
    const result = buildBreakEvenPlan(idResult.identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.closePricePointsPerUnit).toBeCloseTo(0.50, 5);
    expect(result.plan.requestedClosePriceEffect).toBe('Credit');
    expect(result.plan.expectedRealizedPnlDollars).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// runLiveCloseOrderSafetyGate
// ---------------------------------------------------------------------------

describe('runLiveCloseOrderSafetyGate', () => {
  function creditIdentity(quantity = 2): CanonicalCloseIdentity {
    const legs = [
      leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity, avgOpenPrice: 1.05 }),
      leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity, avgOpenPrice: 0.45 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const result = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-08-16');
    if (!result.ok) throw new Error('fixture error: ' + result.message);
    return result.identity;
  }

  function validInput(overrides: Partial<LiveCloseOrderSafetyInput> = {}): LiveCloseOrderSafetyInput {
    const identity = overrides.identity ?? creditIdentity(2);
    return {
      identity,
      requestedQuantity: 2,
      closeableQuantity: 2,
      pricingIntent: 'CUSTOM',
      requestedClosePriceEffect: 'Debit',
      closePricePointsPerUnit: 0.30,
      quote: { netBid: 0.25, netAsk: 0.35, netMid: 0.30, fetchedAtMs: Date.now() },
      actualOrder: {
        legs: identity.legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 0.30,
        priceEffect: 'Debit',
      },
      displayedExpectedPnlDollars: 60, // (0.60-0.30)*100*2
      ...overrides,
    };
  }

  it('a fully valid live submission passes and returns the plan with LITERAL correct P/L', () => {
    const result = runLiveCloseOrderSafetyGate(validInput());
    expect(result.ok).toBe(true);
    expect(result.plan?.expectedRealizedPnlDollars).toBeCloseTo(60, 5);
    expect(result.plan?.closePricePointsPerUnit).toBeCloseTo(0.30, 5);
  });

  it('quote: null (explicit) blocks QUOTE_MISSING', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ quote: null }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('QUOTE_MISSING');
  });

  it('quote: undefined (bypassing the required type via a loose caller) is treated identically to null -- QUOTE_MISSING, never silently skipped', () => {
    const input = validInput();
    // Simulate a caller that bypasses the type system (e.g. spreads an
    // object that never set the key, or passes `undefined` explicitly).
    (input as any).quote = undefined;
    const result = runLiveCloseOrderSafetyGate(input);
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('QUOTE_MISSING');
  });

  it('a one-sided quote (missing bid or ask) blocks QUOTE_MISSING', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ quote: { netBid: null, netAsk: 0.35, netMid: null, fetchedAtMs: Date.now() } }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('QUOTE_MISSING');
  });

  it('an invalid (negative/non-finite) quote blocks QUOTE_INVALID', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ quote: { netBid: -1, netAsk: 0.35, netMid: 0.1, fetchedAtMs: Date.now() } }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('QUOTE_INVALID');
  });

  it('a crossed quote blocks QUOTE_CROSSED', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ quote: { netBid: 0.40, netAsk: 0.30, netMid: 0.35, fetchedAtMs: Date.now() } }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('QUOTE_CROSSED');
  });

  it('a stale quote blocks QUOTE_STALE_UNCONFIRMED unless explicitly confirmed', () => {
    const staleQuote = { netBid: 0.25, netAsk: 0.35, netMid: 0.30, fetchedAtMs: Date.now() - 10 * 60 * 1000 };
    const blocked = runLiveCloseOrderSafetyGate(validInput({ quote: staleQuote }));
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.map(i => i.ruleId)).toContain('QUOTE_STALE_UNCONFIRMED');

    const confirmed = runLiveCloseOrderSafetyGate(validInput({ quote: staleQuote, staleQuoteConfirmed: true }));
    expect(confirmed.ok).toBe(true);
  });

  it('derives the marketable price from netAsk for a Debit close and blocks MATERIAL_PNL_DEVIATION when the plan deviates >30%', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({
      quote: { netBid: 0.05, netAsk: 1.00, netMid: 0.50, fetchedAtMs: Date.now() },
      actualOrder: {
        legs: creditIdentity(2).legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 0.30,
        priceEffect: 'Debit',
      },
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('MATERIAL_PNL_DEVIATION');
  });

  it('does not flag MATERIAL_PNL_DEVIATION for a small deviation from the marketable price', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({
      quote: { netBid: 0.28, netAsk: 0.32, netMid: 0.30, fetchedAtMs: Date.now() },
    }));
    expect(result.issues.map(i => i.ruleId)).not.toContain('MATERIAL_PNL_DEVIATION');
  });

  it('REQUESTED_QTY_EXCEEDS_POSITION blocks via the gate', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ requestedQuantity: 5, closeableQuantity: 2 }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REQUESTED_QTY_EXCEEDS_POSITION');
  });

  it('LEG_IDENTITY_MISMATCH blocks when the actual order legs use the wrong symbol', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({
      actualOrder: { legs: [{ symbol: 'WRONG', quantity: 2, direction: 'Short' }], limitPricePointsPerUnit: 0.30, priceEffect: 'Debit' },
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('LEG_IDENTITY_MISMATCH');
  });

  it('PAYLOAD_QUANTITY_MISMATCH and LEG_RATIO_MISMATCH block together when actual leg quantity is wrong', () => {
    const identity = creditIdentity(5);
    const result = runLiveCloseOrderSafetyGate(validInput({
      identity,
      requestedQuantity: 5,
      closeableQuantity: 5,
      actualOrder: {
        legs: identity.legs.map(l => ({ symbol: l.symbol, quantity: 3, direction: l.direction })),
        limitPricePointsPerUnit: 0.30,
        priceEffect: 'Debit',
      },
    }));
    expect(result.ok).toBe(false);
    const ruleIds = result.issues.map(i => i.ruleId);
    expect(ruleIds).toContain('PAYLOAD_QUANTITY_MISMATCH');
    expect(ruleIds).toContain('LEG_RATIO_MISMATCH');
  });

  it('PAYLOAD_LIMIT_PRICE_MISMATCH blocks when the actual broker limit price (points) differs from the plan -- guards the exact 100x defect', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({
      actualOrder: {
        legs: creditIdentity(2).legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 30, // the exact 100x defect this test guards against
        priceEffect: 'Debit',
      },
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('PAYLOAD_LIMIT_PRICE_MISMATCH');
  });

  it('PAYLOAD_PRICE_EFFECT_MISMATCH blocks when the actual broker price effect differs from the plan', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({
      actualOrder: {
        legs: creditIdentity(2).legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 0.30,
        priceEffect: 'Credit',
      },
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('PAYLOAD_PRICE_EFFECT_MISMATCH');
  });

  it('DISPLAY_PAYLOAD_ECONOMICS_MISMATCH blocks when displayed P/L does not match the plan', () => {
    const result = runLiveCloseOrderSafetyGate(validInput({ displayedExpectedPnlDollars: 999999 }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('DISPLAY_PAYLOAD_ECONOMICS_MISMATCH');
  });

  it('BREAK_EVEN intent validates the ACTUAL submitted plan, not a disconnected theoretical one -- passes when the actual price truly is break-even', () => {
    const identity = creditIdentity(2); // 0.60 credit entry
    const result = runLiveCloseOrderSafetyGate(validInput({
      identity,
      pricingIntent: 'BREAK_EVEN',
      closePricePointsPerUnit: 0.60,
      requestedClosePriceEffect: 'Debit',
      quote: { netBid: 0.55, netAsk: 0.65, netMid: 0.60, fetchedAtMs: Date.now() },
      actualOrder: {
        legs: identity.legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 0.60,
        priceEffect: 'Debit',
      },
      displayedExpectedPnlDollars: 0,
    }));
    expect(result.ok).toBe(true);
    expect(result.plan?.expectedRealizedPnlDollars).toBeCloseTo(0, 5);
  });

  it('BREAK_EVEN intent BLOCKS when the actual submitted price is not truly break-even (declared intent lies about the real plan)', () => {
    const identity = creditIdentity(2); // 0.60 credit entry -- true break-even is 0.60 Debit
    const result = runLiveCloseOrderSafetyGate(validInput({
      identity,
      pricingIntent: 'BREAK_EVEN',
      closePricePointsPerUnit: 0.30, // NOT break-even -- a profitable close mislabeled as break-even
      requestedClosePriceEffect: 'Debit',
      actualOrder: {
        legs: identity.legs.map(l => ({ symbol: l.symbol, quantity: 2, direction: l.direction })),
        limitPricePointsPerUnit: 0.30,
        priceEffect: 'Debit',
      },
      displayedExpectedPnlDollars: 60,
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('BREAK_EVEN_PNL_MISMATCH');
  });

  it('hard-blocks a debit-opened position\'s live submission (production wiring does not yet support it) with ENTRY_DEBIT_POSITIONS_UNSUPPORTED_LIVE', () => {
    const legs = [
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 1, avgOpenPrice: 0.60 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 555, direction: 'Long', quantity: 1, avgOpenPrice: 1.10 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const idResult = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-09-20');
    if (!idResult.ok) throw new Error('fixture error');
    const result = runLiveCloseOrderSafetyGate(validInput({
      identity: idResult.identity,
      requestedQuantity: 1,
      closeableQuantity: 1,
      requestedClosePriceEffect: 'Credit',
      closePricePointsPerUnit: 0.50,
      actualOrder: {
        legs: idResult.identity.legs.map(l => ({ symbol: l.symbol, quantity: 1, direction: l.direction })),
        limitPricePointsPerUnit: 0.50,
        priceEffect: 'Credit',
      },
      displayedExpectedPnlDollars: 0,
    }));
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('ENTRY_DEBIT_POSITIONS_UNSUPPORTED_LIVE');
  });

  it('end-to-end: the ambiguous same-quantity fixture is blocked before any identity/plan/gate call is ever made', () => {
    const legs = [
      leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L1', strikePrice: 195, direction: 'Long', quantity: 2 }),
      leg({ symbol: 'S2', strikePrice: 190, direction: 'Short', quantity: 2 }),
      leg({ symbol: 'L2', strikePrice: 185, direction: 'Long', quantity: 2 }),
    ];
    const analysis = analyzePositionStructure(legs);
    expect(analysis.status).toBe('AMBIGUOUS');
    const blockIssue = structureAnalysisToBlockingIssue(analysis);
    expect(blockIssue?.ruleId).toBe('AMBIGUOUS_POSITION_STRUCTURE');
    // No identity can be built from an ambiguous analysis -- there is no
    // single structure to pass to buildCanonicalCloseIdentity, which is
    // exactly the point: the gate/plan machinery is never reached at all.
  });
});
