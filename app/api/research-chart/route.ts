// app/api/research-chart/route.ts
//
// RESEARCH-0001: price history for the Research page, with a selectable range (1D .. 5Y). Yahoo's chart endpoint, server-side
// (no CORS, no key). Requires a signed-in session. Good responses are cached briefly; errors and empty results never are.
// Separate from /api/chart (fixed 6 months, ten existing callers), which is untouched.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { cachedJson, UpstreamError } from '@/lib/cache/sharedCache';
import { RESEARCH_RANGES, isResearchRange, normalizeResearchSymbol, parseResearchChart, type ResearchChart, type ResearchRange } from '@/lib/research/yahooChart';

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = normalizeResearchSymbol(req.nextUrl.searchParams.get('symbol'));
  if (!symbol) return NextResponse.json({ error: 'A valid symbol is required' }, { status: 400 });
  const rangeParam = req.nextUrl.searchParams.get('range') ?? '1M';
  if (!isResearchRange(rangeParam)) return NextResponse.json({ error: 'range must be 1D, 1W, 1M, 3M, 1Y or 5Y' }, { status: 400 });
  const load = (key: ResearchRange) => {
    const spec = RESEARCH_RANGES[key];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${spec.interval}&range=${spec.range}`;
    return cachedJson<ResearchChart>(`research-chart:${key}:${symbol}`, spec.ttlSeconds, async () => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)', 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new UpstreamError(res.status === 404 ? 404 : 502, res.status === 404 ? `No data for ${symbol}` : `Yahoo Finance returned ${res.status}`);
      const parsed = parseResearchChart(await res.json(), symbol);
      if (!parsed || parsed.points.length === 0) throw new UpstreamError(404, `No data for ${symbol}`);
      return { value: parsed, cacheable: true };
    });
  };
  try {
    const body = await load(rangeParam);
    // Yahoo's "previous close" on a multi-day range is the close before the range STARTED, which made the day change and the
    // Previous close cell move with the chart range. Take it from the 1D chart instead (best effort: keep ours if that fails).
    if (rangeParam !== '1D') {
      const day = await load('1D').catch(() => null);
      const prev = day?.meta.previousClose ?? null;
      return NextResponse.json({ ...body, meta: { ...body.meta, previousClose: prev } });
    }
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err?.message ?? 'Unable to load chart data' }, { status: 500 });
  }
}
