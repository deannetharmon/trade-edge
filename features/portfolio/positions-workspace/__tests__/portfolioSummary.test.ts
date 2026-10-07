// features/portfolio/positions-workspace/__tests__/portfolioSummary.test.ts

import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position, PositionLeg } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import {
  buildPortfolioSummary, exposureTier, openingOrderCash, positionDayChange, positionDayChangeDetail, positionInSummaryGroup, positionWeekChange, summaryGroupForPosition,
} from '../model/portfolioSummary';

const NOW = Date.parse('2026-10-05T17:00:00Z'); // Monday 13:00 New York

const leg = (o: Partial<PositionLeg>): PositionLeg => ({
  symbol: 'X     261106P00120000', optionType: 'P', strikePrice: 120, direction: 'Short', quantity: 1,
  avgOpenPrice: 5.4, currentPrice: 5.35, closePrice: 5.84, openedAt: '2026-10-02T15:00:00Z', ...o,
} as PositionLeg);

function pos(o: Partial<Position> & { legs: PositionLeg[] }): Position {
  return {
    key: o.symbol ?? 'X', symbol: 'X', strategy: 'CSP', quantity: 1, dte: 31, entryDate: '2026-10-02',
    entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 540, pnl: 5, theta: 0.07,
    maxRisk: 12000, maxRiskReliable: true, structureAmbiguous: false, identity: { quantity: 1 }, snapshotHistory: [],
    ...o,
  } as unknown as Position;
}

const csp = (symbol: string, over: Partial<Position> = {}) => pos({ symbol, key: symbol, strategy: 'CSP', legs: [leg({})], ...over });
const leap = (symbol: string, over: Partial<Position> = {}) => pos({
  symbol, key: symbol, strategy: 'CALL', entryPriceEffect: 'Debit', entryCredit: 2080, pnl: -1038, maxRisk: 2080, dte: 400,
  legs: [leg({ optionType: 'C', direction: 'Long', strikePrice: 60, avgOpenPrice: 20.8, currentPrice: 10.42, closePrice: 10.41 })], ...over,
});
const bps = (symbol: string, over: Partial<Position> = {}) => pos({
  symbol, key: symbol, strategy: 'BPS', entryCredit: 150, pnl: 40, maxRisk: 350,
  legs: [leg({ strikePrice: 100, avgOpenPrice: 2.5 }), leg({ strikePrice: 95, direction: 'Long', avgOpenPrice: 1.0, currentPrice: 0.6, closePrice: 0.7 })], ...over,
});
const row = (position: Position, needsAttention = false) => ({ position, needsAttention });
const equity = (o: Partial<EquityHolding> = {}): EquityHolding => ({
  accountNumber: 'A', symbol: 'MSFT', direction: 'Long', quantity: 100, settledQuantity: 100, basis: 400, basisComplete: true,
  currentPrice: 410, marketValue: 41000, unrealizedPnl: 1000, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...o,
} as unknown as EquityHolding);

describe('groups', () => {
  it('classifies by risk profile using the existing strategy classification', () => {
    expect(summaryGroupForPosition(csp('SOXL'))).toBe('SHORT_PUTS');
    expect(summaryGroupForPosition(bps('SPY'))).toBe('SPREADS');
    expect(summaryGroupForPosition(pos({ symbol: 'MRNA', strategy: 'CALL', entryPriceEffect: 'Debit', dte: 46, legs: [leg({ optionType: 'C', direction: 'Long' })] }))).toBe('LONG_OPTIONS');
  });

  it('partitions the portfolio: every position in exactly one group, group totals add up to the total', () => {
    const rows = [row(csp('SOXL', { pnl: 88 })), row(csp('TQQQ', { pnl: -9 })), row(bps('SPY', { pnl: 40 })), row(leap('NFLX', { pnl: -1038 }))];
    const s = buildPortfolioSummary({ rows, equities: [equity()], pendingOrders: [], cashBalance: 50000, nowMs: NOW });
    expect(s.groups.reduce((n, g) => n + g.count, 0)).toBe(s.total.count);
    expect(s.total.count).toBe(5);
    const groupSum = s.groups.reduce((n, g) => n + (g.pnl.value ?? 0), 0);
    expect(groupSum).toBeCloseTo(s.total.pnl.value as number, 2);
    expect(s.total.pnl.value).toBeCloseTo(88 - 9 + 40 - 1038 + 1000, 2); // equals the rows
  });

  it('hides groups the trader does not hold', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('SOXL'))], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.groups.map(g => g.key)).toEqual(['SHORT_PUTS']);
  });

  it('a filter only narrows the list: the strip is built from the whole portfolio', () => {
    const all = [csp('SOXL'), bps('SPY')];
    expect(all.filter(p => positionInSummaryGroup(p, 'SPREADS')).map(p => p.symbol)).toEqual(['SPY']);
    expect(all.filter(p => positionInSummaryGroup(p, null))).toHaveLength(2);
  });
});

