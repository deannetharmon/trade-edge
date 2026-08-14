import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { OpportunityDisposition, OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';

export type RankedResultLimit = 10 | 20 | 50 | 'all';
export type OpenInterestThreshold = 0 | 100 | 250 | 500 | 1000;
export type SharedResultSortKey = 'rank' | 'oi' | 'creditRatio' | 'capitalRequired' | 'otm';
export type SharedResultSortDirection = 'asc' | 'desc';

export interface SharedResultSort {
  key: SharedResultSortKey;
  direction: SharedResultSortDirection;
}

export const DEFAULT_SHARED_RESULT_SORT: SharedResultSort = {
  key: 'rank',
  direction: 'asc',
};

export function defaultSharedResultSortDirection(
  key: SharedResultSortKey,
): SharedResultSortDirection {
  return key === 'rank' || key === 'capitalRequired' ? 'asc' : 'desc';
}

export interface RankedOpportunityPresentationEntry {
  recommendation: OpportunityRecommendation;
  analysis: DecisionAnalysis;
  result: ScreenResult;
}

export interface RankedOpportunityMappingFailure {
  code: 'MISSING_ANALYSIS' | 'MISSING_SOURCE_ID' | 'SOURCE_NOT_FOUND' | 'DUPLICATE_SOURCE_ID';
  recommendation: OpportunityRecommendation;
  sourceResultId?: string;
  message: string;
}

export interface RankedOpportunityMappingResult {
  entries: RankedOpportunityPresentationEntry[];
  failures: RankedOpportunityMappingFailure[];
}

export interface RankedOpportunityFilters {
  limit: RankedResultLimit;
  dteMin: number;
  dteMax: number;
  popMin: number;
  otmMin: number;
  creditRatioMin: number;
  strategies: readonly string[];
  tickers: readonly string[];
  dispositions: readonly OpportunityDisposition[];
  openInterestThreshold: OpenInterestThreshold;
  sort: SharedResultSort;
}

export const DEFAULT_RANKED_OPPORTUNITY_FILTERS: RankedOpportunityFilters = {
  limit: 20,
  dteMin: 0,
  dteMax: 999,
  popMin: 0,
  otmMin: 0,
  creditRatioMin: 0,
  strategies: [],
  tickers: [],
  dispositions: [],
  openInterestThreshold: 500,
  sort: DEFAULT_SHARED_RESULT_SORT,
};

export function mapRankedOpportunitiesToResults(
  recommendations: readonly OpportunityRecommendation[],
  analyses: readonly DecisionAnalysis[],
  results: readonly ScreenResult[],
): RankedOpportunityMappingResult {
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const resultBySourceId = new Map<string, ScreenResult>();
  const duplicateSourceIds = new Set<string>();
  for (const result of results) {
    if (!result.sourceResultId) continue;
    if (resultBySourceId.has(result.sourceResultId)) duplicateSourceIds.add(result.sourceResultId);
    else resultBySourceId.set(result.sourceResultId, result);
  }

  const entries: RankedOpportunityPresentationEntry[] = [];
  const failures: RankedOpportunityMappingFailure[] = [];
  for (const recommendation of recommendations) {
    const analysis = analysisById.get(recommendation.decisionAnalysisId);
    if (!analysis) {
      failures.push({ code: 'MISSING_ANALYSIS', recommendation, message: `Rank ${recommendation.rank} ${recommendation.symbol} (${recommendation.strategy}) is missing its canonical analysis.` });
      continue;
    }
    const sourceResultId = analysis.candidate?.sourceResultId;
    if (!sourceResultId) {
      failures.push({ code: 'MISSING_SOURCE_ID', recommendation, message: `Rank ${recommendation.rank} ${recommendation.symbol} (${recommendation.strategy}) has no canonical sourceResultId.` });
      continue;
    }
    if (duplicateSourceIds.has(sourceResultId)) {
      failures.push({ code: 'DUPLICATE_SOURCE_ID', recommendation, sourceResultId, message: `Duplicate sourceResultId "${sourceResultId}" for rank ${recommendation.rank} ${recommendation.symbol} (${recommendation.strategy}); analysis ${analysis.id} was not mapped.` });
      continue;
    }
    const result = resultBySourceId.get(sourceResultId);
    if (!result) {
      failures.push({ code: 'SOURCE_NOT_FOUND', recommendation, sourceResultId, message: `Rank ${recommendation.rank} ${recommendation.symbol} (${recommendation.strategy}) could not find sourceResultId "${sourceResultId}".` });
      continue;
    }
    entries.push({ recommendation, analysis, result });
  }
  return { entries, failures };
}

export function rankedResultOtmPct(result: ScreenResult): number | null {
  const candidate = result.bestCandidate;
  const price = result.price;
  if (!candidate || price == null || price <= 0) return null;
  if (result.strategy === 'BPS' || result.strategy === 'CSP') {
    return ((price - candidate.shortStrike) / price) * 100;
  }
  if (result.strategy === 'BCS') {
    return ((candidate.shortStrike - price) / price) * 100;
  }
  if (result.strategy === 'PMCC' || result.strategy === 'CC') {
    return ((candidate.shortStrike - price) / price) * 100;
  }
  if (result.strategy === 'IC' && candidate.shortCallStrike != null) {
    return Math.min(
      ((price - candidate.shortStrike) / price) * 100,
      ((candidate.shortCallStrike - price) / price) * 100,
    );
  }
  return null;
}

export function requiredOptionLegOpenInterest(
  strategy: string,
  candidate: SpreadCandidate | null | undefined,
): Array<number | null> {
  if (!candidate) return [];
  if (strategy === 'IC') {
    return [
      candidate.shortOI,
      candidate.longOI,
      candidate.shortCallOI,
      candidate.longCallOI,
    ].map((value) => Number.isFinite(value ?? NaN) ? Number(value) : null);
  }
  if (strategy === 'CSP' || strategy === 'CC') {
    return [candidate.shortOI].map((value) => Number.isFinite(value ?? NaN) ? Number(value) : null);
  }
  if (strategy === 'BPS' || strategy === 'BCS' || strategy === 'PMCC') {
    return [candidate.shortOI, candidate.longOI]
      .map((value) => Number.isFinite(value ?? NaN) ? Number(value) : null);
  }
  return [];
}

export function passesOpenInterestThreshold(
  result: ScreenResult,
  threshold: OpenInterestThreshold,
): boolean {
  if (threshold === 0) return true;
  const required = requiredOptionLegOpenInterest(result.strategy, result.bestCandidate);
  return required.length > 0 && required.every((value) => value !== null && value > threshold);
}

function finiteNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value ?? NaN) ? Number(value) : null;
}

