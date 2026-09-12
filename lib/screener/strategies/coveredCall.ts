import { OptionContract, ScreenerParams } from "@/types/screener";

export interface CoveredCallCandidate {
  shortCall: OptionContract;
  underlyingPrice: number;
  netCostBasis: number;
  maxYieldPct: number;
  downsideProtectionPct: number;
}

export function evaluateCoveredCall(contracts: OptionContract[], params: ScreenerParams): CoveredCallCandidate[] {
  const matches: CoveredCallCandidate[] = [];
  const calls = contracts.filter((c) => c.type === 'call' && (c.delta ?? 0) <= 0.40 && (c.delta ?? 0) >= 0.15);

  for (const shortC of calls) {
    const estimatedStockPrice = shortC.strike;
    const premium = shortC.bid;
    if (premium <= 0) continue;

    const netCostBasis = estimatedStockPrice - premium;
    const maxYieldPct = ((shortC.strike - netCostBasis) / netCostBasis) * 100;
    const downsideProtectionPct = (premium / estimatedStockPrice) * 100;

    matches.push({
      shortCall: shortC,
      underlyingPrice: estimatedStockPrice,
      netCostBasis: Number(netCostBasis.toFixed(2)),
      maxYieldPct: Number(maxYieldPct.toFixed(2)),
      downsideProtectionPct: Number(downsideProtectionPct.toFixed(2)),
    });
  }

  return matches;
}

export function scoreCoveredCall(candidate: CoveredCallCandidate): { score: number; pop: number; liquidityScore: number } {
  const shortDelta = Math.abs(candidate.shortCall.delta ?? 0.30);
  const pop = Number((1 - shortDelta).toFixed(2));

  const spreadPct = (candidate.shortCall.ask - candidate.shortCall.bid) / (candidate.shortCall.mid || 1);
  const liquidityScore = Math.max(0, Math.min(100, Math.round((1 - spreadPct) * 100)));
  const yieldScore = Math.min(100, candidate.maxYieldPct * 5);

  const compositeScore = Math.round((pop * 40) + (liquidityScore * 0.30) + (yieldScore * 0.30));

  return {
    score: Math.max(0, Math.min(100, compositeScore)),
    pop,
    liquidityScore,
  };
}
