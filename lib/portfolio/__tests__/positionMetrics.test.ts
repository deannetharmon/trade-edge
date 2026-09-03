import { describe, expect, it } from 'vitest';
import {
  aggregateBrokerPositionGreeks,
  CONTRACT_MULTIPLIER,
  computeCreditPerContract,
  computeSignedNetPremium,
  isNetDebitStructure,
  computePositionPnl,
  computeSingleLegBreakeven,
  computeIcBreakevens,
  calcPositionPop,
  calcPositionPopVsStrike,
  findShortLegStrikes,
  computeSideBuffers,
  computeCanonicalBuffer,
  resolveOptionLegPrice,
  resolveUnderlyingPrice,
  computeEntryChangeTone,
  clampPct,
  parseBrokerEntryPremium,
  toWholePositionThetaDollars,
  toWholePositionGammaShareEquivalent,
  toWholePositionVegaDollars,
  computeCspEffectiveBuyPrice,
  hasCompleteEntryEconomics,
  hasSupportedCreditEntryEconomics,
  canonicalEntryCredit,
  entryPnlPct,
  reliableSupportedMaxRisk,
  summarizeReliableSupportedMaxRisk,
  formatReliableSupportedMaxRisk,
  formatPortfolioMaxRiskContext,
  MAX_RISK_UNAVAILABLE_COPY,
  type PopLeg,
} from '../positionMetrics';

describe('PM-0002 entry-premium provenance', () => {
  it('requires explicit complete provenance and never falls back to compatibility credit', () => {
    expect(hasCompleteEntryEconomics({ creditReceived: 1260 })).toBe(false);
    expect(hasCompleteEntryEconomics({ entryEconomicsComplete: true, entryCredit: null, creditReceived: 1260 })).toBe(false);
    expect(canonicalEntryCredit({ entryEconomicsComplete: true, entryCredit: null, creditReceived: 1260 })).toBeNull();
    expect(hasCompleteEntryEconomics({ entryEconomicsComplete: true, entryCredit: 1260, creditReceived: 0 })).toBe(true);
  });

  it('keeps complete debit provenance but rejects it for credit-based math and actions', () => {
    const debit = { entryEconomicsComplete: true, entryCredit: 500, entryPriceEffect: 'Debit' as const, creditReceived: 0, pnl: 100 };
    expect(hasCompleteEntryEconomics(debit)).toBe(true);
    expect(canonicalEntryCredit(debit)).toBe(500);
    expect(hasSupportedCreditEntryEconomics(debit)).toBe(false);
    expect(entryPnlPct(debit)).toBeNull();
  });

  it('accepts credit-based math only for explicit supported net-credit entries', () => {
    const credit = { entryEconomicsComplete: true, entryCredit: 1000, entryPriceEffect: 'Credit' as const, creditReceived: 1000, pnl: 250 };
    expect(hasSupportedCreditEntryEconomics(credit)).toBe(true);
    expect(entryPnlPct(credit)).toBe(25);
  });

  it('exposes max risk only for explicit supported credit provenance and reliability', () => {
    const supported = { entryEconomicsComplete: true, entryCredit: 1000, entryPriceEffect: 'Credit' as const, creditReceived: 0, maxRisk: 4000, maxRiskReliable: true };
    expect(reliableSupportedMaxRisk(supported)).toBe(4000);
    expect(reliableSupportedMaxRisk({ ...supported, entryPriceEffect: 'Debit' })).toBeNull();
    expect(reliableSupportedMaxRisk({ ...supported, entryEconomicsComplete: false })).toBeNull();
    expect(reliableSupportedMaxRisk({ ...supported, maxRiskReliable: undefined })).toBeNull();
    expect(reliableSupportedMaxRisk({ ...supported, entryCredit: null })).toBeNull();
  });

  it('fails aggregate At Risk and generated contexts closed for debit, incomplete, and legacy reliability', () => {
    const supported = { entryEconomicsComplete: true, entryCredit: 1000, entryPriceEffect: 'Credit' as const, creditReceived: 0, maxRisk: 4000, maxRiskReliable: true };
    const debit = { ...supported, entryPriceEffect: 'Debit' as const };
    const incomplete = { ...supported, entryEconomicsComplete: false };
    const legacy = { entryEconomicsComplete: true, entryCredit: 1000, entryPriceEffect: 'Credit' as const, creditReceived: 1000, maxRisk: 4000 };

    expect(summarizeReliableSupportedMaxRisk([supported, debit, incomplete, legacy])).toEqual({
      total: 4000,
      includedCount: 1,
      excludedCount: 3,
    });
    expect(formatPortfolioMaxRiskContext([supported, debit, incomplete, legacy]))
      .toBe('Total at risk: $4000.00 (3 positions excluded: unreliable entry/max-risk basis)');
    expect(formatReliableSupportedMaxRisk(supported)).toBe('$4000.00');
    expect(formatReliableSupportedMaxRisk(debit)).toBe(MAX_RISK_UNAVAILABLE_COPY);
    expect(formatReliableSupportedMaxRisk(incomplete)).toBe(MAX_RISK_UNAVAILABLE_COPY);
    expect(formatReliableSupportedMaxRisk(legacy)).toBe(MAX_RISK_UNAVAILABLE_COPY);
  });

  it.each([undefined, null, '', '   ', 'not-a-price', NaN, Infinity, -1])('keeps unavailable broker value %p unavailable', value => {
    expect(parseBrokerEntryPremium(value)).toBeNull();
  });

  it('preserves a genuine broker-reported zero', () => {
    expect(parseBrokerEntryPremium(0)).toBe(0);
    expect(parseBrokerEntryPremium('0')).toBe(0);
  });

  it('fails the whole signed entry calculation closed when any leg is unavailable', () => {
    expect(computeSignedNetPremium([
      { direction: 'Short', quantity: 5, avgOpenPrice: 40.01 },
      { direction: 'Long', quantity: 5, avgOpenPrice: null },
    ])).toBeNull();
  });
});

