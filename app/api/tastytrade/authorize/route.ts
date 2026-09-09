// app/api/tastytrade/authorize/route.ts
//
// Browser re-authorization entry point. The broker authorization page is
// hosted on my.tastytrade.com; api.tastyworks.com is the API host and does
// not accept browser authorization requests.
//
// Flow:
//   expired token in browser -> window.location.href = '/api/tastytrade/authorize?return_to=<path>'
//   -> redirect to TastyTrade /oauth/authorize
//   -> TastyTrade auto-approves, redirects to /api/callback?code=...
//   -> /api/callback exchanges code for tokens, sets temp cookies, redirects to /auth/complete
//   -> /auth/complete moves cookies into localStorage and returns to return_to

import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = process.env.TASTYTRADE_CLIENT_ID ?? '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
const REDIRECT_URI = 'https://options-screener-dun.vercel.app/api/callback';
const AUTHORIZE_URL = 'https://my.tastytrade.com/auth.html';

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('return_to') ?? '/portfolio';
  const state = crypto.randomUUID();

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', 'read trade openid');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  const stateCookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 300,
  };
  // /auth/complete reads this one client-side after the OAuth callback.
  // It carries only an internal route, never a credential or OAuth secret.
  response.cookies.set('tt_return_to_temp', returnTo, { ...stateCookieOpts, httpOnly: false });
  response.cookies.set('tt_oauth_state', state, stateCookieOpts);

  return response;
}
