// app/api/fundamentals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { fetchFundamentalsBundle, type FundamentalsBundle } from '@/lib/fundamentals/fmpClient';

// FUNDAMENTALS-0001: caches once per symbol per calendar day. FMP's free
// tier is 250 calls/day and each symbol costs 3 calls (consensus + summary
// + grades) -- without caching, re-opening the app or re-running a scan on
// the same symbols the same day would burn through the budget fast. No
// user-scoping in the key: unlike position-notes/price-alerts (genuinely
// per-account), fundamentals data is the same for anyone looking up that
// symbol, so the cache is shared, not per-user.
const redis = new Redis(process.env.REDIS_URL!);
const cacheKey = (symbol: string, date: string) => `fmp-fundamentals:${symbol.toUpperCase()}:${date}`;

// Same local-date convention already used elsewhere for exactly this
// "once per calendar day" boundary (see todayLocalDateString in
// lib/portfolio-data/acquisition.ts) -- duplicated here rather than
// imported, since that module pulls in the full acquisition.ts dependency
// tree (TastyTrade client, etc.) for a two-line date helper this route has
// no other reason to depend on.
function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 });

  const today = todayLocalDateString();
  const key = cacheKey(symbol, today);

  try {
    const cached = await redis.get(key);
    if (cached) {
      const bundle: FundamentalsBundle = JSON.parse(cached);
      return NextResponse.json({ bundle, cached: true });
    }
  } catch {
    // Cache read failure falls through to a live fetch -- never blocks on
    // a Redis hiccup when the whole point is conserving FMP call budget,
    // not guaranteeing a cache hit.
  }

  try {
    const bundle = await fetchFundamentalsBundle(symbol);
    try { await redis.set(key, JSON.stringify(bundle), 'EX', 60 * 60 * 36); } catch {}
    return NextResponse.json({ bundle, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to fetch fundamentals' }, { status: 502 });
  }
}
