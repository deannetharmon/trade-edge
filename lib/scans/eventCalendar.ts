export interface NormalizedEventCalendar {
  checkedAt: string;
  earningsDate: string | null;
  exDividendDate: string | null;
  splitOrSymbolChangeDate: string | null;
  complete: boolean;
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
