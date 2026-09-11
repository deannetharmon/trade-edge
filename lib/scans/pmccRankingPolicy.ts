import { PMCC_FINDER_POLICY_VERSIONS } from './pmccFinderPolicy';

export const PMCC_RANKING_WEIGHTS_V1 = {
  safety: 30,
  liquidity: 20,
  leapsQuality: 15,
  capitalEfficiency: 15,
  premiumQuality: 10,
  upsideParticipation: 10,
} as const;

export type PmccRankingDimension = keyof typeof PMCC_RANKING_WEIGHTS_V1;

export interface QualifiedPmccRankingInput {
  qualified: boolean;
  dimensions: Record<PmccRankingDimension, number | null>;
  tieBreakers: {
    cushionPerShare: number;
    worstLegLiquidity: number;
    modeledSlippage: number;
    leapsExtrinsicBurden: number;
    capitalRequired: number;
    stableOccKey: string;
  };
}

export interface PmccRankingResult {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.ranking;
  available: boolean;
  total: number | null;
  weightedComponents: Record<PmccRankingDimension, number | null>;
  incompleteDimensions: PmccRankingDimension[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function scoreQualifiedPmcc(input: QualifiedPmccRankingInput): PmccRankingResult {
  const weightedComponents = {} as Record<PmccRankingDimension, number | null>;
  const incompleteDimensions: PmccRankingDimension[] = [];
  let total = 0;
  for (const dimension of Object.keys(PMCC_RANKING_WEIGHTS_V1) as PmccRankingDimension[]) {
    const value = input.dimensions[dimension];
    if (value == null || !Number.isFinite(value)) {
      weightedComponents[dimension] = null;
      incompleteDimensions.push(dimension);
      continue;
    }
    const points = clamp01(value) * PMCC_RANKING_WEIGHTS_V1[dimension];
    weightedComponents[dimension] = points;
    total += points;
  }
  const available = input.qualified && incompleteDimensions.length === 0;
  return {
    policyVersion: PMCC_FINDER_POLICY_VERSIONS.ranking,
    available,
    total: available ? Math.round(total * 100) / 100 : null,
    weightedComponents,
    incompleteDimensions,
  };
}

export function compareQualifiedPmcc(
  a: { input: QualifiedPmccRankingInput; result: PmccRankingResult },
  b: { input: QualifiedPmccRankingInput; result: PmccRankingResult },
): number {
  if (a.result.available !== b.result.available) return a.result.available ? -1 : 1;
  const score = (b.result.total ?? -Infinity) - (a.result.total ?? -Infinity);
  if (score !== 0) return score;
  const at = a.input.tieBreakers;
  const bt = b.input.tieBreakers;
  return bt.cushionPerShare - at.cushionPerShare
    || bt.worstLegLiquidity - at.worstLegLiquidity
    || at.modeledSlippage - bt.modeledSlippage
    || at.leapsExtrinsicBurden - bt.leapsExtrinsicBurden
    || at.capitalRequired - bt.capitalRequired
    || at.stableOccKey.localeCompare(bt.stableOccKey);
}
