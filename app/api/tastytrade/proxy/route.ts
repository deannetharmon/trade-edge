import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';

const redis = new Redis(process.env.REDIS_URL!);
const API_BASE = 'https://api.tastyworks.com';
const allowed = ['/customers/', '/accounts/', '/market-', '/instruments/', '/option-', '/transactions'];
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 60_000;
const ACCESS_TOKEN_FALLBACK_TTL_SECONDS = 900;
const TOKEN_REFRESH_LOCK_TTL_MS = 15_000;
const refreshInFlight = new Map<string, Promise<string>>();

function cachedAccessToken(credentials: Record<string, string>): string | null {
  const expiresAt = Number(credentials.access_token_expires_at);
  if (!credentials.access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + ACCESS_TOKEN_SAFETY_WINDOW_MS) return null;
  try { return decrypt(credentials.access_token); } catch { return null; }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function refreshBrokerAccessToken(userId: string): Promise<string> {
  const credentialKey = `user:${userId}:tastytrade`;
  const lockKey = `${credentialKey}:access-token-refresh-lock`;
  const lockValue = crypto.randomUUID();
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const credentials = await redis.hgetall(credentialKey);
    const cached = cachedAccessToken(credentials);
    if (cached) return cached;

    const acquired = await redis.set(lockKey, lockValue, 'PX', TOKEN_REFRESH_LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      await delay(200);
      continue;
    }
    try {
      // Another request may have refreshed between the first cache check and
      // acquiring the distributed lock. Always re-read before rotating a
      // refresh token.
      const current = await redis.hgetall(credentialKey);
      const currentCached = cachedAccessToken(current);
      if (currentCached) return currentCached;
      const clientId = process.env.TASTYTRADE_CLIENT_ID;
      if (!current.refresh_token || !current.client_secret || !clientId) throw new Error('Tastytrade is not connected');
      const tokenResponse = await fetch(`${API_BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: decrypt(current.refresh_token), client_id: clientId, client_secret: decrypt(current.client_secret) }),
        cache: 'no-store',
      });
      const tokenData = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Tastytrade token exchange failed');
      const ttlSeconds = Number.isFinite(Number(tokenData.expires_in)) ? Number(tokenData.expires_in) : ACCESS_TOKEN_FALLBACK_TTL_SECONDS;
      const expiresAt = Date.now() + Math.max(60, ttlSeconds - 60) * 1000;
      await redis.hset(credentialKey, {
        access_token: encrypt(tokenData.access_token),
        access_token_expires_at: String(expiresAt),
        ...(tokenData.refresh_token ? { refresh_token: encrypt(tokenData.refresh_token) } : {}),
      });
      return tokenData.access_token;
    } finally {
      // Only remove a lock we still own; a timed-out lock may have been
      // replaced by another request while an upstream call was slow.
      if (await redis.get(lockKey) === lockValue) await redis.del(lockKey);
    }
  }
  throw new Error('Timed out waiting for Tastytrade access-token refresh');
}

async function getBrokerAccessToken(userId: string): Promise<string> {
  const credentials = await redis.hgetall(`user:${userId}:tastytrade`);
  const cached = cachedAccessToken(credentials);
  if (cached) return cached;
  const active = refreshInFlight.get(userId);
  if (active) return active;
  const refreshing = refreshBrokerAccessToken(userId).finally(() => refreshInFlight.delete(userId));
  refreshInFlight.set(userId, refreshing);
  return refreshing;
}

/** Same-origin read proxy: keeps broker calls out of the browser, avoiding CORS. */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith('/') || !allowed.some(prefix => path.startsWith(prefix))) {
    return NextResponse.json({ error: 'Unsupported broker path' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let accessToken: string;
  try { accessToken = await getBrokerAccessToken(userId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Tastytrade token exchange failed' }, { status: 502 }); }

  const brokerRead = (token: string) => fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
    cache: 'no-store',
  });
  let response = await brokerRead(accessToken);
  // A revoked/early-expired token is safe to recover from once. Delete only
  // the access-token cache, preserving the encrypted refresh credential.
  if (response.status === 401) {
    await redis.hdel(`user:${userId}:tastytrade`, 'access_token', 'access_token_expires_at');
    try { response = await brokerRead(await getBrokerAccessToken(userId)); } catch { /* return original 401 below */ }
  }
  const body = await response.text();
  return new NextResponse(body, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
}
