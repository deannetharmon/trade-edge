// lib/fundamentals/__tests__/handler.test.ts

import { describe, expect, it } from 'vitest';
import { createSecClient } from '../sec/client';
import type { SecClient } from '../sec/client';
import { fetchYahooPriceHistory, handleFundamentalsRequest } from '../handler';
import type { HandlerDeps, PriceHistory } from '../handler';
import { loadSecFundamentals, normalizeTicker } from '../secFundamentals';
import { makeCompanyFacts } from '@/lib/discovery/normalized/__tests__/secFixtures';
import { epochDayOfDateString } from '@/lib/discovery/normalized/dates';

const UA = 'TradeEdge Tests tests@example.com';
const NOW = '2026-10-03T14:00:00.000Z';
const DIRECTORY = { '0': { cik_str: 1234567, ticker: 'ACME', title: 'Acme' }, '1': { cik_str: 7654321, ticker: 'FORN', title: 'Foreign' } };

function bars(): { t: number; c: number }[] {
  const out: { t: number; c: number }[] = [];
  const start = epochDayOfDateString('2025-06-01') as number;
  const end = epochDayOfDateString('2026-10-02') as number;
  for (let d = start; d <= end; d += 1) if ((d + 4) % 7 !== 0 && (d + 4) % 7 !== 6) out.push({ t: d * 86400, c: 50 });
  return out;
}

function client(overrides: Record<string, { status: number; body?: unknown }> = {}): { client: SecClient; urls: string[] } {
  const urls: string[] = [];
  const c = createSecClient({
    userAgent: UA,
    nowMs: () => Date.parse(NOW),
    sleep: async () => undefined,
    fetchImpl: async (url) => {
      urls.push(url);
      const hit = Object.keys(overrides).find((k) => url.indexOf(k) >= 0);
      const res = hit
        ? overrides[hit]
        : url.indexOf('company_tickers') >= 0
          ? { status: 200, body: DIRECTORY }
          : url.indexOf('/companyfacts/CIK0001234567') >= 0
            ? { status: 200, body: makeCompanyFacts() }
            : url.indexOf('/submissions/') >= 0
              ? { status: 200, body: { sic: '3571', sicDescription: 'x' } }
              : { status: 404 };
      return { ok: res.status < 300, status: res.status, json: async () => res.body };
    },
  });
  return { client: c, urls };
}

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  const price: PriceHistory = { closes: bars(), issue: null };
  return { userId: 'u1', client: client().client, fetchPriceHistory: async () => price, nowIso: () => NOW, ...over };
}

describe('normalizeTicker', () => {
  it('accepts plain equity tickers and maps class dots to dashes', () => {
    expect(normalizeTicker(' acme ')).toBe('ACME');
    expect(normalizeTicker('brk.b')).toBe('BRK-B');
    ['', 'A B', '../x', 'TOOLONGTICKER', '123', 'AAPL250117C00150000'].forEach((s) => expect(normalizeTicker(s), s).toBeNull());
  });
});

