// lib/tastytrade/client.ts
//
// TC-0001 corrective round: relocated verbatim from app/portfolio/page.tsx
// (mechanical move only -- no logic changes) so a shared portfolio-data
// acquisition module and app/portfolio/page.tsx can both call the exact same
// TastyTrade auth/fetch primitives without duplicating them. This module
// intentionally contains only read-oriented, foundational HTTP plumbing --
// it has no knowledge of orders, safety gates, or submission. Order
// submission (ttPost/ttDelete/ttPostComplex/ttValidateOrder/cancelOrder) and
// every ES-0001/ES-0002 safety-gated call site remain entirely in
// app/portfolio/page.tsx, untouched by this move.
//
// See docs/design/TC-0001-Trade-Command-Center.md's Corrective Round
// Addendum and docs/reviews/TC-0001-Implementation-Report.md for the full
// symbol-by-symbol relocation audit.
//
// SILENT-REAUTH FIX (this revision): TastyTrade's /oauth/token endpoint
// rejects both (a) direct browser fetch calls, via CORS, and (b)
// server-to-server calls from Vercel's serverless IP range, via a 401
// returned before the request reaches TastyTrade's real auth layer
// (confirmed by manual testing). The only path TastyTrade supports for a
// deployment like this is a real browser navigation through their
// /oauth/authorize page. Since the user has already granted this app
// access, that redirect auto-approves and bounces straight back via
// /api/callback -> /auth/complete in well under a second, so it reads as
// "silent" even though it is technically a full navigation. getAccessToken()
// now triggers that redirect instead of POSTing to /oauth/token directly.

export const BASE = 'https://api.tastytrade.com';

export const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

function redirectToSilentReauth(): never {
  const returnTo = typeof window !== 'undefined'
    ? window.location.pathname + window.location.search
    : '/portfolio';
  if (typeof window !== 'undefined') {
    window.location.href = `/api/tastytrade/authorize?return_to=${encodeURIComponent(returnTo)}`;
  }
  throw new Error('Redirecting to re-authenticate with TastyTrade');
}

// ── Auth & API ─────────────────────────────────────────────────────────────
export async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;

  const refreshToken = localStorage.getItem('tt_refresh_token');
  if (!refreshToken) {
    redirectToSilentReauth();
  }

  // Access token missing/expired and there is no supported way to refresh
  // it from here (see note above) -- send the browser through TastyTrade's
  // own re-authorization redirect instead of calling /oauth/token directly.
  redirectToSilentReauth();
}

export async function ttFetch(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) {
    sessionStorage.removeItem('tt_access_token');
    redirectToSilentReauth();
  }
  if (!res.ok) { const text = await res.text(); throw new Error(`${path} failed (${res.status}): ${text.slice(0, 120)}`); }
  return res.json();
}
