import { describe, expect, it, vi } from 'vitest';
import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { CheckResult, ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import { opportunityRecommendationsFromApiResponse } from '@/lib/command-center/screenerOpportunityRecommendations';
import {
  buildBatchedRecommendationTransportPlan,
  evaluateScreenResultsInBatches,
  RecommendationEvaluationPausedError,
  RECOMMENDATION_ENGINE_BUSY_CODE,
  RECOMMENDATION_SAFE_REQUEST_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
} from '../screenerRecommendationTransport';

const check: CheckResult = {
  status: 'pass',
  value: 'Meets threshold',
  reason: 'Sufficient liquidity and expected-move clearance.',
};

function makeCandidate(index: number, overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    sourceResultId: `source-${index}`,
    strategy: 'BPS',
    expiration: '2026-09-18',
    dte: 55,
    shortStrike: 180 + index / 100,
    longStrike: 175 + index / 100,
    shortDelta: -0.22,
    credit: 1.35,
    spreadWidth: 5,
    creditRatio: 0.27,
    roc: 0.37,
    pop: 74.2,
    shortOI: 2500,
    longOI: 1800,
    shortIv: 0.38,
    expirationIvx: 0.41,
    expectedMove: 12.4,
    shortOccSymbol: `SYM${index}260918P00180000`,
    longOccSymbol: `SYM${index}260918P00175000`,
    shortBid: 1.32,
    shortAsk: 1.38,
    longBid: 0.22,
    longAsk: 0.26,
    quoteFetchedAt: 1_785_000_000_000,
    ...overrides,
  };
}

function makeResult(index: number, overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: `SYM${index}`,
    strategy: 'BPS',
    price: 190.25,
    ivr: 55.4,
    ivx: 0.42,
    ivx30: 0.39,
    ivHv30Diff: 0.12,
    liquidityRating: 8.7,
    qualified: true,
    bestCandidate: makeCandidate(index),
    failReasons: [],
    earningsDate: '2026-10-22',
    trendResult: {
      trend: 'uptrend',
      strategy: 'BPS',
      subtype: 'CONTINUATION',
      confidence: 84,
      ma20: 188,
      ma50: 181,
      ma200: 165,
      reason: 'Price above rising moving averages.',
      scores: {
        momentum: 18,
        maAlignment: 17,
        slope: 14,
        structure: 13,
        chop: 8,
        volatility: 9,
        total: 79,
      },
      metrics: {
        price: 190.25,
        ma20: 188,
        ma50: 181,
        ma200: 165,
        momentum20: 0.08,
        momentum60: 0.14,
        momentum90: 0.21,
        rsi14: 61,
        ma20Slope: 0.7,
        ma50Slope: 0.4,
        range60: 32,
        chopRatio: 0.31,
        distFromMa50: 0.051,
        higherHighs: true,
        higherLows: true,
        lowerHighs: false,
        lowerLows: false,
      },
    },
    isEtf: false,
    underlyingType: 'stock',
    ruleSetApplied: 'ranked-broad',
    checks: {
      ivr: check,
      earnings: check,
      oi: check,
      delta: check,
      credit: check,
      roc: check,
      pop: check,
      iv: check,
      emClearance: check,
    },
    ...overrides,
  };
}

function makePmccResult(index: number, longExpiration = '2027-01-15'): ScreenResult {
  return makeResult(index, {
    strategy: 'PMCC',
    bestCandidate: makeCandidate(index, {
      strategy: 'PMCC',
      expiration: '2026-09-18',
      shortStrike: 205,
      longStrike: 150,
      shortOI: 900,
      longOI: 1_200,
      credit: 1.35,
      longCost: 31.35,
      netDebit: 30,
      netDebitUnit: 'per_share',
      capitalRequired: 3_000,
      contractMultiplier: 100,
      quantity: 1,
      longExpiration,
      longOccSymbolPMCC: `SYM${index}270115C00150000`,
      shortOccSymbolPMCC: `SYM${index}260918C00205000`,
    }),
  });
}

