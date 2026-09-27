import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';

const redis = new Redis(process.env.REDIS_URL!);
const TOKEN_URL = 'https://api.tastyworks.com/oauth/token';

/**
 * Exchanges stored credentials without exposing them to the browser.
 *
 * AUTH-LOOP-0001 (2026-09-27): this route used to let ANY failure — a decrypt() throw on a
 * ciphertext that no longer matches ENCRYPTION_KEY, a stale/revoked refresh token TastyTrade
 * rejects, a Redis error — either crash unhandled (a raw exception from a route handler surfaces
 * to the browser as a 502) or come back as a clean-looking error that the caller nonetheless kept
 * retrying with the same bad stored credentials. Every path below is now caught, self-heals by
 * clearing the stored credentials so the NEXT load goes straight to the reconnect form instead of
 * repeating the same failure, and always returns a real JSON response — never an unhandled throw.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `user:${userId}:tastytrade`;

  try {
    const credentials = await redis.hgetall(key);
    if (!credentials.refresh_token || !credentials.client_secret) {
      return NextResponse.json({ error: 'Tastytrade credentials are not connected', reconnect: true }, { status: 400 });
    }

    const clientId = process.env.TASTYTRADE_CLIENT_ID;
    if (!clientId) return NextResponse.json({ error: 'Tastytrade client ID is not configured' }, { status: 500 });

    let refreshToken: string;
    let clientSecret: string;
    try {
      refreshToken = decrypt(credentials.refresh_token);
      clientSecret = decrypt(credentials.client_secret);
    } catch {
      // The stored ciphertext no longer decrypts (wrong ENCRYPTION_KEY, or corrupted data). It can
      // never succeed on retry, so clear it now rather than fail this same way on every load.
      await redis.del(key);
      return NextResponse.json({ error: 'Stored Tastytrade credentials could not be read and were cleared. Please reconnect.', reconnect: true }, { status: 400 });
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Tastytrade requires a product/version User-Agent for API requests.
        'User-Agent': 'trade-edge/1.0',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
    });

    const body = await response.text();
    let data: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try { data = JSON.parse(body); } catch { /* handled below */ }
    if (!response.ok || !data.access_token) {
      const detail = data.error_description ?? data.error ?? body.slice(0, 300) ?? 'Unknown error';
      // A revoked/stale refresh token can never succeed on retry either — clear it so the next
      // load asks to reconnect instead of repeating this same rejection.
      if (response.status === 400 || response.status === 401) await redis.del(key);
      return NextResponse.json(
        { error: `Tastytrade token exchange failed (${response.status}): ${detail}`, reconnect: response.status === 400 || response.status === 401 },
        { status: response.status === 401 ? 401 : 502 },
      );
    }

    if (data.refresh_token) await redis.hset(key, { refresh_token: encrypt(data.refresh_token) });
    // TT-TOKEN-EXPIRY-FIX-0001 — pass through TastyTrade's real expires_in
    // (typically 900s / 15min) so the browser cache stops guessing 23h.
    // Fall back to 900 if TastyTrade omits it for some reason.
    return NextResponse.json(
      { accessToken: data.access_token, expiresIn: data.expires_in ?? 900 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: unknown) {
    // Last resort: something unexpected (Redis unreachable, etc.) threw. Never let it escape as an
    // unhandled 502 — always answer with real JSON so the caller can show a real message.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Tastytrade connection failed unexpectedly' }, { status: 500 });
  }
}
