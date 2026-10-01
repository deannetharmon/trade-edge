// lib/scans/dailyBarsMemo.ts

// RSI-ENTRY-0001 slice A1b: one /api/chart request per symbol, shared by getTrend and the RSI entry gate.
//
// getTrend already fetches the daily bars for every scanned symbol. The gate needs the same bars (with timestamps),
// so both read them through this short-lived memo and a scan row costs no extra request.
//  * Keyed by the Yahoo chart symbol (after YAHOO_INDEX_CHART_MAP), held for DAILY_BARS_TTL_MS.
//  * Concurrent callers share one in-flight request.
//  * A failure (network error, non-OK status, bad JSON) is never kept: the entry is removed so the next call retries.
//  * Expired entries are dropped on every call, so the map cannot grow across a long scan.
// The request is identical to the one getTrend made before: same URL, cache: 'no-store', same error text.

export const DAILY_BARS_TTL_MS = 60_000;

type Outcome = { ok: true; bars: unknown } | { ok: false; status: number };

const memo = new Map<string, { at: number; pending: Promise<Outcome> }>();

function evictExpired(now: number): void {
  memo.forEach((entry, key) => {
    if (now - entry.at >= DAILY_BARS_TTL_MS) memo.delete(key);
  });
}

/** Test hook: forget everything. */
export function clearDailyBarsMemo(): void {
  memo.clear();
}

/**
 * The `bars` value from /api/chart for `chartSymbol` (usually an array of { t, o, h, l, c }; `[]` when absent).
 * Throws `Yahoo chart fetch failed for <label> (<status>)` on a non-OK response, as getTrend always did.
 * `label` is only used in that message (the caller's cleaned symbol).
 */
export async function fetchDailyBars(chartSymbol: string, label: string = chartSymbol): Promise<unknown> {
  const now = Date.now();
  evictExpired(now);

  let entry = memo.get(chartSymbol);
  if (!entry) {
    const pending: Promise<Outcome> = (async () => {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' });
      if (!res.ok) return { ok: false as const, status: res.status };
      const data = await res.json();
      return { ok: true as const, bars: data?.bars ?? [] };
    })();
    entry = { at: now, pending };
    memo.set(chartSymbol, entry);
    const mine = entry;
    // Never keep a failure; only remove the entry if it is still this one.
    pending.then(
      (outcome) => { if (!outcome.ok && memo.get(chartSymbol) === mine) memo.delete(chartSymbol); },
      () => { if (memo.get(chartSymbol) === mine) memo.delete(chartSymbol); },
    );
  }

  const outcome = await entry.pending;
  if (!outcome.ok) throw new Error(`Yahoo chart fetch failed for ${label} (${outcome.status})`);
  return outcome.bars;
}
