import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { AutopilotCandidate, AutopilotConfig, PaperAccount } from '@/lib/autopilot/types';
import type { RecommendationRunResult } from '@/lib/autopilot/decision/types';
import {
  RECOMMENDATION_SAFE_REQUEST_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
} from '@/lib/recommendations/screenerRecommendationTransport';

const {
  runRecommendationEngine,
  screenResultsToAutopilotCandidates,
  resolveAutopilotUserId,
} = vi.hoisted(() => ({
  runRecommendationEngine: vi.fn(),
  screenResultsToAutopilotCandidates: vi.fn(),
  resolveAutopilotUserId: vi.fn(),
}));

vi.mock('@/lib/autopilot/decision/recommendationEngine', () => ({
  runRecommendationEngine,
}));
vi.mock('@/lib/autopilot/decision/screenerCandidateAdapter', () => ({
  screenResultsToAutopilotCandidates,
}));
vi.mock('@/lib/autopilot/server/auth', () => ({
  resolveAutopilotUserId,
}));

import { POST } from '../route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/autopilot/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const candidate: AutopilotCandidate = {
  id: 'screen_AAPL_BPS_2026-09-18_180',
  sourceResultId: 'source-AAPL-BPS-2026-09-18-180',
  strategy: 'BPS',
  symbol: 'AAPL',
  underlyingPrice: 190,
  legs: [{
    symbol: 'AAPL260918P00180000',
    underlyingSymbol: 'AAPL',
    assetType: 'option',
    direction: 'short',
    optionType: 'put',
    strike: 180,
    expiration: '2026-09-18',
    quantity: 1,
  }],
  estimatedCredit: 1.35,
  theoreticalMaxLoss: 365,
};

const pmccCandidate: AutopilotCandidate = {
  id: 'screen_AAPL_PMCC_2026-09-18_205_2027-01-15_150',
  strategy: 'PMCC',
  symbol: 'AAPL',
  underlyingPrice: 190,
  legs: [
    {
      symbol: 'AAPL270115C00150000',
      optionSymbol: 'AAPL270115C00150000',
      underlyingSymbol: 'AAPL',
      assetType: 'option',
      direction: 'long',
      optionType: 'call',
      strike: 150,
      expiration: '2027-01-15',
      quantity: 1,
      contractMultiplier: 100,
      openInterest: 1_200,
    },
    {
      symbol: 'AAPL260918C00205000',
      optionSymbol: 'AAPL260918C00205000',
      underlyingSymbol: 'AAPL',
      assetType: 'option',
      direction: 'short',
      optionType: 'call',
      strike: 205,
      expiration: '2026-09-18',
      quantity: 1,
      contractMultiplier: 100,
      openInterest: 900,
    },
  ],
  estimatedCredit: 135,
  theoreticalMaxLoss: 3_000,
  netDebit: 30,
  netDebitUnit: 'per_share',
  sourceResultId: 'AAPL::PMCC::2026-09-18::205::2027-01-15::150',
};

function completeCandidate(index: number): AutopilotCandidate {
  const symbol = `SYM${index}`;
  return {
    ...candidate,
    id: `screen_${symbol}_BPS_2026-09-18_${180 + index / 100}`,
    sourceResultId: `source-${symbol}-${index}`,
    symbol,
    underlyingPrice: 190 + index / 100,
    legs: [
      {
        ...candidate.legs[0],
        symbol: `${symbol}260918P00180000`,
        underlyingSymbol: symbol,
        delta: -0.22,
        gamma: 0.03,
        theta: -0.04,
        vega: 0.08,
        bid: 1.32,
        ask: 1.38,
        mid: 1.35,
        quoteTimestamp: '2026-07-25T14:30:00.000Z',
      },
      {
        ...candidate.legs[0],
        symbol: `${symbol}260918P00175000`,
        underlyingSymbol: symbol,
        direction: 'long',
        strike: 175,
        delta: -0.16,
        gamma: 0.02,
        theta: -0.02,
        vega: 0.06,
        bid: 0.22,
        ask: 0.26,
        mid: 0.24,
        quoteTimestamp: '2026-07-25T14:30:00.000Z',
      },
    ],
    pop: 74.2,
    roc: 0.37,
    ivr: 55.4,
    annualizedYield: 2.45,
    technicalFit: 79,
    goalAlignment: 82,
    correlationPenalty: 4,
    concentrationPenalty: 3,
    betaWeightedDelta: -6.5,
    sector: 'Technology',
    earningsDate: '2026-10-22',
    marketTrend: 'uptrend',
    notes: ['Screener liquidity, trend, and expected-move checks passed.'],
  };
}

