// lib/tradeLookup/__tests__/buildLookup.test.ts

import { describe, expect, it } from 'vitest';
import { buildLookup, type BuildLookupInput } from '../buildLookup';
import { calcPositionPop, computeCspEffectiveBuyPrice, computeSingleLegBreakeven } from '@/lib/portfolio/positionMetrics';
import { contract, row } from './fixtures';

const today = { year: 2026, month: 10, day: 15 };
const coverage = { status: 'not_applicable' as const, contractsNeeded: 1, canOrder: true, message: '' };

function input(over: Partial<BuildLookupInput> = {}): BuildLookupInput {
  const strikes = [110, 115, 117.5, 120, 122.5, 125, 130];
  return {
    contract: contract(),
    expiration: '2026-11-06',
    nextExpiration: '2026-11-13',
    contracts: 1,
    rows: strikes.map((s) => row(s)).concat([row(120, { expiration: '2026-11-13', bid: 6.4, ask: 6.6 })]),
    underlyingPrice: 135,
    classification: 'etf',
    today,
    coverage,
    ...over,
  };
}

describe('buildLookup', () => {
  it('picks the posted strike with two strikes each side plus the next expiration', () => {
    const r = buildLookup(input());
    expect(r.status).toBe('ok');
    expect(r.rows.map((x) => x.strike)).toEqual([115, 117.5, 120, 122.5, 125, 120]);
    expect(r.rows.filter((x) => x.isPick)).toHaveLength(1);
    expect(r.pick?.strike).toBe(120);
    expect(r.rows[5].isNextExpiration).toBe(true);
    expect(r.rows[5].expiration).toBe('2026-11-13');
  });

  it('uses the Portfolio formulas (parity)', () => {
    const r = buildLookup(input());
    const p = r.pick!;
    const dte = 22;
    expect(p.dte).toBe(dte);
    expect(p.mid).toBeCloseTo(5.5, 10);
    expect(p.credit).toBeCloseTo(5.5, 10);
    expect(p.natural).toBe(5.4);
    expect(p.breakeven).toBe(computeSingleLegBreakeven(120, 5.5, 'P'));
    expect(p.maxRisk).toBeCloseTo((computeCspEffectiveBuyPrice(120, 5.5) as number) * 100, 8);
    const expected = calcPositionPop('PUT', [{ optionType: 'P', strikePrice: 120, direction: 'Short' }], 135, 550, 1, dte, 63);
    expect(expected).not.toBeNull();
    expect(p.pop).toBe(expected);
  });

  it('scales max risk by contracts and keeps per-share credit', () => {
    const r = buildLookup(input({ contracts: 3 }));
    expect(r.pick!.credit).toBeCloseTo(5.5, 10);
    expect(r.pick!.maxRisk).toBeCloseTo(114.5 * 100 * 3, 6);
  });

  it('call rows use CALL POP and no max risk', () => {
    const calls = [16, 17].map((s) => row(s, { right: 'C', expiration: '2026-08-28', bid: 0.38, ask: 0.4, iv: 80 }));
    const r = buildLookup(input({
      contract: contract({ strategy: 'CC', right: 'C', strike: 16, ticker: 'BITX', expiry: { month: 8, day: 28, year: null } }),
      expiration: '2026-08-28', nextExpiration: null, rows: calls, underlyingPrice: 14, today: { year: 2026, month: 8, day: 10 },
    }));
    const p = r.pick!;
    expect(p.maxRisk).toBeNull();
    expect(p.breakeven).toBeCloseTo(16.39, 10);
    expect(p.pop).toBe(calcPositionPop('CALL', [{ optionType: 'C', strikePrice: 16, direction: 'Short' }], 14, 39, 1, 18, 80));
  });

  it('computes differences against the pick', () => {
    const r = buildLookup(input({ rows: [row(115, { bid: 3.9, ask: 4.1 }), row(120), row(125, { bid: 7.4, ask: 7.6 })], nextExpiration: null }));
    const lower = r.rows[0];
    expect(lower.creditVsPick).toBeCloseTo(-1.5, 10);
    expect(lower.popVsPick).toBeCloseTo((lower.pop as number) - (r.pick!.pop as number), 10);
    expect(r.pick!.creditVsPick).toBeNull();
    expect(r.pick!.popVsPick).toBeNull();
  });

  it('no-quote rows keep strike and OI but price nothing', () => {
    for (const q of [{ bid: 0, ask: 0 }, { bid: null, ask: null }, { bid: 2, ask: 1 }]) {
      const r = buildLookup(input({ rows: [row(115, q), row(120)], nextExpiration: null }));
      const nq = r.rows[0];
      expect(nq.noQuote).toBe(true);
      expect([nq.mid, nq.credit, nq.pop, nq.breakeven, nq.maxRisk, nq.delta, nq.creditVsPick, nq.popVsPick]).toEqual([null, null, null, null, null, null, null, null]);
      expect(nq.openInterest).toBe(1000);
    }
  });

  it('a zero bid with a real ask is a quote', () => {
    const r = buildLookup(input({ rows: [row(120, { bid: 0, ask: 0.05 })], nextExpiration: null }));
    expect(r.pick!.noQuote).toBe(false);
    expect(r.pick!.mid).toBeCloseTo(0.025, 10);
  });

  it('a no-quote pick is flagged and posted comparison is blank', () => {
    const r = buildLookup(input({ rows: [row(120, { bid: 0, ask: 0 })], nextExpiration: null }));
    expect(r.status).toBe('ok');
    expect(r.posted.mid).toBeNull();
    expect(r.posted.change).toBeNull();
    expect(r.notes.join(' ')).toMatch(/no quote/i);
  });

  it('strike not listed returns the closest strikes and never rounds', () => {
    const r = buildLookup(input({ contract: contract({ strike: 121 }) }));
    expect(r.status).toBe('strike_not_listed');
    expect(r.rows).toEqual([]);
    expect(r.pick).toBeNull();
    expect(r.nearestStrikes).toEqual([120, 122.5]);
  });

  it('strike below or above the whole chain gives one nearest strike', () => {
    expect(buildLookup(input({ contract: contract({ strike: 5 }) })).nearestStrikes).toEqual([110]);
    expect(buildLookup(input({ contract: contract({ strike: 500 }) })).nearestStrikes).toEqual([130]);
  });

  it('no rows for the expiration', () => {
    const r = buildLookup(input({ rows: [row(120, { expiration: '2026-11-13' })], nextExpiration: null }));
    expect(r.status).toBe('no_rows');
  });

  it('only same-right rows count', () => {
    const r = buildLookup(input({ rows: [row(120, { right: 'C' })], nextExpiration: null }));
    expect(r.status).toBe('no_rows');
  });

  it('decimal strike 75.5 matches', () => {
    const r = buildLookup(input({ contract: contract({ strike: 75.5 }), rows: [row(74), row(75.5), row(77)], nextExpiration: null }));
    expect(r.pick!.strike).toBe(75.5);
  });

  it('no underlying price gives null POP and a note, credit still prices', () => {
    const r = buildLookup(input({ underlyingPrice: null }));
    expect(r.pick!.pop).toBeNull();
    expect(r.pick!.credit).toBeCloseTo(5.5, 10);
    expect(r.notes.join(' ')).toMatch(/underlying price/i);
  });

  it('missing IV gives null POP', () => {
    const r = buildLookup(input({ rows: [row(120, { iv: null })], nextExpiration: null }));
    expect(r.pick!.pop).toBeNull();
  });

  it('notes when the strike is not listed on the next expiration', () => {
    const r = buildLookup(input({ rows: [row(120)], nextExpiration: '2026-11-13' }));
    expect(r.rows).toHaveLength(1);
    expect(r.notes.join(' ')).toContain('2026-11-13');
  });

  it('posted comparison math', () => {
    const r = buildLookup(input({ contract: contract({ postedPrice: 5, postedAt: { year: 2026, month: 10, day: 13 } }) }));
    expect(r.posted.change).toBeCloseTo(0.5, 10);
    expect(r.posted.changePct).toBeCloseTo(10, 10);
    expect(r.posted.postAgeDays).toBe(2);
  });

  it('posted comparison is blank without a posted price or timestamp', () => {
    const r = buildLookup(input({ contract: contract({ postedPrice: null }) }));
    expect(r.posted.change).toBeNull();
    expect(r.posted.changePct).toBeNull();
    expect(r.posted.postAgeDays).toBeNull();
  });

  it('quotesAsOf is the latest quote time for the pick expiration', () => {
    const r = buildLookup(input({ rows: [row(115, { quoteUpdatedAt: '2026-10-15T14:00:00Z' }), row(120, { quoteUpdatedAt: '2026-10-15T15:30:00Z' })], nextExpiration: null }));
    expect(r.quotesAsOf).toBe('2026-10-15T15:30:00Z');
  });

  it('passes coverage and classification through', () => {
    const cov = { status: 'unknown' as const, contractsNeeded: 1, canOrder: false, message: 'x' };
    const r = buildLookup(input({ coverage: cov, classification: 'stock' }));
    expect(r.coverage).toBe(cov);
    expect(r.classification).toBe('stock');
  });
});
