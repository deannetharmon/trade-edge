// lib/paper-trading/adapters/portfolioIntelligenceAdapter.ts
//
// PT-0001 section 13: lets the existing canonical Portfolio Intelligence
// Decision Engine (lib/portfolio-intelligence/objectives/positionObjective.ts's
// evaluatePositionObjective()) evaluate the PAPER portfolio, without mixing
// paper and real data and without duplicating any recommendation logic.
//
// Scope: per the sprint spec, "If the full existing Portfolio UI cannot be
// safely reused in this sprint, provide the canonical adapter and a focused
// paper-intelligence summary rather than duplicating the whole page." This
// adapter calls the single canonical per-position evaluator directly (the
// same function real positions are evaluated by on the Portfolio page) and
// then re-uses the canonical prioritizePortfolioObjectives() sort for the
// final ordering — no new scoring, no copied thresholds.
//
// Isolation: this function's ONLY input is the paper ledger passed in by the
// caller. It never reads real position state, and nothing in
// lib/portfolio-intelligence's real-position code path is changed or reads
// paper data — see __tests__/portfolioIntelligenceAdapter.test.ts for the
// two-directional non-leakage proof.

import { daysUntil, evaluatePositionObjective, type PositionObjectiveInput } from '@/lib/portfolio-intelligence/objectives/positionObjective';
import { prioritizePortfolioObjectives } from '@/lib/portfolio-intelligence/prioritizePortfolioObjectives';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence/types';
import type { PaperTradingPosition } from '../types';

function toObjectiveInput(position: PaperTradingPosition, now: Date): PositionObjectiveInput {
  const pnlPct = position.unrealizedPnl != null && position.entryCredit !== 0 ? (position.unrealizedPnl / position.entryCredit) * 100 : null;

  return {
    positionId: position.positionId,
    key: position.positionId,
    symbol: position.symbol,
    strategy: position.strategy,
    dte: daysUntil(position.expiration, now),
    pnlPct,
    pnl: position.unrealizedPnl,
    creditReceived: position.entryCredit,
    // PT-0001 does not yet compute a marketable-vs-mid distinction for the
    // PI adapter specifically (currentMark IS the marketable/simulated
    // value already -- there is no separate "mid-only" reading to widen
    // against), so marketablePnlPct/liquidityTier are left absent rather
    // than fabricated. See design doc "Known limitations."
    marketablePnlPct: null,
    liquidityTier: null,
    hitTarget: null,
    needsClose: null,
    hasGtc: false,
    buffer: null,
    earningsDate: null,
    expDate: position.expiration,
    healthScore: null,
    managementFlags: [],
  };
}

export interface PaperPortfolioIntelligenceSummary {
  generatedAt: string;
  objectives: PortfolioObjective[];
  positionsEvaluated: number;
}

export function buildPaperPortfolioIntelligence(
  openPositions: PaperTradingPosition[],
  now: Date = new Date(),
): PaperPortfolioIntelligenceSummary {
  const objectives: PortfolioObjective[] = [];

  for (const position of openPositions) {
    const input = toObjectiveInput(position, now);
    const result = evaluatePositionObjective(input, now);
    if (result.objective) objectives.push(result.objective);
  }

  const generatedAt = now.toISOString();
  const ranked = prioritizePortfolioObjectives(objectives, generatedAt);

  return { generatedAt, objectives: ranked, positionsEvaluated: openPositions.length };
}
