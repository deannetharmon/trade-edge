import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';

const redis = new Redis(process.env.REDIS_URL!);
const API_BASE = 'https://api.tastytrade.com';
const allowed = ['/customers/', '/accounts/', '/market-', '/instruments/', '/option-', '/transactions'];

/** Same-origin read proxy: keeps broker calls out of the browser, avoiding CORS. */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith('/') || !allowed.some(prefix => path.startsWith(prefix))) {
    return NextResponse.json({ error: 'Unsupported broker path' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const credentials = await redis.hgetall(`user:${userId}:tastytrade`);
  const clientId = process.env.TASTYTRADE_CLIENT_ID;
  if (!credentials.refresh_token || !credentials.client_secret || !clientId) {
    return NextResponse.json({ error: 'Tastytrade is not connected' }, { status: 400 });
  }

  const tokenResponse = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(credentials.refresh_token), client_id: clientId, client_secret: decrypt(credentials.client_secret) }),
    cache: 'no-store',
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    return NextResponse.json({ error: 'Tastytrade token exchange failed' }, { status: 502 });
  }
  if (tokenData.refresh_token) await redis.hset(`user:${userId}:tastytrade`, { refresh_token: encrypt(tokenData.refresh_token) });

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
    cache: 'no-store',
  });
  const body = await response.text();
  return new NextResponse(body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
}