describe('PM-0002 whole-position Greek units', () => {
  it('reconciles broker-shaped five-lot spread legs before applying the display multiplier once', () => {
    const short = 'MU260904P00800000';
    const long = 'MU260904P00790000';
    const raw = aggregateBrokerPositionGreeks([
      { symbol: short, quantity: '5', 'quantity-direction': 'Short' },
      { symbol: long, quantity: '5', 'quantity-direction': 'Long' },
    ], {
      theta: { [short]: -0.05, [long]: -0.03 },
      gamma: { [short]: 0.002, [long]: 0.001 },
      delta: { [short]: -0.20, [long]: -0.10 },
      vega: { [short]: 0.08, [long]: 0.05 },
    });
    expect(raw).toEqual({ theta: 0.1, gamma: -0.005, delta: 0.5, vega: -0.15 });
    expect(toWholePositionThetaDollars(raw.theta)).toBe(10);
    expect(toWholePositionGammaShareEquivalent(raw.gamma)).toBe(-0.5);
    expect(toWholePositionVegaDollars(raw.vega)).toBe(-15);
  });

  it('applies the standard option multiplier exactly once', () => {
    expect(toWholePositionThetaDollars(0.23)).toBeCloseTo(23);
    expect(toWholePositionGammaShareEquivalent(-0.000405)).toBeCloseTo(-0.0405);
    expect(toWholePositionVegaDollars(-0.15)).toBeCloseTo(-15);
  });

  it('fails closed for missing and non-finite values', () => {
    expect(toWholePositionThetaDollars(null)).toBeNull();
    expect(toWholePositionGammaShareEquivalent(NaN)).toBeNull();
    expect(toWholePositionVegaDollars(Infinity)).toBeNull();
  });

  it('never defaults missing quantity or unknown direction while aggregating broker legs', () => {
    const maps = { theta: { MU: -0.05 }, gamma: { MU: 0.002 }, delta: { MU: -0.2 }, vega: { MU: 0.08 } };
    expect(aggregateBrokerPositionGreeks([{ symbol: 'MU', 'quantity-direction': 'Short' }], maps))
      .toEqual({ theta: null, gamma: null, delta: null, vega: null });
    expect(aggregateBrokerPositionGreeks([{ symbol: 'MU', quantity: '5', 'quantity-direction': 'Sell' }], maps))
      .toEqual({ theta: null, gamma: null, delta: null, vega: null });
  });

  it('fails each Greek closed instead of forming a partial-position aggregate', () => {
    const raw = aggregateBrokerPositionGreeks([
      { symbol: 'SHORT', quantity: '5', 'quantity-direction': 'Short' },
      { symbol: 'LONG', quantity: '5', 'quantity-direction': 'Long' },
    ], {
      theta: { SHORT: -0.05 },
      gamma: { SHORT: 0.002, LONG: 0.001 },
      delta: { SHORT: -0.2, LONG: -0.1 },
      vega: { SHORT: 0.08, LONG: 0.05 },
    });
    expect(raw.theta).toBeNull();
    expect(raw.gamma).toBe(-0.005);
    expect(raw.delta).toBe(0.5);
    expect(raw.vega).toBe(-0.15);
  });
});

