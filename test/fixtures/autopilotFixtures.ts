// test/fixtures/autopilotFixtures.ts
//
// Shared deterministic fixture builders for Sprint 2 validation tests.
// Every builder returns a fully-formed object with sane defaults so tests
// only need to override the one or two fields relevant to the case being
// tested. Nothing here reads the clock in a way that affects assertions
// (quoteTimestamp/now are always passed explicitly by the test).

import type {
  AutopilotCandidate,
  AutopilotConfig,
  AutopilotLeg,
  ConfidenceInputLeg,
  DecisionConfidenceBreakdown,
  PaperAccount,
} from '@/lib/autopilot/types';
import type { PortfolioStateSummary } from '@/lib/autopilot/decision/types';
import { DEFAULT_AUTOPILOT_CONFIG } from '@/lib/autopilot/config/defaults';

export function makeConfig(overrides: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return {
    ...DEFAULT_AUTOPILOT_CONFIG,
    ...overrides,
    thresholds: {
      ...DEFAULT_AUTOPILOT_CONFIG.thresholds,
      ...(overrides.thresholds ?? {}),
    },
    perStrategyGoal: {
      ...DEFAULT_AUTOPILOT_CONFIG.perStrategyGoal,
      ...(overrides.perStrategyGoal ?? {}),
    },
  };
}

export function makeLeg(overrides: Partial<AutopilotLeg> = {}): AutopilotLeg {
  return {
    symbol: 'AMD  260821P00150000',
    optionSymbol: 'AMD  260821P00150000',
    underlyingSymbol: 'AMD',
    assetType: 'option',
    direction: 'short',
    optionType: 'put',
    strike: 150,
    expiration: '2026-08-21',
    quantity: 1,
    delta: -0.25,
    gamma: 0.01,
    theta: -0.04,
    vega: 0.1,
    bid: 1.9,
    ask: 2.0,
    mid: 1.95,
    quoteTimestamp: '2026-07-11T13:00:00.000Z',
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<AutopilotCandidate> = {}): AutopilotCandidate {
  return {
    id: 'cand_amd_csp_1',
    strategy: 'CSP',
    symbol: 'AMD',
    underlyingPrice: 155,
    legs: [makeLeg()],
    estimatedCredit: 195,
    theoreticalMaxLoss: 14805,
    pop: 75,
    roc: 4.2,
    ivr: 45,
    annualizedYield: 38,
    technicalFit: 65,
    goalAlignment: undefined,
    correlationPenalty: 5,
    concentrationPenalty: 5,
    betaWeightedDelta: 10,
    sector: 'Technology',
    earningsDate: undefined,
    marketTrend: 'uptrend',
    notes: [],
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<PaperAccount> = {}): PaperAccount {
  return {
    userId: 'test-user',
    startingBalance: 100000,
    currentBalance: 100000,
    peakBalance: 100000,
    openPositions: [],
    closedPositions: [],
    dailyEquityCurve: [{ date: '2026-07-11', equity: 100000 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

export function makePortfolioState(
  overrides: Partial<PortfolioStateSummary> = {},
): PortfolioStateSummary {
  return {
    userId: 'test-user',
    currentBalance: 100000,
    peakBalance: 100000,
    openPositionCount: 0,
    closedPositionCount: 0,
    openRisk: 0,
    openRiskPct: 0,
    drawdownPct: 0,
    tickerExposure: {},
    strategyExposure: { BPS: 0, BCS: 0, IC: 0, CSP: 0, CC: 0 },
    generatedAt: '2026-07-11T13:00:00.000Z',
    ...overrides,
  };
}

export function makeConfidenceLeg(overrides: Partial<ConfidenceInputLeg> = {}): ConfidenceInputLeg {
  return {
    bidAskSpread: 0.05,
    averageBidAskSpread20: 0.05,
    quoteTimestamp: '2026-07-11T13:00:00.000Z',
    ...overrides,
  };
}

// A "clean" confidence framework result: every dimension maxed out, so tests
// for AVOID/WAIT/critical-concern paths aren't accidentally caused by low
// confidence instead of the concern being tested.
export function makeCleanConfidenceFramework(
  overrides: Partial<DecisionConfidenceBreakdown> = {},
): DecisionConfidenceBreakdown {
  return {
    total: 100,
    liquidityScore: 40,
    latencyScore: 20,
    macroProximityScore: 20,
    volatilityStabilityScore: 20,
    notes: ['Decision conditions are clean enough for framework evaluation.'],
    ...overrides,
  };
}
