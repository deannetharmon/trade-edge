import { describe, it, expect } from 'vitest';
import { scoreCandidate } from '../rank-scoring';
import type { ScreenResult, RankConfig, SpreadCandidate } from '../types';

// TARGETED-FILTER-BADGE-INSTABILITY-0001 -- Quinn's follow-up question:
// findBestSpread (the candidate search) is proven deterministic in
// isolation, but the diagnostic badge Dean sees shows scoreCandidate's
// OUTPUT, not the raw candidate -- a separate step. This tests whether
// scoreCandidate itself can disagree with itself given the identical
// candidate and identical RankConfig, twice, with no React involved.

const RANK_CONFIG: RankConfig = {
  weightMomentum: 25, weightIvr: 15, weightEmClearance: 15, weightRange: 15,
  weightTechnical: 10, weightLiquidity: 10, weightBuffer: 10,
  dteSweetSpot: 38, dteRange: 7,
  thresholdGreen: 75, thresholdYellow: 55, thresholdOrange: 35,
  weightCredit: 25, weightRoc: 20, weightPop: 15, weightDte: 15,
};

function buildBcsCandidate(): SpreadCandidate {
  return {
    strategy: 'BCS', expiration: '2026-10-16', dte: 30,
    shortStrike: 300, longStrike: 305, shortDelta: 0.28,
    shortOI: 24353, longOI: 10829,
    credit: 0.49, spreadWidth: 5, capitalRequired: 451, contractMultiplier: 100,
    creditRatio: 0.098, roc: 10.9, pop: 84, optimized: true,
  } as SpreadCandidate;
}

function buildResult(): ScreenResult {
  return {
    symbol: 'AAPL', strategy: 'BCS', qualified: false, failReasons: [],
    bestCandidate: buildBcsCandidate(),
    trendResult: {
      strategy: 'BPS',
      scores: { momentum: 12, total: 40 },
      confidence: 60, trend: 'up',
      metrics: { rsi14: 67 },
    },
    checks: {} as any,
  } as unknown as ScreenResult;
}

describe('scoreCandidate determinism (Quinn: identical candidate + config, called twice, no React)', () => {
  it('returns byte-identical scores across two calls with the exact same result/config references', () => {
    const result = buildResult();
    const first = scoreCandidate(result, RANK_CONFIG);
    const second = scoreCandidate(result, RANK_CONFIG);
    expect(second).toEqual(first);
  });

  it('returns byte-identical scores across two calls with separately-constructed but equal inputs', () => {
    const first = scoreCandidate(buildResult(), { ...RANK_CONFIG });
    const second = scoreCandidate(buildResult(), { ...RANK_CONFIG });
    expect(second).toEqual(first);
  });

  it('is stable across ten repeated calls', () => {
    const result = buildResult();
    const results = Array.from({ length: 10 }, () => scoreCandidate(result, RANK_CONFIG));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('produces a real, non-null score for this fixture (sanity check)', () => {
    const scored = scoreCandidate(buildResult(), RANK_CONFIG);
    expect(scored).not.toBeNull();
    expect(typeof scored!.score).toBe('number');
  });
});
