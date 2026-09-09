// app/api/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';

const BASE = 'https://api.tastyworks.com';
const CLIENT_ID = process.env.TASTYTRADE_CLIENT_ID ?? '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
const REDIRECT_URI = 'https://options-screener-dun.vercel.app/api/callback';
const redis = new Redis(process.env.REDIS_URL!);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');
  const state = searchParams.get('state');

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDesc ?? error)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=No+authorization+code+received', req.url));
  }

  if (!state || state !== req.cookies.get('tt_oauth_state')?.value) {
    return NextResponse.redirect(new URL('/login?error=Invalid+OAuth+state.+Please+try+again.', req.url));
  }

  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
  if (!clientSecret) {
    return NextResponse.redirect(new URL('/login?error=Tastytrade+OAuth+is+not+configured.', req.url));
  }

  try {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(msg)}`, req.url)
      );
    }

    if (!data.access_token || !data.refresh_token) {
      return NextResponse.redirect(
        new URL('/login?error=Incomplete+token+response+from+TastyTrade', req.url)
      );
    }

    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.redirect(new URL('/login?error=Please+sign+in+to+TradeEdge+before+connecting+Tastytrade.', req.url));
    }

    // Persist the broker refresh token against the already signed-in TradeEdge
    // user, so future Reconnect clicks only refresh server-side credentials.
    await redis.hset(`user:${userId}:tastytrade`, {
      refresh_token: encrypt(data.refresh_token),
      client_secret: encrypt(clientSecret),
    });

    // Pass the short-lived access token to the client via a redirect to /auth/complete.
    // We can't write to localStorage from a server route, so we pass via
    // a short-lived cookie and let the client page pick them up.
    const response = NextResponse.redirect(new URL('/auth/complete', req.url));

    const cookieOpts = {
      httpOnly: false, // must be readable by client JS
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60, // 60 seconds — just long enough to complete the redirect
    };

    response.cookies.set('tt_access_token_temp', data.access_token, cookieOpts);
    response.cookies.set('tt_oauth_state', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });

    return response;
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(e.message ?? 'Token exchange failed')}`, req.url)
    );
  }
}