describe('PM-0002 CSP Effective Buy units', () => {
  it('uses the per-share short-put premium and is quantity invariant', () => {
    expect(computeCspEffectiveBuyPrice(440, 16.55)).toBeCloseTo(423.45);
    // Contract count is deliberately absent: the per-share basis is the same
    // for one contract or five contracts.
    expect(computeCspEffectiveBuyPrice(440, 16.55)).not.toBeCloseTo(440 - 8275);
  });

  it('fails closed for missing/malformed economics and preserves genuine zero', () => {
    expect(computeCspEffectiveBuyPrice(440, null)).toBeNull();
    expect(computeCspEffectiveBuyPrice(NaN, 16.55)).toBeNull();
    expect(computeCspEffectiveBuyPrice(440, 0)).toBe(440);
  });
});

describe('CONTRACT_MULTIPLIER', () => {
  it('is the standard 100 shares/contract multiplier', () => {
    expect(CONTRACT_MULTIPLIER).toBe(100);
  });
});

// ── 1. Per-contract credit normalization ──────────────────────────────────
describe('computeCreditPerContract', () => {
  // Five NKE CSPs, total credit $225 -> $0.45/contract, never $2.25.
  it('divides by BOTH canonical quantity and the contract multiplier for a 5-lot CSP', () => {
    const perContract = computeCreditPerContract(225, 5);
    expect(perContract).toBeCloseTo(0.45, 5);
    expect(perContract).not.toBeCloseTo(2.25, 5);
  });

  // Five MU 800/790 BPS, total credit $1,260 -> $2.52/spread, never $12.60.
  it('divides by BOTH canonical quantity and the contract multiplier for a 5-lot BPS', () => {
    const perContract = computeCreditPerContract(1260, 5);
    expect(perContract).toBeCloseTo(2.52, 5);
    expect(perContract).not.toBeCloseTo(12.6, 5);
  });

  it('matches the single-contract case exactly (1 contract, 1/5 the credit)', () => {
    const fiveLot = computeCreditPerContract(1260, 5);
    const oneLot = computeCreditPerContract(252, 1);
    expect(fiveLot).toBeCloseTo(oneLot!, 8);
  });

  it('returns null for a non-positive or non-finite quantity', () => {
    expect(computeCreditPerContract(225, 0)).toBeNull();
    expect(computeCreditPerContract(225, -1)).toBeNull();
    expect(computeCreditPerContract(225, NaN)).toBeNull();
  });

  it('honors an explicit non-default contract multiplier', () => {
    expect(computeCreditPerContract(100, 1, 10)).toBeCloseTo(10, 5);
  });
});

// ── computeSignedNetPremium / isNetDebitStructure (debit guard) ───────────
describe('computeSignedNetPremium / isNetDebitStructure', () => {
  it('is positive for a net-credit structure (short leg premium exceeds long)', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 5, avgOpenPrice: 40.01 },
      { direction: 'Long' as const, quantity: 5, avgOpenPrice: 37.49 },
    ];
    const net = computeSignedNetPremium(legs);
    expect(net).toBeCloseTo(1260, 2); // MU BPS fixture, $2.52/contract * 5 * 100
    expect(isNetDebitStructure(net)).toBe(false);
  });

  it('is negative for a net-debit structure (long leg premium exceeds short)', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 5, avgOpenPrice: 1.00 },
      { direction: 'Long' as const, quantity: 5, avgOpenPrice: 3.00 },
    ];
    const net = computeSignedNetPremium(legs);
    expect(net).toBeLessThan(0);
    expect(isNetDebitStructure(net)).toBe(true);
  });

  it('does not flag a genuine ~$0.00 credit as a debit (float-noise epsilon)', () => {
    expect(isNetDebitStructure(-0.001)).toBe(false);
    expect(isNetDebitStructure(0)).toBe(false);
  });
});

