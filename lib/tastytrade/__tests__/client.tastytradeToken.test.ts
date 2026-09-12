// @vitest-environment jsdom
// AUTH-TOKEN-CONSOLIDATION-0001 -- confirms lib/tastytrade/client.ts's
// re-exported getAccessToken is genuinely the shared implementation
// (expiry-aware, redirects on failure), not silently still using its own
// old, unfixed logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tastytrade/browser-token', () => ({
  refreshBrowserAccessToken: vi.fn(),
}));

import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';
import { getAccessToken, LS_ACCESS_TOKEN_EXPIRY } from '../client';

describe('lib/tastytrade/client.ts re-exported getAccessToken', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    delete (window as any).location;
    (window as any).location = { href: '' };
  });

  it('expiry path: an expired cached token forces a real refresh (the exact bug this file used to have)', async () => {
    sessionStorage.setItem('tt_access_token', 'stale-token');
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() - 1000));
    (refreshBrowserAccessToken as any).mockResolvedValue({ accessToken: 'fresh', expiresIn: 900 });

    const token = await getAccessToken();
    expect(token).toBe('fresh');
    expect(refreshBrowserAccessToken).toHaveBeenCalledTimes(1);
  });

  it('failure path: redirects to /login (this file used to have no fallback at all)', async () => {
    (refreshBrowserAccessToken as any).mockRejectedValue(new Error('refresh failed'));
    await expect(getAccessToken()).rejects.toThrow('Session expired');
    expect(window.location.href).toBe('/login');
  });
});
