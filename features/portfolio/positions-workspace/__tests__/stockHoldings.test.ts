// features/portfolio/positions-workspace/__tests__/stockHoldings.test.ts
//
// STOCKS-0001 -- Dean's holdings (META 5 shares @ $549 avg, SNDK 2 shares @ $1,592 avg, as of the 2026-09-20 screenshots) plus the states the
// mock says the section must handle: 300 shares with a short call open, several lots with no complete basis, and short stock.

import { describe, expect, it } from 'vitest';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { buildStockHoldingRows, buildStockTotals, isPriceAlertCrossed, stockNoteKey, stockPricesAsOf } from '../model/stockHoldings';
import type { CapacityViewModel } from '../model/types';

const holding = (over: Partial<EquityHolding>): EquityHolding => ({
  accountNumber: 'ACCT-1', symbol: 'META', direction: 'Long', quantity: 5, settledQuantity: null, basis: 549, basisComplete: true, currentPrice: 668.4, marketValue: 3342, unrealizedPnl: 596,
  quoteAsOf: '2026-09-21T02:45:19.000Z', staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...over,
});
const capacity = (over: Partial<CapacityViewModel> = {}): CapacityViewModel => ({ status: 'ok', sharesOwned: 5, allocatedContracts: 0, reservedContracts: 0, availableContracts: 0, remainderShares: 5, basisComplete: true, blockingReason: null, unallocatedShares: 5, ...over });
const group = (h: EquityHolding, cap: Partial<CapacityViewModel> = {}) => ({ symbol: h.symbol, equities: [h], capacity: capacity({ sharesOwned: h.direction === 'Long' ? h.quantity : 0, ...cap }) });

const META = holding({});
const SNDK = holding({ symbol: 'SNDK', quantity: 2, basis: 1592, currentPrice: 1798, marketValue: 3596, unrealizedPnl: 412 });
const XYZ = holding({ symbol: 'XYZ', quantity: 300, basis: 38, currentPrice: 42.1, marketValue: 12630, unrealizedPnl: 1230 });
const ABC = holding({ symbol: 'ABC', quantity: 150, basis: null, basisComplete: false, currentPrice: 21.35, marketValue: 3202.5, unrealizedPnl: null });
const DEF = holding({ symbol: 'DEF', direction: 'Short', quantity: 100, basis: 52, currentPrice: 55, marketValue: -5500, unrealizedPnl: -300 });
const row = (h: EquityHolding, cap?: Partial<CapacityViewModel>) => buildStockHoldingRows([group(h, cap)])[0];

describe('Dean\'s two holdings', () => {
  const rows = buildStockHoldingRows([group(META), group(SNDK)]);

  it('META 5 shares: value $3,342, cost $2,745, +$596 = +21.7%', () => {
    expect(rows[0]).toMatchObject({ symbol: 'META', direction: 'Long', shares: 5, sharesNote: null, price: 668.4, value: 3342, avgCost: 549, costBasis: 2745, basisComplete: true, pnl: 596, key: 'equity:META:long' });
    expect(rows[0].pnlPct).toBeCloseTo(21.71, 2);
  });

  it('SNDK 2 shares: cost $3,184, +$412 = +12.9%', () => {
    expect(rows[1]).toMatchObject({ symbol: 'SNDK', shares: 2, costBasis: 3184, pnl: 412 });
    expect(rows[1].pnlPct).toBeCloseTo(12.94, 2);
  });

  it('totals: value $6,938, cost $5,929, P/L +$1,008 = +17.0%, complete, "Value" label', () => {
    const t = buildStockTotals(rows);
    expect(t).toMatchObject({ holdings: 2, hasShort: false, valueLabel: 'Value', value: 6938, valueIncluded: 2, costBasis: 5929, pnl: 1008, pnlIncluded: 2, complete: true });
    expect(t.pnlPct).toBeCloseTo(17.0, 1);
  });

  it('sorts by symbol', () => {
    expect(buildStockHoldingRows([group(SNDK), group(META)]).map(r => r.symbol)).toEqual(['META', 'SNDK']);
  });
});

