// lib/__tests__/optimizeRank.test.ts
//
// OPTMAP-0001 S5b: Optimize is the screener's ranked scan, not a second finder. The scan runner and scorer are the
// screener's own; these tests pin that Trade Map calls them with the saved criteria and keeps their order.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runRankedScan = vi.fn();
vi.mock('@/lib/scans/ranked-scan-runner', () => ({ runRankedScan: (...a: unknown[]) => runRankedScan(...a) }));
vi.mock('@/lib/scans/rank-scoring', () => ({
  scoreCandidate: (r: any) => (r.score == null ? null : { score: r.score, dims: {} }),
}));

import { pickRanked, runRankedOptimize } from '@/lib/trademap/optimizeRank';
import { DEFAULT_ETF_RULES, DEFAULT_RULES } from '@/lib/scans/constants';

const res = (strategy: string, short: number, score: number | null, exp = '2026-12-18') =>
  ({ bestCandidate: { strategy, expiration: exp, shortStrike: short, longStrike: short - 5, dte: 30, pop: 70, roc: 30, credit: 1 }, score }) as any;
const rank = { weightPop: 15 } as any;

describe('pickRanked', () => {
  it('keeps one side, best score first, drops unscored (unqualified) results', () => {
    const out = pickRanked([res('BPS', 700, 55), res('BCS', 760, 90), res('BPS', 690, 80), res('BPS', 720, null), res('IC', 700, 99)], 'bps', rank);
    expect(out.map(o => o.candidate.shortStrike)).toEqual([690, 700]);
    expect(out[0].score).toBe(80);
  });
  it('can come from a different expiration than the one on screen', () => {
    const out = pickRanked([res('BPS', 700, 50, '2026-12-18'), res('BPS', 695, 60, '2027-01-02')], 'bps', rank);
    expect(out[0].candidate.expiration).toBe('2027-01-02');
  });
  it('limits the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => res('BPS', 700 - i, 50 + i));
    expect(pickRanked(many, 'bps', rank, 5)).toHaveLength(5);
  });
});

describe('runRankedOptimize', () => {
  beforeEach(() => runRankedScan.mockReset());
  it('runs the screener scan for this one symbol with the saved rules and rank weights', async () => {
    runRankedScan.mockResolvedValue({ results: [res('BPS', 700, 70)], rawScanCache: [{ chainData: { isEtfOrIndex: true } }] });
    const out = await runRankedOptimize({ symbol: 'SPY', strategy: 'bps', sRules: DEFAULT_RULES, eRules: DEFAULT_ETF_RULES, rankConfig: rank });
    expect(runRankedScan).toHaveBeenCalledWith({ activeSymbols: ['SPY'], sRules: DEFAULT_RULES, eRules: DEFAULT_ETF_RULES, rankConfig: rank });
    expect(out.ranked).toHaveLength(1);
    expect(out.popMin).toBe(DEFAULT_ETF_RULES.POP_MIN);
  });
  it('uses the stock rules for a stock', async () => {
    runRankedScan.mockResolvedValue({ results: [], rawScanCache: [{ chainData: { isEtfOrIndex: false } }] });
    const out = await runRankedOptimize({ symbol: 'AAPL', strategy: 'bcs', sRules: { ...DEFAULT_RULES, POP_MIN: 70 }, eRules: DEFAULT_ETF_RULES, rankConfig: rank });
    expect(out.ranked).toEqual([]);
    expect(out.popMin).toBe(70);
  });
});
