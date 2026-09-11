import { OptionContract, ScreenerParams } from "@/types/screener";

export interface CreditSpreadCandidate {
  shortLeg: OptionContract;
  longLeg: OptionContract;
  type: 'put' | 'call';
  netCredit: number;
  maxRisk: number;
  breakEven: number;
  returnOnRisk: number;
}

export function evaluateCreditSpread(contracts: OptionContract[], params: ScreenerParams): CreditSpreadCandidate[] {
  const matches: CreditSpreadCandidate[] = [];

  const puts = contracts.filter((c) => c.type === 'put');
  const calls = contracts.filter((c) => c.type === 'call');

  for (const shortP of puts.filter((c) => (c.delta ?? 0) >= -0.35 && (c.delta ?? 0) <= -0.10)) {
    for (const longP of puts.filter((c) => c.strike < shortP.strike)) {
      if (shortP.expiration !== longP.expiration) continue;

      const netCredit = shortP.bid - longP.ask;
      if (netCredit <= 0) continue;

      const spreadWidth = shortP.strike - longP.strike;
      const maxRisk = spreadWidth - netCredit;
      if (maxRisk <= 0) continue;

      matches.push({
        shortLeg: shortP,
        longLeg: longP,
        type: 'put',
        netCredit: Number(netCredit.toFixed(2)),
        maxRisk: Number(maxRisk.toFixed(2)),
        breakEven: Number((shortP.strike - netCredit).toFixed(2)),
        returnOnRisk: Number(((netCredit / maxRisk) * 100).toFixed(2)),
      });
    }
  }

  for (const shortC of calls.filter((c) => (c.delta ?? 0) <= 0.35 && (c.delta ?? 0) >= 0.10)) {
    for (const longC of calls.filter((c) => c.strike > shortC.strike)) {
      if (shortC.expiration !== longC.expiration) continue;

      const netCredit = shortC.bid - longC.ask;
      if (netCredit <= 0) continue;

      const spreadWidth = longC.strike - shortC.strike;
      const maxRisk = spreadWidth - netCredit;
      if (maxRisk <= 0) continue;

      matches.push({
        shortLeg: shortC,
        longLeg: longC,
        type: 'call',
        netCredit: Number(netCredit.toFixed(2)),
        maxRisk: Number(maxRisk.toFixed(2)),
        breakEven: Number((shortC.strike + netCredit).toFixed(2)),
        returnOnRisk: Number(((netCredit / maxRisk) * 100).toFixed(2)),
      });
    }
  }

  return matches;
}

export function scoreCreditSpread(candidate: CreditSpreadCandidate): { score: number; pop: number; liquidityScore: number } {
  const shortDelta = Math.abs(candidate.shortLeg.delta ?? 0.25);
  const pop = Number((1 - shortDelta).toFixed(2));

  const shortSpread = (candidate.shortLeg.ask - candidate.shortLeg.bid) / (candidate.shortLeg.mid || 1);
  const longSpread = (candidate.longLeg.ask - candidate.longLeg.bid) / (candidate.longLeg.mid || 1);
  const avgSpreadPct = (shortSpread + longSpread) / 2;

  const liquidityScore = Math.max(0, Math.min(100, Math.round((1 - avgSpreadPct) * 100)));
  const rorScore = Math.min(100, candidate.returnOnRisk * 2.5);

  const compositeScore = Math.round((pop * 45) + (liquidityScore * 0.25) + (rorScore * 0.30));

  return {
    score: Math.max(0, Math.min(100, compositeScore)),
    pop,
    liquidityScore,
  };
}
