// lib/portfolio-ai/fromPositions.ts
//
// PORTFOLIO-AI-0001: maps the Portfolio page's own Position[] onto the snapshot input. Every
// number comes from an existing fail-closed helper; nothing is derived here.

import type { Position } from '@/lib/portfolio-data/types';
import type { LeveragedPositionExposureGroup } from '@/lib/portfolio/leveragedPositionExposure';
import { entryPnlPct, reliableSupportedMaxRisk } from '@/lib/portfolio/positionMetrics';
import { isPairedPmccLong } from '@/lib/portfolio-data/pmccPairDetection';
import { buildPositionFacts } from './positionFacts';
import {
  buildPortfolioAiSnapshot,
  type PortfolioAiPositionInput,
  type PortfolioAiSnapshot,
} from './snapshot';

export function toPortfolioAiPositions(positions: Position[], nowMs: number = Date.now()): PortfolioAiPositionInput[] {
  return positions.map(pos => {
    const facts = buildPositionFacts(pos, nowMs);
    return {
    key: pos.key,
    symbol: pos.symbol,
    strategy: pos.strategy,
    dte: pos.dte,
    entryPnlPct: entryPnlPct(pos),
    maxRisk: reliableSupportedMaxRisk(pos),
    bufferPct: pos.buffer != null && Number.isFinite(pos.buffer) ? pos.buffer : null,
    recommendationLabel: pos.recommendation?.label ?? null,
    recommendationDetail: pos.recommendation?.suggestedAction || pos.recommendation?.primaryReason || null,
    needsClose: pos.needsClose === true,
    hitTarget: pos.hitTarget === true,
    hasGtc: pos.hasGtc === true,
    pmccPaired: isPairedPmccLong(pos, positions),
    factLines: facts.lines,
    factFigures: facts.figures,
    };
  });
}

export function buildPortfolioAiSnapshotFromPage(args: {
  positions: Position[];
  thetaPerDay: number | null;
  leverageGroups: LeveragedPositionExposureGroup[];
  now?: Date;
}): PortfolioAiSnapshot {
  return buildPortfolioAiSnapshot({
    generatedAt: (args.now ?? new Date()).toISOString(),
    positions: toPortfolioAiPositions(args.positions, (args.now ?? new Date()).getTime()),
    thetaPerDay: args.thetaPerDay,
    leverageGroups: args.leverageGroups.map(group => ({
      economicUnderlying: group.economicUnderlying,
      memberSymbols: Array.from(new Set(group.members.map(m => m.symbol))),
      maxCapitalLoss: group.maxCapitalLoss,
      capitalRiskComplete: group.capitalRiskComplete,
    })),
  });
}
