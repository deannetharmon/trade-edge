// app/api/chart-history/route.ts
//
// WHEEL-SYSTEM-0003 Slice B -- a separate, longer-range daily-close route for the own-history check.
// Deliberately NOT a change to /api/chart (6-month range, ten existing callers) --
// that route is untouched by this slice. This route requires a signed-in session (Ian's ruling, decision 4:
// approved). DATA-CACHE-0001 later gave /api/chart the same session check (it had been the open pre-existing gap).
//
// DATA-CACHE-0001: a good response is cached for 15 minutes in the shared cache. Short on purpose: the trailing close of a
// session still in progress would otherwise sit unchanged for hours. Errors and empty results are never cached.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { cachedJson, UpstreamError } from '@/lib/cache/sharedCache';

const MIN_YEARS = 1;
const MAX_YEARS = 10;
const DEFAULT_YEARS = 5;
const HISTORY_CACHE_TTL_SECONDS = 900;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'symbol param required' }, { status: 400 });

  const yearsParam = req.nextUrl.searchParams.get('years');
  const years = yearsParam == null ? DEFAULT_YEARS : (/^\d+$/.test(yearsParam) ? Number.parseInt(yearsParam, 10) : NaN);
  if (!Number.isInteger(years) || years < MIN_YEARS || years > MAX_YEARS) {
    return NextResponse.json({ error: `years must be a whole number between ${MIN_YEARS} and ${MAX_YEARS}` }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${years}y`;

  try {
    const body = await cachedJson<{ closes: { t: number; c: number }[] }>(
      `chart-history:${symbol.toUpperCase()}:${years}y`,
      HISTORY_CACHE_TTL_SECONDS,
      async () => {
        const res = await fetch(url, {
          headers: {
            // Yahoo requires a browser-like User-Agent or it returns 401/429
            'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)',
            'Accept': 'application/json',
          },
          cache: 'no-store',
        });

        if (!res.ok) throw new UpstreamError(res.status, `Yahoo Finance returned ${res.status}`);

        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) throw new UpstreamError(404, 'No data returned');

        const timestamps: number[] = result.timestamp ?? [];
        // Split-adjusted, dividend-UNADJUSTED closes -- the `quote` series, never `adjclose`
        // (Alan's ruling O8 in DECIDE-0001).
        const closesRaw: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

        const closes: { t: number; c: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          const c = closesRaw[i];
          if (c != null && Number.isFinite(c)) closes.push({ t: timestamps[i], c });
        }
        return { value: { closes }, cacheable: closes.length > 0 };
      },
    );
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err?.message ?? 'Unknown error fetching chart history' }, { status: 500 });
  }
}
