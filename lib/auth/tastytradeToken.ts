// lib/auth/tastytradeToken.ts
// AUTH-TOKEN-CONSOLIDATION-0001 -- the single, correct getAccessToken
// implementation. Previously duplicated across nine files (this exact
// logic lived in lib/scans/tastytrade-client.ts, a scans-specific module
// that had no business owning shared auth logic -- Alan's call to give it
// a real, dedicated home instead).
//
// If you need a TastyTrade access token, import getAccessToken from here.
// Do not write a new local copy -- that duplication is exactly how five
// of the previous nine copies ended up missing the real token-expiry
// check TT-TOKEN-EXPIRY-FIX-0001 already fixed once, in only one place.

export const LS_ACCESS_TOKEN = 'tt_access_token_cache';
export const LS_ACCESS_TOKEN_EXPIRY = 'tt_access_token_expiry';

import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';

export async function getAccessToken(): Promise<string> {
  // Check both caches against the broker's real expiry. A sessionStorage
  // token must not bypass this check: it otherwise survives past TT's
  // ~15-minute lifetime and causes order validation to fail with 401.
  const sessionCached = sessionStorage.getItem('tt_access_token');
  let expiry: string | null = null;
  try { expiry = localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY); } catch {}
  if (sessionCached && expiry && Date.now() < parseInt(expiry, 10)) return sessionCached;
  if (sessionCached) sessionStorage.removeItem('tt_access_token');

  // Check localStorage cache — survives rebuilds/page reloads
  // TT-TOKEN-EXPIRY-FIX-0001: was hardcoded to a fake 23h window, but
  // TastyTrade access tokens actually expire in ~15min. That mismatch let
  // the browser keep serving a dead token, causing "invalid or expired"
  // errors on order placement. Expiry is now the real TastyTrade
  // expires_in value (stored below), with a 60s safety buffer already
  // baked into the stored timestamp.
  try {
    const lsCached = localStorage.getItem(LS_ACCESS_TOKEN);
    expiry = localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY);
    if (lsCached && expiry && Date.now() < parseInt(expiry)) {
      sessionStorage.setItem('tt_access_token', lsCached);
      return lsCached;
    }
  } catch {}

  // Use refresh token to get a new access token
  let token: string;
  let expiresIn: number;
  try {
    const result = await refreshBrowserAccessToken();
    token = result.accessToken;
    expiresIn = result.expiresIn;
  } catch {
    sessionStorage.removeItem('tt_access_token');
    try { localStorage.removeItem(LS_ACCESS_TOKEN); localStorage.removeItem(LS_ACCESS_TOKEN_EXPIRY); } catch {}
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Session expired');
  }

  // Store in both sessionStorage and localStorage — real expiry minus a
  // 60s safety buffer, not the old fake 23h window.
  sessionStorage.setItem('tt_access_token', token);
  try {
    localStorage.setItem(LS_ACCESS_TOKEN, token);
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() + Math.max(60, expiresIn - 60) * 1000));
  } catch {}

  return token;
}