function makeAnalysis(candidate: AutopilotCandidate, score: number): DecisionAnalysis {
  return {
    id: `decision_${candidate.id}`,
    createdAt: '2026-07-25T00:00:00.000Z',
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: candidate.id,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol} ${candidate.strategy}`,
    },
    objective: 'generate_income',
    recommendation: {
      action: 'OPEN_BPS',
      strategy: candidate.strategy,
      summary: 'Review candidate.',
      status: score % 3 === 0 ? 'conditional' : 'recommended',
    },
    confidence: {
      overall: 70 + (score % 20),
      market: 75,
      portfolio: 75,
      execution: 75,
      income: 75,
      risk: 75,
    },
    priority: 'normal',
    rationale: 'Canonical evaluation result.',
    supportingEvidence: [],
    concerns: [],
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'Evaluate the candidate without execution.' },
    candidate,
    opportunityScore: {
      total: score,
      edgeScore: score,
      goalAlignmentFactor: 1,
      riskContributionPenalty: 0,
      postureMultiplier: 1,
      notes: [],
    },
    metadata: {
      source: 'screener',
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: [],
      rulesBlocked: [],
    },
  };
}

function response(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('screener recommendation transport', () => {
  it('turns a representative 9,425-result scan into compact byte-bounded requests without omission or duplication', () => {
    const results = Array.from({ length: 9_425 }, (_, index) => makeResult(index));
    const originalBytes = new TextEncoder().encode(JSON.stringify({ screenResults: results })).byteLength;
    const plan = buildBatchedRecommendationTransportPlan(results);
    const transportedIds = plan.batches.flatMap((batch) => batch.candidates.map((candidate) => candidate.id));

    expect(originalBytes).toBeGreaterThan(VERCEL_FUNCTION_BODY_LIMIT_BYTES);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.candidateCount).toBe(9_425);
    expect(transportedIds).toHaveLength(9_425);
    expect(new Set(transportedIds).size).toBe(9_425);
    expect(plan.batches.every((batch) => batch.byteLength <= RECOMMENDATION_SAFE_REQUEST_BYTES)).toBe(true);
    expect(Math.max(...plan.batches.map((batch) => batch.byteLength))).toBeLessThan(
      VERCEL_FUNCTION_BODY_LIMIT_BYTES,
    );
  });

  it('bounds variable-sized records by serialized UTF-8 bytes rather than candidate count', () => {
    const results = Array.from({ length: 40 }, (_, index) => makeResult(index, {
      failReasons: [`variable note ${'x'.repeat(index * 1_000)}`],
    }));
    const plan = buildBatchedRecommendationTransportPlan(results, 75_000);

    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.every((batch) => batch.byteLength <= 75_000)).toBe(true);
    expect(plan.batches.map((batch) => batch.candidates.length)).not.toEqual(
      Array(plan.batches.length).fill(plan.batches[0].candidates.length),
    );
  });

  it('fails truthfully before sending when one duplicate-affinity group cannot fit safely', () => {
    const oversized = makeResult(1, { failReasons: ['x'.repeat(20_000)] });
    expect(() => buildBatchedRecommendationTransportPlan([oversized], 5_000)).toThrow(
      /exceeding the safe 5000-byte request limit/,
    );
  });

  it('keeps candidates with the canonical duplicate identity in one batch', () => {
    const first = makeResult(1, { symbol: 'AAPL' });
    const second = makeResult(2, {
      symbol: 'AAPL',
      bestCandidate: makeCandidate(1, { expiration: '2026-10-16' }),
    });
    const plan = buildBatchedRecommendationTransportPlan(
      [first, ...Array.from({ length: 6 }, (_, index) => makeResult(index + 10)), second],
      2_500,
    );
    const matchingBatchIndexes = plan.batches.flatMap((batch, batchIndex) =>
      batch.candidates
        .filter((candidate) => candidate.symbol === 'AAPL')
        .map(() => batchIndex),
    );

    expect(matchingBatchIndexes).toHaveLength(2);
    expect(new Set(matchingBatchIndexes).size).toBe(1);
  });

  it('retains PMCC two-expiration identity through planning and does not collapse distinct LEAPS expirations', () => {
    const first = makePmccResult(1, '2027-01-15');
    const second = makePmccResult(1, '2027-03-19');
    second.bestCandidate = {
      ...second.bestCandidate!,
      longOccSymbolPMCC: 'SYM1270319C00150000',
    };
    const plan = buildBatchedRecommendationTransportPlan([first, second], 10_000);

    expect(plan.candidateCount).toBe(2);
    expect(plan.batches.flatMap((batch) => batch.candidates).map((candidate) =>
      candidate.legs.find((leg) => leg.direction === 'long')?.expiration,
    )).toEqual(['2027-01-15', '2027-03-19']);
  });

  it('excludes Covered Call before recommendation submission', () => {
    const cc = makeResult(7, {
      strategy: 'CC',
      bestCandidate: makeCandidate(7, { strategy: 'CC' }),
    });
    expect(() => buildBatchedRecommendationTransportPlan([cc])).toThrow(
      /produced no canonical candidates/,
    );
  });

  it('aggregates a PMCC analysis without overwriting earlier batches', async () => {
    const results = [makeResult(1), makePmccResult(2)];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      return response({
        result: {
          recommendations: candidates.map((candidate, index) => makeAnalysis(candidate, index + 1)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });
    const body = await evaluateScreenResultsInBatches(results, { fetch: fetchMock, maxRequestBytes: 2_500 });

    expect(body.result.recommendations.map((analysis) => analysis.candidate?.strategy)).toEqual(['BPS', 'PMCC']);
    expect(body.result.recommendations[1].candidate?.legs.map((leg) => leg.expiration)).toEqual([
      '2027-01-15',
      '2026-09-18',
    ]);
    expect(body.result.recommendations.map((analysis) => analysis.candidate?.sourceResultId)).toEqual([
      'source-1',
      'source-2',
    ]);
  });

  it('uses one request for a normal small scan and aggregates every batch before returning success', async () => {
    const results = Array.from({ length: 8 }, (_, index) => makeResult(index));
    const observedIds: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      observedIds.push(...candidates.map((candidate) => candidate.id));
      return response({
        result: {
          recommendations: candidates.map((candidate, index) => makeAnalysis(candidate, index + 1)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    const body = await evaluateScreenResultsInBatches(results, { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.result.recommendations).toHaveLength(8);
    expect(body.result.candidatesScanned).toBe(8);
    expect(new Set(observedIds).size).toBe(8);
  });

  it('evaluates exhaustive Ranked Scan rows even when the legacy checklist flag is false', async () => {
    const ranked = makeResult(1, {
      qualified: false,
      ruleSetApplied: 'ranked-broad',
      failReasons: ['Below fit threshold'],
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      return response({
        result: {
          recommendations: candidates.map((candidate) => makeAnalysis(candidate, 3)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    const body = await evaluateScreenResultsInBatches([ranked], {
      fetch: fetchMock,
      includeUnqualifiedCandidates: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.result.recommendations).toHaveLength(1);
    expect(body.result.recommendations[0].recommendation.status).toBe('conditional');
    expect(body.result.recommendations[0].candidate).not.toHaveProperty('qualified');
    expect(body.diagnostics).toMatchObject({
      rawResultCount: 1,
      resultsWithBestCandidate: 1,
      qualifiedTrueCount: 0,
      qualifiedFalseCount: 1,
      canonicalCandidateCount: 1,
      duplicateAffinityGroupCount: 1,
      httpBatchCount: 1,
      submittedCandidateCount: 1,
      returnedAnalysisCount: 1,
      batchCandidateCounts: [1],
      batchAnalysisCounts: [1],
    });
  });

  it('retains exact analyses across an empty intervening batch and globally ranks only the complete aggregate', async () => {
    const results = Array.from({ length: 6 }, (_, index) => makeResult(index));
    let call = 0;
    const expectedAnalyses: DecisionAnalysis[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      const analyses = call === 2
        ? []
        : candidates.map((candidate, index) => {
            const score = 100 - (call * 10) - index;
            const analysis = makeAnalysis(candidate, score);
            expectedAnalyses.push(analysis);
            return analysis;
          });
      return response({
        result: {
          recommendations: analyses,
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    const body = await evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      maxRequestBytes: 1_000,
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    const expectedIds = expectedAnalyses.map((analysis) => analysis.id);
    const aggregateIds = body.result.recommendations.map((analysis) => analysis.id);
    expect(aggregateIds).toEqual(expectedIds);
    expect(new Set(aggregateIds).size).toBe(expectedIds.length);
    expect(body.diagnostics.batchAnalysisCounts[0]).toBeGreaterThan(0);
    expect(body.diagnostics.batchAnalysisCounts[1]).toBe(0);
    expect(body.diagnostics.batchAnalysisCounts.slice(2).some((count) => count > 0)).toBe(true);
    expect(body.diagnostics.returnedAnalysisCount).toBe(expectedIds.length);

    const globallyRanked = opportunityRecommendationsFromApiResponse(body, new Date(0));
    const canonicalCompleteSetRanking = opportunityRecommendationsFromApiResponse(
      { result: { recommendations: [...expectedAnalyses].reverse() } },
      new Date(0),
    );
    expect(globallyRanked.recommendations).toEqual(canonicalCompleteSetRanking.recommendations);
  });

  it('retains curated-scan qualification admission and reports a neutral first-evaluation failure', async () => {
    const curated = makeResult(1, {
      qualified: false,
      ruleSetApplied: 'strict-curated',
    });

    expect(() => buildBatchedRecommendationTransportPlan([curated])).toThrow(
      'Recommendation evaluation produced no canonical candidates.',
    );
    expect(() => buildBatchedRecommendationTransportPlan([curated])).not.toThrow(
      /prior ranked-opportunity publication was preserved/,
    );
  });

  it('treats a structurally successful all-empty evaluation as publication failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      result: {
        recommendations: [],
        duplicates: [],
        candidatesScanned: 1,
        killSwitchActive: false,
      },
    }));

    const evaluation = evaluateScreenResultsInBatches([makeResult(1)], {
      fetch: fetchMock,
    });
    await expect(evaluation).rejects.toThrow('completed without candidate analyses');
    await expect(evaluation).rejects.not.toThrow(/prior ranked-opportunity publication was preserved/);
  });

  it('keeps zero capital from removing a conditional Ranked Scan analysis', async () => {
    const result = makeResult(1, { qualified: false, ruleSetApplied: 'ranked-broad' });
    const plan = buildBatchedRecommendationTransportPlan([result], RECOMMENDATION_SAFE_REQUEST_BYTES, true);
    const analysis = makeAnalysis(plan.batches[0].candidates[0], 3);
    const ranked = opportunityRecommendationsFromApiResponse(
      { result: { recommendations: [analysis] } },
      new Date(0),
    );

    expect(analysis.recommendation.status).toBe('conditional');
    expect(ranked.recommendations).toHaveLength(1);
    expect(ranked.recommendations[0].disposition).not.toBe('RECOMMENDED');
  });

  it('preserves canonical complete-set global ranking after partitioned transport', async () => {
    const results = Array.from({ length: 12 }, (_, index) => makeResult(index));
    const allAnalyses: DecisionAnalysis[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      const analyses = candidates
        .map((candidate) => makeAnalysis(candidate, Number(candidate.symbol.replace('SYM', '')) + 1))
        .reverse();
      allAnalyses.push(...analyses);
      return response({
        result: {
          recommendations: analyses,
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    const partitionedBody = await evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      maxRequestBytes: 2_000,
    });
    const partitioned = opportunityRecommendationsFromApiResponse(partitionedBody, new Date(0));
    const unpartitioned = opportunityRecommendationsFromApiResponse(
      { result: { recommendations: [...allAnalyses].reverse() } },
      new Date(0),
    );

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(partitioned.recommendations).toEqual(unpartitioned.recommendations);
  });

  it('never returns partial success when a transport batch fails', async () => {
    const results = Array.from({ length: 6 }, (_, index) => makeResult(index));
    let call = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === 2) return response({ error: 'batch unavailable' }, false, 503);
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      return response({
        result: {
          recommendations: candidates.map((candidate) => makeAnalysis(candidate, 50)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    await expect(evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      maxRequestBytes: 1_500,
    })).rejects.toThrow('batch unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately and returns a coherent zero-result paused outcome when the first batch sees the kill switch', async () => {
    const results = Array.from({ length: 6 }, (_, index) => makeResult(index));
    const plan = buildBatchedRecommendationTransportPlan(results, 1_000);
    expect(plan.batches.length).toBeGreaterThan(2);
    const fetchMock = vi.fn().mockResolvedValue(response({
      result: {
        recommendations: [],
        duplicates: [],
        candidatesScanned: 0,
        killSwitchActive: true,
      },
    }));

    const evaluation = evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      maxRequestBytes: 1_000,
    });

    await expect(evaluation).rejects.toBeInstanceOf(RecommendationEvaluationPausedError);
    await expect(evaluation).rejects.toMatchObject({
      pausedResult: {
        result: {
          recommendations: [],
          duplicates: [],
          candidatesScanned: 0,
          killSwitchActive: true,
        },
        transport: {
          batchCount: 1,
          candidateCount: 6,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards earlier analyses and sends no later batch when the kill switch activates mid-evaluation', async () => {
    const results = Array.from({ length: 6 }, (_, index) => makeResult(index));
    const plan = buildBatchedRecommendationTransportPlan(results, 1_000);
    expect(plan.batches.length).toBeGreaterThan(2);
    let call = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      if (call === 2) {
        return response({
          result: {
            recommendations: [],
            duplicates: [],
            candidatesScanned: 0,
            killSwitchActive: true,
          },
        });
      }
      return response({
        result: {
          recommendations: candidates.map((item, index) => makeAnalysis(item, index + 1)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    const evaluation = evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      maxRequestBytes: 1_000,
    });

    await expect(evaluation).rejects.toMatchObject({
      pausedResult: {
        result: {
          recommendations: [],
          duplicates: [],
          candidatesScanned: 0,
          killSwitchActive: true,
        },
        transport: {
          batchCount: 2,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries only explicit lock contention with bounded backoff and then succeeds', async () => {
    const result = makeResult(1);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        error: 'Autopilot recommendation engine is already running.',
        code: RECOMMENDATION_ENGINE_BUSY_CODE,
        retryable: true,
      }, false, 409))
      .mockResolvedValueOnce(response({
        result: {
          recommendations: [makeAnalysis(
            buildBatchedRecommendationTransportPlan([result]).batches[0].candidates[0],
            80,
          )],
          duplicates: [],
          candidatesScanned: 1,
          killSwitchActive: false,
        },
      }));

    const body = await evaluateScreenResultsInBatches([result], {
      fetch: fetchMock,
      maxBusyRetries: 1,
      busyRetryBaseDelayMs: 0,
      busyRetryMaxDelayMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.result.recommendations).toHaveLength(1);
  });

  it('does not retry a genuine failure or an unclassified 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ error: 'Recommendation persistence failed.' }, false, 500),
    );

    await expect(evaluateScreenResultsInBatches([makeResult(1)], {
      fetch: fetchMock,
      maxBusyRetries: 12,
      busyRetryBaseDelayMs: 0,
      busyRetryMaxDelayMs: 0,
    })).rejects.toThrow('Recommendation persistence failed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails truthfully when the bounded busy-retry window is exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      error: 'Autopilot recommendation engine is already running.',
      code: RECOMMENDATION_ENGINE_BUSY_CODE,
      retryable: true,
    }, false, 409));

    await expect(evaluateScreenResultsInBatches([makeResult(1)], {
      fetch: fetchMock,
      maxBusyRetries: 2,
      busyRetryBaseDelayMs: 0,
      busyRetryMaxDelayMs: 0,
    })).rejects.toThrow(/remained busy after 3 attempts.*not published/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts immediately while a superseded evaluation is waiting to retry a busy lock', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(response({
      error: 'Autopilot recommendation engine is already running.',
      code: RECOMMENDATION_ENGINE_BUSY_CODE,
      retryable: true,
    }, false, 409));
    const evaluation = evaluateScreenResultsInBatches([makeResult(1)], {
      fetch: fetchMock,
      signal: controller.signal,
      maxBusyRetries: 12,
      busyRetryBaseDelayMs: 10_000,
      busyRetryMaxDelayMs: 10_000,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(evaluation).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an older multi-request evaluation before it can publish a complete result', async () => {
    const results = Array.from({ length: 6 }, (_, index) => makeResult(index));
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const candidates = JSON.parse(String(init?.body)).candidates as AutopilotCandidate[];
      controller.abort();
      return response({
        result: {
          recommendations: candidates.map((candidate) => makeAnalysis(candidate, 50)),
          duplicates: [],
          candidatesScanned: candidates.length,
          killSwitchActive: false,
        },
      });
    });

    await expect(evaluateScreenResultsInBatches(results, {
      fetch: fetchMock,
      signal: controller.signal,
      maxRequestBytes: 1_500,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
