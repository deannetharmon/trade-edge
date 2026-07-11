// test/fixtures/portfolioIntelligenceFixtures.ts
//
// Shared deterministic fixture builders for Sprint 3 PI-0001 validation
// tests. Default threshold values match this repo's established trading
// conventions (50% profit target, 21-DTE time stop, 2x credit loss stop)
// and the Autopilot layer's existing default thresholds (65% max buying-power
// utilization, 8% defensive drawdown, 10% single-ticker limit, 25% sector
// limit) so both layers agree on what these terms mean.

import type {
  MarketContextInput,
  PendingOrderInput,
  PortfolioIntelligenceContext,
  PortfolioIntelligenceThresholds,
  PortfolioPositionInput,
  PortfolioStateInput,
} from '@/lib/portfolio-intelligence';

export const GENERATED_AT = '2026-07-11T13:00:00.000Z';

export function makeThresholds(overrides: Partial<PortfolioIntelligenceThresholds> = {}): PortfolioIntelligenceThresholds {
  return {
    profitTargetPct: 50,
    dteReviewThreshold: 21,
    materialLossPct: -200,
    stalePendingOrderMinutes: 240,
    materialFillDistancePct: 15,
    idleCashThresholdPct: 15,
    maxBuyingPowerUtilizationPct: 65,
    defensiveDrawdownPct: 8,
    ...overrides,
  };
}

export function makePortfolioState(overrides: Partial<PortfolioStateInput> = {}): PortfolioStateInput {
  return {
    netLiquidity: 100000,
    cash: 20000,
    availableBuyingPower: 50000,
    buyingPowerUtilizationPct: 40,
    currentDrawdownPct: 2,
    riskPosture: 'steady',
    symbolConcentrationPct: {},
    sectorConcentrationPct: {},
    maxSymbolConcentrationPct: 10,
    maxSectorConcentrationPct: 25,
    idleCashPct: 10,
    recurringIncomeTarget: 2000,
    currentIncomeProduced: 1900,
    ...overrides,
  };
}

export function makePosition(overrides: Partial<PortfolioPositionInput> = {}): PortfolioPositionInput {
  return {
    id: 'pos_amd_csp_1',
    symbol: 'AMD',
    strategy: 'CSP',
    status: 'open',
    dte: 35,
    openPlPct: 20,
    pctOfMaxProfitCaptured: 25,
    theoreticalMaxLoss: 14805,
    currentRisk: 14805,
    assignmentIntent: 'neutral',
    earningsWithinExpiration: false,
    managementFlags: [],
    ...overrides,
  };
}

export function makePendingOrder(overrides: Partial<PendingOrderInput> = {}): PendingOrderInput {
  return {
    id: 'order_1',
    symbol: 'AMD',
    strategyAction: 'OPEN_BPS',
    ageMinutes: 10,
    fillDistancePct: 3,
    status: 'working',
    staleOrReviewRequired: false,
    ...overrides,
  };
}

export function makeMarketContext(overrides: Partial<MarketContextInput> = {}): MarketContextInput {
  return {
    regime: 'neutral',
    macroEventProximityHours: undefined,
    volatilityStable: true,
    marketOpen: true,
    dataFreshnessSeconds: 10,
    ...overrides,
  };
}

export function makeContext(overrides: Partial<PortfolioIntelligenceContext> = {}): PortfolioIntelligenceContext {
  return {
    generatedAt: GENERATED_AT,
    portfolio: makePortfolioState(),
    positions: [],
    pendingOrders: [],
    market: makeMarketContext(),
    thresholds: makeThresholds(),
    ...overrides,
  };
}
