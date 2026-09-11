import { OptionContract, ScreenerParams, CandidateResult } from "@/types/screener";
import { fetchOptionChainsConcurrently } from "@/lib/screener/provider";

export async function executeScreenerSearch<T>(
  underlyingSymbols: string[],
  params: ScreenerParams,
  _fetchChainData: (symbol: string) => Promise<OptionContract[]>,
  evaluateStrategy: (contracts: OptionContract[], params: ScreenerParams) => T[],
  scoreCandidate: (candidate: T) => { score: number; pop: number; liquidityScore: number }
): Promise<CandidateResult<T>[]> {
  const results: CandidateResult<T>[] = [];
  const chainMap = await fetchOptionChainsConcurrently(underlyingSymbols, 3, 150);

  for (const symbol of underlyingSymbols) {
    try {
      const rawChain = chainMap.get(symbol) || [];
      if (!rawChain || rawChain.length === 0) continue;

      const sanitizedChain = rawChain.filter((contract) => {
        const spreadWidth = contract.ask - contract.bid;
        const mid = contract.mid || (contract.bid + contract.ask) / 2;
        const spreadWidthPct = mid > 0 ? spreadWidth / mid : Number.POSITIVE_INFINITY;

        const validQuote = contract.bid > 0 && spreadWidthPct <= params.maxSpreadWidthPct;
        const validDTE = contract.dte >= params.minDTE && contract.dte <= params.maxDTE;
        const validVolume = contract.volume >= params.minVolume;
        const validGreeks =
          !params.requireGreeks ||
          (contract.delta !== undefined &&
            contract.theta !== undefined &&
            !Number.isNaN(contract.delta) &&
            !Number.isNaN(contract.theta));

        return validQuote && validDTE && validVolume && validGreeks;
      });

      if (sanitizedChain.length === 0) continue;

      const matches = evaluateStrategy(sanitizedChain, params);

      for (const match of matches) {
        const { score, pop, liquidityScore } = scoreCandidate(match);
        const sampleMid = sanitizedChain[0].mid || (sanitizedChain[0].bid + sanitizedChain[0].ask) / 2;
        const sampleWidth = sanitizedChain[0].ask - sanitizedChain[0].bid;

        results.push({
          underlying: symbol,
          strategyData: match,
          score,
          metrics: {
            spreadWidthPct: sampleMid > 0 ? sampleWidth / sampleMid : 0,
            liquidityScore,
            pop,
          },
        });
      }
    } catch (error) {
      console.error(`Error processing screening logic for underlying: ${symbol}`, error);
    }
  }

  return results.sort((a, b) => b.score - a.score || b.metrics.pop - a.metrics.pop);
}