export function weakestRequiredOptionLegOpenInterest(result: ScreenResult): number | null {
  const required = requiredOptionLegOpenInterest(result.strategy, result.bestCandidate);
  if (required.length === 0 || required.some((value) => value === null)) return null;
  return Math.min(...required as number[]);
}

export function resultCapitalRequired(result: ScreenResult): number | null {
  return finiteNumber(result.bestCandidate?.capitalRequired);
}

export function resultSortMetric(
  result: ScreenResult,
  key: Exclude<SharedResultSortKey, 'rank'>,
): number | null {
  if (key === 'oi') return weakestRequiredOptionLegOpenInterest(result);
  if (key === 'creditRatio') return finiteNumber(result.bestCandidate?.creditRatio);
  if (key === 'capitalRequired') return resultCapitalRequired(result);
  return rankedResultOtmPct(result);
}

export function sortPublishedResults<T>(
  items: readonly T[],
  sort: SharedResultSort,
  getResult: (item: T) => ScreenResult,
  getRank: (item: T, originalIndex: number) => number | null = (_item, index) => index + 1,
  getCapitalRequired?: (item: T) => number | null,
): T[] {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftValue = sort.key === 'rank'
        ? finiteNumber(getRank(left.item, left.originalIndex))
        : sort.key === 'capitalRequired' && getCapitalRequired
          ? finiteNumber(getCapitalRequired(left.item))
          : resultSortMetric(getResult(left.item), sort.key);
      const rightValue = sort.key === 'rank'
        ? finiteNumber(getRank(right.item, right.originalIndex))
        : sort.key === 'capitalRequired' && getCapitalRequired
          ? finiteNumber(getCapitalRequired(right.item))
          : resultSortMetric(getResult(right.item), sort.key);

      if (leftValue === null && rightValue === null) return left.originalIndex - right.originalIndex;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const comparison = leftValue - rightValue;
      if (comparison === 0) return left.originalIndex - right.originalIndex;
      return sort.direction === 'asc' ? comparison : -comparison;
    })
    .map(({ item }) => item);
}

export function publishTargetedScoreOrder<T extends { score: number }>(
  entries: readonly T[],
): Array<T & { publishedRank: number }> {
  return entries
    .slice()
    .sort((left, right) => right.score - left.score)
    .map((entry, index) => ({ ...entry, publishedRank: index + 1 }));
}

export function publishScreenResultOrder(
  results: readonly ScreenResult[],
  includeCanonicalRank = false,
): ScreenResult[] {
  const seen = new Set<string>();
  return results.map((result, index) => {
    const sourceResultId = result.sourceResultId ?? crypto.randomUUID();
    if (seen.has(sourceResultId)) throw new Error(`Duplicate sourceResultId "${sourceResultId}" in source publication.`);
    seen.add(sourceResultId);
    return {
      ...result,
      sourceResultId,
      publishedOrder: index + 1,
      publishedRank: includeCanonicalRank ? index + 1 : undefined,
    };
  });
}

export function filterRankedOpportunityEntries(
  entries: readonly RankedOpportunityPresentationEntry[],
  filters: RankedOpportunityFilters,
): {
  matching: RankedOpportunityPresentationEntry[];
  visible: RankedOpportunityPresentationEntry[];
} {
  const filtered = entries.filter(({ recommendation, result }) => {
    const candidate = result.bestCandidate;
    if (!candidate) return false;
    if (candidate.dte < filters.dteMin || candidate.dte > filters.dteMax) return false;
    if ((candidate.pop ?? Number.NEGATIVE_INFINITY) < filters.popMin) return false;
    if (filters.otmMin > 0) {
      const otm = rankedResultOtmPct(result);
      if (otm == null || otm < filters.otmMin) return false;
    }
    if (filters.creditRatioMin > 0) {
      const ratio = candidate.creditRatio;
      if (!Number.isFinite(ratio ?? NaN) || Number(ratio) * 100 < filters.creditRatioMin) return false;
    }
    if (filters.strategies.length > 0 && !filters.strategies.includes(result.strategy)) return false;
    if (filters.tickers.length > 0 && !filters.tickers.includes(result.symbol)) return false;
    if (
      filters.dispositions.length > 0
      && !filters.dispositions.includes(recommendation.disposition)
    ) return false;
    return passesOpenInterestThreshold(result, filters.openInterestThreshold);
  });
  const matching = sortPublishedResults(
    filtered,
    filters.sort,
    (entry) => entry.result,
    (entry) => entry.recommendation.rank,
    (entry) => finiteNumber(entry.analysis.expectedOutcome.capitalRequired)
      ?? finiteNumber(entry.analysis.candidate?.theoreticalMaxLoss),
  );

  return {
    matching,
    visible: filters.limit === 'all' ? matching : matching.slice(0, filters.limit),
  };
}
