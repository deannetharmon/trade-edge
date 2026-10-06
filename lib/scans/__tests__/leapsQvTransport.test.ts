// lib/scans/__tests__/leapsQvTransport.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest';
import { leapsQvProxyGet } from '../leapsQvTransport';

afterEach(() => { vi.unstubAllGlobals(); });

describe('LEAPS-QV-0001 Gate 4c: browser transport', () => {
  it('reads through the same-origin proxy and returns the provider status and body as-is', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 429, json: async () => ({ error: 'slow down' }) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await leapsQvProxyGet('/market-data/by-type?equity-option=UBER  271217C00045000');
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tastytrade/proxy?path=${encodeURIComponent('/market-data/by-type?equity-option=UBER  271217C00045000')}`);
    expect(r).toEqual({ status: 429, body: { error: 'slow down' } });
  });

  it('a non-JSON body is null, never a guessed value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 502, json: async () => { throw new Error('bad json'); } }));
    expect(await leapsQvProxyGet('/option-chains/UBER/nested')).toEqual({ status: 502, body: null });
  });
});
