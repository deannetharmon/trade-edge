// features/portfolio/positions-workspace/__tests__/stockColumnAlignment.test.ts

import { describe, expect, it } from 'vitest';
import { alignedStockColumns, sameWidths, STOCK_TO_OPTION_COLUMNS } from '../model/stockColumnAlignment';

const widths = { identity: 120, dates: 100, underlying: 150, strike: 130, capital: 90, entry: 80, value: 100, pnl: 190, orders: 130, notes: 140, priceAlert: 110, recommendation: 200 };

describe('alignedStockColumns', () => {
  it('each stock column takes the width of the option column it sits under, and the total equals the table above', () => {
    const aligned = alignedStockColumns(widths)!;
    expect(aligned.template).toBe('120px 100px 150px 130px 90px 180px 320px 140px 110px 200px');
    expect(aligned.total).toBe(Object.values(widths).reduce((a, b) => a + b, 0));
    expect(aligned.template.split(' ')).toHaveLength(STOCK_TO_OPTION_COLUMNS.length);
  });
  it('Notes and Price alert land under the Notes and Price alert columns above', () => {
    const cols = alignedStockColumns(widths)!.template.split(' ');
    expect(cols[7]).toBe(`${widths.notes}px`);
    expect(cols[8]).toBe(`${widths.priceAlert}px`);
  });
  it('falls back (null) when a column is missing, zero, or nothing was measured', () => {
    expect(alignedStockColumns(null)).toBeNull();
    expect(alignedStockColumns({})).toBeNull();
    expect(alignedStockColumns({ ...widths, notes: 0 })).toBeNull();
    const { priceAlert: _omit, ...missing } = widths;
    expect(alignedStockColumns(missing)).toBeNull();
    expect(alignedStockColumns({ ...widths, pnl: NaN })).toBeNull();
  });
});

describe('sameWidths', () => {
  it('ignores sub-pixel jitter and detects real changes', () => {
    expect(sameWidths(null, widths)).toBe(false);
    expect(sameWidths(widths, { ...widths, notes: 140.3 })).toBe(true);
    expect(sameWidths(widths, { ...widths, notes: 142 })).toBe(false);
    expect(sameWidths(widths, { ...widths, extra: 10 })).toBe(false);
  });
});
