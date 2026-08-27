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
import { refreshBrowserAccessToken } from './browser-token';

export const BASE = 'https://api.tastytrade.com';

export const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

// ── Auth & API ─────────────────────────────────────────────────────────────
export async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;
  const token = await refreshBrowserAccessToken();
  sessionStorage.setItem('tt_access_token', token);
  return token;
}

export async function ttFetch(path: string, token: string) {
  void token; // Credentials are held by the signed-in user's server-side record.
  const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) {
    sessionStorage.removeItem('tt_access_token');
    throw new Error('Session expired');
  }
  if (!res.ok) { const text = await res.text(); throw new Error(`${path} failed (${res.status}): ${text.slice(0, 120)}`); }
  return res.json();
}