// ── computePositionPnl (PM-0001 corrective round 2) ─────────────────────────
// This is the EXACT formula acquisition.ts's loadPositions() calls (not a
// reimplementation) -- these tests are a regression against the real
// production/population calculation, not merely a test of the
// isNetDebit -> entryPriceEffect mapping.
describe('computePositionPnl', () => {
  // Genuine credit-position control: ordinary credit P/L is unchanged by
  // the isNetDebit gate (isNetDebit is false, so the formula behaves
  // exactly as it did before round 2's fix).
  it('control: computes ordinary credit-position pnl unchanged (credit - currentValue)', () => {
    const pnl = computePositionPnl({
      isNetDebit: false,
      hasCurrentPrices: true,
      anyLegCrossed: false,
      creditReceived: 1260,
      currentValue: 1750,
    });
    expect(pnl).toBeCloseTo(1260 - 1750, 5); // -490, matches the MU fixture from the base PM-0001 report
  });

  it('computes debit-position pnl as liquidation value minus verified entry debit', () => {
    const pnl = computePositionPnl({
      isNetDebit: true,
      hasCurrentPrices: true,
      anyLegCrossed: false,
      creditReceived: 0, // floored, as calculateSpreadCredit would produce for a debit
      signedEntryAmount: -1200,
      currentValue: -1750,
    });
    expect(pnl).toBe(550);
  });

  it('keeps debit pnl unavailable without verified signed entry economics', () => {
    const pnl = computePositionPnl({
      isNetDebit: true,
      hasCurrentPrices: true,
      anyLegCrossed: false,
      creditReceived: 0,
      currentValue: -1750,
    });
    expect(pnl).toBeNull();
  });

  // Crossed-quote control: even a genuinely credit (non-debit) position
  // must still produce pnl = null when a leg is crossed -- proves the
  // isNetDebit fix didn't regress the crossed-quote guard from the prior
  // corrective round.
  it('control: a crossed-quote CREDIT position still produces pnl = null', () => {
    const pnl = computePositionPnl({
      isNetDebit: false,
      hasCurrentPrices: true,
      anyLegCrossed: true,
      creditReceived: 1260,
      currentValue: 1750,
    });
    expect(pnl).toBeNull();
  });

  it('returns null when currentValue itself is unavailable, independent of the debit/crossed gates', () => {
    const pnl = computePositionPnl({
      isNetDebit: false,
      hasCurrentPrices: false,
      anyLegCrossed: false,
      creditReceived: 1260,
      currentValue: 0,
    });
    expect(pnl).toBeNull();
  });

  it('a debit structure with a crossed leg is still null (both gates independently sufficient)', () => {
    const pnl = computePositionPnl({
      isNetDebit: true,
      hasCurrentPrices: true,
      anyLegCrossed: true,
      creditReceived: 0,
      signedEntryAmount: -400,
      currentValue: 500,
    });
    expect(pnl).toBeNull();
  });
});

// ── 1 (continued). CSP breakeven ───────────────────────────────────────────
describe('computeSingleLegBreakeven', () => {
  it('produces $40.05 breakeven for a $40.50 short put with $0.45/contract credit', () => {
    expect(computeSingleLegBreakeven(40.5, 0.45, 'P')).toBeCloseTo(40.05, 5);
  });

  it('adds credit for a short call breakeven', () => {
    expect(computeSingleLegBreakeven(100, 2, 'C')).toBeCloseTo(102, 5);
  });
});

