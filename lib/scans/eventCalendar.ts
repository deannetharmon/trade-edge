export interface NormalizedEventCalendar {
  checkedAt: string;
  earningsDate: string | null;
  exDividendDate: string | null;
  splitOrSymbolChangeDate: string | null;
  complete: boolean;
}

// Relocated from lib/fundamentals/fmpClient.ts when that file's
// FUNDAMENTALS-0001/0002 fundamentals-scoring work was backed out (Ian/
// Paul: analyst price targets are opinion not metric, and the Finviz
// screen already covers the quality-filtering job the Z-Score/valuation-
// compression work would have refined -- not worth the free-tier access
// problems it ran into). fetchEventCalendarBundle is the one piece of that
// file genuinely used by a live, wired-in feature (PMCC event-risk gating,
// app/api/event-risk/route.ts) and doesn't belong grouped with dormant
// debug-only code -- moved here, next to the calendar normalizer it feeds,
// rather than deleted along with everything else in that file.
const FMP_LEGACY_BASE = 'https://financialmodelingprep.com/api/v3';

export interface FmpEventCalendarBundle {
  symbol: string;
  fetchedAt: string;
  earnings: unknown;
  dividends: unknown;
  splits: unknown;
}

async function fetchFmpCalendar(path: string, from: string, to: string): Promise<unknown> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY is not configured');
  const url = `${FMP_LEGACY_BASE}/${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${apiKey}`;
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = body; }
  if (!response.ok) throw new Error(`FMP ${path} failed (${response.status})`);
  return parsed;
}

/** Raw calendar spike. Fields deliberately remain untrusted until a deployed
 * response confirms the account's plan, schema, and date semantics. */
export async function fetchEventCalendarBundle(symbol: string, from: string, to: string): Promise<FmpEventCalendarBundle> {
  const [earnings, dividends, splits] = await Promise.all([
    fetchFmpCalendar('earning_calendar', from, to),
    fetchFmpCalendar('stock_dividend_calendar', from, to),
    fetchFmpCalendar('stock_split_calendar', from, to),
  ]);
  return { symbol, fetchedAt: new Date().toISOString(), earnings, dividends, splits };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function records(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) && value.every(item => item != null && typeof item === 'object')
    ? value as Record<string, unknown>[]
    : null;
}

function earliestDate(value: unknown, symbol: string): string | null {
  const rows = records(value);
  if (!rows) return null;
  return rows
    .filter(row => String(row.symbol ?? '').toUpperCase() === symbol)
    .map(row => typeof row.date === 'string' && ISO_DATE.test(row.date) ? row.date : null)
    .filter((date): date is string => date != null)
    .sort()[0] ?? null;
}

/** Converts only documented calendar-like rows. Any unexpected response is
 * incomplete, which callers must treat as unavailable rather than clear. */
export function normalizeFmpEventCalendar(bundle: { symbol: string; fetchedAt: string; earnings: unknown; dividends: unknown; splits: unknown }): NormalizedEventCalendar {
  const symbol = bundle.symbol.toUpperCase();
  const earnings = records(bundle.earnings);
  const dividends = records(bundle.dividends);
  const splits = records(bundle.splits);
  return {
    checkedAt: bundle.fetchedAt,
    earningsDate: earliestDate(bundle.earnings, symbol),
    exDividendDate: earliestDate(bundle.dividends, symbol),
    splitOrSymbolChangeDate: earliestDate(bundle.splits, symbol),
    complete: earnings != null && dividends != null && splits != null,
  };
}
