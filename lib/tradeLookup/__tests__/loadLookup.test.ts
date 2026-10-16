// lib/tradeLookup/__tests__/loadLookup.test.ts

import { describe, expect, it } from 'vitest';
import { loadTradeLookup, type LookupDeps } from '../loadLookup';
import { contract } from './fixtures';

const rawRow = (strike: number, exp: string, right = 'P') => ({
  strikePrice: strike, expirationDate: exp, optionType: right, bid: 5.4, ask: 5.6, delta: -0.3, openInterest: 100, iv: 63, occSymbol: 'S' + strike, quoteUpdatedAt: 't',
});

function makeDeps(over: Partial<LookupDeps> = {}) {
  const calls = { chain: [] as string[], coverage: 0, price: 0 };
  const deps: LookupDeps = {
    getToken: async () => 'tok',
    getListedExpirations: async () => ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2027-06-18'],
    fetchChain: async (_s, _t, exp) => {
      calls.chain.push(exp);
      return { chains: { [exp]: [115, 120, 125].map((k) => rawRow(k, exp)) }, classification: 'etf' };
    },
    getUnderlyingPrice: async () => {
      calls.price++;
      return 135;
    },
    getCoverageReports: async () => {
      calls.coverage++;
      return { capacity: null, foundations: null };
    },
    today: () => ({ year: 2026, month: 10, day: 15 }),
    ...over,
  };
  return { deps, calls };
}

