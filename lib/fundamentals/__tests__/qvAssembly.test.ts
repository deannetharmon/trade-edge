// lib/fundamentals/__tests__/qvAssembly.test.ts

// LEAPS-QV-0001 -- Gate 3 input builder against the REAL loader (spec tests 1 and 4): the /api/fundamentals handler runs on
// synthetic SEC company facts and price history, its body goes through a JSON round trip (as over HTTP), and the assembled
// StrategyInput must (1) carry every id QV-v1.0 reads, each produced by a real source or listed as no-provider, and
// (4) give a pinned QV-v1.0 evaluation (state and reason codes).

import { describe, expect, it } from 'vitest';
import { createSecClient } from '../sec/client';
import { handleFundamentalsRequest } from '../handler';
import type { PriceHistory } from '../handler';
import { makeCompanyFacts } from '@/lib/discovery/normalized/__tests__/secFixtures';
import { PRICE_BASIS_QUOTE, daysFromCivil, isSessionDay } from '@/lib/discovery/normalized';
import type { DailyBar } from '@/lib/discovery/normalized';
import { assembleQvStrategyInput, QV_NO_PROVIDER_METRIC_IDS, qvRequiredMetricIds, QV_V1_0_STRATEGY } from '@/lib/discovery/qv';
import { runStrategy } from '@/lib/discovery';

const NOW = '2026-10-03T14:00:00.000Z';
const LAST_DAY = daysFromCivil(2026, 10, 2);
const DIRECTORY = { '0': { cik_str: 1234567, ticker: 'ACME', title: 'Acme' } };

function sessions(n: number, f: (i: number) => number): DailyBar[] {
  const days: number[] = [];
  for (let d = LAST_DAY; days.length < n; d -= 1) if (isSessionDay(d) === true) days.push(d);
  days.reverse();
  return days.map((d, i) => ({ t: d * 86400 + 14 * 3600 + 30 * 60, c: f(i) }));
}

async function loaded() {
  const client = createSecClient({
    userAgent: 'TradeEdge Tests tests@example.com',
    nowMs: () => Date.parse(NOW),
    sleep: async () => undefined,
    fetchImpl: async (url) => {
      const res = url.indexOf('company_tickers') >= 0 ? { status: 200, body: DIRECTORY }
        : url.indexOf('/companyfacts/') >= 0 ? { status: 200, body: makeCompanyFacts() }
        : { status: 200, body: { sic: '3571', sicDescription: 'x' } };
      return { ok: true, status: res.status, json: async () => res.body };
    },
  });
  const history = (f: (i: number) => number): PriceHistory => ({ closes: sessions(1300, f), issue: null, basis: PRICE_BASIS_QUOTE });
  const res = await handleFundamentalsRequest('ACME', {
    userId: 'u1', client, nowIso: () => NOW,
    fetchPriceHistory: async (sym) => (sym === 'SPY' ? history((i) => 100 + 0.05 * i) : history((i) => 80 + 0.04 * i + 4 * Math.sin(i / 9))),
  });
  return JSON.parse(JSON.stringify(res.body));
}

const MARKET_ITEM = { symbol: 'ACME', 'updated-at': '2026-10-03T13:00:00.000Z', earnings: { 'expected-report-date': '2026-10-28' } };

describe('Gate 3 input builder with the real loader', () => {
  it('every id QV-v1.0 reads is present; only the documented no-provider ids lack a source', async () => {
    const body = await loaded();
    const { input } = assembleQvStrategyInput({ symbol: 'ACME', asOf: NOW, fundamentals: { ok: true, metrics: body.metrics, technicals: body.technicals, issues: [] }, marketMetrics: { ok: true, item: MARKET_ITEM } });
    const required = qvRequiredMetricIds();
    required.forEach((id) => expect(input.metrics[id], id).toBeDefined());
    const unsourced = required.filter((id) => {
      const m = input.metrics[id] as { validity: string; reason?: string };
      return m.validity === 'UNAVAILABLE' && (m.reason === 'NO_PROVIDER' || m.reason === 'NOT_PRODUCED_BY_ANY_SOURCE');
    });
    expect(unsourced.sort()).toEqual([...QV_NO_PROVIDER_METRIC_IDS].sort());
    expect(input.underlyingPrice.validity).toBe('VALID');
  });

  it('golden: the assembled input gives a pinned QV-v1.0 evaluation', async () => {
    const body = await loaded();
    const { input } = assembleQvStrategyInput({ symbol: 'ACME', asOf: NOW, fundamentals: { ok: true, metrics: body.metrics, technicals: body.technicals, issues: [] }, marketMetrics: { ok: true, item: MARKET_ITEM } });
    const evaluation = runStrategy(QV_V1_0_STRATEGY, input);
    const observed = { outcome: evaluation.outcome, reasonCodes: evaluation.reasonCodes.map((r) => (r as { code: string }).code ?? r).sort() };
    expect(observed).toMatchSnapshot();
  });
});

describe('feasibility route handler', () => {
  it('signed-in only; validates symbols; reports state, blockers and source issues per symbol', async () => {
    const { handleQvFeasibility } = await import('../qvFeasibility');
    const base = { client: createSecClient({ userAgent: 'TradeEdge Tests tests@example.com', nowMs: () => Date.parse(NOW), sleep: async () => undefined,
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => (url.indexOf('company_tickers') >= 0 ? DIRECTORY : url.indexOf('/companyfacts/') >= 0 ? makeCompanyFacts() : { sic: '3571' }) }) }),
      nowIso: () => NOW,
      fetchPriceHistory: async (): Promise<PriceHistory> => ({ closes: sessions(1300, (i) => 80 + 0.04 * i + 4 * Math.sin(i / 9)), issue: null, basis: PRICE_BASIS_QUOTE }) };
    expect((await handleQvFeasibility('ACME', { ...base, userId: null })).status).toBe(401);
    expect((await handleQvFeasibility('', { ...base, userId: 'u' })).status).toBe(400);
    const res = await handleQvFeasibility('acme,ZZZZ', { ...base, userId: 'u' });
    expect(res.status).toBe(200);
    const rows = (res.body as { rows: { symbol: string; state: string; sourceIssues: string[] }[] }).rows;
    expect(rows[0]).toMatchObject({ symbol: 'ACME', state: 'WATCH' });
    expect(rows[1].symbol).toBe('ZZZZ');
    expect(rows[1].sourceIssues.join(' ')).toMatch(/SEC_NOT_COVERED|FUNDAMENTALS_HTTP/);
    const r1 = rows[1] as unknown as { state: string; blockingReasons: Record<string, string> };
    if (rows[1].sourceIssues.indexOf('SEC_NOT_COVERED') >= 0) expect(r1.state).toBe('NOT_APPLICABLE_NO_COMPANY_FILINGS');
    Object.values(r1.blockingReasons).forEach((reason) => expect(reason).toMatch(/^(UNAVAILABLE|INVALID|STALE)/));
  });
});
