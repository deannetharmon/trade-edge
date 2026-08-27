// app/api/tastytrade/authorize/route.ts
//
// Silent re-auth entry point. When a browser-side access token has expired
// and there is no working way to refresh it (TastyTrade blocks CORS fetches
// to /oauth/token from the browser, and blocks server-to-server calls from
// Vercel's IP range -- confirmed via manual testing), the only supported
// path is a real browser navigation through TastyTrade's own /oauth/authorize
// page. Since the user has already granted this app access, TastyTrade
// auto-approves and redirects straight back to /api/callback without
// showing a login/consent screen -- so from the user's perspective this is
// a near-instant redirect out and back, not a manual re-login.
//
// Flow:
//   expired token in browser -> window.location.href = '/api/tastytrade/authorize?return_to=<path>'
//   -> redirect to TastyTrade /oauth/authorize
//   -> TastyTrade auto-approves, redirects to /api/callback?code=...
//   -> /api/callback exchanges code for tokens, sets temp cookies, redirects to /auth/complete
//   -> /auth/complete moves cookies into localStorage and returns to return_to

import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
const REDIRECT_URI = 'https://options-screener-dun.vercel.app/api/callback';
const AUTHORIZE_URL = 'https://api.tastytrade.com/oauth/authorize';

export async function GET(req: NextRequest) {
  const clientSecret = process.env.NEXT_PUBLIC_TASTYTRADE_CLIENT_SECRET;
  if (!clientSecret) {
    return NextResponse.json(
      { error: 'Server missing NEXT_PUBLIC_TASTYTRADE_CLIENT_SECRET' },
      { status: 500 }
    );
  }

  const returnTo = req.nextUrl.searchParams.get('return_to') ?? '/portfolio';

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', 'read trade openid');

  const response = NextResponse.redirect(authorizeUrl.toString());

  // Stash the client secret (needed by /api/callback) and the page the user
  // was on (so /auth/complete can send them back to it) in short-lived
  // cookies -- same pattern the existing /login flow already uses.
  const cookieOpts = {
    httpOnly: false,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 120,
  };
  response.cookies.set('tt_client_secret_temp', clientSecret, cookieOpts);
  response.cookies.set('tt_return_to_temp', returnTo, cookieOpts);

  return response;
}