describe('handleFundamentalsRequest', () => {
  it('401 without a session, before touching SEC or price data', async () => {
    let touched = false;
    const res = await handleFundamentalsRequest('ACME', deps({ userId: null, fetchPriceHistory: async () => { touched = true; return { closes: null, issue: null }; } }));
    expect(res.status).toBe(401);
    expect(touched).toBe(false);
  });

  it('400 for a missing or unsupported symbol', async () => {
    expect((await handleFundamentalsRequest(null, deps())).status).toBe(400);
    expect((await handleFundamentalsRequest('not a ticker!', deps())).status).toBe(400);
  });

  it('200 with normalized metrics, coverage and provenance for a covered ticker', async () => {
    const res = await handleFundamentalsRequest('acme', deps());
    expect(res.status).toBe(200);
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(body.coverage).toBe('COVERED');
    expect(body.cik).toBe('0001234567');
    expect(body.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
    expect(body.metrics.sector_classification.validity).toBe('VALID');
    expect(body.conceptMapVersion).toBe('SECMAP-v1.1');
    expect(body.provenance.fcf_ttm.length).toBeGreaterThan(0);
    expect(body.annualSeries.length).toBe(7);
  });

  it('a security SEC does not cover is a normal 200 with every metric UNAVAILABLE (never a failure)', async () => {
    const res = await handleFundamentalsRequest('ZZZZ', deps());
    expect(res.status).toBe(200);
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(body.coverage).toBe('NOT_COVERED');
    expect(body.reason).toBe('TICKER_NOT_IN_SEC_DIRECTORY');
    Object.values(body.metrics).forEach((m) => expect(m.validity).toBe('UNAVAILABLE'));
  });

  it.each([
    ['no companyfacts', {}, 'NO_SEC_COMPANYFACTS'],
    ['not US-GAAP', { '/companyfacts/': { status: 200, body: { facts: { 'ifrs-full': {} } } } }, 'NOT_US_GAAP_XBRL'],
  ])('%s is NOT_COVERED with that reason', async (_n, over, reason) => {
    const res = await handleFundamentalsRequest('FORN', deps({ client: client(over).client }));
    const body = res.body as { coverage: string; reason: string; metrics: Record<string, { validity: string }> };
    expect(res.status).toBe(200);
    expect(body.coverage).toBe('NOT_COVERED');
    expect(body.reason).toBe(reason);
    Object.values(body.metrics).forEach((m) => expect(m.validity).toBe('UNAVAILABLE'));
  });

  it('a provider failure is a visible 502 PROVIDER_FAILURE, not a quiet empty result', async () => {
    const res = await handleFundamentalsRequest('ACME', deps({ client: client({ '/companyfacts/': { status: 503 } }).client }));
    expect(res.status).toBe(502);
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(body.coverage).toBe('PROVIDER_FAILURE');
    expect(body.reason).toBe('SEC_HTTP_ERROR');
  });

  it('a missing SEC_USER_AGENT surfaces as a provider failure with that reason', async () => {
    const noUa = createSecClient({ userAgent: undefined, sleep: async () => undefined });
    const res = await handleFundamentalsRequest('ACME', deps({ client: noUa }));
    expect(res.status).toBe(502);
    expect((res.body as { reason: string }).reason).toBe('SEC_USER_AGENT_MISSING');
  });

  it('a submissions failure only costs the sector, not the financial metrics', async () => {
    const res = await handleFundamentalsRequest('ACME', deps({ client: client({ '/submissions/': { status: 500 } }).client }));
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(res.status).toBe(200);
    expect(body.metrics.fcf_ttm.validity).toBe('VALID');
    expect(body.metrics.sector_classification.validity).toBe('UNAVAILABLE');
  });

  it('price history failure keeps the SEC-only metrics and reports why price metrics are unavailable', async () => {
    const res = await handleFundamentalsRequest('ACME', deps({ fetchPriceHistory: async () => ({ closes: null, issue: 'PRICE_HTTP_429' }) }));
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(res.status).toBe(200);
    expect(body.priceIssue).toBe('PRICE_HTTP_429');
    expect(body.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
    expect(body.metrics.pe_ttm.validity).toBe('UNAVAILABLE');
    expect(body.metrics.fcf_yield_pct.validity).toBe('UNAVAILABLE');
  });
});

describe('fetchYahooPriceHistory', () => {
  const yahoo = (payload: unknown, ok = true, status = 200): typeof fetch =>
    (async () => ({ ok, status, json: async () => payload })) as unknown as typeof fetch;

  it('uses the quote close series (not adjclose), drops null / non-positive / out-of-order bars', async () => {
    const payload = { chart: { result: [{ timestamp: [100, 200, 300, 250, 400], indicators: { quote: [{ close: [1, null, 3, 4, 0] }], adjclose: [{ adjclose: [9, 9, 9, 9, 9] }] } }] } };
    expect(await fetchYahooPriceHistory('ACME', yahoo(payload))).toEqual({ closes: [{ t: 100, c: 1 }, { t: 300, c: 3 }], issue: null });
  });

  it('reports why history is unusable', async () => {
    expect(await fetchYahooPriceHistory('ACME', yahoo({}, false, 429))).toEqual({ closes: null, issue: 'PRICE_HTTP_429' });
    expect(await fetchYahooPriceHistory('ACME', yahoo({ chart: { result: null } }))).toEqual({ closes: null, issue: 'PRICE_NO_DATA' });
    const boom = (async () => { throw new Error('x'); }) as unknown as typeof fetch;
    expect(await fetchYahooPriceHistory('ACME', boom)).toEqual({ closes: null, issue: 'PRICE_FETCH_FAILED' });
  });
});

describe('evaluation clock ordering (live AAPL smoke test: sector_classification was INVALID)', () => {
  it('reads "now" after the SEC fetches, so a fetched timestamp is never later than now', async () => {
    let clock = Date.parse('2026-10-03T17:00:00.000Z');
    const tick = (): number => {
      clock += 1000; // every read of the clock is one second later
      return clock;
    };
    const c = createSecClient({
      userAgent: UA,
      nowMs: tick,
      sleep: async () => undefined,
      fetchImpl: async (url) => {
        const body = url.indexOf('company_tickers') >= 0 ? DIRECTORY : url.indexOf('/companyfacts/') >= 0 ? makeCompanyFacts() : { sic: '3571', sicDescription: 'x' };
        return { ok: true, status: 200, json: async () => body };
      },
    });
    const res = await handleFundamentalsRequest('ACME', deps({ client: c, nowIso: () => new Date(tick()).toISOString() }));
    const body = res.body as Awaited<ReturnType<typeof loadSecFundamentals>>;
    expect(body.metrics.sector_classification.validity).toBe('VALID');
  });
});
