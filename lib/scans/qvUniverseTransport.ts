// lib/scans/qvUniverseTransport.ts

// LEAPS-QV-0001 -- browser binding for the Gate 3 input builder (lib/discovery/qv/runUniverse.ts). The only place the
// builder's data is fetched: /api/fundamentals (SEC + Yahoo, server-side) and TastyTrade /market-metrics through the
// same-origin proxy. Types are structural (this file may not import lib/discovery; isolation guard). Find LEAPS never
// imports this file (guarded by test).

type MetricSetLike = Record<string, unknown>;
export type QvFundamentalsSource = { ok: true; metrics: MetricSetLike; technicals: MetricSetLike; issues: string[] } | { ok: false; reason: string };
export type QvMarketMetricsSource = { ok: true; item: Record<string, unknown> } | { ok: false; reason: string };

export async function qvFetchFundamentals(symbol: string): Promise<QvFundamentalsSource> {
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    return { ok: false, reason: 'FUNDAMENTALS_NETWORK' };
  }
  if (res.status !== 200) return { ok: false, reason: `FUNDAMENTALS_HTTP_${res.status}` };
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'FUNDAMENTALS_UNPARSEABLE' };
  }
  if (!body || typeof body.metrics !== 'object' || typeof body.technicals !== 'object' || !body.metrics || !body.technicals) {
    return { ok: false, reason: 'FUNDAMENTALS_UNPARSEABLE' };
  }
  const issues = [body.priceIssue, body.benchmarkIssue, body.calendarIssue, body.benchmarkCalendarIssue]
    .filter((x): x is string => typeof x === 'string' && x !== '');
  if (typeof body.coverage === 'string' && body.coverage !== 'COVERED') issues.push(`SEC_${body.coverage}`);
  return { ok: true, metrics: body.metrics as MetricSetLike, technicals: body.technicals as MetricSetLike, issues };
}

export async function qvFetchMarketMetrics(symbols: string[]): Promise<Record<string, QvMarketMetricsSource>> {
  const path = `/market-metrics?symbols=${symbols.map(encodeURIComponent).join(',')}`;
  const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const out: Record<string, QvMarketMetricsSource> = {};
  if (res.status !== 200) {
    symbols.forEach((s) => { out[s] = { ok: false, reason: `MARKET_METRICS_HTTP_${res.status}` }; });
    return out;
  }
  const body = (await res.json().catch(() => null)) as { data?: { items?: Record<string, unknown>[] } } | null;
  (body?.data?.items ?? []).forEach((item) => {
    const sym = typeof item.symbol === 'string' ? item.symbol.toUpperCase() : null;
    if (sym && symbols.indexOf(sym) >= 0) out[sym] = { ok: true, item };
  });
  return out;
}

export const QV_UNIVERSE_BROWSER_DEPS = {
  fetchFundamentals: qvFetchFundamentals,
  fetchMarketMetrics: qvFetchMarketMetrics,
  now: () => new Date().toISOString(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
