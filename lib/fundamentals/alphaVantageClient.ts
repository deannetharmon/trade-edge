// lib/fundamentals/alphaVantageClient.ts
//
// FUNDAMENTALS-0002 pivot: FMP's balance-sheet-statement/income-statement/
// cash-flow-statement/ratios all returned 402 (Premium Query Parameter) on
// Dean's actual account -- confirmed via /debug/fundamentals, not assumed.
// Alpha Vantage is being evaluated as a free alternative for exactly these
// four data types. Its own free tier is real but severely constrained: 25
// requests/day, 5/minute (confirmed from Alpha Vantage's own current
// documentation, independently corroborated by multiple third-party
// sources -- this has shrunk over time, from 500/day historically to 100,
// now 25). That budget is precious enough that this client exists purely
// to let /debug/alphavantage show real output for real field-name
// verification BEFORE any scoring logic gets built against guessed names
// -- same discipline Alan required for the FMP integration.
//
// Deliberately returns unknown/raw JSON per function, same reasoning as
// fmpClient.ts: confirm real field names via the debug page before typing
// anything.

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

async function fetchAlphaVantage(functionName: string, symbol: string): Promise<unknown> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error('ALPHA_VANTAGE_API_KEY is not configured');
  const url = `${ALPHA_VANTAGE_BASE}?function=${encodeURIComponent(functionName)}&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  if (!response.ok) {
    throw new Error(`Alpha Vantage ${functionName} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  // Alpha Vantage returns 200 OK even for rate-limit/invalid-key errors --
  // the actual error lives in a "Note", "Information", or "Error Message"
  // field in an otherwise-200 response. Surfacing these explicitly rather
  // than letting a rate-limit response silently look like empty data.
  if (parsed != null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const softError = obj['Note'] ?? obj['Information'] ?? obj['Error Message'];
    if (typeof softError === 'string') {
      throw new Error(`Alpha Vantage ${functionName}: ${softError}`);
    }
  }
  return parsed;
}

export function fetchAlphaVantageBalanceSheet(symbol: string): Promise<unknown> {
  return fetchAlphaVantage('BALANCE_SHEET', symbol);
}

export function fetchAlphaVantageIncomeStatement(symbol: string): Promise<unknown> {
  return fetchAlphaVantage('INCOME_STATEMENT', symbol);
}

export function fetchAlphaVantageCashFlow(symbol: string): Promise<unknown> {
  return fetchAlphaVantage('CASH_FLOW', symbol);
}

// OVERVIEW includes company-level ratios (PERatio, PEGRatio, etc.) in one
// call -- worth checking directly whether it can substitute for FMP's
// separate "ratios" (valuation compression) call, since it's a genuinely
// different endpoint shape (current snapshot, not historical periods) and
// that distinction matters for whether it can support a multi-period
// median comparison at all.
export function fetchAlphaVantageOverview(symbol: string): Promise<unknown> {
  return fetchAlphaVantage('OVERVIEW', symbol);
}

export interface AlphaVantageBundle {
  symbol: string;
  fetchedAt: string;
  balanceSheet: unknown;
  incomeStatement: unknown;
  cashFlow: unknown;
  overview: unknown;
}

// Bundled the same way fetchFundamentalsBundle is -- one cache entry per
// symbol covers all four calls. Sequential, not concurrent (unlike
// fmpClient's Promise.all) -- Alpha Vantage's own community guidance flags
// it as burst-sensitive even under its per-minute cap, and each call here
// is precious against a 25/day budget; not worth risking a rate-limit
// rejection on a burst of 4 simultaneous requests to save a few seconds.
export async function fetchAlphaVantageBundle(symbol: string): Promise<AlphaVantageBundle> {
  const safeFetch = async (fn: () => Promise<unknown>) => {
    try { return await fn(); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  };
  const balanceSheet = await safeFetch(() => fetchAlphaVantageBalanceSheet(symbol));
  const incomeStatement = await safeFetch(() => fetchAlphaVantageIncomeStatement(symbol));
  const cashFlow = await safeFetch(() => fetchAlphaVantageCashFlow(symbol));
  const overview = await safeFetch(() => fetchAlphaVantageOverview(symbol));
  return { symbol, fetchedAt: new Date().toISOString(), balanceSheet, incomeStatement, cashFlow, overview };
}
