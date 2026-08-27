// app/api/debug-tt-refresh-test/route.ts
//
// TEMPORARY DIAGNOSTIC ROUTE — delete after use.
// Tests whether TastyTrade's oauth/token endpoint accepts a server-to-server
// (Vercel function) refresh_token call. Takes refresh_token + client_secret
// as query params so nothing is stored anywhere.
//
// Usage:
//   https://options-screener-dun.vercel.app/api/debug-tt-refresh-test?refresh_token=XXX&client_secret=YYY
//
// Returns JSON showing whether the call succeeded, and TastyTrade's raw
// response/status if it failed, so we can tell CORS/IP-block apart from an
// invalid-token error.

import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

export async function GET(req: NextRequest) {
  const refreshToken = req.nextUrl.searchParams.get('refresh_token');
  const clientSecret = req.nextUrl.searchParams.get('client_secret');

  if (!refreshToken || !clientSecret) {
    return NextResponse.json(
      { error: 'Missing refresh_token or client_secret query param' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: clientSecret,
      }),
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave parsed null if not JSON
    }

    return NextResponse.json({
      reachedTastytrade: true,
      status: res.status,
      ok: res.ok,
      hasAccessToken: !!parsed?.access_token,
      bodyPreview: text.slice(0, 500),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        reachedTastytrade: false,
        errorName: err?.name ?? null,
        errorMessage: err?.message ?? String(err),
      },
      { status: 502 }
    );
  }
}
