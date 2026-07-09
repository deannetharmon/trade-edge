// lib/scans/ranked-scan-runner.ts
//
// Standalone rank-only scan orchestration, extracted to run as a
// TaskManager-owned background task (TE-0005A). TE-0002B also runs this same
// runner from the Redis-backed server job engine; in that path the browser
// must pass a TastyTrade access token because server code cannot read
// sessionStorage/localStorage/window.

import type { RulesType } from './constants';
import { RANK_SCAN_DTE_MIN, RANK_SCAN_DTE_MAX } from './constants';
import type { RankConfig, ScreenResult, TrendResult, RawScanEntry } from './types';
import { getAccessToken, getMarketMetrics, classifyUnderlying, getChain, getQuote } from './tastytrade-client';
import { getTrend } from './trend';
import { exploreAllCandidatesForRank, scoreCandidate } from './rank-scoring';

export interface RankedScanInput {
  activeSymbols: string[];
  sRules: RulesType;
  eRules: RulesType;
  sLabel?: string;
  eLabel?: string;
  rankConfig: RankConfig;
  accessToken?: string;
}

export interface RankedScanResult {
  results: ScreenResult[];
  rawScanCache: RawScanEntry[];
}

export interface RankedScanProgress {
  label: string;
  completed: number;
  total: number;
}

export type RankedScanProgressCallback = (progress: RankedScanProgress) => void | Promise<void>;

/**
 * Cooperative-cancellation marker per ADR-0003: thrown when the caller's
 * AbortSignal fires between scan steps. Callers should treat this as
 * "stop and mark cancelled", not as a scan failure.
 */
export class RankedScanCancelledError extends Error {
  constructor() {
    super('Ranked scan cancelled');
    this.name = 'RankedScanCancelledError';
  }
}

export async function runRankedScan(
  input: RankedScanInput,
  onProgress?: RankedScanProgressCallback,
  signal?: AbortSignal
): Promise<RankedScanResult> {
  const { activeSymbols, sRules, eRules, sLabel, eLabel, rankConfig } = input;

  if (!activeSymbols.length) {
    throw new Error('No active tickers in watchlist. Check the box next to a ticker to include it in the scan.');
  }

  await onProgress?.({ label: 'Getting access token...', completed: 0, total: activeSymbols.length });
  const token = input.accessToken || await getAccessToken();

  const allSymbols = Array.from(new Set(activeSymbols));

  await onProgress?.({ label: 'Fetching market metrics...', completed: 0, total: activeSymbols.length });
  const metricsArray = await getMarketMetrics(allSymbols, token);

  const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

  const screenResults: ScreenResult[] = [];
  const scanCache: RawScanEntry[] = [];

  const errResult = (symbol: string, strategy: string, msg: string, trendResult?: TrendResult): ScreenResult => ({
    symbol, strategy, price: null, ivr: null, ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
    qualified: false, bestCandidate: null,
    failReasons: [msg], trendResult,
    checks: { ivr: { status: 'fail', value: 'Error', reason: msg }, earnings: { status: 'pending', value: '—', reason: '—' }, oi: { status: 'pending', value: '—', reason: '—' }, delta: { status: 'pending', value: '—', reason: '—' }, credit: { status: 'pending', value: '—', reason: '—' }, roc: { status: 'pending', value: '—', reason: '—' }, pop: { status: 'pending', value: '—', reason: '—' }, iv: { status: 'pending', value: '—', reason: '—' }, emClearance: { status: 'pending', value: '—', reason: '—' } }
  });

  // getChain uses the appropriate rule set for DTE filtering — pass stock rules as base,
  // runChecklist will auto-select ETF rules internally per ticker
  const getChainRules = (isEtfTicker: boolean) => isEtfTicker ? eRules : sRules;

  // Rank mode is exhaustive — every strategy, every qualifying strike, every
  // expiration, no trend gate — because "ranked" means score sorts the full
  // candidate set rather than a single curated pick per symbol. Trend is
  // still fetched (used for the trend-alignment badge and momentum scoring)
  // but never used to skip a ticker. (Mirrors runScreen's isRankMode=true path.)
  for (let i = 0; i < activeSymbols.length; i++) {
    if (signal?.aborted) throw new RankedScanCancelledError();

    const symbol = activeSymbols[i];
    await onProgress?.({ label: `Scanning ${symbol} (${i + 1}/${activeSymbols.length})...`, completed: i, total: activeSymbols.length });
    const classification = await classifyUnderlying(symbol, token);
    const isEtfTicker = classification === 'index' || classification === 'etf';
    let trendResult: TrendResult | undefined;
    try { trendResult = await getTrend(symbol, isEtfTicker); } catch (e) { console.warn(e); }

    try {
      const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
      const rankDteWindow = { min: RANK_SCAN_DTE_MIN, max: RANK_SCAN_DTE_MAX };
      const [chainData, price] = await Promise.all([
        getChain(symbol, token, getChainRules(isEtfTicker), rankDteWindow),
        getQuote(symbol, token),
      ]);
      scanCache.push({ symbol, strategy: trendResult?.strategy === 'NO_TRADE' ? 'BPS' : (trendResult?.strategy ?? 'BPS'), metrics, chainData, price, trendResult });
      screenResults.push(...exploreAllCandidatesForRank(symbol, metrics, chainData, price, sRules, trendResult, isEtfTicker, eRules, sLabel, eLabel));
    } catch (e: any) {
      screenResults.push(errResult(symbol, trendResult?.strategy ?? 'BPS', e.message, trendResult));
    }
  }

  if (signal?.aborted) throw new RankedScanCancelledError();

  // Rank mode: no de-dup (exhaustive candidate set); sort by score descending,
  // no-candidate results go to the bottom. (Mirrors runScreen's rank sort.)
  const uniqueResults = screenResults;
  uniqueResults.sort((a, b) => {
    const sA = scoreCandidate(a, rankConfig)?.score ?? 0;
    const sB = scoreCandidate(b, rankConfig)?.score ?? 0;
    return sB - sA;
  });

  await onProgress?.({ label: 'Complete', completed: activeSymbols.length, total: activeSymbols.length });

  return { results: uniqueResults, rawScanCache: scanCache };
}
