import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';

const redis = new Redis(process.env.REDIS_URL!);
const API_BASE = 'https://api.tastyworks.com';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
  const order = body?.order;
  if (!accountNumber || !order || typeof order !== 'object') return NextResponse.json({ error: 'Account and order are required' }, { status: 400 });
  const credentials = await redis.hgetall(`user:${userId}:tastytrade`);
  const clientId = process.env.TASTYTRADE_CLIENT_ID;
  if (!credentials.refresh_token || !credentials.client_secret || !clientId) return NextResponse.json({ error: 'Tastytrade is not connected' }, { status: 400 });
  const tokenResponse = await fetch(`${API_BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: decrypt(credentials.refresh_token), client_id: clientId, client_secret: decrypt(credentials.client_secret) }), cache: 'no-store' });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.json({ error: 'Tastytrade token exchange failed' }, { status: 502 });
  if (tokenData.refresh_token) await redis.hset(`user:${userId}:tastytrade`, { refresh_token: encrypt(tokenData.refresh_token) });
  const response = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountNumber)}/orders/dry-run`, { method: 'POST', headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, body: JSON.stringify(order), cache: 'no-store' });
  const responseBody = await response.text();
  return new NextResponse(responseBody, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
}
