// @vitest-environment jsdom
// lib/auth/__tests__/tokenRetry.test.ts
// TOKEN-0001: a refused token is replaced and a dry run is sent once more; nothing else is retried.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateAccessToken, isTokenRejection, sendWithTokenRetry } from '../tokenRetry';
import { LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY } from '../tastytradeToken';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe('isTokenRejection', () => {
  it('recognises a 401 and the broker wording from the reported error', () => {
    expect(isTokenRejection(401, '')).toBe(true);
    expect(isTokenRejection(400, 'This token is invalid or has expired')).toBe(true);
    expect(isTokenRejection(400, 'Session expired')).toBe(true);
  });
  it('does not mistake a price rejection or an unreadable message for a token problem', () => {
    expect(isTokenRejection(422, 'Price must be in increments of $0.05 for this order.')).toBe(false);
    expect(isTokenRejection(500, 'Insufficient buying power')).toBe(false);
    expect(isTokenRejection(undefined, undefined)).toBe(false);
  });
});

describe('invalidateAccessToken', () => {
  it('clears the session and local caches', () => {
    sessionStorage.setItem('tt_access_token', 'a');
    localStorage.setItem(LS_ACCESS_TOKEN, 'a');
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, '9999999999999');
    invalidateAccessToken();
    expect(sessionStorage.getItem('tt_access_token')).toBeNull();
    expect(localStorage.getItem(LS_ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY)).toBeNull();
  });
});

describe('sendWithTokenRetry', () => {
  const tokens = () => { let n = 0; return vi.fn(async () => `token-${++n}`); };

  it('sends once when the token is accepted', async () => {
    const send = vi.fn(async () => ({ response: 'ok', tokenRejected: false }));
    const getToken = tokens();
    const result = await sendWithTokenRetry(send, { getToken, invalidate: vi.fn() });
    expect(result).toEqual({ response: 'ok', refreshed: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a refused token is invalidated, replaced, and the request sent once more on the new token', async () => {
    const seen: string[] = [];
    const send = vi.fn(async (token: string) => { seen.push(token); return { response: token, tokenRejected: token === 'token-1' }; });
    const invalidate = vi.fn();
    const result = await sendWithTokenRetry(send, { getToken: tokens(), invalidate });
    expect(seen).toEqual(['token-1', 'token-2']);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ response: 'token-2', refreshed: true });
  });

  it('a second refusal is returned, never a third attempt', async () => {
    const send = vi.fn(async () => ({ response: 'refused', tokenRejected: true }));
    const result = await sendWithTokenRetry(send, { getToken: tokens(), invalidate: vi.fn() });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ response: 'refused', refreshed: true });
  });

  it('a failure to get a fresh token (session really expired) is not swallowed', async () => {
    const send = vi.fn(async () => ({ response: 'x', tokenRejected: true }));
    let calls = 0;
    const getToken = vi.fn(async () => { if (++calls === 2) throw new Error('Session expired'); return 'token-1'; });
    await expect(sendWithTokenRetry(send, { getToken, invalidate: vi.fn() })).rejects.toThrow('Session expired');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
