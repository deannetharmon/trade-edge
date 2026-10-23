// app/api/market/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { cachedJson, UpstreamError } from '@/lib/cache/sharedCache';

// Proxy for Yahoo Finance market data — VIX, ES=F, SPX, VIX3M, etc.
// Called client-side as: GET /api/market?symbol=^VIX&range=2d&interval=1d
// Runs server-side so CORS is not an issue.
// Returns raw Yahoo Finance chart JSON so callers can extract whatever fields they need.
//
// DATA-CACHE-0001: requires a signed-in session (it was an open proxy) and caches a good response for 60 seconds in the shared cache.
// Errors are never cached. Response shapes and error messages are unchanged.

// Not exported: Next.js route files may only export route handlers and config fields.
const MARKET_CACHE_TTL_SECONDS = 60;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol   = req.nextUrl.searchParams.get('symbol');
  const range    = req.nextUrl.searchParams.get('range')    ?? '2d';
  const interval = req.nextUrl.searchParams.get('interval') ?? '1d';
  const includePrePost = req.nextUrl.searchParams.get('includePrePost') ?? 'false';

  if (!symbol) {
    return NextResponse.json({ error: 'symbol param required' }, { status: 400 });
  }

  // Whitelist allowed symbols to prevent abuse
  const ALLOWED_PREFIXES = ['^', 'ES', 'NQ', 'SPY', 'QQQ', 'IWM', 'GLD', 'TLT'];
  const symbolUpper = symbol.toUpperCase();
  const isAllowed = ALLOWED_PREFIXES.some(p => symbolUpper.startsWith(p));
  if (!isAllowed) {
    return NextResponse.json({ error: 'Symbol not permitted' }, { status: 403 });
  }

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', interval);
  url.searchParams.set('range', range);
  if (includePrePost === 'true') url.searchParams.set('includePrePost', 'true');

  try {
    const data = await cachedJson<unknown>(
      `market:${symbolUpper}:${range}:${interval}:${includePrePost === 'true' ? 'pp' : 'rth'}`,
      MARKET_CACHE_TTL_SECONDS,
      async () => {
        const res = await fetch(url.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)',
            'Accept': 'application/json',
          },
          cache: 'no-store',
        });

        if (!res.ok) throw new UpstreamError(res.status, `Yahoo Finance returned ${res.status}`);

        return { value: await res.json(), cacheable: true };
      },
    );
    return NextResponse.json(data);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
