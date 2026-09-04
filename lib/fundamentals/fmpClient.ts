// lib/fundamentals/fmpClient.ts
//
// FUNDAMENTALS-0001: pure fetch functions for Financial Modeling Prep's
// stable endpoints. Confirmed real URLs (fetched from FMP's own docs,
// 2026-09-04):
//   https://financialmodelingprep.com/stable/price-target-consensus?symbol=X
//   https://financialmodelingprep.com/stable/price-target-summary?symbol=X
// grades-summary follows the same stable/{name}?symbol=X pattern as the
// two confirmed endpoints, but wasn't independently verified -- treat its
// exact path/fields as unconfirmed the same as the two above.
//
// Deliberately returns unknown/raw JSON, not a typed interface. FMP's docs
// describe the fields in prose (high/low/median/consensus targets; average
// targets over lastMonth/lastQuarter/lastYear/allTime; analyst coverage
// counts) but don't expose the exact JSON key names in fetchable text.
// Per Alan's explicit requirement, scoring math must be built against
// CONFIRMED real field names, not guessed ones -- see
// app/debug/fundamentals/page.tsx, which exists specifically to let Dean
// inspect a real response before anything reads specific keys from it.

const FMP_BASE = 'https://financialmodelingprep.com/stable';

async function fetchFmp(path: string, symbol: string): Promise<unknown> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY is not configured');
  const url = `${FMP_BASE}/${path}?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed != null && 'error' in (parsed as Record<string, unknown>)
      ? String((parsed as Record<string, unknown>).error)
      : body.slice(0, 300);
    throw new Error(`FMP ${path} failed (${response.status}): ${detail}`);
  }
  return parsed;
}

export function fetchPriceTargetConsensus(symbol: string): Promise<unknown> {
  return fetchFmp('price-target-consensus', symbol);
}

export function fetchPriceTargetSummary(symbol: string): Promise<unknown> {
  return fetchFmp('price-target-summary', symbol);
}

export function fetchGradesSummary(symbol: string): Promise<unknown> {
  return fetchFmp('grades-summary', symbol);
}

export interface FundamentalsBundle {
  symbol: string;
  fetchedAt: string;
  priceTargetConsensus: unknown;
  priceTargetSummary: unknown;
  gradesSummary: unknown;
}

// Bundles all three calls together so a single cache write/read covers the
// full fundamentals picture for a symbol -- a cache HIT saves all three FMP
// calls at once, not just one. Each call fails independently rather than
// failing the whole bundle -- a symbol with grades data but no consensus
// data yet (e.g. very thin coverage) still returns what's available rather
// than nothing.
export async function fetchFundamentalsBundle(symbol: string): Promise<FundamentalsBundle> {
  const [priceTargetConsensus, priceTargetSummary, gradesSummary] = await Promise.all([
    fetchPriceTargetConsensus(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchPriceTargetSummary(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchGradesSummary(symbol).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ]);
  return { symbol, fetchedAt: new Date().toISOString(), priceTargetConsensus, priceTargetSummary, gradesSummary };
}
