// app/api/chart/route.ts
//
// Proxy for Yahoo Finance daily OHLCV data (6 months).
// Called client-side as: GET /api/chart?symbol=AAPL
// Runs server-side so CORS is not an issue. No API key required (Yahoo is free and unofficial).
//
// DATA-CACHE-0001: now requires a signed-in session (it was an open proxy) and caches a good response for 5 minutes in the shared
// cache. Errors and empty results are never cached. Response shapes and error messages are unchanged.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { cachedJson, UpstreamError } from '@/lib/cache/sharedCache';

// Not exported: Next.js route files may only export route handlers and config fields.
const CHART_CACHE_TTL_SECONDS = 300;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'symbol param required' }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`;

  try {
    const body = await cachedJson<{ bars: { t: number; o: number; h: number; l: number; c: number }[] }>(
      `chart:6mo:${symbol.toUpperCase()}`,
      CHART_CACHE_TTL_SECONDS,
      async () => {
        const res = await fetch(url, {
          headers: {
            // Yahoo requires a browser-like User-Agent or it returns 401/429
            'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)',
            'Accept': 'application/json',
          },
          // Next.js: don't use its data cache; freshness is handled by the shared cache TTL above
          cache: 'no-store',
        });

        if (!res.ok) throw new UpstreamError(res.status, `Yahoo Finance returned ${res.status}`);

        const data = await res.json();

        // Parse Yahoo's response into flat OHLCV arrays matching our bar format
        const result = data?.chart?.result?.[0];
        if (!result) throw new UpstreamError(404, 'No data returned');

        const timestamps: number[]    = result.timestamp ?? [];
        const quote                   = result.indicators?.quote?.[0] ?? {};
        const opens:  (number|null)[] = quote.open   ?? [];
        const highs:  (number|null)[] = quote.high   ?? [];
        const lows:   (number|null)[] = quote.low    ?? [];
        const closes: (number|null)[] = quote.close  ?? [];

        // Filter out any bars where any OHLC value is null (Yahoo sometimes returns nulls
        // for weekends/holidays that slipped through)
        const bars: { t: number; o: number; h: number; l: number; c: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
          if (o != null && h != null && l != null && c != null) {
            bars.push({ t: timestamps[i], o, h, l, c });
          }
        }
        return { value: { bars }, cacheable: bars.length > 0 };
      },
    );
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error fetching chart data' },
      { status: 500 }
    );
  }
}