// ── CSP / BPS / BCS POP ─────────────────────────────────────────────────────
describe('calcPositionPop: CSP', () => {
  const shortPut: PopLeg = { optionType: 'P', strikePrice: 40.5, direction: 'Short' };

  it('computes a valid CSP POP using per-contract (not whole-position) credit', () => {
    // 5 NKE CSPs, $225 total credit, stock $42.26, IV 34%, 8 DTE.
    const pop = calcPositionPop('PUT', [shortPut], 42.26, 225, 5, 8, 34);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThan(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('returns null when there is no short put leg', () => {
    expect(calcPositionPop('PUT', [], 42.26, 225, 5, 8, 34)).toBeNull();
  });

  it('returns null when IV/price/dte are missing or invalid', () => {
    expect(calcPositionPop('PUT', [shortPut], null, 225, 5, 8, 34)).toBeNull();
    expect(calcPositionPop('PUT', [shortPut], 42.26, 225, 5, 8, null)).toBeNull();
    expect(calcPositionPop('PUT', [shortPut], 42.26, 225, 5, 0, 34)).toBeNull();
  });
});

describe('calcPositionPop: BPS / BCS', () => {
  const bpsLegs: PopLeg[] = [
    { optionType: 'P', strikePrice: 800, direction: 'Short' },
    { optionType: 'P', strikePrice: 790, direction: 'Long' },
  ];

  it('computes a valid BPS POP using per-spread (not whole-position) credit', () => {
    // 5 MU 800/790 BPS, $1,260 total credit, stock $876.40, IV 66%, 29 DTE.
    const pop = calcPositionPop('BPS', bpsLegs, 876.40, 1260, 5, 29, 66);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThan(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('BCS returns null when there is no short call leg', () => {
    expect(calcPositionPop('BCS', bpsLegs, 876.40, 1260, 5, 29, 66)).toBeNull();
  });
});

// ── Quantity invariance ─────────────────────────────────────────────────────
describe('calcPositionPop: quantity invariance', () => {
  it('produces identical POP for 1 contract vs. 5 identical contracts (CSP)', () => {
    const shortPut: PopLeg = { optionType: 'P', strikePrice: 40.5, direction: 'Short' };
    const popOne = calcPositionPop('PUT', [shortPut], 42.26, 45, 1, 8, 34);
    const popFive = calcPositionPop('PUT', [shortPut], 42.26, 225, 5, 8, 34);
    expect(popOne).not.toBeNull();
    expect(popFive).toBeCloseTo(popOne as number, 8);
  });

  it('produces identical POP for 1 contract vs. 5 identical contracts (BPS)', () => {
    const legs: PopLeg[] = [
      { optionType: 'P', strikePrice: 800, direction: 'Short' },
      { optionType: 'P', strikePrice: 790, direction: 'Long' },
    ];
    const popOne = calcPositionPop('BPS', legs, 876.40, 252, 1, 29, 66);
    const popFive = calcPositionPop('BPS', legs, 876.40, 1260, 5, 29, 66);
    expect(popOne).not.toBeNull();
    expect(popFive).toBeCloseTo(popOne as number, 8);
  });

  it('produces identical POP for 1 contract vs. 5 identical contracts (IC)', () => {
    const legs: PopLeg[] = [
      { optionType: 'P', strikePrice: 95, direction: 'Short' },
      { optionType: 'P', strikePrice: 90, direction: 'Long' },
      { optionType: 'C', strikePrice: 110, direction: 'Short' },
      { optionType: 'C', strikePrice: 115, direction: 'Long' },
    ];
    const popOne = calcPositionPop('IC', legs, 100, 2, 1, 30, 40);
    const popFive = calcPositionPop('IC', legs, 100, 10, 5, 30, 40);
    expect(popOne).not.toBeNull();
    expect(popFive).toBeCloseTo(popOne as number, 8);
  });
});

// ── 2. Iron-condor breakevens ────────────────────────────────────────────────
describe('computeIcBreakevens', () => {
  it('applies the FULL per-condor credit to BOTH breakevens (symmetric IC)', () => {
    const { lowerBreakeven, upperBreakeven } = computeIcBreakevens(95, 105, 2);
    expect(lowerBreakeven).toBeCloseTo(93, 5);   // 95 - 2, NOT 95 - 1
    expect(upperBreakeven).toBeCloseTo(107, 5);  // 105 + 2, NOT 105 + 1
  });

  it('applies the FULL per-condor credit to both breakevens (asymmetric-wing IC)', () => {
    // Put side 10-wide, call side 5-wide -- credit still applies in full to both.
    const { lowerBreakeven, upperBreakeven } = computeIcBreakevens(90, 110, 1.5);
    expect(lowerBreakeven).toBeCloseTo(88.5, 5);
    expect(upperBreakeven).toBeCloseTo(111.5, 5);
  });

  it('returns null breakevens for invalid or missing strikes', () => {
    expect(computeIcBreakevens(null, 105, 2)).toEqual({ lowerBreakeven: null, upperBreakeven: null });
    expect(computeIcBreakevens(95, null, 2)).toEqual({ lowerBreakeven: null, upperBreakeven: null });
    expect(computeIcBreakevens(0, 105, 2)).toEqual({ lowerBreakeven: null, upperBreakeven: null });
    expect(computeIcBreakevens(95, 105, null)).toEqual({ lowerBreakeven: null, upperBreakeven: null });
  });
});

describe('calcPositionPop: IC', () => {
  it('computes a symmetric IC POP, clamped to [0, 100]', () => {
    const legs: PopLeg[] = [
      { optionType: 'P', strikePrice: 95, direction: 'Short' },
      { optionType: 'P', strikePrice: 90, direction: 'Long' },
      { optionType: 'C', strikePrice: 105, direction: 'Short' },
      { optionType: 'C', strikePrice: 110, direction: 'Long' },
    ];
    const pop = calcPositionPop('IC', legs, 100, 2, 1, 30, 25);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThanOrEqual(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('computes an asymmetric-wing IC POP without erroring, clamped to [0, 100]', () => {
    const legs: PopLeg[] = [
      { optionType: 'P', strikePrice: 90, direction: 'Short' },
      { optionType: 'P', strikePrice: 80, direction: 'Long' },
      { optionType: 'C', strikePrice: 110, direction: 'Short' },
      { optionType: 'C', strikePrice: 113, direction: 'Long' },
    ];
    const pop = calcPositionPop('IC', legs, 100, 1.5, 1, 30, 60);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThanOrEqual(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('returns null when either short leg is missing', () => {
    const legs: PopLeg[] = [{ optionType: 'P', strikePrice: 95, direction: 'Short' }];
    expect(calcPositionPop('IC', legs, 100, 2, 1, 30, 25)).toBeNull();
  });

  it('clampPct clamps out-of-range values to [0, 100]', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(105)).toBe(100);
    expect(clampPct(50)).toBe(50);
  });
});

// ── POP-0001: strike-based POP ("will price ever touch my strike") ──────────
// Same engine as calcPositionPop above (popAboveBreakeven/popBelowBreakeven),
// just fed the raw strike instead of a credit-adjusted breakeven -- no
// credit/quantity/contractMultiplier inputs needed.
describe('calcPositionPopVsStrike: CSP', () => {
  const shortPut: PopLeg = { optionType: 'P', strikePrice: 40.5, direction: 'Short' };

  it('computes a valid strike-based POP, distinct from and lower than the breakeven-based POP', () => {
    const popStrike = calcPositionPopVsStrike('PUT', [shortPut], 42.26, 8, 34);
    const popBreakeven = calcPositionPop('PUT', [shortPut], 42.26, 225, 5, 8, 34);
    expect(popStrike).not.toBeNull();
    expect(popStrike as number).toBeGreaterThan(0);
    expect(popStrike as number).toBeLessThanOrEqual(100);
    // Strike sits above breakeven for a short put (strike - credit = breakeven),
    // so the probability of staying above the (higher) strike is always <=
    // the probability of staying above the (lower) breakeven.
    expect(popStrike as number).toBeLessThanOrEqual(popBreakeven as number);
  });

  it('returns null when there is no short put leg', () => {
    expect(calcPositionPopVsStrike('PUT', [], 42.26, 8, 34)).toBeNull();
  });

  it('returns null when IV/price/dte are missing or invalid', () => {
    expect(calcPositionPopVsStrike('PUT', [shortPut], null, 8, 34)).toBeNull();
    expect(calcPositionPopVsStrike('PUT', [shortPut], 42.26, 8, null)).toBeNull();
    expect(calcPositionPopVsStrike('PUT', [shortPut], 42.26, 0, 34)).toBeNull();
  });
});

describe('calcPositionPopVsStrike: BPS / BCS', () => {
  const bpsLegs: PopLeg[] = [
    { optionType: 'P', strikePrice: 800, direction: 'Short' },
    { optionType: 'P', strikePrice: 790, direction: 'Long' },
  ];

  it('computes a valid BPS strike-based POP', () => {
    const pop = calcPositionPopVsStrike('BPS', bpsLegs, 876.40, 29, 66);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThan(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('BCS returns null when there is no short call leg', () => {
    expect(calcPositionPopVsStrike('BCS', bpsLegs, 876.40, 29, 66)).toBeNull();
  });
});

describe('calcPositionPopVsStrike: IC', () => {
  it('computes a symmetric IC strike-based POP, clamped to [0, 100]', () => {
    const legs: PopLeg[] = [
      { optionType: 'P', strikePrice: 95, direction: 'Short' },
      { optionType: 'P', strikePrice: 90, direction: 'Long' },
      { optionType: 'C', strikePrice: 105, direction: 'Short' },
      { optionType: 'C', strikePrice: 110, direction: 'Long' },
    ];
    const pop = calcPositionPopVsStrike('IC', legs, 100, 30, 25);
    expect(pop).not.toBeNull();
    expect(pop as number).toBeGreaterThanOrEqual(0);
    expect(pop as number).toBeLessThanOrEqual(100);
  });

  it('returns null when either short leg is missing', () => {
    const legs: PopLeg[] = [{ optionType: 'P', strikePrice: 95, direction: 'Short' }];
    expect(calcPositionPopVsStrike('IC', legs, 100, 30, 25)).toBeNull();
  });
});

// ── 3. Side-specific IC buffer ───────────────────────────────────────────────
describe('computeSideBuffers', () => {
  it('computes both sides for an IC with stock between the two short strikes', () => {
    const { putBufferPct, callBufferPct } = computeSideBuffers(100, 95, 105);
    expect(putBufferPct).toBeCloseTo(5, 5);   // (100-95)/100*100
    expect(callBufferPct).toBeCloseTo(5, 5);  // (105-100)/100*100
  });

  it('returns null for a missing stock price', () => {
    expect(computeSideBuffers(null, 95, 105)).toEqual({ putBufferPct: null, callBufferPct: null });
  });

  it('returns null for the side with no applicable short strike', () => {
    const { putBufferPct, callBufferPct } = computeSideBuffers(100, 95, null);
    expect(putBufferPct).toBeCloseTo(5, 5);
    expect(callBufferPct).toBeNull();
  });
});

describe('computeCanonicalBuffer', () => {
  // Put side safe, call side breached -> IC is breached (min <= 0).
  it('is breached when the call side is through zero even though the put side is safe', () => {
    const buffer = computeCanonicalBuffer('IC', 8.0, -1.0);
    expect(buffer).toBeCloseTo(-1.0, 5);
    expect(buffer! <= 0).toBe(true);
  });

  // Call side safe, put side breached -> IC is breached.
  it('is breached when the put side is through zero even though the call side is safe', () => {
    const buffer = computeCanonicalBuffer('IC', -0.5, 6.0);
    expect(buffer).toBeCloseTo(-0.5, 5);
    expect(buffer! <= 0).toBe(true);
  });

  // Both safe -> displayed buffer is the smaller cushion.
  it('uses the smaller cushion when both sides are safe', () => {
    expect(computeCanonicalBuffer('IC', 8.0, 3.0)).toBeCloseTo(3.0, 5);
    expect(computeCanonicalBuffer('IC', 2.0, 9.0)).toBeCloseTo(2.0, 5);
  });

  // Reversing which side is "put"/"call" (i.e. leg-array order) never
  // changes the result, since both are passed as pre-resolved named values.
  it('put-only strategy uses the put buffer regardless of a stray call value', () => {
    expect(computeCanonicalBuffer('PUT', 4.2, 99)).toBeCloseTo(4.2, 5);
  });

  it('call-only strategy uses the call buffer regardless of a stray put value', () => {
    expect(computeCanonicalBuffer('CALL', 99, 4.2)).toBeCloseTo(4.2, 5);
  });

  it('returns null when neither side is applicable', () => {
    expect(computeCanonicalBuffer('IC', null, null)).toBeNull();
  });

  // PM-0001 corrective round: an IC must never be declared safe or breached
  // from incomplete (one-sided) evidence.
  it('IC: put buffer present, call buffer missing -> null (not the put value)', () => {
    expect(computeCanonicalBuffer('IC', 8.0, null)).toBeNull();
  });

  it('IC: call buffer present, put buffer missing -> null (not the call value)', () => {
    expect(computeCanonicalBuffer('IC', null, 3.0)).toBeNull();
  });

  it('IC: both sides present -> minimum of the two', () => {
    expect(computeCanonicalBuffer('IC', 8.0, 3.0)).toBeCloseTo(3.0, 5);
  });

  it('IC: both sides missing -> null', () => {
    expect(computeCanonicalBuffer('IC', null, null)).toBeNull();
  });
});

// ── Leg-order invariance (wiring-level) ─────────────────────────────────────
// PM-0001 corrective round: replaces the earlier ineffective "leg-order
// independent" test, which called computeCanonicalBuffer with pre-resolved
// values twice and asserted a tautology (a === a) -- it never actually
// exercised leg-array ordering. This test constructs the SAME IC's raw legs
// in both original and fully-reversed broker order, resolves short put/call
// strikes through findShortLegStrikes() -- the exact function
// acquisition.ts's loadPositions() calls, not a reimplementation -- and
// proves putBufferPct/callBufferPct/canonical buffer/breach are identical
// regardless of order.
describe('leg-order invariance (wiring-level, via findShortLegStrikes)', () => {
  const stockPrice = 100;
  // A 4-leg IC: short put 95, long put 90, short call 105, long call 110.
  const legsOriginalOrder = [
    { optionType: 'P' as const, direction: 'Short' as const, strikePrice: 95 },
    { optionType: 'P' as const, direction: 'Long' as const, strikePrice: 90 },
    { optionType: 'C' as const, direction: 'Short' as const, strikePrice: 105 },
    { optionType: 'C' as const, direction: 'Long' as const, strikePrice: 110 },
  ];
  const legsReversedOrder = [...legsOriginalOrder].reverse();

  function resolveBufferAndBreach(legs: typeof legsOriginalOrder) {
    const { shortPutStrike, shortCallStrike } = findShortLegStrikes(legs);
    const { putBufferPct, callBufferPct } = computeSideBuffers(stockPrice, shortPutStrike, shortCallStrike);
    const buffer = computeCanonicalBuffer('IC', putBufferPct, callBufferPct);
    return { putBufferPct, callBufferPct, buffer, breached: buffer != null && buffer <= 0 };
  }

  it('produces identical putBufferPct, callBufferPct, canonical buffer, and breach result for original vs. fully-reversed leg order (both sides safe)', () => {
    const original = resolveBufferAndBreach(legsOriginalOrder);
    const reversed = resolveBufferAndBreach(legsReversedOrder);
    expect(reversed).toEqual(original);
    expect(original.putBufferPct).toBeCloseTo(5, 5);
    expect(original.callBufferPct).toBeCloseTo(5, 5);
    expect(original.buffer).toBeCloseTo(5, 5);
    expect(original.breached).toBe(false);
  });

  it('produces identical results for original vs. reversed order when the put side is breached', () => {
    const stockNearPut = 94; // below the 95 short put strike -> put side breached
    const withStock = (legs: typeof legsOriginalOrder) => {
      const { shortPutStrike, shortCallStrike } = findShortLegStrikes(legs);
      const { putBufferPct, callBufferPct } = computeSideBuffers(stockNearPut, shortPutStrike, shortCallStrike);
      const buffer = computeCanonicalBuffer('IC', putBufferPct, callBufferPct);
      return { putBufferPct, callBufferPct, buffer, breached: buffer != null && buffer <= 0 };
    };
    const original = withStock(legsOriginalOrder);
    const reversed = withStock(legsReversedOrder);
    expect(reversed).toEqual(original);
    expect(original.breached).toBe(true);
  });
});

// ── 4. Quote-price resolution (never fabricate a 0) ─────────────────────────
describe('resolveOptionLegPrice', () => {
  it('uses the midpoint for a real two-sided market', () => {
    expect(resolveOptionLegPrice(1.0, 1.2, 1.1)).toBeCloseTo(1.1, 5);
  });

  it('falls back to a valid positive mark when one-sided', () => {
    expect(resolveOptionLegPrice(0, 1.2, 1.15)).toBeCloseTo(1.15, 5);
  });

  it('returns null (never 0) when neither a two-sided market nor a positive mark exists', () => {
    expect(resolveOptionLegPrice(0, 1.2, 0)).toBeNull();
    expect(resolveOptionLegPrice(0, 0, 0)).toBeNull();
  });

  // PM-0001 corrective round: crossed option quotes (ask < bid).
  it('crossed bid/ask with a valid mark uses the mark for the observational midpoint value', () => {
    expect(resolveOptionLegPrice(1.3, 1.1, 1.2)).toBeCloseTo(1.2, 5);
  });

  it('crossed bid/ask without a mark returns null (never the crossed midpoint)', () => {
    expect(resolveOptionLegPrice(1.3, 1.1, 0)).toBeNull();
  });

  it('never averages a crossed bid/ask even when that average would look plausible', () => {
    // (1.3+1.1)/2 = 1.2 would look like a normal midpoint -- must not be used.
    const result = resolveOptionLegPrice(1.3, 1.1, 0);
    expect(result).not.toBe(1.2);
    expect(result).toBeNull();
  });
});

describe('resolveUnderlyingPrice', () => {
  // bid 0, ask positive, valid mark -> use mark.
  it('uses mark when bid is 0 and ask is positive', () => {
    expect(resolveUnderlyingPrice(0, 50, 49.5)).toBeCloseTo(49.5, 5);
  });

  // bid 0, ask positive, no mark -> null.
  it('returns null when bid is 0, ask is positive, and no mark exists', () => {
    expect(resolveUnderlyingPrice(0, 50, 0)).toBeNull();
  });

  it('never uses ask/2 as a fabricated midpoint when bid is 0', () => {
    const result = resolveUnderlyingPrice(0, 50, 0);
    expect(result).not.toBe(25); // ask/2 would be 25 -- must not appear
    expect(result).toBeNull();
  });

  // Crossed market -> use valid mark or null.
  it('does not use the midpoint of a crossed market, falling back to mark', () => {
    expect(resolveUnderlyingPrice(51, 50, 50.2)).toBeCloseTo(50.2, 5); // ask < bid, crossed
  });

  it('returns null for a crossed market with no valid mark', () => {
    expect(resolveUnderlyingPrice(51, 50, 0)).toBeNull();
  });

  it('uses the real midpoint for a normal two-sided, non-crossed market', () => {
    expect(resolveUnderlyingPrice(49.9, 50.1, 50.0)).toBeCloseTo(50.0, 5);
  });

  it('never returns $0.00 for a fully unavailable quote', () => {
    expect(resolveUnderlyingPrice(0, 0, 0)).toBeNull();
  });
});

// ── 5. Trade Evolution color direction ──────────────────────────────────────
describe('computeEntryChangeTone: POP direction', () => {
  it('is favorable ("good") when POP increases', () => {
    expect(computeEntryChangeTone(70, 80, false)).toBe('good');
  });

  it('is unfavorable ("bad") when POP decreases', () => {
    expect(computeEntryChangeTone(80, 70, false)).toBe('bad');
  });

  it('is neutral for a negligible change', () => {
    expect(computeEntryChangeTone(80, 80.005, false)).toBe('neutral');
  });
});

describe('computeEntryChangeTone: absolute-delta direction', () => {
  it('+0.40 -> +0.20 (shrinking positive exposure) is favorable', () => {
    expect(computeEntryChangeTone(Math.abs(0.40), Math.abs(0.20), true)).toBe('good');
  });

  it('+0.20 -> +0.40 (growing positive exposure) is unfavorable', () => {
    expect(computeEntryChangeTone(Math.abs(0.20), Math.abs(0.40), true)).toBe('bad');
  });

  it('-0.40 -> -0.20 (shrinking negative exposure) is favorable', () => {
    expect(computeEntryChangeTone(Math.abs(-0.40), Math.abs(-0.20), true)).toBe('good');
  });

  it('-0.20 -> -0.40 (growing negative exposure) is unfavorable', () => {
    expect(computeEntryChangeTone(Math.abs(-0.20), Math.abs(-0.40), true)).toBe('bad');
  });
});
