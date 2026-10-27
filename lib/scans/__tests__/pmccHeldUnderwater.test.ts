// lib/scans/__tests__/pmccHeldUnderwater.test.ts
//
// PMCC-HELD-UNDERWATER-0001A golden fixtures (Alan): an OTM / below-cost held LEAP (NFLX case) must reach
// short-call pairing and show cost-based economics; a profitable ITM held LEAP keeps working; a new-entry
// OTM long stays rejected; unusable or multi-lot cost bases keep market economics.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { heldLongKey } from '../pmccHeldBreakeven';
import { pairPmccCandidates } from '../pmccPairing';
import { evaluatePmccDecision } from '../pmccDecision';
import { excludedContractPremiumText, heldIncomeSummary, heldLeapOtmTag, heldStrikeBelowLeapLine, heldUncoveredSkippedLine, isUncoveredHeldShort, selectLongLegBlockerLine } from '../pmccHeldUnderwaterDisplay';
import { DEFAULT_HELD_PMCC_SHORT_DELTA, DEFAULT_HELD_PMCC_SHORT_DTE, DEFAULT_PMCC_DTE_RANGES, HELD_PMCC_SHORT_DTE_PRESETS } from '../pmccDteRanges';
import { PMCC_SHORT_DELTA_BOUNDS } from '../pmccConfig';
import { PMCC_DELTA_PRESETS } from '@/features/screener/components/PmccScanModal';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const asOf = new Date('2026-10-27T19:00:00.000Z');
const quoteTimestamp = '2026-10-27T18:59:30.000Z';

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 },
  shortDelta: { min: 0.15, max: 0.35 },
  longOiMin: 100,
  shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

