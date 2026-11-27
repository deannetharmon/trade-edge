import { describe, expect, it } from 'vitest';
import { allBelowCost, balancedPickStrike, buildCcAllRows, gapTone, rowChips, sortCcAllRows } from '../ccAllCalls';
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

  it('flags a strike under the stock price, a thin payout and no quote; open interest is a number, not a reason', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(47, 2, 2.1, 0.6), row(60, 0.1, 0.12, 0.05), row(62, 0.2, 0.25, 0.04, 0), row(64, null, null, null)] });
    expect(rows.find(r => r.strike === 47)?.reasons).toContain('in_the_money');
    expect(rowChips(rows.find(r => r.strike === 60)!, 25, false)).toContain('Pays under $25');
    expect(rows.find(r => r.strike === 62)?.reasons).not.toContain('no_oi' as never);
    expect(rows.find(r => r.strike === 62)?.openInterest).toBe(0);
    const nq = rows.find(r => r.strike === 64)!;
    expect(nq.reasons).toContain('no_quote');
    expect(nq.collect).toBeNull();
    expect(nq.popPct).toBeNull();
  });

  it('flags a price gap that is too big', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(60, 0.1, 0.4, 0.1)] });
    expect(rows[0].reasons).toContain('wide');
    expect(gapTone(rows[0])).toBe('red');
    expect(rowChips(rows[0], 25, false)).not.toContain('Price gap too big');
  });

  it('does not call it below cost when the cost is unknown', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: null, lots: null, rows: [row(55, 0.88, 0.94, 0.15)] });
    expect(rows[0].reasons).not.toContain('below_cost');
  });

  it('separates real premium from stock value on a call under the stock price', () => {
    const rows = buildCcAllRows({ ...base, stockPrice: 48.69, floorBasis: 40, rows: [row(27, 19.5, 23.55, 0.99), row(55, 0.88, 0.94, 0.15)] });
    const itm = rows.find(r => r.strike === 27)!;
    expect(itm.collect).toBe(2152);
    expect(itm.timeValue).toBe(0);
    const otm = rows.find(r => r.strike === 55)!;
    expect(otm.timeValue).toBe(91);
  });
});

describe('balancedPickStrike', () => {
  const rows = (floor: number) => buildCcAllRows({ ...base, floorBasis: floor, rows: [row(52, 1.5, 1.55, 0.35), row(54, 1.0, 1.05, 0.27), row(56, 0.6, 0.65, 0.12), row(51, 2, 2.05, 0.5)] });
  it('picks the pick whose keep-shares chance is closest to the middle of 65 to 80%', () => {
    expect(balancedPickStrike(rows(40))).toBe(54);
  });
  it('is null when nothing is a pick (every strike below cost)', () => {
    expect(balancedPickStrike(rows(82))).toBeNull();
  });
});

describe('sortCcAllRows', () => {
  const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(52, 1.5, 1.55, 0.35, 900), row(54, 1.0, 1.05, 0.27, 50), row(56, 0.6, 0.65, 0.12, null), row(64, null, null, null, 10)] });
  it('sorts by a column either way and keeps missing values last', () => {
    expect(sortCcAllRows(rows, 'oi', 'desc').map(r => r.strike)).toEqual([52, 54, 64, 56]);
    expect(sortCcAllRows(rows, 'oi', 'asc').map(r => r.strike)).toEqual([64, 54, 52, 56]);
    expect(sortCcAllRows(rows, 'premium', 'desc').map(r => r.strike)).toEqual([52, 54, 56, 64]);
    expect(sortCcAllRows(rows, 'keep', 'asc').map(r => r.strike)).toEqual([52, 54, 56, 64]);
  });
  it('does not change the original order', () => {
    const before = rows.map(r => r.strike);
    sortCcAllRows(rows, 'strike', 'desc');
    expect(rows.map(r => r.strike)).toEqual(before);
  });
});

describe('gapTone', () => {
  it('is green for a tight spread, yellow for an ok one, red when too big, none with no quote', () => {
    const rows = buildCcAllRows({ ...base, floorBasis: 40, rows: [row(55, 1.0, 1.02, 0.15), row(56, 1.0, 1.08, 0.15), row(57, 0.1, 0.4, 0.1), row(58, null, null, null)] });
    const t = (k: number) => gapTone(rows.find(r => r.strike === k)!);
    expect(t(55)).toBe('green');
    expect(t(56)).toBe('yellow');
    expect(t(57)).toBe('red');
    expect(t(58)).toBeNull();
  });
});
