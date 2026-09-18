// lib/portfolio/trendFetch.ts
//
// PI-0006B-FOLLOWUP: batch trend fetch for the portfolio recommendation
// engine, parallel to lib/portfolio-data/acquisition.ts's
// fetchSnapshotStore. Reuses classifyTrendFromCloses
// (trendClassification.ts) -- the SAME pure scoring logic
// app/portfolio/page.tsx's per-card getTrend now also calls -- so the
// batch read and the per-card read can never disagree for the same
// symbol. This module owns only the /api/chart fetch and the
// per-symbol dedupe; no scoring math lives here.

import { classifyTrendFromCloses, type TrendClassification } from './trendClassification';

// Same index-symbol remapping app/portfolio/page.tsx's
// INDEX_CHART_SYMBOLS has always used. Duplicated rather than imported --
// a lib/ module cannot import from a Next.js page.tsx file (wrong
// direction), same reasoning pmccStopGtcPrompt.ts already applied to
// isUpcomingEarningsRisk. This is a static lookup table, not scoring
// logic, so duplicating it carries none of the drift risk the actual
// trend math would -- that math lives in exactly one place
// (trendClassification.ts), imported by both call sites.
const INDEX_CHART_SYMBOLS: Record<string, string> = {
  'SPX': '^GSPC',
  'SPXW': '^GSPC',
  'NDX': '^NDX',
  'RUT': '^RUT',
  'VIX': '^VIX',
  'DJX': '^DJI',
};

/**
 * Fetches and classifies trend for a single symbol. Never throws --
 * resolves to an 'unknown' classification on any fetch/parse failure,
 * same fail-closed convention as this codebase's other quote-resolution
 * functions (see pmccLegQuote.ts's getOptionLegQuote doc comment).
 */
export async function fetchTrendForSymbol(symbol: string): Promise<TrendClassification> {
  try {
    const chartSymbol = INDEX_CHART_SYMBOLS[symbol.toUpperCase()] ?? symbol;
    const res = await fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' });
    if (!res.ok) {
      return { trend: 'unknown', strategy: 'NO_TRADE', confidence: 0, reason: 'Chart data unavailable' };
    }
    const data = await res.json();
    const bars: { c: number }[] = data?.bars ?? [];
    const closes = bars.map((b: any) => Number(b.c)).filter((c: any): c is number => Number.isFinite(c));
    return classifyTrendFromCloses(closes);
  } catch {
    return { trend: 'unknown', strategy: 'NO_TRADE', confidence: 0, reason: 'Chart data unavailable' };
  }
}

/**
 * Batch trend fetch, deduped by unique underlying symbol -- a symbol
 * with multiple open structures (e.g. two SLV spreads) triggers exactly
 * one /api/chart call, not one per position, per Ian's explicit
 * requirement. Never throws; a symbol whose fetch fails still resolves
 * to an 'unknown' entry in the returned map rather than being omitted,
 * so callers never have to distinguish "not fetched" from "fetched and
 * unknown" -- both read as the same 'unknown' TrendClassification.
 */
export async function fetchTrendStore(symbols: string[]): Promise<Record<string, TrendClassification>> {
  const uniqueSymbols = Array.from(new Set(symbols.map(s => s.toUpperCase())));
  const results = await Promise.all(uniqueSymbols.map(async symbol => {
    const trend = await fetchTrendForSymbol(symbol);
    return [symbol, trend] as const;
  }));
  return Object.fromEntries(results);
}

