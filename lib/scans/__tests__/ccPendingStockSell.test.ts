// lib/scans/__tests__/ccPendingStockSell.test.ts
// SELL-CC-0001 B -- a working order to sell the stock competes with a new covered call for the same shares.
import { describe, it, expect } from 'vitest';
import { buildCoveredCallCapacityReport, normalizeWorkingStockSells } from '../covered-call-capacity';
import { guardCcOrder, type CcOrderRequest } from '../ccOrderSubmission';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';

const position = (symbol: string, qty: number) => ({
  symbol, 'instrument-type': 'Equity', quantity: String(qty), 'quantity-direction': 'Long', 'average-open-price': '80',
});
const stockSell = (symbol: string, qty: number, status = 'Live', action = 'Sell to Close') => ({
  id: 1, status, legs: [{ symbol, 'instrument-type': 'Equity', action, quantity: qty }],
});
const req = (over: Partial<CcOrderRequest> = {}): CcOrderRequest => ({
  symbol: 'TQQQ', expiration: '2026-12-18', strike: 85, quantity: 1, entryPerShare: 0.38, belowCostBasisAcknowledged: false, ...over,
});
const reportsFor = (shares: number, orders: unknown[]): CoverageReports => ({
  capacity: buildCoveredCallCapacityReport([position('TQQQ', shares)] as never, orders as never) as never,
  foundations: { status: 'ok', warnings: [], foundations: [] } as never,
});

describe('normalizeWorkingStockSells', () => {
  it('counts working equity sells only', () => {
    const r = normalizeWorkingStockSells([
      stockSell('TQQQ', 50), stockSell('TQQQ', 25, 'Received'), stockSell('TQQQ', 10, 'Filled'),
      stockSell('TQQQ', 5, 'Live', 'Buy to Open'), stockSell('AAPL', 3, 'Cancelled'),
    ] as never);
    expect(r).toEqual({ TQQQ: 75 });
  });
  it('ignores option legs', () => {
    expect(normalizeWorkingStockSells([{ status: 'Live', legs: [{ symbol: 'TQQQ  261218C00085000', 'instrument-type': 'Equity Option', action: 'Sell to Open', quantity: 1 }] }] as never)).toEqual({});
  });
});

describe('guard with a pending stock sale', () => {
  it('no pending sale: allowed, no warning', () => {
    const g = guardCcOrder(reportsFor(200, []), req());
    expect(g.allowed && g.warning).toBeFalsy();
    expect(g.allowed).toBe(true);
  });
  it('pending sale leaves the call uncovered: blocked with a plain reason', () => {
    const g = guardCcOrder(reportsFor(100, [stockSell('TQQQ', 100)]), req());
    expect(g.allowed).toBe(false);
    if (!g.allowed) expect(g.reason).toMatch(/open order to sell 100 TQQQ shares would leave this call uncovered/);
  });
  it('pending sale that still leaves enough shares: allowed with a warning', () => {
    const g = guardCcOrder(reportsFor(200, [stockSell('TQQQ', 100)]), req());
    expect(g.allowed).toBe(true);
    if (g.allowed) expect(g.warning).toMatch(/open order to sell 100 TQQQ shares/);
  });
  it('a sale of another symbol does not matter', () => {
    const g = guardCcOrder(reportsFor(100, [stockSell('AAPL', 100)]), req());
    expect(g.allowed).toBe(true);
    if (g.allowed) expect(g.warning).toBeUndefined();
  });
});