describe('partial data never shows as complete', () => {
  it('missing P/L: total counts what is priced and drops the return %', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('A', { pnl: 10 })), row(csp('B', { pnl: null as unknown as number }))], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.total.pnl).toEqual({ value: 10, included: 1, of: 2 });
    expect(s.groups[0].returnPct).toBeNull();
  });

  it('return % on credit for short premium, on cost for long options', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('A', { pnl: 135 }))], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.groups[0]).toMatchObject({ basis: 'credit', returnPct: 25 });
  });

  it('needs-attention count comes from the rows', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('A'), true), row(csp('B'))], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.total.needsAttention).toBe(1);
  });
});

describe('1D change (previous close)', () => {
  it('short leg: previous close 5.84, now 5.35 -> +$49', () => {
    expect(positionDayChange(csp('SOXL'), NOW)).toBe(49);
  });

  it('a leg opened today counts from its open price', () => {
    expect(positionDayChange(csp('MULL', { legs: [leg({ openedAt: '2026-10-05T14:00:00Z', avgOpenPrice: 0.5, currentPrice: 0.42, closePrice: 0 })] }), NOW)).toBe(8);
  });

  it('missing previous close -> null, and the tile says partial', () => {
    const missing = csp('B', { legs: [leg({ closePrice: null })] });
    expect(positionDayChange(missing, NOW)).toBeNull();
    const s = buildPortfolioSummary({ rows: [row(csp('A')), row(missing)], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.total.dayChange).toEqual({ value: 49, included: 1, of: 2 });
  });
});

describe('PL-DAY-ROW-0001: per-row 1D with a reason', () => {
  it('value, no reason, not since-open for a leg held overnight', () => {
    expect(positionDayChangeDetail(csp('SOXL'), NOW)).toEqual({ value: 49, reason: null, sinceOpen: false });
  });
  it('legs opened today are flagged since open', () => {
    const d = positionDayChangeDetail(csp('MULL', { legs: [leg({ openedAt: '2026-10-05T14:00:00Z', avgOpenPrice: 0.5, currentPrice: 0.42, closePrice: 0 })] }), NOW);
    expect(d).toEqual({ value: 8, reason: null, sinceOpen: true });
  });
  it('missing data gives a reason, never zero', () => {
    expect(positionDayChangeDetail(csp('A', { legs: [leg({ closePrice: undefined })] }), NOW)).toMatchObject({ value: null, reason: 'previous close unavailable' });
    expect(positionDayChangeDetail(csp('B', { legs: [leg({ currentPrice: undefined })] }), NOW)).toMatchObject({ value: null, reason: 'current option price unavailable' });
    expect(positionDayChangeDetail(csp('C', { legs: [] }), NOW)).toMatchObject({ value: null, reason: 'no option legs' });
  });
  it('Total tile names positions lacking 1D, with reasons (stock holdings included)', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('SOXL')), row(csp('A', { legs: [leg({ closePrice: undefined })] }))], equities: [equity({ symbol: 'SNDK' })], pendingOrders: [], cashBalance: 1000, nowMs: NOW });
    expect(s.total.dayMissing).toEqual([
      { symbol: 'A', reason: 'previous close unavailable' },
      { symbol: 'SNDK', reason: 'no previous-close data for stock holdings yet' },
    ]);
  });
});

describe('1W change (daily snapshots)', () => {
  it('against the latest snapshot at least 7 days old', () => {
    const p = csp('A', { pnl: 100, entryDate: '2026-09-01', snapshotHistory: [{ date: '2026-09-27', pnl: 20 }, { date: '2026-09-28', pnl: 30 }, { date: '2026-10-01', pnl: 90 }] as Position['snapshotHistory'] });
    expect(positionWeekChange(p, NOW)).toEqual({ value: 70, since: '2026-09-28' });
  });

  it('opened within the week: counts from entry', () => {
    expect(positionWeekChange(csp('A', { pnl: 25, entryDate: '2026-10-02' }), NOW)).toEqual({ value: 25, since: '2026-10-02' });
  });

  it('older position with no history: unavailable, never guessed', () => {
    expect(positionWeekChange(csp('A', { pnl: 25, entryDate: '2026-08-01' }), NOW)).toEqual({ value: null, since: null });
  });
});

