import { OptionContract, ScreenerParams } from "@/types/screener";

export interface CSPCandidate {
  shortPut: OptionContract;
  strike: number;
  premium: number;
  breakEven: number;
  maxRisk: number;
  returnOnCollateralPct: number;
  annualizedReturnPct: number;
}

export function evaluateCSP(contracts: OptionContract[], params: ScreenerParams): CSPCandidate[] {
  const matches: CSPCandidate[] = [];

  const puts = contracts.filter(
    (c) => c.type === 'put' && (c.delta ?? 0) >= -0.40 && (c.delta ?? 0) <= -0.15
  );

  for (const shortP of puts) {
    const premium = shortP.bid;
    if (premium <= 0) continue;

    const strike = shortP.strike;
    const breakEven = strike - premium;
    const maxRisk = breakEven;
    const returnOnCollateralPct = (premium / strike) * 100;
    const dte = Math.max(1, shortP.dte);
    const annualizedReturnPct = returnOnCollateralPct * (365 / dte);

    matches.push({
      shortPut: shortP,
      strike,
      premium: Number(premium.toFixed(2)),
      breakEven: Number(breakEven.toFixed(2)),
      maxRisk: Number(maxRisk.toFixed(2)),
      returnOnCollateralPct: Number(returnOnCollateralPct.toFixed(2)),
      annualizedReturnPct: Number(annualizedReturnPct.toFixed(2)),
    });
  }

  return matches;
}

export function scoreCSP(candidate: CSPCandidate): { score: number; pop: number; liquidityScore: number } {
  const shortDelta = Math.abs(candidate.shortPut.delta ?? 0.30);
  const pop = Number((1 - shortDelta).toFixed(2));

  const spreadPct = (candidate.shortPut.ask - candidate.shortPut.bid) / (candidate.shortPut.mid || 1);
  const liquidityScore = Math.max(0, Math.min(100, Math.round((1 - spreadPct) * 100)));

  const returnScore = Math.min(100, candidate.annualizedReturnPct * 2);

  const compositeScore = Math.round((pop * 45) + (liquidityScore * 0.25) + (returnScore * 0.30));

  return {
    score: Math.max(0, Math.min(100, compositeScore)),
    pop,
    liquidityScore,
  };
}
