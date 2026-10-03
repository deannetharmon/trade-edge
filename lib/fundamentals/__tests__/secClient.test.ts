// lib/fundamentals/__tests__/secClient.test.ts

import { describe, expect, it } from 'vitest';
import {
  DIRECTORY_TTL_MS,
  FACTS_TTL_MS,
  MIN_REQUEST_SPACING_MS,
  NEGATIVE_TTL_MS,
  SecProviderError,
  createSecClient,
  isValidUserAgent,
  padCik,
} from '../sec/client';
import { makeCompanyFacts } from '@/lib/discovery/normalized/__tests__/secFixtures';

const UA = 'TradeEdge Tests tests@example.com';

interface Call { url: string; headers: Record<string, string> }

function harness(responder: (url: string, n: number) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>, userAgent: string | null = UA) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const client = createSecClient({
    userAgent: userAgent === null ? undefined : userAgent,
    nowMs: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      await Promise.resolve(); // the clock moves only after every concurrent request has been scheduled
      clock += ms;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      const res = await responder(url, calls.length);
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
    },
  });
  return { client, calls, sleeps, advance: (ms: number) => { clock += ms; } };
}

const DIRECTORY = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' },
  '2': { cik_str: 111, ticker: 'DUP', title: 'One' },
  '3': { cik_str: 222, ticker: 'DUP', title: 'Two' },
};

