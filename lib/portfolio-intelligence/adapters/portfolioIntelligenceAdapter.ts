// lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts
//
// PI-0003: wires evaluatePortfolioObjectives() into a real (if partial)
// production caller for the first time -- previously it had zero consumers
// anywhere in the app. Combines:
//   - Position Objectives: evaluatePositionObjective() per position (the
//     TE-0006B-consolidated, parity-preserving evaluator from PI-0002,
//     already wired to the Portfolio page's UI).
//   - Portfolio Objectives + Pending Order Objectives: a single
//     evaluatePortfolioObjectives() call, with `positions: []` supplied so
//     it only produces its portfolio-level rules (concentration, buying
//     power, idle cash, income) and its pending-order rule -- NOT its own
//     position-level threatened/profit/DTE rules, which would duplicate
//     (with different thresholds -- see PI-0002's documented divergence)
//     what evaluatePositionObjective() already produces per position.
// into one canonical ranked list via prioritizePortfolioObjectives().
//
// KNOWN GAP: portfolio-level financial aggregates (net liquidity, cash,
// buying power, drawdown, symbol/sector concentration, idle cash, income)
// are not currently computed anywhere on the Portfolio page -- they live
// only in the Balances tab, which this adapter does not read. Until that's
// wired (a later slice; reading the Balances tab is separate integration
// work, not this slice's architecture-consolidation goal), callers must
// supply these explicitly or accept the conservative zero/safe defaults
// below, which mean the portfolio-level rules (concentration/buying-power/
// idle-cash/income) will not fire from default-constructed input.
// Position-level and pending-order objectives are unaffected by this gap.

import { evaluatePortfolioObjectives } from '../evaluatePortfolioObjectives';
import { evaluatePositionObjective } from '../objectives/positionObjective';
import type { PositionObjectiveInput } from '../objectives/positionObjective';
import { prioritizePortfolioObjectives } from '../prioritizePortfolioObjectives';
import { DEFAULT_PORTFOLIO_RISK_POLICY, DEFAULT_POSITION_MANAGEMENT_POLICY } from '../policies';
import type { PendingOrderInput, PortfolioIntelligenceContext, PortfolioObjective, PortfolioStateInput } from '../types';

export interface PortfolioFinancialSnapshot {
  netLiquidity?: number;
  cash?: number;
  availableBuyingPower?: number;
  buyingPowerUtilizationPct?: number;
  currentDrawdownPct?: number;
  symbolConcentrationPct?: Record<string, number>;
  sectorConcentrationPct?: Record<string, number>;
  idleCashPct?: number;
  recurringIncomeTarget?: number;
  currentIncomeProduced?: number;
}

export interface RawPendingOrderLike {
  id: string;
  symbol: string;
  strategy?: string | null;
  createdAt?: string | null;
  status?: string | null;
}

export function buildPortfolioIntelligenceContext(
  financial: PortfolioFinancialSnapshot,
  rawPendingOrders: RawPendingOrderLike[],
  now: Date = new Date(),
): PortfolioIntelligenceContext {
  const portfolio: PortfolioStateInput = {
    netLiquidity: financial.netLiquidity ?? 0,
    cash: financial.cash ?? 0,
    availableBuyingPower: financial.availableBuyingPower ?? 0,
    buyingPowerUtilizationPct: financial.buyingPowerUtilizationPct ?? 0,
    currentDrawdownPct: financial.currentDrawdownPct ?? 0,
    riskPosture: 'steady',
    symbolConcentrationPct: financial.symbolConcentrationPct ?? {},
    sectorConcentrationPct: financial.sectorConcentrationPct ?? {},
    maxSymbolConcentrationPct: DEFAULT_PORTFOLIO_RISK_POLICY.maxSymbolConcentrationPct,
    maxSectorConcentrationPct: DEFAULT_PORTFOLIO_RISK_POLICY.maxSectorConcentrationPct,
    idleCashPct: financial.idleCashPct ?? 0,
    recurringIncomeTarget: financial.recurringIncomeTarget ?? 0,
    currentIncomeProduced: financial.currentIncomeProduced ?? 0,
  };

  const pendingOrders: PendingOrderInput[] = rawPendingOrders.map((order) => {
    const ageMinutes = order.createdAt
      ? Math.max(0, Math.round((now.getTime() - new Date(order.createdAt).getTime()) / 60_000))
      : 0;
    const rawStatus = (order.status ?? '').toLowerCase();
    const staleOrReviewRequired = rawStatus.includes('stale') || rawStatus.includes('review');
    return {
      id: order.id,
      symbol: order.symbol,
      strategyAction: order.strategy ?? 'UNKNOWN',
      ageMinutes,
      fillDistancePct: undefined,
      status: staleOrReviewRequired ? 'review_required' : 'working',
      staleOrReviewRequired,
    };
  });

  return {
    generatedAt: now.toISOString(),
    portfolio,
    positions: [], // deliberately empty -- see module doc comment above
    pendingOrders,
    market: {
      regime: 'neutral',
      volatilityStable: true,
      marketOpen: true,
    },
    thresholds: {
      profitTargetPct: DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct,
      dteReviewThreshold: DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold,
      materialLossPct: DEFAULT_PORTFOLIO_RISK_POLICY.candidateMaterialLossPct,
      stalePendingOrderMinutes: 240,
      materialFillDistancePct: 15,
      idleCashThresholdPct: DEFAULT_PORTFOLIO_RISK_POLICY.idleCashThresholdPct,
      maxBuyingPowerUtilizationPct: DEFAULT_PORTFOLIO_RISK_POLICY.maxBuyingPowerUtilizationPct,
      defensiveDrawdownPct: DEFAULT_PORTFOLIO_RISK_POLICY.defensiveDrawdownPct,
    },
  };
}

export interface CanonicalPortfolioPriorities {
  objectives: PortfolioObjective[];
  positionObjectiveCount: number;
  portfolioObjectiveCount: number;
  pendingOrderObjectiveCount: number;
}

// The single combining entry point required by PI-0003 objective 4:
// Position Objectives + Portfolio Objectives + Pending Order Objectives ->
// one canonical ranked list.
export function computeCanonicalPortfolioPriorities(
  positionInputs: PositionObjectiveInput[],
  financial: PortfolioFinancialSnapshot,
  rawPendingOrders: RawPendingOrderLike[],
  now: Date = new Date(),
): CanonicalPortfolioPriorities {
  const positionObjectives = positionInputs
    .map((input) => evaluatePositionObjective(input, now).objective)
    .filter((o): o is PortfolioObjective => o !== null);

  const context = buildPortfolioIntelligenceContext(financial, rawPendingOrders, now);
  const portfolioLevelResult = evaluatePortfolioObjectives(context).filter((o) => o.type !== 'WAIT');

  const pendingOrderObjectiveCount = portfolioLevelResult.filter((o) => o.source === 'pending_order').length;
  const portfolioObjectiveCount = portfolioLevelResult.length - pendingOrderObjectiveCount;

  const combined = [...positionObjectives, ...portfolioLevelResult];
  const objectives = prioritizePortfolioObjectives(combined, context.generatedAt);

  return {
    objectives,
    positionObjectiveCount: positionObjectives.length,
    portfolioObjectiveCount,
    pendingOrderObjectiveCount,
  };
}
