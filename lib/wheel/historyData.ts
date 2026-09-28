// lib/wheel/historyData.ts
//
// WHEEL-SYSTEM-0003 Slice B -- fetch adapter for the own-history check, kept apart from the
// component so it can be tested with an injected fetcher (same pattern as candidateData.ts).

export interface HistoryFetchResult {
  closes: number[] | null;
  years: number;
}

const DEFAULT_YEARS = 5;

/**
 * Daily closes for one symbol from /api/chart-history, oldest first, or null when they cannot be
 * read (session expired, symbol not found, Yahoo failure). One fetch per symbol; the caller is
 * responsible for not calling this more than once per symbol per session (Quinn, O3).
 */
export async function fetchPriceHistory(
  symbol: string,
  years: number = DEFAULT_YEARS,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<number[] | null> {
  try {
    const res = await fetchImpl(`/api/chart-history?symbol=${encodeURIComponent(symbol)}&years=${years}`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { closes?: Array<{ c?: number | null }>; error?: unknown };
    if (!Array.isArray(payload?.closes)) return null;
    const closes = payload.closes.map((bar) => bar?.c);
    return closes.filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  } catch {
    return null;
  }
}