function completeAnalysis(item: AutopilotCandidate, index: number): DecisionAnalysis {
  return {
    id: `decision_${item.id}`,
    createdAt: '2026-07-25T14:31:00.000Z',
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: item.id,
      symbol: item.symbol,
      strategy: item.strategy,
      label: `${item.symbol} ${item.strategy} candidate`,
    },
    objective: 'generate_income',
    recommendation: {
      action: 'OPEN_BPS',
      strategy: item.strategy,
      summary: 'Open only after confirming price, liquidity, and portfolio-risk constraints.',
      status: index % 5 === 0 ? 'conditional' : 'recommended',
    },
    confidence: {
      overall: 82,
      market: 79,
      portfolio: 76,
      execution: 84,
      income: 86,
      risk: 78,
      framework: {
        total: 82,
        liquidityScore: 22,
        latencyScore: 20,
        macroProximityScore: 20,
        volatilityStabilityScore: 20,
        notes: ['Quotes are current.', 'Liquidity is within the expected spread range.'],
      },
    },
    priority: 'normal',
    rationale: 'The candidate has favorable defined-risk income characteristics with acceptable execution quality.',
    supportingEvidence: [
      { id: 'credit', label: 'Credit quality', value: item.estimatedCredit, tone: 'positive', explanation: 'Credit is adequate for the defined width.' },
      { id: 'pop', label: 'Probability of profit', value: item.pop, tone: 'positive', explanation: 'Modeled probability supports the income objective.' },
      { id: 'trend', label: 'Market trend', value: item.marketTrend, tone: 'neutral', explanation: 'Trend is aligned with the candidate structure.' },
    ],
    concerns: [
      { id: 'earnings', label: 'Earnings timing', severity: 'medium', explanation: 'Reconfirm the earnings calendar before entry.' },
      { id: 'fill', label: 'Execution quality', severity: 'low', explanation: 'Use a patient limit order near the modeled midpoint.' },
    ],
    alternatives: [
      { action: 'WAIT', score: 68, disposition: 'considered', reasons: ['Wait if the bid/ask spread widens.'] },
      { action: 'AVOID', score: 25, disposition: 'rejected', reasons: ['Current evidence does not require avoiding the setup.'] },
    ],
    reviewTriggers: [
      { id: 'price', label: 'Underlying price', triggerType: 'price', threshold: 185, explanation: 'Review if the underlying breaks support.' },
      { id: 'volatility', label: 'Volatility shift', triggerType: 'volatility', threshold: '10% change', explanation: 'Re-evaluate after a material volatility change.' },
      { id: 'manual', label: 'Pre-entry review', triggerType: 'manual', explanation: 'Confirm quotes and portfolio context immediately before entry.' },
    ],
    expectedOutcome: {
      intent: 'Generate defined-risk premium income.',
      expectedCredit: item.estimatedCredit,
      expectedAnnualizedReturnPct: item.annualizedYield,
      capitalRequired: item.theoreticalMaxLoss,
      theoreticalMaxLoss: item.theoreticalMaxLoss,
      assignmentProbabilityPct: 25.8,
      expectedHoldingDays: 21,
    },
    candidate: item,
    opportunityScore: {
      total: 84,
      edgeScore: 86,
      goalAlignmentFactor: 0.98,
      riskContributionPenalty: 3,
      postureMultiplier: 1,
      notes: ['Strong income fit.', 'Defined risk remains within the modeled allocation.'],
    },
    metadata: {
      source: 'screener',
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['candidate_validation', 'liquidity', 'portfolio_pre_gate', 'decision_confidence'],
      rulesBlocked: index % 5 === 0 ? ['manual_confirmation_required'] : [],
    },
  };
}

