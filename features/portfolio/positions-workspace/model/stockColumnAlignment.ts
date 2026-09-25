// features/portfolio/positions-workspace/model/stockColumnAlignment.ts
//
// Makes the Stock holdings table line up with the options table above it. Each stock column takes the measured width of the
// option column(s) it sits under, so Holding sits under Position, Notes under Notes and Price alert under Price alert. Pure.

/** Stock holdings columns, in order, and the options-table column ids each one spans. */
export const STOCK_TO_OPTION_COLUMNS: ReadonlyArray<readonly string[]> = [
  ['identity'],            // Holding
  ['dates'],               // Shares
  ['underlying'],          // Price
  ['strike'],              // Avg cost
  ['capital'],             // Value
  ['entry', 'value'],      // Unrealized P/L
  ['pnl', 'orders'],       // Covered calls
  ['notes'],               // Notes
  ['priceAlert'],          // Price alert
  ['recommendation'],      // Sell
];

export interface AlignedStockColumns {
  /** CSS grid-template-columns value, one pixel width per stock column. */
  template: string;
  /** Total width in pixels, equal to the options table's width over the columns it covers. */
  total: number;
}

/**
 * Returns null (use the default widths) unless every options column the stock table needs is present with a real measured width.
 * That covers a hidden column, a not-yet-rendered table, and a test environment that measures everything as zero.
 */
export function alignedStockColumns(widths: Readonly<Record<string, number>> | null | undefined): AlignedStockColumns | null {
  if (!widths) return null;
  const px: number[] = [];
  for (const ids of STOCK_TO_OPTION_COLUMNS) {
    let sum = 0;
    for (const id of ids) {
      const width = widths[id];
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
      sum += width;
    }
    px.push(Math.round(sum * 100) / 100);
  }
  return { template: px.map(value => `${value}px`).join(' '), total: Math.round(px.reduce((a, b) => a + b, 0) * 100) / 100 };
}

export function sameWidths(a: Readonly<Record<string, number>> | null, b: Readonly<Record<string, number>>): boolean {
  if (!a) return false;
  const keys = Object.keys(b);
  if (keys.length !== Object.keys(a).length) return false;
  return keys.every(key => Math.abs((a[key] ?? -1) - b[key]) < 0.5);
}
