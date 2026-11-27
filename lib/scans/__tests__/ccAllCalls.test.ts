import { describe, expect, it } from 'vitest';
import { allBelowCost, buildCcAllRows, rowChips } from '../ccAllCalls';
import type { ChainRow } from '@/lib/tradeLookup/lookupTypes';

const row = (strike: number, bid: number | null, ask: number | null, delta: number | null, oi: number | null = 500, right: 'C' | 'P' = 'C'): ChainRow => ({
  strike, right, expiration: '2026-12-11', bid, ask, delta, openInterest: oi, iv: null, occSymbol: `TQQQ  261211C${strike}`, quoteUpdatedAt: null,
});
const lots = [{ shares: 100, price: 82, day: '2026-01-05' }, { shares: 100, price: 75.5, day: '2026-11-04' }];
const base = { dte: 14, stockPrice: 48.01, floorBasis: 82, lots, minPayChip: 25 };

describe('buildCcAllRows', () => {
  it('keeps every call and drops puts', () => {
    const rows = buildCcAllRows({ ...base, rows: [row(53, 1.4, 1.54, 0.2), row(55, 0.88, 0.94, 0.15), row(55, 0.5, 0.6, -0.2, 500, 'P')] });
    expect(rows.map(r => r.strike)).toEqual([53, 55]);
  });

  it('tags every below-cost call and gives the lot loss line', () => {
    const rows = buildCcAllRows({ ...base, rows: [row(55, 0.88, 0.94, 0.15)] });
    expect(rows[0].reasons).toContain('below_cost');
    expect(rows[0].isPick).toBe(false);
    expect(rows[0].collect).toBe(91);
    expect(rows[0].popPct).toBe(85);
    expect(rows[0].lotLossLine).toContain('you lose $2,609 on your oldest shares');
  });

  it('shows the shared reason once when all rows are below cost', () => {
    const rows = buildCcAllRows({ ...base, rows: [row(53, 1.4, 1.54, 0.2), row(55, 0.88, 0.94, 0.15)] });
    expect(allBelowCost(rows)).toBe(true);
    expect(rowChips(rows[0], 25, true)).toEqual([]);
    expect(rowChips(rows[0], 25, false)).toEqual(['Below your cost']);
  });

  it('is a pick only with no reasons', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, stockPrice: 48.01, rows: [row(55, 0.88, 0.94, 0.15)] });
    expect(rows[0].reasons).toEqual([]);
    expect(rows[0].isPick).toBe(true);
    expect(rows[0].lotLossLine).toBeNull();
  });

  it('flags a strike under the stock price, a thin payout, no open interest and no quote', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(47, 2, 2.1, 0.6), row(60, 0.1, 0.12, 0.05), row(62, 0.2, 0.25, 0.04, 0), row(64, null, null, null)] });
    expect(rows.find(r => r.strike === 47)?.reasons).toContain('in_the_money');
    expect(rowChips(rows.find(r => r.strike === 60)!, 25, false)).toContain('Pays under $25');
    expect(rows.find(r => r.strike === 62)?.reasons).toContain('no_oi');
    const nq = rows.find(r => r.strike === 64)!;
    expect(nq.reasons).toContain('no_quote');
    expect(nq.collect).toBeNull();
    expect(nq.popPct).toBeNull();
  });

  it('flags a price gap that is too big', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(60, 0.1, 0.4, 0.1)] });
    expect(rows[0].reasons).toContain('wide');
  });

  it('does not call it below cost when the cost is unknown', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: null, lots: null, rows: [row(55, 0.88, 0.94, 0.15)] });
    expect(rows[0].reasons).not.toContain('below_cost');
  });
});
