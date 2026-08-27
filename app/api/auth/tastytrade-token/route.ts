import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';

const redis = new Redis(process.env.REDIS_URL!);
const TOKEN_URL = 'https://api.tastytrade.com/oauth/token';

/** Exchanges stored credentials without exposing them to the browser. */
export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `user:${userId}:tastytrade`;
  const credentials = await redis.hgetall(key);
  if (!credentials.refresh_token || !credentials.client_secret) {
    return NextResponse.json({ error: 'Tastytrade credentials are not connected' }, { status: 400 });
  }

  const clientId = process.env.TASTYTRADE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Tastytrade client ID is not configured' }, { status: 500 });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decrypt(credentials.refresh_token),
      client_id: clientId,
      client_secret: decrypt(credentials.client_secret),
    }),
    cache: 'no-store',
  });

  const body = await response.text();
  let data: { access_token?: string; refresh_token?: string; error?: string; error_description?: string } = {};
  try { data = JSON.parse(body); } catch { /* handled below */ }
  if (!response.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.error_description ?? data.error ?? 'Tastytrade token exchange failed' },
      { status: response.status === 401 ? 401 : 502 },
    );
  }

  if (data.refresh_token) await redis.hset(key, { refresh_token: encrypt(data.refresh_token) });
  return NextResponse.json({ accessToken: data.access_token }, { headers: { 'Cache-Control': 'no-store' } });
}
