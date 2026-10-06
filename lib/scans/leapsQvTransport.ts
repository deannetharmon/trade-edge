// lib/scans/leapsQvTransport.ts

// LEAPS-QV-0001 Gate 4c -- browser binding for the QV LEAPS orchestrator (lib/discovery/leaps/orchestrate.ts).
// Reads go through the app's same-origin TastyTrade proxy (credentials stay server-side; the proxy already retries a
// revoked token once, so a 401 reaching here means the session is really gone and the run stops). The provider's
// HTTP status is returned as-is so the acquisition layer can apply its 401 / 429 / budget rules. Find LEAPS never
// imports this file (guarded by test).

export interface LeapsQvProviderResponse {
  status: number;
  body: unknown;
}

export async function leapsQvProxyGet(path: string): Promise<LeapsQvProviderResponse> {
  const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export function leapsQvSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function leapsQvNow(): string {
  return new Date().toISOString();
}

/** The injected dependencies the orchestrator needs, bound to the browser. */
export const LEAPS_QV_BROWSER_DEPS = { get: leapsQvProxyGet, sleep: leapsQvSleep, now: leapsQvNow };
