// lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts
//
// PI-0003: wires evaluatePortfolioObjectives() into a real production
// caller for the first time -- previously it had zero consumers anywhere
// in the app. Combines:
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
// PI-0003.5: financial data now flows in through PortfolioFinancialContext
// (lib/portfolio-intelligence/adapters/balancesNormalization.ts) -- an
// optional-field model that keeps "unavailable" genuinely distinct from
// "confirmed zero". PortfolioStateInput (PI-0001's existing, required-number
// type actually consumed by evaluatePortfolioObjectives) is unchanged --
// bridging optional financial data into it happens once, here, explicitly:
//
//   Every field this bridge maps is a ">= threshold to fire" style rule
//   (idle cash, buying-power utilization, drawdown, income deficit) where
//   0 is the "everything's fine, don't fire" value. So "unavailable" safely
//   maps to 0 for these specific fields WITHOUT fabricating a false
//   trigger -- it under-reports risk/opportunity rather than over-reporting
//   it. This is a deliberate, narrow safety property of the CURRENT rule
//   designs, not a general license to conflate missing-with-zero elsewhere.
//   Symbol/sector concentration avoids this question entirely: it's a map,
//   and an empty map ({}) has no entries to iterate, which is the correct
//   "no data" representation already (not fabricated via a numeric default).

import { evaluatePortfolioObjectives } from '../evaluatePortfolioObjectives';
import { evaluatePositionObjective } from '../objectives/positionObjective';
import type { PositionObjectiveInput } from '../objectives/positionObjective';
import { prioritizePortfolioObjectives } from '../prioritizePortfolioObjectives';
import { DEFAULT_PORTFOLIO_RISK_POLICY, DEFAULT_POSITION_MANAGEMENT_POLICY } from '../policies';
import type { PendingOrderInput, PortfolioIntelligenceContext, PortfolioObjective, PortfolioStateInput } from '../types';
import { derivePositionConcentration, deriveWheelDominance, type PortfolioFinancialContext, type PositionExposureInput } from './balancesNormalization';

export type { PortfolioFinancialContext, PositionExposureInput } from './balancesNormalization';
export { buildPortfolioFinancialContext, toFiniteNumber, derivePositionConcentration, deriveWheelDominance } from './balancesNormalization';

export interface RawPendingOrderLike {
  id: string;
  symbol: string;
  strategy?: string | null;
  createdAt?: string | null;
  status?: string | null;
}

export function buildPortfolioIntelligenceContext(
  financial: PortfolioFinancialContext,
  positionsForConcentration: PositionExposureInput[],
  rawPendingOrders: RawPendingOrderLike[],
  now: Date = new Date(),
): PortfolioIntelligenceContext {
  const symbolConcentrationPct = derivePositionConcentration(positionsForConcentration, financial.netLiquidity);
  // PI-0004B: derived independently of netLiquidity (it's a within-symbol
  // ratio, not a share of the portfolio) -- see deriveWheelDominance()'s doc
  // comment. Empty object when no position carries WHEEL+PREFER, which is
  // exactly today's production reality until PositionStrategy is wired to a
  // real input source (see positionStrategyDefaults.ts's doc comment).
  const symbolWheelDominance = deriveWheelDominance(positionsForConcentration);

  // Idle cash %: cash sitting uninvested as a share of net liquidity. A real,
  // confirmable formula from two fields we actually have -- not derived from
  // an unrelated concept. Undefined (-> 0, safe per module doc above) if
  // either input is unavailable.
  const idleCashPct =
    financial.cashBalance !== undefined && financial.netLiquidity !== undefined && financial.netLiquidity > 0
      ? (financial.cashBalance / financial.netLiquidity) * 100
      : undefined;

  const portfolio: PortfolioStateInput = {
    netLiquidity: financial.netLiquidity ?? 0,
    cash: financial.cashBalance ?? 0,
    availableBuyingPower: financial.availableBuyingPower ?? 0,
    // buyingPowerUsedPct is a best-effort formula -- see
    // balancesNormalization.ts doc comment. Safe (never fires) when absent.
    buyingPowerUtilizationPct: financial.buyingPowerUsedPct ?? 0,
    currentDrawdownPct: financial.drawdownPct ?? 0,
    riskPosture: 'steady',
    symbolConcentrationPct,
    symbolWheelDominance,
    sectorConcentrationPct: {}, // no sector data exists anywhere in the app yet
    maxSymbolConcentrationPct: DEFAULT_PORTFOLIO_RISK_POLICY.maxSymbolConcentrationPct,
    maxSectorConcentrationPct: DEFAULT_PORTFOLIO_RISK_POLICY.maxSectorConcentrationPct,
    idleCashPct: idleCashPct ?? 0,
    // No canonical income source exists yet (see balancesNormalization.ts) --
    // recurringIncomeTarget stays 0, which keeps evaluateIncreaseIncome's own
    // `if (recurringIncomeTarget <= 0) return null` guard silent, rather than
    // fabricating a deficit against an unknown target.
    recurringIncomeTarget: financial.targetIncome ?? 0,
    currentIncomeProduced: financial.currentIncome ?? 0,
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
// one canonical ranked list. positionsForConcentration is typically the
// same positions passed via positionInputs, narrowed to {symbol, maxRisk} --
// kept as a separate parameter rather than overloading PositionObjectiveInput
// with a field only relevant to portfolio-level concentration.
export function computeCanonicalPortfolioPriorities(
  positionInputs: PositionObjectiveInput[],
  financial: PortfolioFinancialContext,
  positionsForConcentration: PositionExposureInput[],
  rawPendingOrders: RawPendingOrderLike[],
  now: Date = new Date(),
): CanonicalPortfolioPriorities {
  // PI-0004B: this is where Actionability actually gates Today's Priorities.
  // MONITOR objectives (e.g. earnings before expiration but outside the
  // review window -- see positionObjective.ts's computeActionability()) are
  // real and still fully computed, just excluded from the surfaced
  // canonical list here -- "MONITOR items remain available internally but
  // are not surfaced" (PI-0004B brief). No other objective source
  // (portfolio-level, pending-order) currently produces MONITOR, so this
  // filter is a no-op for them today.
  const positionObjectives = positionInputs
    .map((input) => evaluatePositionObjective(input, now).objective)
    .filter((o): o is PortfolioObjective => o !== null)
    .filter((o) => o.actionability !== 'MONITOR');

  const context = buildPortfolioIntelligenceContext(financial, positionsForConcentration, rawPendingOrders, now);
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
