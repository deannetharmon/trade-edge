// lib/auth/tokenRetry.ts
//
// TOKEN-0001: a TastyTrade access token can be rejected ("This token is invalid or has expired") even though the local expiry
// check passed (another tab refreshed it, clock skew, the broker ended the session early). The cached token is then thrown away,
// a fresh one is fetched, and a DRY RUN is sent once more. A dry run places nothing, so one retry is safe. A rejected LIVE order is
// never resent here: the cache is cleared so the next attempt starts on a fresh token, and the trader places again.

import { LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY } from './tastytradeToken';

/** True for a broker response that says the token itself was refused (HTTP 401, or its wording). */
export function isTokenRejection(status: number | null | undefined, message: unknown): boolean {
  if (status === 401) return true;
  return typeof message === 'string' && /token (is )?(invalid|expired)|invalid or (has )?expired|session (has )?expired/i.test(message);
}

/** Throws away every cached access token so the next getAccessToken() fetches a fresh one. */
export function invalidateAccessToken(): void {
  try { sessionStorage.removeItem('tt_access_token'); } catch {}
  try { localStorage.removeItem(LS_ACCESS_TOKEN); localStorage.removeItem(LS_ACCESS_TOKEN_EXPIRY); } catch {}
}

export interface TokenRetryDeps {
  getToken: () => Promise<string>;
  invalidate?: () => void;
}

export interface TokenRetryResult<T> {
  response: T;
  /** True when the first token was refused and the request was sent again on a fresh one. */
  refreshed: boolean;
}

/**
 * Sends a request; if the broker refuses the token, fetches a new one and sends it once more. `send` returns the response and
 * whether the broker refused the token. A second refusal is returned as it is (no loop). Use for dry runs only.
 */
export async function sendWithTokenRetry<T>(
  send: (token: string) => Promise<{ response: T; tokenRejected: boolean }>,
  deps: TokenRetryDeps,
): Promise<TokenRetryResult<T>> {
  const first = await send(await deps.getToken());
  if (!first.tokenRejected) return { response: first.response, refreshed: false };
  (deps.invalidate ?? invalidateAccessToken)();
  const second = await send(await deps.getToken());
  return { response: second.response, refreshed: true };
}