describe('SEC client: compliance', () => {
  it('validates the User-Agent: needs a name and a contact email', () => {
    expect(isValidUserAgent(UA)).toBe(true);
    expect(isValidUserAgent(undefined)).toBe(false);
    expect(isValidUserAgent('')).toBe(false);
    expect(isValidUserAgent('TradeEdge')).toBe(false);
    expect(isValidUserAgent('a@b.c')).toBe(false);
  });

  it.each([[null], ['no-email-here-at-all']])('makes NO request without a valid SEC_USER_AGENT (%s)', async (ua) => {
    const h = harness(() => ({ status: 200, body: {} }), ua);
    await expect(h.client.getCompanyFacts('320193')).rejects.toMatchObject({ code: 'USER_AGENT_MISSING' });
    await expect(h.client.lookupCik('AAPL')).rejects.toBeInstanceOf(SecProviderError);
    expect(h.calls).toHaveLength(0);
    expect(h.client.stats().errors.USER_AGENT_MISSING).toBe(2);
  });

  it('sends the User-Agent and JSON accept header, and pads the CIK', async () => {
    const h = harness(() => ({ status: 200, body: makeCompanyFacts() }));
    await h.client.getCompanyFacts('320193');
    expect(h.calls[0].url).toBe('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
    expect(h.calls[0].headers['User-Agent']).toBe(UA);
    expect(padCik(5)).toBe('0000000005');
    expect(padCik('0000320193')).toBe('0000320193');
  });

  it('spaces request starts at least the minimum interval apart (under the 10/s SEC limit)', async () => {
    const h = harness(() => ({ status: 200, body: makeCompanyFacts() }));
    await Promise.all(['1', '2', '3', '4'].map((cik) => h.client.getCompanyFacts(cik)));
    expect(h.calls).toHaveLength(4);
    expect(h.sleeps).toEqual([MIN_REQUEST_SPACING_MS, MIN_REQUEST_SPACING_MS * 2, MIN_REQUEST_SPACING_MS * 3]);
    expect(MIN_REQUEST_SPACING_MS).toBeGreaterThanOrEqual(100);
    expect(h.client.stats().spacingWaits).toBe(3);
  });
});

describe('SEC client: caching', () => {
  it('serves repeat requests from cache and refetches after the TTL', async () => {
    const h = harness(() => ({ status: 200, body: makeCompanyFacts() }));
    const first = await h.client.getCompanyFacts('1');
    const second = await h.client.getCompanyFacts('1');
    expect(second).toBe(first);
    expect(h.calls).toHaveLength(1);
    expect(h.client.stats()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
    h.advance(FACTS_TTL_MS + 1);
    await h.client.getCompanyFacts('1');
    expect(h.calls).toHaveLength(2);
  });

  it('retains only compact facts (a FACTS outcome carries the concept-map version)', async () => {
    const h = harness(() => ({ status: 200, body: makeCompanyFacts() }));
    const out = await h.client.getCompanyFacts('1');
    expect(out.kind).toBe('FACTS');
    if (out.kind === 'FACTS') {
      expect(out.compact.conceptMapVersion).toBe('SECMAP-v1.1');
      expect(out.compact.facts.length).toBeGreaterThan(100);
    }
  });

  it('joins concurrent identical requests into one fetch', async () => {
    const h = harness(() => ({ status: 200, body: makeCompanyFacts() }));
    const [a, b, c] = await Promise.all([h.client.getCompanyFacts('1'), h.client.getCompanyFacts('1'), h.client.getCompanyFacts('1')]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(h.calls).toHaveLength(1);
    expect(h.client.stats().inflightJoins).toBe(2);
  });

  it('negative-caches a 404 as NOT_FOUND for a limited time', async () => {
    const h = harness(() => ({ status: 404 }));
    expect(await h.client.getCompanyFacts('9')).toEqual({ kind: 'NOT_FOUND' });
    expect(await h.client.getCompanyFacts('9')).toEqual({ kind: 'NOT_FOUND' });
    expect(h.calls).toHaveLength(1);
    h.advance(NEGATIVE_TTL_MS + 1);
    await h.client.getCompanyFacts('9');
    expect(h.calls).toHaveLength(2);
  });

  it('never caches a failure: the next call tries again', async () => {
    let n = 0;
    const h = harness(() => (++n === 1 ? { status: 503 } : { status: 200, body: makeCompanyFacts() }));
    await expect(h.client.getCompanyFacts('1')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 });
    expect((await h.client.getCompanyFacts('1')).kind).toBe('FACTS');
    expect(h.calls).toHaveLength(2);
    expect(h.client.stats().errors.HTTP_ERROR).toBe(1);
  });
});

describe('SEC client: failures are typed and visible', () => {
  it('maps 403/429 to HTTP_ERROR with the status', async () => {
    for (const status of [403, 429]) {
      const h = harness(() => ({ status }));
      await expect(h.client.getCompanyFacts('1')).rejects.toMatchObject({ code: 'HTTP_ERROR', status });
    }
  });

  it('maps a network failure and a malformed payload', async () => {
    const down = createSecClient({ userAgent: UA, sleep: async () => undefined, fetchImpl: async () => { throw new Error('boom'); } });
    await expect(down.getCompanyFacts('1')).rejects.toMatchObject({ code: 'NETWORK' });
    const bad = harness(() => ({ status: 200, body: { facts: 'nope' } }));
    await expect(bad.client.getCompanyFacts('1')).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });

  it('reports a non-US-GAAP filer as NOT_US_GAAP (coverage, not failure)', async () => {
    const h = harness(() => ({ status: 200, body: { cik: 1, facts: { 'ifrs-full': {} } } }));
    expect(await h.client.getCompanyFacts('1')).toEqual({ kind: 'NOT_US_GAAP' });
  });
});

describe('SEC client: ticker directory and submissions', () => {
  it('maps tickers to padded CIKs case-insensitively and fails closed on a ticker listed under two CIKs', async () => {
    const h = harness(() => ({ status: 200, body: DIRECTORY }));
    expect(await h.client.lookupCik('aapl')).toBe('0000320193');
    expect(await h.client.lookupCik('BRK-B')).toBe('0001067983');
    expect(await h.client.lookupCik('DUP')).toBeNull();
    expect(await h.client.lookupCik('ZZZZ')).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe('https://www.sec.gov/files/company_tickers.json');
    h.advance(DIRECTORY_TTL_MS + 1);
    await h.client.lookupCik('AAPL');
    expect(h.calls).toHaveLength(2);
  });

  it('rejects an empty or malformed directory instead of treating every ticker as uncovered', async () => {
    const empty = harness(() => ({ status: 200, body: {} }));
    await expect(empty.client.lookupCik('AAPL')).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });

  it('reads the SIC code from submissions and stamps the fetch time', async () => {
    const h = harness(() => ({ status: 200, body: { sic: '3571', sicDescription: 'Electronic Computers' } }));
    const info = await h.client.getSubmissions('320193');
    expect(info).toMatchObject({ sic: '3571', sicDescription: 'Electronic Computers' });
    expect(info?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(h.calls[0].url).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(harness(() => ({ status: 404 })).client.getSubmissions('1')).resolves.toBeNull();
  });
});