describe('loadTradeLookup', () => {
  it('CSP ok path fetches the posted and next expiration, not coverage', async () => {
    const { deps, calls } = makeDeps();
    const out = await loadTradeLookup(contract(), deps);
    expect(out.kind).toBe('result');
    if (out.kind !== 'result') return;
    expect(out.result.status).toBe('ok');
    expect(out.result.expiration).toBe('2026-11-06');
    expect(out.result.rows.some((r) => r.isNextExpiration && r.expiration === '2026-11-13')).toBe(true);
    expect(calls.chain.sort()).toEqual(['2026-11-06', '2026-11-13']);
    expect(calls.coverage).toBe(0);
    expect(out.result.coverage.status).toBe('not_applicable');
  });

  it('covered call fetches coverage and stays unknown when reports are missing', async () => {
    const { deps, calls } = makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [115, 120, 125].map((k) => rawRow(k, exp, 'C')) }, classification: 'etf' }),
    });
    const out = await loadTradeLookup(contract({ strategy: 'CC', right: 'C' }), deps);
    expect(calls.coverage).toBe(1);
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.coverage.canOrder).toBe(false);
  });

  it('a coverage failure degrades to unknown, not an error', async () => {
    const { deps } = makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [120].map((k) => rawRow(k, exp, 'C')) }, classification: 'etf' }),
      getCoverageReports: async () => { throw new Error('boom'); },
    });
    const out = await loadTradeLookup(contract({ strategy: 'CC', right: 'C' }), deps);
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.coverage.status).toBe('unknown');
  });

  it('expired date is blocked without fetching a chain', async () => {
    const { deps, calls } = makeDeps({ today: () => ({ year: 2026, month: 11, day: 20 }) });
    const out = await loadTradeLookup(contract({ postedAt: { year: 2026, month: 10, day: 1 } }), deps);
    expect(out.kind).toBe('blocked');
    if (out.kind === 'blocked') expect(out.resolution.status).toBe('expired');
    expect(calls.chain).toEqual([]);
  });

  it('a date the ticker does not list is blocked', async () => {
    const { deps } = makeDeps({ getListedExpirations: async () => ['2026-10-23', '2026-11-13'] });
    const out = await loadTradeLookup(contract(), deps);
    expect(out.kind).toBe('blocked');
    if (out.kind === 'blocked') expect(out.resolution.status).toBe('not_listed');
  });

  it('an impossible date is blocked', async () => {
    const { deps } = makeDeps();
    const out = await loadTradeLookup(contract({ expiry: { month: 2, day: 30, year: null } }), deps);
    expect(out.kind).toBe('blocked');
  });

  it('far date is blocked until confirmed, then loads', async () => {
    const { deps, calls } = makeDeps();
    const far = contract({ expiry: { month: 6, day: 18, year: 2027 } });
    const first = await loadTradeLookup(far, deps);
    expect(first.kind).toBe('blocked');
    if (first.kind === 'blocked') expect(first.resolution.status).toBe('confirm_far');
    expect(calls.chain).toEqual([]);
    const second = await loadTradeLookup(far, deps, { confirmedFar: true });
    expect(second.kind).toBe('result');
  });

  it('missing token is an error', async () => {
    const { deps } = makeDeps({ getToken: async () => null });
    expect((await loadTradeLookup(contract(), deps)).kind).toBe('error');
  });

  it('a throwing token read is an error', async () => {
    const { deps } = makeDeps({ getToken: async () => { throw new Error('nope'); } });
    const out = await loadTradeLookup(contract(), deps);
    expect(out).toEqual({ kind: 'error', message: 'nope' });
  });

  it('empty listed expirations is an error', async () => {
    const { deps } = makeDeps({ getListedExpirations: async () => [] });
    expect((await loadTradeLookup(contract(), deps)).kind).toBe('error');
  });

  it('a failed posted-expiration chain is an error', async () => {
    const { deps } = makeDeps({
      fetchChain: async (_s, _t, exp) => {
        if (exp === '2026-11-06') throw new Error('chain down');
        return { chains: {}, classification: 'etf' };
      },
    });
    const out = await loadTradeLookup(contract(), deps);
    expect(out).toEqual({ kind: 'error', message: 'chain down' });
  });

  it('a failed next-expiration chain is ignored', async () => {
    const { deps } = makeDeps({
      fetchChain: async (_s, _t, exp) => {
        if (exp === '2026-11-13') throw new Error('x');
        return { chains: { [exp]: [120].map((k) => rawRow(k, exp)) }, classification: 'etf' };
      },
    });
    const out = await loadTradeLookup(contract(), deps);
    expect(out.kind).toBe('result');
    if (out.kind === 'result') expect(out.result.rows.some((r) => r.isNextExpiration)).toBe(false);
  });

  it('a failed price read leaves POP blank but still returns the chain', async () => {
    const { deps } = makeDeps({ getUnderlyingPrice: async () => { throw new Error('q'); } });
    const out = await loadTradeLookup(contract(), deps);
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.underlyingPrice).toBeNull();
      expect(out.result.pick!.pop).toBeNull();
    }
  });

  it('contracts option scales max risk', async () => {
    const { deps } = makeDeps();
    const out = await loadTradeLookup(contract(), deps, { contracts: 2 });
    if (out.kind === 'result') expect(out.result.contracts).toBe(2);
  });

  it('rows come back flagged, and CC cost basis flows from the capacity report', async () => {
    const { deps } = makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [115, 120, 125].map((k) => rawRow(k, exp, 'C')) }, classification: 'etf' }),
      getCoverageReports: async () => ({
        capacity: { status: 'ok', warnings: [], bySymbol: { SOXL: { availableCoveredContracts: 1, costBasis: 122, costBasisComplete: true } } } as never,
        foundations: null,
      }),
    });
    const out = await loadTradeLookup(contract({ strategy: 'CC', right: 'C' }), deps);
    expect(out.kind).toBe('result');
    if (out.kind !== 'result') return;
    expect(out.result.pick!.flags.map((f) => f.code)).toContain('below_cost_basis');
    expect(out.result.rows.filter((r) => r.strike === 125 && !r.isNextExpiration)[0].flags.map((f) => f.code)).not.toContain('below_cost_basis');
  });

  it('an incomplete cost basis raises no cost-basis flag', async () => {
    const { deps } = makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [120].map((k) => rawRow(k, exp, 'C')) }, classification: 'etf' }),
      getCoverageReports: async () => ({
        capacity: { status: 'ok', warnings: [], bySymbol: { SOXL: { availableCoveredContracts: 1, costBasis: null, costBasisComplete: false } } } as never,
        foundations: null,
      }),
    });
    const out = await loadTradeLookup(contract({ strategy: 'CC', right: 'C' }), deps);
    if (out.kind === 'result') expect(out.result.pick!.flags.map((f) => f.code)).not.toContain('below_cost_basis');
  });

  describe('RSI and earnings signals', () => {
    const fall: number[] = [];
    for (let k = 0; k < 60; k++) fall.push(100 - k * 0.5);
    const closes = fall.concat([70.5, 71.2, 72.1, 73.3, 74.6]);

    it('attaches RSI and, for a single stock, earnings per expiration', async () => {
      const { deps } = makeDeps({
        fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [115, 120, 125].map((k) => rawRow(k, exp)) }, classification: 'stock' }),
        getDailyCloses: async () => closes,
        getEarningsDate: async () => '2026-10-30',
      });
      const out = await loadTradeLookup(contract(), deps);
      if (out.kind !== 'result') throw new Error('expected a result');
      const s = out.result.signals!;
      expect(s.rsi!.label).toBe('Turning up');
      expect(s.earnings.applies).toBe(true);
      expect(s.earnings.forExpiration[out.result.expiration].highlight).toBe(true);
    });

    it('never fails or blocks the lookup when the signal reads fail', async () => {
      const { deps } = makeDeps({
        getDailyCloses: async () => { throw new Error('chart down'); },
        getEarningsDate: async () => { throw new Error('metrics down'); },
      });
      const out = await loadTradeLookup(contract(), deps);
      expect(out.kind).toBe('result');
      if (out.kind !== 'result') return;
      expect(out.result.status).toBe('ok');
      expect(out.result.signals!.rsi).toBeNull();
      expect(out.result.signals!.earnings.date).toBeNull();
    });

    it('works with deps that do not provide the signal reads at all', async () => {
      const { deps } = makeDeps();
      const out = await loadTradeLookup(contract(), deps);
      expect(out.kind).toBe('result');
      if (out.kind === 'result') expect(out.result.signals!.rsi).toBeNull();
    });
  });
});
