#!/usr/bin/env bash
set -e

# Ensure directories exist
mkdir -p types lib/screener/strategies "app/api/screener/[strategy]" hooks

# 1. types/screener.ts
cat << 'EOF' > types/screener.ts
export interface OptionContract {
  symbol: string;
  strike: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  delta?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  openInterest: number;
  volume: number;
  type: 'call' | 'put';
}

export interface ScreenerParams {
  minVolume: number;
  minIVRank: number;
  maxIVRank: number;
  minDTE: number;
  maxDTE: number;
  maxSpreadWidthPct: number;
  requireGreeks: boolean;
}

export interface CandidateResult<T> {
  underlying: string;
  strategyData: T;
  score: number;
  metrics: {
    spreadWidthPct: number;
    liquidityScore: number;
    pop: number;
  };
}

export interface ScreenerApiResponse<T> {
  success: boolean;
  count: number;
  data: CandidateResult<T>[];
  error?: string;
}
EOF

# 2. lib/screener/engine.ts
cat << 'EOF' > lib/screener/engine.ts
import { OptionContract, ScreenerParams, CandidateResult } from "@/types/screener";

export async function executeScreenerSearch<T>(
  underlyingSymbols: string[],
  params: ScreenerParams,
  fetchChainData: (symbol: string) => Promise<OptionContract[]>,
  evaluateStrategy: (contracts: OptionContract[], params: ScreenerParams) => T[],
  scoreCandidate: (candidate: T) => { score: number; pop: number; liquidityScore: number }
): Promise<CandidateResult<T>[]> {
  const results: CandidateResult<T>[] = [];

  for (const symbol of underlyingSymbols) {
    try {
      const rawChain = await fetchChainData(symbol);
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
EOF

# 3. lib/screener/provider.ts
cat << 'EOF' > lib/screener/provider.ts
import { OptionContract } from "@/types/screener";

export async function fetchOptionChainFromProvider(symbol: string): Promise<OptionContract[]> {
  try {
    const baseUrl = process.env.MARKET_DATA_API_URL || 'https://api.tastyworks.com';
    const response = await fetch(`${baseUrl}/option-chains/${symbol}/nested`, {
      headers: {
        'Authorization': `Bearer ${process.env.MARKET_DATA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      console.error(`Failed to fetch chain for ${symbol}: ${response.statusText}`);
      return [];
    }

    const payload = await response.json();
    const rawItems: any[] = payload.data?.items || payload.items || [];

    return rawItems.map((item) => {
      const bid = Number(item.bid || item.bid_price || 0);
      const ask = Number(item.ask || item.ask_price || 0);
      const mid = Number(item.mid || item.mid_price || (bid + ask) / 2);

      return {
        symbol: item.symbol,
        strike: Number(item.strike_price || item.strike),
        expiration: item.expiration_date || item.expiration,
        dte: Number(item.dte || item.days_to_expiration || 0),
        bid,
        ask,
        mid,
        delta: item.delta !== undefined ? Number(item.delta) : undefined,
        theta: item.theta !== undefined ? Number(item.theta) : undefined,
        vega: item.vega !== undefined ? Number(item.vega) : undefined,
        iv: item.implied_volatility !== undefined ? Number(item.implied_volatility) : undefined,
        openInterest: Number(item.open_interest || 0),
        volume: Number(item.volume || 0),
        type: (item.option_type || item.type || '').toLowerCase() === 'call' ? 'call' : 'put',
      };
    });
  } catch (error) {
    console.error(`Error in fetchOptionChainFromProvider for ${symbol}:`, error);
    return [];
  }
}
EOF

# 4. lib/screener/strategies/pmcc.ts
cat << 'EOF' > lib/screener/strategies/pmcc.ts
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
EOF

# 5. lib/screener/strategies/creditSpread.ts
cat << 'EOF' > lib/screener/strategies/creditSpread.ts
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
EOF

# 6. lib/screener/strategies/coveredCall.ts
cat << 'EOF' > lib/screener/strategies/coveredCall.ts
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
EOF

# 7. lib/screener/strategies/csp.ts
cat << 'EOF' > lib/screener/strategies/csp.ts
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
EOF

# 8. app/api/screener/[strategy]/route.ts
cat << 'EOF' > "app/api/screener/[strategy]/route.ts"
import { NextRequest, NextResponse } from 'next/server';
import { executeScreenerSearch } from '@/lib/screener/engine';
import { ScreenerParams } from '@/types/screener';
import { fetchOptionChainFromProvider } from '@/lib/screener/provider';
import { evaluatePMCC, scorePMCC } from '@/lib/screener/strategies/pmcc';
import { evaluateCreditSpread, scoreCreditSpread } from '@/lib/screener/strategies/creditSpread';
import { evaluateCoveredCall, scoreCoveredCall } from '@/lib/screener/strategies/coveredCall';
import { evaluateCSP, scoreCSP } from '@/lib/screener/strategies/csp';

export async function POST(
  request: NextRequest,
  { params }: { params: { strategy: string } }
) {
  try {
    const body = await request.json();
    const { symbols, config } = body as { symbols: string[]; config: Partial<ScreenerParams> };

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'A valid array of underlying symbols is required.' }, { status: 400 });
    }

    const defaultParams: ScreenerParams = {
      minVolume: config?.minVolume ?? 10,
      minIVRank: config?.minIVRank ?? 0,
      maxIVRank: config?.maxIVRank ?? 100,
      minDTE: config?.minDTE ?? 0,
      maxDTE: config?.maxDTE ?? 360,
      maxSpreadWidthPct: config?.maxSpreadWidthPct ?? 0.15,
      requireGreeks: config?.requireGreeks ?? true,
    };

    const strategyKey = params.strategy.toLowerCase();

    switch (strategyKey) {
      case 'pmcc': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluatePMCC,
          scorePMCC
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'credit-spread': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCreditSpread,
          scoreCreditSpread
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'covered-call': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCoveredCall,
          scoreCoveredCall
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'csp':
      case 'cash-secured-put': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCSP,
          scoreCSP
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      default:
        return NextResponse.json({ error: `Unsupported strategy type: ${params.strategy}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Screener route error:', error);
    return NextResponse.json({ error: 'Internal server error processing screener request.' }, { status: 500 });
  }
}
EOF

# 9. hooks/useScreener.ts
cat << 'EOF' > hooks/useScreener.ts
import { useState } from 'react';
import { ScreenerParams, ScreenerApiResponse, CandidateResult } from '@/types/screener';

export function useScreener<T>(strategy: string) {
  const [data, setData] = useState<CandidateResult<T>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (symbols: string[], config?: Partial<ScreenerParams>) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/screener/${strategy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, config }),
      });

      const result: ScreenerApiResponse<T> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to execute screener search');
      }

      setData(result.data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  return { runSearch, data, loading, error };
}
EOF

echo "All 9 screener pipeline files written successfully."