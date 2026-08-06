import { describe, expect, it } from 'vitest';
import {
  CONTRACT_MULTIPLIER,
  computeCreditPerContract,
  computeSignedNetPremium,
  isNetDebitStructure,
  computePositionPnl,
  computeSingleLegBreakeven,
  computeIcBreakevens,
  calcPositionPop,
  findShortLegStrikes,
  computeSideBuffers,
  computeCanonicalBuffer,
  resolveOptionLegPrice,
  resolveUnderlyingPrice,
  computeEntryChangeTone,
  clampPct,
  type PopLeg,
} from '../positionMetrics';

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

  // The defect this round fixes: a net-debit structure's creditReceived is
  // floored to $0.00 by calculateSpreadCredit, so WITHOUT the isNetDebit
  // gate this same call would have returned `0 - 1750 = -1750` -- a
  // fabricated loss equal to the full buyback cost. It must return null.
  it('a net-debit structure never produces pnl = -currentValue (the round-2 defect)', () => {
    const pnl = computePositionPnl({
      isNetDebit: true,
      hasCurrentPrices: true,
      anyLegCrossed: false,
      creditReceived: 0, // floored, as calculateSpreadCredit would produce for a debit
      currentValue: 1750,
    });
    expect(pnl).toBeNull();
    expect(pnl).not.toBe(-1750);
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