describe('cash to deploy (no margin)', () => {
  const order = (o: Partial<PendingOrder>): PendingOrder => ({ id: 'o', legs: [], limitPrice: null, priceEffect: null, ...o } as unknown as PendingOrder);

  it('cash minus short-put collateral, spread max loss and opening orders', () => {
    const opening = order({ legs: [{ symbol: 's', action: 'Sell to Open', optionType: 'P', strikePrice: 50, quantity: 1 }] });
    const s = buildPortfolioSummary({ rows: [row(csp('A')), row(bps('B'))], equities: [], pendingOrders: [opening], cashBalance: 20000, nowMs: NOW });
    expect(s.cashToDeploy).toMatchObject({ value: 20000 - 12000 - 350 - 5000, usingMargin: false, excluded: 0 });
  });

  it('closing orders do not hold cash', () => {
    expect(openingOrderCash(order({ legs: [{ symbol: 's', action: 'Buy to Close', optionType: 'P', strikePrice: 120, quantity: 1 }], limitPrice: 2.7 }))).toBe(0);
  });

  it('a debit opening order holds its cost; a credit spread its max loss', () => {
    expect(openingOrderCash(order({ legs: [{ symbol: 'l', action: 'Buy to Open', optionType: 'C', strikePrice: 60, quantity: 2 }], limitPrice: 3 }))).toBe(600);
    expect(openingOrderCash(order({
      legs: [{ symbol: 's', action: 'Sell to Open', optionType: 'P', strikePrice: 100, quantity: 1 }, { symbol: 'l', action: 'Buy to Open', optionType: 'P', strikePrice: 95, quantity: 1 }],
      limitPrice: 1.5, priceEffect: 'Credit',
    }))).toBe(350);
  });

  it('negative means relying on margin', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('A'))], equities: [], pendingOrders: [], cashBalance: 5000, nowMs: NOW });
    expect(s.cashToDeploy).toMatchObject({ value: -7000, usingMargin: true });
  });

  it('a missing cash balance is Unavailable, never $0', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('A'))], equities: [], pendingOrders: [], cashBalance: null, nowMs: NOW });
    expect(s.cashToDeploy).toMatchObject({ value: null, reason: 'Cash balance unavailable' });
  });
});

describe('largest exposure', () => {
  it('largest single-underlying share of capital, amber only above the limit', () => {
    const rows = [row(csp('SOXL', { maxRisk: 16721 })), row(csp('TQQQ', { maxRisk: 5719 })), row(csp('AVL', { maxRisk: 3500 }))];
    const s = buildPortfolioSummary({ rows, equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.largest).toMatchObject({ symbol: 'SOXL', capital: 16721, sharePct: 64, overLimit: true, limitPct: 25, tier: 'red' });
    const relaxed = buildPortfolioSummary({ rows, equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW, exposureLimitPct: 70 });
    expect(relaxed.largest?.overLimit).toBe(false);
  });
});

describe('CONCENTRATION-TIERS-0001', () => {
  it('tiers: muted under 15, amber 15-24, red from 25', () => {
    expect(exposureTier(14)).toBe('normal');
    expect(exposureTier(15)).toBe('amber');
    expect(exposureTier(24)).toBe('amber');
    expect(exposureTier(25)).toBe('red');
  });
  it('leveraged-ETF cluster totals every leveraged underlying (MULL included) and ignores plain stocks', () => {
    const rows = [row(csp('GGLL', { maxRisk: 5000 })), row(csp('MULL', { maxRisk: 3000 })), row(csp('METU', { maxRisk: 2000 })), row(csp('AVL', { maxRisk: 10000 }))];
    const s = buildPortfolioSummary({ rows, equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.leveragedCluster).toMatchObject({ symbols: ['GGLL', 'METU', 'MULL'], capital: 10000, sharePct: 50, tier: 'red' });
  });
  it('no cluster when none is held', () => {
    const s = buildPortfolioSummary({ rows: [row(csp('AVL'))], equities: [], pendingOrders: [], cashBalance: 1, nowMs: NOW });
    expect(s.leveragedCluster).toBeNull();
  });
});
