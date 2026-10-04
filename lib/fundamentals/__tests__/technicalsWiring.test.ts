// lib/fundamentals/__tests__/technicalsWiring.test.ts

// LEAPS-QV-0001 Gate 2c -- loader / handler wiring of the technical direction metrics: completed bars only, SPY acquired once,
// failure isolation (SPY / price / SEC are independent), technicals present on every coverage path.

import { describe, expect, it } from 'vitest';
import { createSecClient } from '../sec/client';
import { fetchYahooPriceHistory, handleFundamentalsRequest } from '../handler';
import type { HandlerDeps, PriceHistory } from '../handler';
import type { LoadedFundamentals } from '../secFundamentals';
import { makeCompanyFacts } from '@/lib/discovery/normalized/__tests__/secFixtures';
import { PRICE_BASIS_QUOTE, daysFromCivil, isSessionDay } from '@/lib/discovery/normalized';
import type { DailyBar } from '@/lib/discovery/normalized';

const NOW = '2026-10-03T14:00:00.000Z'; // Saturday
const LAST_DAY = daysFromCivil(2026, 10, 2);
const OPEN = 14 * 3600 + 30 * 60;
const DIRECTORY = { '0': { cik_str: 1234567, ticker: 'ACME', title: 'Acme' } };
const DIRECTION = ['rsi_weekly_slope_1w', 'price_vs_sma50_gap_change_4w_pp', 'relative_return_126d_change_4w_pp'];

function sessions(n: number, f: (i: number) => number, endDay: number = LAST_DAY): DailyBar[] {
  const days: number[] = [];
  for (let d = endDay; days.length < n; d -= 1) if (isSessionDay(d) === true) days.push(d);
  days.reverse();
  return days.map((d, i) => ({ t: d * 86400 + OPEN, c: f(i) }));
}
const stockF = (i: number): number => 100 + 0.5 * i + 3 * ((i * 3) % 7);
const spyF = (i: number): number => 100 + 0.2 * i + 2 * ((i * 5) % 4);

function secClient(status = 200) {
  return createSecClient({
    userAgent: 'TradeEdge Tests tests@example.com',
    nowMs: () => Date.parse(NOW),
    sleep: async () => undefined,
    fetchImpl: async (url) => {
      const res =
        url.indexOf('company_tickers') >= 0
          ? { status: 200, body: DIRECTORY }
          : url.indexOf('/companyfacts/CIK0001234567') >= 0
            ? { status, body: status === 200 ? makeCompanyFacts() : undefined }
            : { status: 200, body: { sic: '3571', sicDescription: 'x' } };
      return { ok: res.status < 300, status: res.status, json: async () => res.body };
    },
  });
}

interface Setup {
  stock?: PriceHistory;
  spy?: PriceHistory | 'THROW';
  nowIso?: string;
  sec?: number;
}
async function run(symbol: string, setup: Setup = {}) {
  const calls: string[] = [];
  const stock: PriceHistory = setup.stock || { closes: sessions(200, stockF), issue: null, basis: PRICE_BASIS_QUOTE };
  const spy: PriceHistory | 'THROW' = setup.spy || { closes: sessions(200, spyF), issue: null, basis: PRICE_BASIS_QUOTE };
  const deps: HandlerDeps = {
    userId: 'u1',
    client: secClient(setup.sec),
    nowIso: () => setup.nowIso || NOW,
    fetchPriceHistory: async (sym) => {
      calls.push(sym);
      if (sym === 'SPY') {
        if (spy === 'THROW') throw new Error('boom');
        return spy;
      }
      return stock;
    },
  };
  const res = await handleFundamentalsRequest(symbol, deps);
  return { res, body: res.body as LoadedFundamentals, calls };
}

