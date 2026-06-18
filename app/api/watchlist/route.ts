// app/api/watchlist/route.ts

import Redis from 'ioredis';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export interface WatchlistTicker {
  symbol: string;
  classification?: 'index' | 'etf' | 'stock';
  active: boolean;
}

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url);
}

// TEMPORARY — preview-only auth bypass for testing this route before OAuth
// redirect URIs are configured for preview deployment URLs. Only activates if
// DEBUG_AUTH_BYPASS_USER_ID is set (should only ever be set on Preview env in
// Vercel, never Production) AND the request sends a matching header. Remove
// once preview OAuth is sorted or this branch merges.
function getDebugBypassUserId(request: Request): string | null {
  const bypassId = process.env.DEBUG_AUTH_BYPASS_USER_ID;
  if (!bypassId) return null;
  const header = request.headers.get('x-debug-auth-bypass');
  return header === bypassId ? bypassId : null;
}

async function resolveUserId(request: Request): Promise<string | null> {
  const bypassUserId = getDebugBypassUserId(request);
  if (bypassUserId) return bypassUserId;
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.id ?? null;
}

export async function GET(request: Request) {
  let redis;
  try {
    const userId = await resolveUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    redis = getRedis();
    const raw = await redis.get(`watchlist:${userId}`);
    const tickers: WatchlistTicker[] = raw ? JSON.parse(raw) : [];
    return NextResponse.json({ tickers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}

export async function PUT(request: Request) {
  let redis;
  try {
    const userId = await resolveUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { tickers } = await request.json();
    if (!Array.isArray(tickers)) {
      return NextResponse.json({ error: 'tickers must be an array' }, { status: 400 });
    }

    const isValid = tickers.every(
      (t: any) =>
        t &&
        typeof t.symbol === 'string' &&
        typeof t.active === 'boolean'
    );
    if (!isValid) {
      return NextResponse.json({ error: 'invalid ticker shape' }, { status: 400 });
    }

    // Classification is intentionally never persisted — it's index/etf/stock
    // type derived live from TastyTrade on every load, never trusted from
    // storage. Stripping it here means a stale value can't exist in Redis
    // even if a client sends one.
    const toStore = tickers.map((t: any) => ({ symbol: t.symbol, active: t.active }));

    redis = getRedis();
    await redis.set(`watchlist:${userId}`, JSON.stringify(toStore));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}
