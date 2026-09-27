// @vitest-environment jsdom
// AUTH-TOKEN-CONSOLIDATION-0001 -- Quinn's three-path verification,
// actually exercised via vitest+jsdom, not just inspected by eye. Run
// against every one of the eight consuming files' swap, not just once.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tastytrade/browser-token', () => ({
  refreshBrowserAccessToken: vi.fn(),
}));

import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';
import { getAccessToken, LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY } from '../tastytradeToken';

describe('getAccessToken', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    // jsdom doesn't implement navigation; stub it so the failure-path
    // assertion can check it was invoked without jsdom throwing.
    delete (window as any).location;
    (window as any).location = { href: '', pathname: '/portfolio' };
  });

  it('happy path: a fresh token fetch works and gets cached in both stores', async () => {
    (refreshBrowserAccessToken as any).mockResolvedValue({ accessToken: 'fresh-token-1', expiresIn: 900 });
    const token = await getAccessToken();
    expect(token).toBe('fresh-token-1');
    expect(sessionStorage.getItem('tt_access_token')).toBe('fresh-token-1');
    expect(localStorage.getItem(LS_ACCESS_TOKEN)).toBe('fresh-token-1');
    expect(refreshBrowserAccessToken).toHaveBeenCalledTimes(1);
  });

  it('expiry path: an expired cached token is not reused, forces a real refresh', async () => {
    // Seed a cached token that looks present but is already expired --
    // this is the exact bug TT-TOKEN-EXPIRY-FIX-0001 fixed, and the one
    // still live in five of the other eight copies.
    sessionStorage.setItem('tt_access_token', 'stale-token');
    localStorage.setItem(LS_ACCESS_TOKEN, 'stale-token');
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() - 1000)); // already expired

    (refreshBrowserAccessToken as any).mockResolvedValue({ accessToken: 'refreshed-token', expiresIn: 900 });
    const token = await getAccessToken();

    expect(token).toBe('refreshed-token');
    expect(token).not.toBe('stale-token');
    expect(refreshBrowserAccessToken).toHaveBeenCalledTimes(1);
  });

  it('expiry path: a genuinely unexpired cached token IS reused, no refresh call', async () => {
    sessionStorage.setItem('tt_access_token', 'still-good-token');
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() + 900_000)); // 15 min from now

    const token = await getAccessToken();

    expect(token).toBe('still-good-token');
    expect(refreshBrowserAccessToken).not.toHaveBeenCalled();
  });

  it('failure path: refresh throwing clears storage, redirects to /login, and re-throws', async () => {
    (refreshBrowserAccessToken as any).mockRejectedValue(new Error('refresh token invalid'));

    await expect(getAccessToken()).rejects.toThrow('Session expired');
    expect(window.location.href).toBe('/login');
    expect(sessionStorage.getItem('tt_access_token')).toBeNull();
    expect(localStorage.getItem(LS_ACCESS_TOKEN)).toBeNull();
  });

  // AUTH-LOOP-0001 (2026-09-27): this function is called unconditionally on every page, including
  // /login itself, by globally-mounted providers (ActiveBrokerAccountProvider) that resolve a broker
  // account on mount. With no guard, a failed refresh on /login redirected to /login, which remounted
  // those providers, which called this again, which redirected again: an infinite reload loop (visible
  // as a rapidly flashing browser tab favicon) with no relation to anything in app/login/page.tsx's
  // own code, and one that persisted through a private/incognito window with no stored credentials at
  // all. Regression coverage for both the loop and every other page's real redirect.
  it('on /login itself, a failure clears storage and re-throws but does NOT redirect (would self-loop)', async () => {
    (window as any).location = { href: '', pathname: '/login' };
    (refreshBrowserAccessToken as any).mockRejectedValue(new Error('refresh token invalid'));

    await expect(getAccessToken()).rejects.toThrow('Session expired');
    expect(window.location.href).toBe('');
    expect(sessionStorage.getItem('tt_access_token')).toBeNull();
    expect(localStorage.getItem(LS_ACCESS_TOKEN)).toBeNull();
  });

  it('on every other page, the redirect still fires (this is the real, intended behavior elsewhere)', async () => {
    for (const pathname of ['/portfolio', '/screener', '/dashboard', '/', '/login/', '/loginish-but-not-login']) {
      (window as any).location = { href: '', pathname };
      (refreshBrowserAccessToken as any).mockRejectedValue(new Error('refresh token invalid'));
      await expect(getAccessToken()).rejects.toThrow('Session expired');
      expect(window.location.href).toBe('/login');
    }
  });
});
