import { OptionContract, ScreenerParams } from "@/types/screener";

export interface PMCCCandidate {
  longCall: OptionContract;
  shortCall: OptionContract;
  netDebit: number;
  maxRisk: number;
  breakEven: number;
  extrinsicValueLong: number;
  shortPremiumRatio: number;
}

export function evaluatePMCC(contracts: OptionContract[], params: ScreenerParams): PMCCCandidate[] {
  const matches: PMCCCandidate[] = [];
  const calls = contracts.filter((c) => c.type === 'call');

  const longCalls = calls.filter((c) => c.dte >= 120 && (c.delta ?? 0) >= 0.75);
  const shortCalls = calls.filter((c) => c.dte <= 50 && (c.delta ?? 0) <= 0.35 && (c.delta ?? 0) >= 0.15);

  for (const longC of longCalls) {
    for (const shortC of shortCalls) {
      if (shortC.strike <= longC.strike) continue;
      if (shortC.dte >= longC.dte) continue;

      const netDebit = longC.ask - shortC.bid;
      if (netDebit <= 0) continue;

      const strikeWidth = shortC.strike - longC.strike;
      if (netDebit >= strikeWidth) continue;

      const intrinsicValueLong = Math.max(0, shortC.strike - longC.strike);
      const extrinsicValueLong = Math.max(0, longC.mid - intrinsicValueLong);
      const shortPremiumRatio = shortC.bid / netDebit;

      matches.push({
        longCall: longC,
        shortCall: shortC,
        netDebit: Number(netDebit.toFixed(2)),
        maxRisk: Number(netDebit.toFixed(2)),
        breakEven: Number((longC.strike + netDebit).toFixed(2)),
        extrinsicValueLong: Number(extrinsicValueLong.toFixed(2)),
        shortPremiumRatio: Number(shortPremiumRatio.toFixed(4)),
      });
    }
  }

  return matches;
}

export function scorePMCC(candidate: PMCCCandidate): { score: number; pop: number; liquidityScore: number } {
  const shortDelta = Math.abs(candidate.shortCall.delta ?? 0.30);
  const pop = Number((1 - shortDelta).toFixed(2));

  const longSpread = (candidate.longCall.ask - candidate.longCall.bid) / (candidate.longCall.mid || 1);
  const shortSpread = (candidate.shortCall.ask - candidate.shortCall.bid) / (candidate.shortCall.mid || 1);
  const avgSpreadPct = (longSpread + shortSpread) / 2;

  const liquidityScore = Math.max(0, Math.min(100, Math.round((1 - avgSpreadPct) * 100)));

  const returnOnRisk = ((candidate.shortCall.bid) / candidate.netDebit) * 100;
  const rorScore = Math.min(100, returnOnRisk * 2);

  const compositeScore = Math.round((pop * 40) + (liquidityScore * 0.30) + (rorScore * 0.30));

  return {
    score: Math.max(0, Math.min(100, compositeScore)),
    pop,
    liquidityScore,
  };
}