describe('technicals through the loader / handler', () => {
  it('COVERED: direction metrics VALID (independent value), SPY fetched exactly once, SEC metrics still there', async () => {
    const { res, body, calls } = await run('ACME');
    expect(res.status).toBe(200);
    expect(calls.sort()).toEqual(['ACME', 'SPY']);
    DIRECTION.forEach((id) => expect(body.technicals[id].validity, id).toBe('VALID'));
    expect((body.technicals.relative_return_126d_change_4w_pp as { value: number }).value).toBeCloseTo(0.5771809117517179, 10);
    expect(body.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
    expect(body.metrics.fcf_annual_history_5y.validity).toBe('VALID');
    expect(body.benchmarkIssue).toBeNull();
    expect(body.calendarIssue).toBeNull();
  });

  it('a still-forming bar never reaches the metric layer: the last completed bar is used, not the forming one', async () => {
    const forming = sessions(200, stockF);
    forming[forming.length - 1] = { ...forming[forming.length - 1], c: 999999 }; // 2026-10-02 bar, session not over at 15:00Z
    const spyBars = sessions(200, spyF);
    const { body } = await run('ACME', {
      nowIso: '2026-10-02T15:00:00.000Z',
      stock: { closes: forming, issue: null, basis: PRICE_BASIS_QUOTE },
      spy: { closes: spyBars, issue: null, basis: PRICE_BASIS_QUOTE },
    });
    const last = (body.technicals.price_last_close as { value: number }).value;
    expect(last).toBe(stockF(198)); // the 2026-10-01 close
    DIRECTION.filter((id) => id !== 'rsi_weekly_slope_1w').forEach((id) => expect(body.technicals[id].validity, id).toBe('VALID'));
  });

  it('SPY HTTP failure only costs the benchmark-derived metrics', async () => {
    const { res, body } = await run('ACME', { spy: { closes: null, issue: 'PRICE_HTTP_429', basis: PRICE_BASIS_QUOTE } });
    expect(res.status).toBe(200);
    expect(body.benchmarkIssue).toBe('BENCHMARK_PRICE_HTTP_429');
    ['relative_return_126d_change_4w_pp', 'relative_return_126d_vs_benchmark_pct'].forEach((id) =>
      expect(body.technicals[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'BENCHMARK_PRICE_HTTP_429' }),
    );
    expect(body.technicals.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(body.technicals.sma_50.validity).toBe('VALID');
    expect(body.metrics.fcf_ttm.validity).toBe('VALID');
  });

  it('a throwing SPY fetch is isolated the same way', async () => {
    const { res, body } = await run('ACME', { spy: 'THROW' });
    expect(res.status).toBe(200);
    expect(body.technicals.relative_return_126d_change_4w_pp).toMatchObject({ validity: 'UNAVAILABLE', reason: 'BENCHMARK_PRICE_FETCH_FAILED' });
    expect(body.technicals.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
  });

  it('stock price failure: technicals UNAVAILABLE NO_PRICE_HISTORY, SEC-only metrics intact', async () => {
    const { res, body } = await run('ACME', { stock: { closes: null, issue: 'PRICE_HTTP_500', basis: PRICE_BASIS_QUOTE } });
    expect(res.status).toBe(200);
    DIRECTION.forEach((id) => expect(body.technicals[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'NO_PRICE_HISTORY' }));
    expect(body.metrics.fcf_annual_history_5y.validity).toBe('VALID');
  });

  it('technicals are present when SEC does not cover the ticker and when the SEC provider fails', async () => {
    const notCovered = await run('ZZZZ');
    expect(notCovered.body.coverage).toBe('NOT_COVERED');
    DIRECTION.forEach((id) => expect(notCovered.body.technicals[id].validity, id).toBe('VALID'));
    const failed = await run('ACME', { sec: 503 });
    expect(failed.res.status).toBe(502);
    expect(failed.body.coverage).toBe('PROVIDER_FAILURE');
    DIRECTION.forEach((id) => expect(failed.body.technicals[id].validity, id).toBe('VALID'));
    expect(failed.body.metrics.fcf_annual_history_5y.validity).toBe('UNAVAILABLE');
  });

  it('a price-basis mismatch between stock and SPY makes the benchmark metrics INVALID, not silently mixed', async () => {
    const { body } = await run('ACME', { spy: { closes: sessions(200, spyF), issue: null, basis: 'ADJCLOSE_DIVIDEND_ADJUSTED' } });
    expect(body.technicals.relative_return_126d_change_4w_pp).toMatchObject({ validity: 'INVALID', reason: 'ADJUSTMENT_BASIS_MISMATCH' });
    expect(body.technicals.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
  });

  it('SPY series with a missing lookback bar -> INVALID alignment (never position-matched)', async () => {
    const spyBars = sessions(200, spyF);
    spyBars.splice(200 - 1 - 126, 1);
    const { body } = await run('ACME', { spy: { closes: spyBars, issue: null, basis: PRICE_BASIS_QUOTE } });
    expect(body.technicals.relative_return_126d_change_4w_pp).toMatchObject({ validity: 'INVALID', reason: 'BENCHMARK_NOT_ALIGNED_TO_LOOKBACK_BAR' });
  });

  it('requesting SPY itself fetches it once and benchmarks it against itself (0 pp)', async () => {
    const { body, calls } = await run('SPY', { stock: { closes: sessions(200, spyF), issue: null, basis: PRICE_BASIS_QUOTE } });
    expect(calls).toEqual(['SPY']);
    expect((body.technicals.relative_return_126d_change_4w_pp as { value: number }).value).toBeCloseTo(0, 12);
  });

  it('a bar on a day the exchange calendar calls closed -> calendarIssue and direction metrics UNAVAILABLE (nothing guessed)', async () => {
    const odd = [...sessions(199, stockF, daysFromCivil(2026, 9, 4)), { t: daysFromCivil(2026, 9, 7) * 86400 + OPEN, c: 100 }]; // Labor Day bar
    const { body } = await run('ACME', { nowIso: '2026-09-08T14:00:00.000Z', stock: { closes: odd, issue: null, basis: PRICE_BASIS_QUOTE } });
    expect(body.calendarIssue).toBe('SESSION_CALENDAR_UNAVAILABLE');
    DIRECTION.forEach((id) => expect(body.technicals[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' }));
  });

  it('the Yahoo fetcher labels its series as the split-adjusted, dividend-unadjusted quote basis', async () => {
    const chart = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [10, 11, 12] }], adjclose: [{ adjclose: [1, 2, 3] }] } }] } };
    const ok = await fetchYahooPriceHistory('ACME', (async () => ({ ok: true, status: 200, json: async () => chart })) as unknown as typeof fetch);
    expect(ok.basis).toBe(PRICE_BASIS_QUOTE);
    expect(ok.closes!.map((b) => b.c)).toEqual([10, 11, 12]); // quote closes, never adjclose
  });
});
