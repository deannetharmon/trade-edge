// app/api/alphavantage-debug/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { fetchAlphaVantageBundle, type AlphaVantageBundle } from '@/lib/fundamentals/alphaVantageClient';

// FUNDAMENTALS-0002 pivot: Alpha Vantage's free tier is 25 requests/day
// total (confirmed real, current, and far tighter than FMP's 250/day) --
// a symbol looked up here costs 4 of those 25. Caching is even more
// important than it was for the FMP route: a 7-day TTL instead of FMP's
// 36-hour one, since burning through a quarter of the entire daily budget
// on a repeat lookup of the same symbol the same week would be wasteful
// for data that doesn't change that often anyway.
const redis = new Redis(process.env.REDIS_URL!);
const cacheKey = (symbol: string) => `alphavantage-debug:${symbol.toUpperCase()}`;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 });

  // FIX: a real bug found live -- the route used to always cache whatever
  // fetchAlphaVantageBundle returned, including a bundle where every field
  // failed with "ALPHA_VANTAGE_API_KEY is not configured" (a setup
  // problem, not real API data). That got stuck in the cache for the full
  // 7-day TTL, so once the key was actually added, lookups kept silently
  // replaying the pre-key failure instead of ever reaching Alpha Vantage.
  // Checking for the missing key upfront avoids caching a configuration
  // error as if it were a real, symbol-specific API response.
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    return NextResponse.json({ error: 'ALPHA_VANTAGE_API_KEY is not configured' }, { status: 500 });
  }

  const key = cacheKey(symbol);
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

  if (forceRefresh) {
    try { await redis.del(key); } catch {}
  }

  try {
    if (!forceRefresh) {
      const cached = await redis.get(key);
      if (cached) {
        const bundle: AlphaVantageBundle = JSON.parse(cached);
        return NextResponse.json({ bundle, cached: true });
      }
    }
  } catch {
    // Cache read failure falls through to a live fetch, same as the FMP
    // route -- never block on a Redis hiccup, even though a live fetch
    // here costs more (4 of 25 daily calls) than it does for FMP.
  }

  try {
    const bundle = await fetchAlphaVantageBundle(symbol);
    try { await redis.set(key, JSON.stringify(bundle), 'EX', 60 * 60 * 24 * 7); } catch {}
    return NextResponse.json({ bundle, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to fetch from Alpha Vantage' }, { status: 502 });
  }
}
