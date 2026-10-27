// lib/scans/__tests__/pmccHeldUnderwater.test.ts
//
// PMCC-HELD-UNDERWATER-0001A golden fixtures (Alan): an OTM / below-cost held LEAP (NFLX case) must reach
// short-call pairing and show cost-based economics; a profitable ITM held LEAP keeps working; a new-entry
// OTM long stays rejected; unusable or multi-lot cost bases keep market economics.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { heldLongKey } from '../pmccHeldBreakeven';
import { pairPmccCandidates } from '../pmccPairing';
import { excludedContractPremiumText, heldLeapOtmTag, selectLongLegBlockerLine } from '../pmccHeldUnderwaterDisplay';
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

  it('still fails the cost-basis floor (0001B owns that control): floor = 70 + 20.85 = 90.85', () => {
    const result = runNflx({ held: true });
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.nearMissPairs).toHaveLength(2);
    result.nearMissPairs.forEach(pair => expect(pair.failureReasons.map(item => item.code)).toEqual(['SHORT_NOT_ABOVE_HELD_BREAKEVEN']));
  });

  it('measures economics from cost, not the market ask (Alan)', () => {
    const pair = runNflx({ held: true }).nearMissPairs.find(item => item.shortLeg.strike === 72.5)!;
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
    const pair = runNflx({ held: true }).nearMissPairs.find(item => item.shortLeg.strike === 75)!;
    // (75 - 70) + 0.30 - 20.85 = -15.55
    expect(pair.metrics!.widthMinusDebitPerShare).toBeCloseTo(-15.55, 10);
  });

  it('keeps market economics when cost basis is unusable or multi-lot', () => {
    for (const result of [runNflx({ held: true, avgOpen: null }), runNflx({ held: true, quantity: 2 })]) {
      expect(result.counts.eligibleLongLegs).toBe(1);
      result.nearMissPairs.forEach(pair => {
        expect(pair.failureReasons.map(item => item.code)).toContain('COST_BASIS_UNAVAILABLE');
        expect(pair.metrics!.costBasisPerShare).toBeUndefined();
        expect(pair.metrics!.netDebitPerShare).toBeCloseTo(7.4 - pair.shortLeg.executablePrice, 10);
      });
    }
  });

  it('keeps market economics when the cost looks mis-scaled (unit guard)', () => {
    const result = runNflx({ held: true, avgOpen: 2085 });
    result.nearMissPairs.forEach(pair => {
      expect(pair.failureReasons.map(item => item.code)).toContain('COST_BASIS_UNAVAILABLE');
      expect(pair.metrics!.costBasisPerShare).toBeUndefined();
    });
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