function occ(symbol: string, expiration: string, strike: number): string {
  return `${symbol}${expiration.slice(2).replace(/-/g, '')}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

function leg(symbol: string, overrides: Partial<PmccChainLeg> & { expiration: string; strike: number }): PmccChainLeg {
  return {
    underlyingSymbol: symbol, optionType: 'C', delta: 0.25, openInterest: 500, bid: 1, ask: 1.02,
    occSymbol: occ(symbol, overrides.expiration, overrides.strike), quoteTimestamp, delayed: false,
    ...overrides,
  };
}

function basisFor(long: PmccChainLeg, avgOpen: number | null, quantity: unknown = 1) {
  return new Map([[heldLongKey(long.occSymbol!), { avgOpen, quantity }]]);
}

// NFLX case from the ticket: $70 call 2027-09-17, cost $20.85/sh, spot about $62.70.
const nflxLong = () => leg('NFLX', { expiration: '2027-09-17', strike: 70, delta: 0.45, bid: 7.0, ask: 7.4 });
const nflxShorts = () => [
  leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.25, bid: 0.60, ask: 0.62 }),
  leg('NFLX', { expiration: '2026-12-04', strike: 75, delta: 0.18, bid: 0.30, ask: 0.32 }),
];

function runNflx(opts: { held: boolean; avgOpen?: number | null; quantity?: unknown }) {
  const long = nflxLong();
  return pairPmccCandidates({
    symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long], shortLegs: nflxShorts(),
    criteria, asOf, marketSession: 'open',
    ...(opts.held ? {
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]),
      heldLongBasis: basisFor(long, opts.avgOpen === undefined ? 20.85 : opts.avgOpen, opts.quantity ?? 1),
    } : {}),
  });
}

describe('held OTM LEAP (NFLX, below cost)', () => {
  it('is no longer rejected for being out of the money, so shorts reach pairing', () => {
    const result = runNflx({ held: true });
    expect(result.counts.eligibleLongLegs).toBe(1);
    expect(result.counts.eligibleShortLegs).toBe(2);
    expect(result.legRejections.filter(item => item.role === 'long')).toHaveLength(0);
    expect(result.counts.combinationsEvaluated).toBe(2);
  });

  it('0001B: every call above the LEAP strike qualifies; the cost-basis floor (90.85) is not a gate', () => {
    const result = runNflx({ held: true });
    expect(result.qualifiedPairs).toHaveLength(2);
    expect(result.nearMissPairs).toHaveLength(0);
    result.qualifiedPairs.forEach(pair => expect(pair.failureReasons).toEqual([]));
  });

  it('rollback switch: enforceHeldCostFloor re-applies the old floor', () => {
    const long = nflxLong();
    const shorts = [leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.25, bid: 0.60, ask: 0.62 })];
    const result = pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long], shortLegs: shorts, criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85, 1), enforceHeldCostFloor: true,
    });
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.nearMissPairs).toHaveLength(1);
    expect(result.nearMissPairs[0].failureReasons.map(item => item.code)).toEqual(['SHORT_NOT_ABOVE_HELD_BREAKEVEN']);
  });

  it('a short at the SAME strike as the held LEAP is covered and qualifies; one strictly below never does', () => {
    const long = nflxLong();
    const run = (strike: number) => pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long],
      shortLegs: [leg('NFLX', { expiration: '2026-12-04', strike, delta: 0.30, bid: 2.4, ask: 2.5 })],
      criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85, 1),
    });
    expect(run(70).qualifiedPairs.map(pair => pair.shortLeg.strike)).toEqual([70]);
    const below = run(69.5);
    expect(below.qualifiedPairs).toHaveLength(0);
    expect(below.nearMissPairs[0].failureReasons.map(item => item.code)).toContain('LONG_STRIKE_NOT_BELOW_SHORT');
  });

  it('measures economics from cost, not the market ask (Alan)', () => {
    const pair = runNflx({ held: true }).qualifiedPairs.find(item => item.shortLeg.strike === 72.5)!;
    const metrics = pair.metrics!;
    expect(metrics.costBasisPerShare).toBeCloseTo(20.85, 10);
    expect(metrics.netDebitPerShare).toBeCloseTo(20.25, 10); // 20.85 - 0.60
    expect(metrics.strikeWidth).toBeCloseTo(2.5, 10);
    expect(metrics.widthMinusDebitPerShare).toBeCloseTo(-17.75, 10); // 2.5 - 20.25
    expect(metrics.shortCreditToNetDebitPct).toBeCloseTo((0.60 / 20.25) * 100, 8);
    // breakeven the card shows = long strike + net cost
    expect(pair.longLeg.strike + metrics.netDebitPerShare).toBeCloseTo(90.25, 10);
    // market-based fields stay market-based
    expect(metrics.longExtrinsicPerShare).toBeCloseTo(7.4, 10);
    expect(metrics.longIntrinsicPerShare).toBe(0);
  });

  it('worst-case assignment result equals width minus cost (strike gap + credit - cost)', () => {
    const pair = runNflx({ held: true }).qualifiedPairs.find(item => item.shortLeg.strike === 75)!;
    // (75 - 70) + 0.30 - 20.85 = -15.55
    expect(pair.metrics!.widthMinusDebitPerShare).toBeCloseTo(-15.55, 10);
  });

  it('keeps market economics when cost basis is unusable or multi-lot', () => {
    for (const result of [runNflx({ held: true, avgOpen: null }), runNflx({ held: true, quantity: 2 })]) {
      expect(result.counts.eligibleLongLegs).toBe(1);
      expect(result.qualifiedPairs).toHaveLength(2);
      result.qualifiedPairs.forEach(pair => {
        expect(pair.failureReasons).toEqual([]);
        expect(pair.metrics!.costBasisPerShare).toBeUndefined();
        expect(pair.metrics!.netDebitPerShare).toBeCloseTo(7.4 - pair.shortLeg.executablePrice, 10);
      });
    }
  });

  it('keeps market economics when the cost looks mis-scaled (unit guard)', () => {
    const result = runNflx({ held: true, avgOpen: 2085 });
    expect(result.qualifiedPairs).toHaveLength(2);
    result.qualifiedPairs.forEach(pair => expect(pair.metrics!.costBasisPerShare).toBeUndefined());
  });
});

describe('new-entry OTM long stays strict', () => {
  it('rejects an OTM long with LONG_NOT_ITM when it is not a held contract', () => {
    const result = runNflx({ held: false });
    expect(result.counts.eligibleLongLegs).toBe(0);
    const longRejection = result.legRejections.find(item => item.role === 'long')!;
    expect(longRejection.reasons.map(item => item.code)).toContain('LONG_NOT_ITM');
  });
});

describe('profitable ITM held LEAP (floor behavior unchanged)', () => {
  const gsLong = () => leg('GS', { expiration: '2027-09-17', strike: 720, delta: 0.82, bid: 345, ask: 347 });
  const gsShort = () => leg('GS', { expiration: '2026-12-04', strike: 1070, delta: 0.23, bid: 22, ask: 22.5 });

  it('qualifies and reports cost-based economics', () => {
    const long = gsLong();
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [long], shortLegs: [gsShort()],
      criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]),
      heldLongBasis: basisFor(long, 345),
    });
    expect(result.qualifiedPairs).toHaveLength(1);
    const metrics = result.qualifiedPairs[0].metrics!;
    expect(metrics.costBasisPerShare).toBe(345);
    expect(metrics.netDebitPerShare).toBeCloseTo(323, 10); // 345 - 22
    expect(metrics.widthMinusDebitPerShare).toBeCloseTo(27, 10); // 350 - 323
    expect(metrics.shortCreditToNetDebitPct).toBeCloseTo((22 / 323) * 100, 8);
    expect(720 + metrics.netDebitPerShare).toBeCloseTo(1043, 10);
  });

  it('a new-entry pair on the same chain keeps market economics (no costBasisPerShare)', () => {
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [gsLong()], shortLegs: [gsShort()],
      criteria, asOf, marketSession: 'open',
    });
    const metrics = result.qualifiedPairs[0].metrics!;
    expect(metrics.costBasisPerShare).toBeUndefined();
    expect(metrics.netDebitPerShare).toBeCloseTo(347 - 22, 10);
  });
});

describe('excluded contracts keep their premium', () => {
  it('carries bid and ask on a short rejected for delta', () => {
    const long = nflxLong();
    const result = pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long],
      shortLegs: [leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.50, bid: 1.9, ask: 1.95 })],
      criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85),
    });
    const rejection = result.legRejections.find(item => item.role === 'short')!;
    expect(rejection.reasons.map(item => item.code)).toContain('DELTA_OUT_OF_RANGE');
    expect(rejection.bid).toBeCloseTo(1.9, 10);
    expect(rejection.ask).toBeCloseTo(1.95, 10);
  });
});

describe('display selectors', () => {
  it('heldLeapOtmTag: shows for strike at or above spot, null when ITM or unusable', () => {
    expect(heldLeapOtmTag(70, 62.7, 0.4521)).toBe('OTM LEAP · Δ0.45');
    expect(heldLeapOtmTag(62.7, 62.7, 0.5)).toBe('OTM LEAP · Δ0.50');
    expect(heldLeapOtmTag(60, 62.7, 0.7)).toBeNull();
    expect(heldLeapOtmTag(70, null, 0.4)).toBeNull();
    expect(heldLeapOtmTag(NaN, 62.7, 0.4)).toBeNull();
    expect(heldLeapOtmTag(70, 62.7, null)).toBe('OTM LEAP');
  });

  it('selectLongLegBlockerLine: names the engine reason only when no long was eligible', () => {
    const rejections = [{ role: 'long' as const, occSymbol: 'x', strike: 67.5, expiration: '2027-09-17', reasons: [{ code: 'LONG_NOT_ITM' as const, message: 'Long call is not in the money' }] }];
    expect(selectLongLegBlockerLine(rejections, { eligibleLongLegs: 0 })).toBe('Long leg blocked: Long call is not in the money (1 contract).');
    expect(selectLongLegBlockerLine(rejections, { eligibleLongLegs: 1 })).toBeNull();
    expect(selectLongLegBlockerLine([], { eligibleLongLegs: 0 })).toBeNull();
    expect(selectLongLegBlockerLine(undefined, undefined)).toBeNull();
    const shortOnly = [{ role: 'short' as const, occSymbol: 'y', strike: 75, expiration: '2026-12-04', reasons: [{ code: 'DELTA_OUT_OF_RANGE' as const, message: 'x' }] }];
    expect(selectLongLegBlockerLine(shortOnly, { eligibleLongLegs: 0 })).toBeNull();
  });

  it('excludedContractPremiumText: shows a positive bid only', () => {
    expect(excludedContractPremiumText({ bid: 1.9 })).toBe(' · bid $1.90');
    expect(excludedContractPremiumText({ bid: 0 })).toBe('');
    expect(excludedContractPremiumText({ bid: null })).toBe('');
    expect(excludedContractPremiumText({})).toBe('');
  });
});

describe('0001B: income line for a held short call', () => {
  it('NFLX 72.50 call: collect $60 per contract, percent above price, chance of assignment, assigned outcome', () => {
    const out = heldIncomeSummary({ shortBid: 0.60, shortStrike: 72.5, shortDelta: 0.25, spot: 62.7, widthMinusCostPerShare: -17.75 });
    expect(out.collect).toBe('$60 per contract');
    expect(out.abovePrice).toBe('15.6% above price');
    expect(out.chanceAssigned).toBe('about 25% chance of assignment');
    expect(out.assignedOutcome).toBe('If assigned and LEAP exercised: -$17.75/sh (-$1,775 per contract), before fees. Not an expected P/L.');
  });

  it('positive outcome and missing data degrade quietly', () => {
    expect(heldIncomeSummary({ shortBid: 0.3, shortStrike: 75, shortDelta: 0.18, spot: 62.7, widthMinusCostPerShare: 27 }).assignedOutcome).toContain('$27.00/sh ($2,700 per contract)');
    const none = heldIncomeSummary({ shortBid: 0.3, shortStrike: 75, shortDelta: null, spot: null, widthMinusCostPerShare: null });
    expect(none).toEqual({ collect: '$30 per contract', abovePrice: null, chanceAssigned: null, assignedOutcome: null });
  });

  it('the held-card income line takes the cost-based outcome from the qualified NFLX pair', () => {
    const pair = runNflx({ held: true }).qualifiedPairs.find(item => item.shortLeg.strike === 75)!;
    const out = heldIncomeSummary({ shortBid: pair.shortLeg.executablePrice, shortStrike: 75, shortDelta: pair.shortLeg.delta, spot: 62.7, widthMinusCostPerShare: pair.metrics!.costBasisPerShare != null ? pair.metrics!.widthMinusDebitPerShare : null });
    expect(out.collect).toBe('$30 per contract');
    expect(out.assignedOutcome).toContain('-$15.55/sh (-$1,555 per contract)');
  });
});

describe('0001B: held scan defaults', () => {
  it('held scan opens at 7-10 DTE and delta 0-.15; new-entry ranges are unchanged', () => {
    expect(DEFAULT_HELD_PMCC_SHORT_DTE).toEqual({ min: 7, max: 10 });
    expect(DEFAULT_HELD_PMCC_SHORT_DELTA).toEqual({ min: 0, max: 0.15 });
    expect(DEFAULT_PMCC_DTE_RANGES.shortMin).toBe(30);
    expect(DEFAULT_PMCC_DTE_RANGES.shortMax).toBe(45);
  });

  it('chip sets: each chip overlaps the next, the defaults are chips, and delta chips sit inside the bounds', () => {
    expect(HELD_PMCC_SHORT_DTE_PRESETS.map(p => p.label)).toEqual(['7–10', '7–14', '10–21', '21–45', '30–45']);
    expect(PMCC_DELTA_PRESETS.map(p => p.label)).toEqual(['Δ 0–.10', 'Δ 0–.15', 'Δ .05–.20', 'Δ .10–.25', 'Δ .20–.35']);
    expect(PMCC_SHORT_DELTA_BOUNDS.min).toBe(0);
    const overlaps = (list: readonly { min: number; max: number }[]) => list.slice(1).every((chip, i) => chip.min <= list[i].max && chip.max >= list[i].min);
    expect(overlaps(HELD_PMCC_SHORT_DTE_PRESETS)).toBe(true);
    expect(overlaps(PMCC_DELTA_PRESETS)).toBe(true);
    expect(HELD_PMCC_SHORT_DTE_PRESETS.some(p => p.min === DEFAULT_HELD_PMCC_SHORT_DTE.min && p.max === DEFAULT_HELD_PMCC_SHORT_DTE.max)).toBe(true);
    expect(PMCC_DELTA_PRESETS.some(p => p.min === DEFAULT_HELD_PMCC_SHORT_DELTA.min && p.max === DEFAULT_HELD_PMCC_SHORT_DELTA.max)).toBe(true);
    PMCC_DELTA_PRESETS.forEach(p => { expect(p.min).toBeGreaterThanOrEqual(PMCC_SHORT_DELTA_BOUNDS.min); expect(p.max).toBeLessThanOrEqual(PMCC_SHORT_DELTA_BOUNDS.max); });
  });

  it('a 7-10 DTE short qualifies for a held LEAP when the scan range is 7-10', () => {
    const long = nflxLong();
    const shorts = [leg('NFLX', { expiration: '2026-11-06', strike: 75, delta: 0.14, bid: 0.20, ask: 0.22 })];
    const result = pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long], shortLegs: shorts,
      criteria: { ...criteria, dte: { ...criteria.dte, shortMin: 7, shortMax: 10 }, shortDelta: { min: 0.1, max: 0.2 } },
      asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85, 1),
    });
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(result.qualifiedPairs[0].shortLeg.dte).toBe(10);
  });
});

describe('0001B: best income, trend, and the strike-below-LEAP line', () => {
  const heldRun = (shorts: PmccChainLeg[], shortDelta = { min: 0.1, max: 0.2 }, dte = { shortMin: 7, shortMax: 45 }) => {
    const long = nflxLong();
    return pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.7, longLegs: [long], shortLegs: shorts,
      criteria: { ...criteria, dte: { ...criteria.dte, ...dte }, shortDelta },
      asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85, 1),
    });
  };

  it('ranks held pairs by premium per day, so a 40-day call that pays more per day beats a 10-day call', () => {
    const result = heldRun([
      leg('NFLX', { expiration: '2026-11-06', strike: 72.5, delta: 0.15, bid: 0.07, ask: 0.08 }),   // 10 DTE: 0.7 cents/day
      leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.15, bid: 0.50, ask: 0.52 }),   // 38 DTE: ~1.3 cents/day
    ]);
    expect(result.qualifiedPairs.map(pair => pair.shortLeg.expiration)).toEqual(['2026-12-04', '2026-11-06']);
  });

  it('delta closeness only breaks ties when premium per day is equal', () => {
    const result = heldRun([
      leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.12, bid: 0.40, ask: 0.42 }),
      leg('NFLX', { expiration: '2026-12-04', strike: 73, delta: 0.15, bid: 0.40, ask: 0.42 }),
    ]);
    expect(result.qualifiedPairs[0].shortLeg.strike).toBe(73);
  });

  it('a short below the LEAP strike is not qualified and the explanation names both strikes', () => {
    const result = heldRun([leg('NFLX', { expiration: '2026-12-04', strike: 66, delta: 0.17, bid: 0.29, ask: 0.31 })]);
    expect(result.qualifiedPairs).toHaveLength(0);
    const pair = result.nearMissPairs.concat(result.qualifiedPairs)[0];
    expect(heldStrikeBelowLeapLine(70, 66)).toContain('$66 strike is below your $70 LEAP strike');
    expect(pair?.failureReasons.map(item => item.code) ?? []).toContain('LONG_STRIKE_NOT_BELOW_SHORT');
  });

  it('trend against the bullish thesis is a note for a held pair and still a block for a new entry', () => {
    const held = heldRun([leg('NFLX', { expiration: '2026-12-04', strike: 72.5, delta: 0.15, bid: 0.40, ask: 0.42 })]).qualifiedPairs[0];
    const heldDecision = evaluatePmccDecision({ pair: { ...held, entryMode: 'covered-short-call-against-held-leaps' }, criteria, marketSession: 'open', trendAgainst: true });
    expect(heldDecision.gates.find(g => g.code === 'TREND_AGAINST_BULLISH_THESIS')?.status).toBe('warning');
    const newDecision = evaluatePmccDecision({ pair: { ...held, entryMode: 'new-pmcc' }, criteria, marketSession: 'open', trendAgainst: true });
    expect(newDecision.gates.find(g => g.code === 'TREND_AGAINST_BULLISH_THESIS')?.status).toBe('fail');
  });
});

describe('0001B: far-out-of-the-money income calls (real NFLX Nov 6 chain)', () => {
  it('with min delta .01, the $71-73 calls above a $70 LEAP qualify and rank by premium per day', () => {
    const long = nflxLong();
    const shorts = [
      leg('NFLX', { expiration: '2026-11-06', strike: 71, delta: 0.03, bid: 0.05, ask: 0.06, openInterest: 892 }),
      leg('NFLX', { expiration: '2026-11-06', strike: 72, delta: 0.03, bid: 0.04, ask: 0.05, openInterest: 889 }),
      leg('NFLX', { expiration: '2026-11-06', strike: 73, delta: 0.02, bid: 0.03, ask: 0.04, openInterest: 2670 }),
    ];
    const result = pairPmccCandidates({
      symbol: 'NFLX', underlyingPrice: 62.52, longLegs: [long], shortLegs: shorts,
      criteria: { ...criteria, dte: { ...criteria.dte, shortMin: 7, shortMax: 10 }, shortDelta: { min: 0.01, max: 0.2 }, quotePolicy: { ...criteria.quotePolicy } },
      asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]), heldLongBasis: basisFor(long, 20.85, 1),
    });
    expect(result.qualifiedPairs.map(pair => pair.shortLeg.strike)).toEqual([71, 72, 73]);
  });
});

describe('PMCC-HELD-UNDERWATER-0001B4 uncovered held calls are skipped, not listed', () => {
  const held = 'covered-short-call-against-held-leaps';
  it('flags only held pairs failing LONG_STRIKE_NOT_BELOW_SHORT', () => {
    expect(isUncoveredHeldShort({ entryMode: held, failureReasons: [{ code: 'LONG_STRIKE_NOT_BELOW_SHORT' }] })).toBe(true);
    expect(isUncoveredHeldShort({ entryMode: held, failureReasons: [{ code: 'SHORT_SPREAD_TOO_WIDE' }] })).toBe(false);
    expect(isUncoveredHeldShort({ entryMode: 'new-entry', failureReasons: [{ code: 'LONG_STRIKE_NOT_BELOW_SHORT' }] })).toBe(false);
    expect(isUncoveredHeldShort(null)).toBe(false);
  });
  it('one summary line, with guidance only when nothing else is shown', () => {
    expect(heldUncoveredSkippedLine(5, 70, false)).toBe('5 calls below your $70 LEAP strike were skipped (not covered).');
    expect(heldUncoveredSkippedLine(1, 70, false)).toBe('1 call below your $70 LEAP strike was skipped (not covered).');
    expect(heldUncoveredSkippedLine(5, 70, true)).toContain('No call above your $70 LEAP strike fits');
  });
});
