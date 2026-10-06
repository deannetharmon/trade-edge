// lib/discovery/qv/__tests__/runUniverse.test.ts

// LEAPS-QV-0001 -- Gate 3 input builder (spec tests 2, 3, 5, 7): disjoint sources, named source failures that make
// QV-v1.0 report INSUFFICIENT_DATA, determinism and order independence, failure isolation, and the hand-off to Gate 4c.

import { describe, expect, it } from 'vitest';
import { validMetric, type MetricSet } from '../../metrics';
import { assembleQvStrategyInput, FUNDAMENTALS_SOURCE_IDS, QvAssemblyContractError, type FundamentalsSource } from '../assembleInput';
import { runQvUniverse, type QvUniverseDeps } from '../runUniverse';
import { runQvLeaps } from '../../leaps/orchestrate';

const NOW = '2026-10-03T14:00:00.000Z';
const set = (ids: string[], value = 1): MetricSet => {
  const out: Record<string, ReturnType<typeof validMetric>> = {};
  ids.forEach((id) => { out[id] = validMetric(id, value, '2026-10-02T20:00:00.000Z'); });
  return out;
};
const okFundamentals = (): FundamentalsSource => ({ ok: true, metrics: set(['revenue_cagr_5y_pct']), technicals: set(['price_last_close'], 100), issues: [] });

function deps(o: Partial<QvUniverseDeps> & { fundamentals?: Record<string, FundamentalsSource | 'THROW' | 'HANG'> } = {}): QvUniverseDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchFundamentals: async (s) => {
      calls.push(s);
      const f = o.fundamentals?.[s];
      if (f === 'THROW') throw new Error('boom');
      if (f === 'HANG') return new Promise(() => undefined);
      return f ?? okFundamentals();
    },
    fetchMarketMetrics: o.fetchMarketMetrics ?? (async (symbols) => Object.fromEntries(symbols.map((s) => [s, { ok: true as const, item: { symbol: s } }]))),
    now: o.now ?? (() => NOW),
    sleep: o.sleep ?? ((ms) => (ms === 30000 ? new Promise<void>(() => undefined) : Promise.resolve())),
  };
}

describe('assembleQvStrategyInput', () => {
  it('a metric id in two sources is a contract error, never last-one-wins', () => {
    expect(() => assembleQvStrategyInput({
      symbol: 'A', asOf: NOW,
      fundamentals: { ok: true, metrics: set(['sma_50']), technicals: set(['sma_50']), issues: [] },
      marketMetrics: { ok: false, reason: 'X' },
    })).toThrow(QvAssemblyContractError);
  });

  it('failed fundamentals: every fundamentals id UNAVAILABLE with the named reason; QV reports INSUFFICIENT_DATA', async () => {
    const run = await runQvUniverse(['A'], deps({ fundamentals: { A: { ok: false, reason: 'FUNDAMENTALS_HTTP_502' } } }));
    const e = run.entries[0];
    FUNDAMENTALS_SOURCE_IDS().forEach((id) => expect(e.input.metrics[id]).toMatchObject({ validity: 'UNAVAILABLE', reason: 'FUNDAMENTALS_HTTP_502' }));
    expect(e.evaluation.outcome.kind).toBe('INSUFFICIENT_DATA');
    expect(e.sourceIssues).toContain('FUNDAMENTALS_HTTP_502');
  });

  it('failed market metrics: earnings date UNAVAILABLE with the reason; symbol still evaluated', async () => {
    const run = await runQvUniverse(['A'], deps({ fetchMarketMetrics: async () => { throw new Error('down'); } }));
    expect(run.entries[0].input.metrics.days_to_next_earnings).toMatchObject({ validity: 'UNAVAILABLE', reason: 'MARKET_METRICS_UNAVAILABLE' });
    expect(run.entries[0].sourceIssues).toContain('MARKET_METRICS_UNAVAILABLE');
  });
});

describe('runQvUniverse', () => {
  it('network error and timeout are contained to that symbol; order is the input order', async () => {
    const run = await runQvUniverse(['a', 'B', 'C', 'b'], deps({
      fundamentals: { B: 'THROW', C: 'HANG' },
      sleep: (ms) => (ms === 30000 ? new Promise<void>((r) => setTimeout(r, 20)) : Promise.resolve()),
    }));
    expect(run.entries.map((e) => e.symbol)).toEqual(['A', 'B', 'C']);
    expect(run.entries[1].sourceIssues).toContain('FUNDAMENTALS_NETWORK');
    expect(run.entries[2].sourceIssues).toContain('FUNDAMENTALS_TIMEOUT');
    expect(run.entries[0].sourceIssues).not.toContain('FUNDAMENTALS_NETWORK');
  });

  it('a symbol missing from the market-metrics reply is named, not silently empty', async () => {
    const run = await runQvUniverse(['A', 'B'], deps({ fetchMarketMetrics: async () => ({ A: { ok: true, item: { symbol: 'A' } } }) }));
    expect(run.entries[1].sourceIssues).toContain('MARKET_METRICS_NO_ITEM');
  });

  it('a source contract error fails closed for that symbol only', async () => {
    const bad: FundamentalsSource = { ok: true, metrics: set(['sma_50']), technicals: set(['sma_50']), issues: [] };
    const run = await runQvUniverse(['A', 'B'], deps({ fundamentals: { A: bad } }));
    expect(run.entries[0].sourceIssues).toContain('ASSEMBLY_CONTRACT_ERROR');
    expect(run.entries[0].evaluation.outcome.kind).toBe('INSUFFICIENT_DATA');
    expect(run.entries[1].sourceIssues).toEqual([]);
  });

  it('deterministic: same payloads and instant give identical inputs and evaluations, whatever the input order', async () => {
    const a = await runQvUniverse(['A', 'B'], deps());
    const b = await runQvUniverse(['B', 'A'], deps());
    expect(JSON.stringify(b.entries.find((e) => e.symbol === 'A'))).toBe(JSON.stringify(a.entries.find((e) => e.symbol === 'A')));
  });

  it('reads the clock once, after all fetches; previous state is null until Gate 7', async () => {
    let reads = 0;
    const run = await runQvUniverse(['A'], deps({ now: () => { reads += 1; return NOW; } }));
    expect(reads).toBe(1);
    expect(run.entries[0].previousState).toBeNull();
    expect(run.entries[0].input.asOf).toBe(NOW);
  });

  it('feeds Gate 4c: non-qualifying symbols make zero chain calls', async () => {
    const universe = await runQvUniverse(['A'], deps());
    const chainCalls: string[] = [];
    const leaps = await runQvLeaps(universe.entries.map((e) => ({ symbol: e.symbol, evaluation: e.evaluation })), {
      get: async (path) => { chainCalls.push(path); return { status: 500, body: null }; },
      sleep: async () => undefined,
      now: () => NOW,
    });
    expect(universe.entries[0].evaluation.outcome.kind === 'CLASSIFIED' && ['SETUP', 'ACTIONABLE'].indexOf(universe.entries[0].evaluation.outcome.state) >= 0).toBe(false);
    expect(chainCalls).toHaveLength(0);
    expect(leaps.results[0].leaps.contractStatus).toBe('NOT_EVALUATED');
  });
});