describe('covered-call column (from the capacity model, not recomputed)', () => {
  it('under 100 shares: "Needs N more shares", gray not amber (Ian), with 0 of 1 contract', () => {
    expect(row(META).covered).toEqual({ kind: 'needs-shares', headline: 'Needs 95 more shares', detail: '0 of 1 contract available', tone: 'neutral' });
    expect(row(SNDK, { sharesOwned: 2 }).covered.headline).toBe('Needs 98 more shares');
    expect(row(holding({ quantity: 99 }), { sharesOwned: 99 }).covered.headline).toBe('Needs 1 more share');
  });

  it('exactly 100 shares with nothing committed is 1 of 1 available (green)', () => {
    expect(row(holding({ quantity: 100 }), { sharesOwned: 100, availableContracts: 1 }).covered).toEqual({ kind: 'available', headline: '1 of 1 contract available', detail: null, tone: 'good' });
  });

  it('300 shares with one short call open: 2 of 3 available, and what is committed', () => {
    expect(row(XYZ, { sharesOwned: 300, allocatedContracts: 1, availableContracts: 2 }).covered).toEqual({
      kind: 'available', headline: '2 of 3 contracts available', detail: '1 contract committed to short calls or pending orders', tone: 'good' });
  });

  it('everything committed says so, split by short calls and pending orders', () => {
    expect(row(XYZ, { sharesOwned: 300, allocatedContracts: 2, reservedContracts: 1, availableContracts: 0 }).covered).toEqual({
      kind: 'committed', headline: 'All 3 contracts committed', detail: '2 contracts committed to short calls · 1 contract reserved by pending orders', tone: 'neutral' });
  });

  it('short stock has no covered-call capacity', () => {
    expect(row(DEF).covered).toEqual({ kind: 'not-applicable', headline: 'Not applicable to short stock', detail: null, tone: 'neutral' });
  });

  it('a capacity that cannot be computed is amber with the model\'s own reason', () => {
    expect(row(META, { status: 'unavailable', blockingReason: 'Working orders are unavailable' }).covered).toEqual({ kind: 'unavailable', headline: 'Unavailable', detail: 'Working orders are unavailable', tone: 'watch' });
  });
});

describe('incomplete basis and short stock', () => {
  it('several lots without a complete basis: no cost, no P/L, no percent, but the value stays', () => {
    expect(row(ABC, { sharesOwned: 150, availableContracts: 1 })).toMatchObject({ avgCost: null, costBasis: null, basisComplete: false, pnl: null, pnlPct: null, value: 3202.5 });
  });

  it('a P/L the broker reports is still hidden when the basis is incomplete (never a partial-lot average)', () => {
    expect(row(holding({ basisComplete: false, basis: 500, unrealizedPnl: 99 })).pnl).toBeNull();
  });

  it('short stock: negative shares with a label, negative value, and the P/L sign as reported (-$300 = -5.8%)', () => {
    const r = row(DEF);
    expect(r).toMatchObject({ shares: -100, sharesNote: 'Short 100 shares', value: -5500, costBasis: 5200, pnl: -300, key: 'equity:DEF:short' });
    expect(r.pnlPct).toBeCloseTo(-5.77, 2);
  });

  it('a missing price gives no value and no P/L instead of a guess', () => {
    expect(row(holding({ currentPrice: null, marketValue: null, unrealizedPnl: null }))).toMatchObject({ price: null, value: null, pnl: null, pnlPct: null });
  });
});

describe('totals with partial data', () => {
  it('the mock\'s example: P/L covers 2 of 3 holdings, no percent, and "Net value" because a short is included', () => {
    const t = buildStockTotals(buildStockHoldingRows([group(XYZ, { sharesOwned: 300 }), group(ABC, { sharesOwned: 150 }), group(DEF)]));
    expect(t).toMatchObject({ holdings: 3, hasShort: true, valueLabel: 'Net value', value: 10332.5, valueIncluded: 3, costBasis: null, pnl: 930, pnlIncluded: 2, pnlPct: null, complete: false });
  });

  it('a holding without a price is left out of the value total and counted', () => {
    const t = buildStockTotals(buildStockHoldingRows([group(META), group(holding({ symbol: 'ZZZ', currentPrice: null, marketValue: null, unrealizedPnl: null }))]));
    expect(t).toMatchObject({ value: 3342, valueIncluded: 1, pnlIncluded: 1, complete: false, pnlPct: null });
  });

  it('nothing to total gives nulls, not zeros', () => {
    expect(buildStockTotals([])).toMatchObject({ holdings: 0, value: null, pnl: null, costBasis: null, pnlPct: null, complete: false });
  });
});