const completeConfig: AutopilotConfig = {
  perStrategyGoal: {
    BPS: 'income',
    BCS: 'income',
    IC: 'income',
    CSP: 'acquire',
    CC: 'income',
    PMCC: 'income',
  },
  portfolioRiskPosture: 'steady',
  thresholds: {
    perTradeMaxLossPctEquity: 2,
    dailyLossPausePct: 3,
    monthlyDrawdownDefensivePct: 8,
    bpUtilizationMaxPct: 50,
    bpUtilizationHighVixPct: 35,
    singleTickerMaxPct: 10,
    sectorMaxPct: 25,
    maxEntriesPerDay: 3,
    maxEntriesPerWeek: 10,
    correlationSkipThreshold: 0.8,
    ccIvrReplacementYieldPct: 1,
    netEdgeFadeOffPeakPct: 30,
    decisionConfidenceMinimum: 70,
  },
  ccStockManagement: 'never-sell-escalate-on-thesis-break',
  killSwitchEnabled: false,
  updatedAt: '2026-07-25T14:00:00.000Z',
};

function completeAccount(candidates: AutopilotCandidate[]): PaperAccount {
  const positions = candidates.slice(0, 24).map((item, index) => ({
    id: `position_${index}`,
    strategy: item.strategy,
    symbol: item.symbol,
    legs: item.legs,
    entryDate: '2026-07-01',
    entryCredit: item.estimatedCredit,
    simulatedFillPrice: item.estimatedCredit,
    theoreticalMaxLoss: item.theoreticalMaxLoss,
    status: 'open' as const,
    managementLog: [],
    goalAtEntry: 'income' as const,
    decisionConfidenceAtEntry: 82,
    opportunityScoreAtEntry: 84,
  }));
  return {
    userId: 'user-1',
    startingBalance: 100_000,
    currentBalance: 102_500,
    peakBalance: 104_000,
    openPositions: positions,
    closedPositions: positions.slice(0, 12).map((position, index) => ({
      ...position,
      id: `closed_${index}`,
      status: 'closed' as const,
      closedDate: '2026-07-20',
      closeCredit: 0.35,
      realizedPnl: 100,
    })),
    dailyEquityCurve: Array.from({ length: 60 }, (_, index) => ({
      date: `2026-06-${String((index % 30) + 1).padStart(2, '0')}`,
      equity: 100_000 + index * 50,
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-25T14:31:00.000Z',
    lastRunAt: '2026-07-25T14:31:00.000Z',
    liveBuyingPowerSnapshot: 48_500,
  };
}

function completeRunResult(candidates: AutopilotCandidate[]): RecommendationRunResult {
  const recommendations = candidates.map(completeAnalysis);
  const account = completeAccount(candidates);
  return {
    runId: 'run_complete_response_measurement',
    timestamp: '2026-07-25T14:31:00.000Z',
    userId: 'user-1',
    mode: 'paper',
    liveTradingEnabled: false,
    config: completeConfig,
    portfolioState: {
      userId: 'user-1',
      currentBalance: account.currentBalance,
      peakBalance: account.peakBalance,
      openPositionCount: account.openPositions.length,
      closedPositionCount: account.closedPositions.length,
      openRisk: 8_760,
      openRiskPct: 8.55,
      drawdownPct: 1.44,
      tickerExposure: Object.fromEntries(candidates.slice(0, 100).map((item) => [item.symbol, 365])),
      strategyExposure: { BPS: 8_760, BCS: 0, IC: 0, CSP: 0, CC: 0, PMCC: 0 },
      generatedAt: '2026-07-25T14:31:00.000Z',
    },
    account,
    candidatesScanned: candidates.length,
    approvedCount: recommendations.filter((item) => item.recommendation.status === 'recommended').length,
    rejectedCount: 0,
    suppressedCount: recommendations.filter((item) => item.recommendation.status === 'conditional').length,
    recommendations,
    duplicates: [],
    killSwitchActive: false,
  };
}

describe('POST /api/autopilot/recommendations compact transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAutopilotUserId.mockResolvedValue('user-1');
    runRecommendationEngine.mockResolvedValue({
      recommendations: [],
      duplicates: [],
      candidatesScanned: 1,
      killSwitchActive: false,
    });
  });

  it('accepts compact canonical candidates and retains canonical engine validation/evaluation', async () => {
    const response = await POST(request({ candidates: [candidate] }));

    expect(response.status).toBe(200);
    expect(screenResultsToAutopilotCandidates).not.toHaveBeenCalled();
    expect(runRecommendationEngine).toHaveBeenCalledWith('user-1', {
      source: 'screener',
      candidates: [candidate],
    });
  });

  it('accepts a canonical two-expiration PMCC and retains both leg contracts', async () => {
    const response = await POST(request({ candidates: [pmccCandidate] }));

    expect(response.status).toBe(200);
    expect(runRecommendationEngine).toHaveBeenCalledWith('user-1', {
      source: 'screener',
      candidates: [pmccCandidate],
    });
  });

  it.each([
    ['same expiration', {
      legs: [
        pmccCandidate.legs[0],
        { ...pmccCandidate.legs[1], expiration: pmccCandidate.legs[0].expiration },
      ],
    }],
    ['mismatched quantity', {
      legs: [
        pmccCandidate.legs[0],
        { ...pmccCandidate.legs[1], quantity: 2 },
      ],
    }],
    ['missing debit', { netDebit: undefined }],
  ])('rejects invalid PMCC structure: %s', async (_label, override) => {
    const response = await POST(request({ candidates: [{ ...pmccCandidate, ...override }] }));
    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it('serializes the actual route envelope with a complete realistic run result below the response limit', async () => {
    const encoder = new TextEncoder();
    const emptyEnvelopeBytes = encoder.encode(JSON.stringify({ candidates: [] })).byteLength;
    const candidates: AutopilotCandidate[] = [];
    let requestBytes = emptyEnvelopeBytes;

    for (let index = 0; index < 5_000; index += 1) {
      const item = completeCandidate(index);
      const itemBytes = encoder.encode(JSON.stringify({ candidates: [item] })).byteLength;
      const combinedBytes = candidates.length
        ? requestBytes + itemBytes - emptyEnvelopeBytes + 1
        : itemBytes;
      if (combinedBytes > RECOMMENDATION_SAFE_REQUEST_BYTES) break;
      candidates.push(item);
      requestBytes = combinedBytes;
    }

    expect(requestBytes).toBeGreaterThan(850_000);
    runRecommendationEngine.mockImplementationOnce(
      async (_userId: string, options: { candidates: AutopilotCandidate[] }) =>
        completeRunResult(options.candidates),
    );

    const response = await POST(request({ candidates }));
    const responseText = await response.text();
    const responseBytes = encoder.encode(responseText).byteLength;
    const body = JSON.parse(responseText);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      mode: 'paper',
      liveTradingEnabled: false,
      skipped: [],
    });
    expect(Object.keys(body.result).sort()).toEqual([
      'account',
      'approvedCount',
      'candidatesScanned',
      'config',
      'duplicates',
      'killSwitchActive',
      'liveTradingEnabled',
      'mode',
      'portfolioState',
      'recommendations',
      'rejectedCount',
      'runId',
      'suppressedCount',
      'timestamp',
      'userId',
    ].sort());
    expect(body.result).toMatchObject({
      runId: 'run_complete_response_measurement',
      timestamp: '2026-07-25T14:31:00.000Z',
      userId: 'user-1',
      mode: 'paper',
      liveTradingEnabled: false,
      candidatesScanned: candidates.length,
      approvedCount: expect.any(Number),
      rejectedCount: expect.any(Number),
      suppressedCount: expect.any(Number),
      killSwitchActive: false,
    });
    expect(body.result.config).toEqual(completeConfig);
    expect(body.result.portfolioState).toBeDefined();
    expect(body.result.account).toBeDefined();
    expect(body.result.recommendations).toHaveLength(candidates.length);
    expect(responseBytes).toBeLessThan(VERCEL_FUNCTION_BODY_LIMIT_BYTES);
    expect(VERCEL_FUNCTION_BODY_LIMIT_BYTES - responseBytes).toBeGreaterThan(1_000_000);
  });

  it('rejects malformed compact candidates before the engine can crash or evaluate them', async () => {
    const response = await POST(request({
      candidates: [{ ...candidate, legs: [{ symbol: 'missing-underlying' }] }],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/structurally valid recommendation candidates/);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported strategy', { strategy: 'CC' }],
    ['missing price', { underlyingPrice: undefined }],
    ['invalid price', { underlyingPrice: 0 }],
    ['invalid max loss', { theoreticalMaxLoss: -1 }],
    ['empty legs', { legs: [] }],
    ['invalid direction', { legs: [{ ...candidate.legs[0], direction: 'buy' }] }],
    ['invalid asset type', { legs: [{ ...candidate.legs[0], assetType: 'stock' }] }],
    ['nonpositive quantity', { legs: [{ ...candidate.legs[0], quantity: 0 }] }],
    ['option without valid optionType', { legs: [{ ...candidate.legs[0], optionType: undefined }] }],
    ['invalid expiration', { legs: [{ ...candidate.legs[0], expiration: '2026-02-30' }] }],
  ])('rejects %s in the compact transport schema', async (_label, override) => {
    const response = await POST(request({ candidates: [{ ...candidate, ...override }] }));

    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it.each([
    'pop',
    'roc',
    'ivr',
    'annualizedYield',
    'technicalFit',
    'goalAlignment',
    'correlationPenalty',
    'concentrationPenalty',
    'betaWeightedDelta',
  ])('rejects malformed optional candidate number %s', async (field) => {
    const response = await POST(request({
      candidates: [{ ...candidate, [field]: 'not-a-number' }],
    }));

    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it.each([
    ['marketTrend', 'rising'],
    ['earningsDate', '2026-02-30'],
    ['sector', 42],
    ['notes', ['valid note', 42]],
  ])('rejects malformed optional candidate metadata %s', async (field, value) => {
    const response = await POST(request({
      candidates: [{ ...candidate, [field]: value }],
    }));

    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it.each([
    'delta',
    'gamma',
    'theta',
    'vega',
    'bid',
    'ask',
    'mid',
  ])('rejects malformed optional leg number %s', async (field) => {
    const response = await POST(request({
      candidates: [{
        ...candidate,
        legs: [{ ...candidate.legs[0], [field]: 'not-a-number' }],
      }],
    }));

    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it('rejects a malformed optional leg quoteTimestamp', async () => {
    const response = await POST(request({
      candidates: [{
        ...candidate,
        legs: [{ ...candidate.legs[0], quoteTimestamp: 'not-a-timestamp' }],
      }],
    }));

    expect(response.status).toBe(400);
    expect(runRecommendationEngine).not.toHaveBeenCalled();
  });

  it('classifies only the explicit pre-run engine lock as retryable contention', async () => {
    runRecommendationEngine.mockRejectedValueOnce(
      new Error('Autopilot recommendation engine is already running.'),
    );

    const response = await POST(request({ candidates: [candidate] }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: 'AUTOPILOT_ENGINE_BUSY',
      retryable: true,
    });
  });

  it('leaves genuine engine failures non-retryable', async () => {
    runRecommendationEngine.mockRejectedValueOnce(new Error('Redis write failed.'));

    const response = await POST(request({ candidates: [candidate] }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Redis write failed.' });
  });

  it('retains the legacy ScreenResult route contract for compatible small callers', async () => {
    screenResultsToAutopilotCandidates.mockReturnValue({
      candidates: [candidate],
      skipped: [{ symbol: 'PMCC', strategy: 'PMCC', reason: 'Unsupported.' }],
    });

    const response = await POST(request({ screenResults: [{ symbol: 'AAPL' }] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(screenResultsToAutopilotCandidates).toHaveBeenCalledTimes(1);
    expect(body.skipped).toEqual([{ symbol: 'PMCC', strategy: 'PMCC', reason: 'Unsupported.' }]);
  });
});