describe('notes and alert keys', () => {
  it('has its own format, uppercased, that an option position key can never equal', () => {
    expect(stockNoteKey('meta', 'Long')).toBe('equity:META:long');
    expect(stockNoteKey(' DEF ', 'Short')).toBe('equity:DEF:short');
    expect(stockNoteKey('META', 'Long')).not.toBe(stockNoteKey('META', 'Short'));
  });
});

describe('price alerts (the same rule the option rows use)', () => {
  it.each([['above', 700, 700, true], ['above', 700, 699.99, false], ['below', 600, 600, true], ['below', 600, 600.01, false]] as const)('%s %s at %s -> %s', (direction, targetPrice, price, crossed) => {
    expect(isPriceAlertCrossed({ targetPrice, direction }, price)).toBe(crossed);
  });
  it('no alert, or no price, is never crossed', () => {
    expect(isPriceAlertCrossed(null, 700)).toBe(false);
    expect(isPriceAlertCrossed({ targetPrice: 700, direction: 'above' }, null)).toBe(false);
  });
});

describe('the "prices as of" label', () => {
  const ET = 'America/New_York';
  const rows = (...times: Array<string | null>) => times.map(quoteAsOf => ({ quoteAsOf, stale: false }));

  it('same day: just the time, with "market closed" when the market is not open', () => {
    // 2026-09-21T02:45:19Z = 10:45 PM ET on Sunday 2026-09-20
    expect(stockPricesAsOf({ rows: rows('2026-09-21T02:45:19.000Z'), fallback: null, nowMs: Date.parse('2026-09-21T02:50:00.000Z'), marketOpen: false, timeZone: ET }))
      .toEqual({ text: 'Prices as of 10:45 PM · market closed', staleCount: 0 });
  });

  it('an earlier day adds the weekday: Monday morning before the open shows Friday\'s close', () => {
    expect(stockPricesAsOf({ rows: rows('2026-09-18T20:00:00.000Z'), fallback: null, nowMs: Date.parse('2026-09-21T12:00:00.000Z'), marketOpen: false, timeZone: ET }))
      .toEqual({ text: 'Prices as of Fri 4:00 PM · market closed', staleCount: 0 });
  });

  it('while the market is open there is no "market closed"', () => {
    expect(stockPricesAsOf({ rows: rows('2026-09-21T15:00:00.000Z'), fallback: null, nowMs: Date.parse('2026-09-21T15:00:05.000Z'), marketOpen: true, timeZone: ET })!.text).toBe('Prices as of 11:00 AM');
  });

  it('uses the OLDEST holding price, so a stale one is not hidden, and counts stale prices', () => {
    const r = stockPricesAsOf({ rows: [{ quoteAsOf: '2026-09-21T15:00:00.000Z', stale: false }, { quoteAsOf: '2026-09-21T13:30:00.000Z', stale: true }], fallback: null, nowMs: Date.parse('2026-09-21T15:05:00.000Z'), marketOpen: true, timeZone: ET })!;
    expect(r).toEqual({ text: 'Prices as of 9:30 AM', staleCount: 1 });
  });

  it('falls back to the snapshot time, and says nothing when no time is known', () => {
    expect(stockPricesAsOf({ rows: rows(null), fallback: '2026-09-21T15:00:00.000Z', nowMs: Date.parse('2026-09-21T15:05:00.000Z'), marketOpen: true, timeZone: ET })!.text).toBe('Prices as of 11:00 AM');
    expect(stockPricesAsOf({ rows: rows(null, 'garbage'), fallback: null, nowMs: 0, marketOpen: true, timeZone: ET })).toBeNull();
  });
});
