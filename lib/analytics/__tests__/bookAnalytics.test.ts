import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import type { ClosedTrade } from '@/lib/tradeLog/types';
import { buildPerformanceReport } from '@/lib/tradeLog/performanceMetrics';
import { buildPortfolioSummary, DEFAULT_EXPOSURE_LIMIT_PCT } from '@/features/portfolio/positions-workspace/model/portfolioSummary';
import { presetDates } from '@/lib/performance/period';
import { buildBookAnalytics, positionSizeBand, tradesInPeriod, type BookAnalyticsInput } from '../bookAnalytics';

// ANALYTICS-0001 A1: golden fixture, every expected number worked out by hand (Alan). Fixtures are small on purpose.
const TODAY = '2026-10-06';
const NOW = Date.parse('2026-10-06T17:00:00Z');

const trade = (id: string, symbol: string, strategy: ClosedTrade['strategy'], closeDate: string, pnl: number, dteAtEntry: number, over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id, symbol, strategy, openDate: '2026-01-01', closeDate, openTime: '10:00', openDow: 1, expiry: '2026-12-18', holdDays: 5, strikes: '500P',
  creditReceived: 100, closePrice: 0, pnl, pnlPct: 0, outcome: pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'SCRATCH', quantity: 1, fees: 0,
  dteAtClose: 5, dteAtEntry, exitType: 'TARGET_HIT', reconstructionStatus: 'COMPLETE', closureMechanism: 'CLOSED',
  openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [], ...over,
} as ClosedTrade);

const TRADES: ClosedTrade[] = [
  trade('t1', 'SPY', 'CSP', '2026-08-20', 100, 35),
  trade('t2', 'SOXL', 'CSP', '2026-09-10', -50, 28),
  trade('t3', 'QQQ', 'BPS', '2026-09-25', 80, 44, { strikes: '400/395' }),
  trade('t4', 'NVDA', 'CSP', '2026-10-02', 120, 10),
  trade('t5', 'SPY', 'CSP', '2026-10-05', 60, 50),
  trade('t6', 'IWM', 'CSP', '2026-10-03', -999, 30, { reconstructionStatus: 'INCOMPLETE' }),
  trade('t7', 'AAPL', 'CSP', '2026-10-01', 500, 30, { excluded: true }),
  trade('t8', 'MSFT', 'CSP', '2026-07-31', 40, 35),
  trade('t9', 'AMD', 'CSP', '2026-10-04', 10, Number.NaN),
];

const leg = (o: Partial<PositionLeg>): PositionLeg => ({
  symbol: 'X     261106P00120000', optionType: 'P', strikePrice: 120, direction: 'Short', quantity: 1,
  avgOpenPrice: 5.4, currentPrice: 5.35, closePrice: 5.84, openedAt: '2026-10-02T15:00:00Z', ...o,
} as PositionLeg);
function pos(o: Partial<Position> & { legs: PositionLeg[] }): Position {
  return {
    key: o.symbol ?? 'X', symbol: 'X', strategy: 'CSP', quantity: 1, dte: 31, entryDate: '2026-10-02',
    entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 540, pnl: 5, theta: 0.07,
    maxRisk: 12000, maxRiskReliable: true, structureAmbiguous: false, identity: { quantity: 1 }, snapshotHistory: [], ...o,
  } as unknown as Position;
}
const csp = (symbol: string, over: Partial<Position> = {}) => pos({ symbol, key: symbol, strategy: 'CSP', legs: [leg({})], ...over });
const bps = (symbol: string, over: Partial<Position> = {}) => pos({
  symbol, key: symbol, strategy: 'BPS', entryCredit: 150, pnl: 40, maxRisk: 350,
  legs: [leg({ strikePrice: 100, avgOpenPrice: 2.5 }), leg({ strikePrice: 95, direction: 'Long', avgOpenPrice: 1.0, currentPrice: 0.6, closePrice: 0.7 })], ...over,
});
const leap = (symbol: string, over: Partial<Position> = {}) => pos({
  symbol, key: symbol, strategy: 'CALL', entryPriceEffect: 'Debit', entryCredit: 2080, pnl: -1038, maxRisk: 2080, dte: 400,
  legs: [leg({ optionType: 'C', direction: 'Long', strikePrice: 60, avgOpenPrice: 20.8, currentPrice: 10.42, closePrice: 10.41 })], ...over,
});
const row = (position: Position, needsAttention = false) => ({ position, needsAttention });
const equity = (o: Partial<EquityHolding> = {}): EquityHolding => ({
  accountNumber: 'A', symbol: 'MSFT', direction: 'Long', quantity: 100, settledQuantity: 100, basis: 400, basisComplete: true,
  currentPrice: 410, marketValue: 41000, unrealizedPnl: 1000, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...o,
} as unknown as EquityHolding);

// Capital: SOXL 12,000 + NVDU 8,000 + NVDA 6,000 + SPY 350 + NFLX 2,080 + MSFT shares 40,000 = 68,430.
const ROWS = [
  row(csp('SOXL', { pnl: 88, maxRisk: 12000, dte: 31 })),
  row(csp('NVDU', { pnl: -9, maxRisk: 8000, dte: 5 }), true),
  row(csp('NVDA', { pnl: 30, maxRisk: 6000, dte: 40 })),
  row(bps('SPY', { pnl: 40, maxRisk: 350, dte: 30 })),
  row(leap('NFLX', { pnl: -1038 })),
];
const base: BookAnalyticsInput = {
  trades: TRADES, period: { from: '2026-09-01', to: TODAY }, today: TODAY,
  rows: ROWS, equities: [equity()], pendingOrders: [], cashBalance: 50000, nowMs: NOW, netLiquidity: 100000,
};
const run = (over: Partial<BookAnalyticsInput> = {}) => buildBookAnalytics({ ...base, ...over });

describe('realized, open and total', () => {
  it('realized = included trades closed in the period; incomplete and user-excluded never counted', () => {
    const b = run();
    // In period: t2 -50, t3 80, t4 120, t5 60, t9 10 = 220 over 5 trades (t6 incomplete, t7 excluded, t1/t8 outside).
    expect(b.realized).toMatchObject({ trades: 5, pnl: 220, wins: 4, losses: 1, winRate: 80, expectancy: 44, needsReview: 1, excludedByUser: 1 });
  });
  it('test 1: Realized + Open = Total when the period ends today', () => {
    const b = run();
    expect(b.open.value).toBe(111); // 88 - 9 + 30 + 40 - 1038 + 1000
    expect(b.total).toEqual({ value: 331, reason: null, openComplete: true });
    expect(b.total.value).toBeCloseTo((b.realized.pnl as number) + (b.open.value as number), 2);
  });
  it('test 9: Total is withheld when the period does not end today (two moments are never mixed)', () => {
    const b = run({ period: { from: '2026-09-01', to: '2026-10-05' } });
    expect(b.period.endsToday).toBe(false);
    expect(b.total.value).toBeNull();
    expect(b.total.reason).toMatch(/does not end today/);
    expect(b.realized.pnl).toBe(220); // t5 closes 10-05, the last day, so it is still inside
  });
  it('Total is withheld, with a reason, when open P&L is unavailable', () => {
    const b = run({ rows: [row(csp('A', { pnl: null as unknown as number }))], equities: [] });
    expect(b.total.value).toBeNull();
    expect(b.total.reason).toMatch(/Open P&L is unavailable/);
  });
});

describe('test 2: monthly realized', () => {
  it('sums to Realized and equals the Performance report for the same window', () => {
    const b = run();
    expect(b.monthly.months.map(m => [m.month, m.stats.pnl])).toEqual([['2026-09', 30], ['2026-10', 190]]);
    expect(b.monthly.months.reduce((n, m) => n + m.stats.pnl, 0)).toBe(b.realized.pnl);
    expect(b.realized.pnl).toBe(buildPerformanceReport(tradesInPeriod(TRADES, b.period)).headline.pnl);
  });
  it('open P&L is its own figure, never added into a month', () => {
    const b = run();
    expect(b.monthly.openPnl).toEqual(b.open);
    expect(b.monthly.months.find(m => m.month === '2026-10')?.stats.pnl).toBe(190);
  });
  it('marks months the period cuts as partial, and the month containing today as in progress', () => {
    const b = run({ period: { from: '2026-09-15', to: TODAY } });
    expect(b.monthly.months.map(m => [m.month, m.partial, m.inProgress])).toEqual([['2026-09', true, false], ['2026-10', true, true]]);
    const whole = run({ period: { from: '2026-09-01', to: '2026-09-30' } });
    expect(whole.monthly.months.map(m => [m.month, m.partial, m.inProgress])).toEqual([['2026-09', false, false]]);
  });
});

describe('test 9: period filter', () => {
  it('is inclusive by close date at both ends', () => {
    const b = run({ period: { from: '2026-09-10', to: '2026-09-25' } }); // t2 closes 09-10, t3 closes 09-25
    expect(b.realized).toMatchObject({ trades: 2, pnl: 30 });
    const tight = run({ period: { from: '2026-09-11', to: '2026-09-24' } });
    expect(tight.realized.trades).toBe(0);
  });
  it('a preset gives the same result as its custom from/to equivalent', () => {
    const preset = presetDates('3M', TODAY);
    const a = run({ period: preset });
    const c = run({ period: { from: preset.from, to: preset.to } });
    expect(a).toEqual(c);
    expect(preset).toEqual({ from: '2026-07-06', to: TODAY });
    expect(a.realized).toMatchObject({ trades: 7, pnl: 360 }); // t1 100, t8 40 (07-31 is inside 07-06..10-06), t2, t3, t4, t5, t9 = 220
  });
});

describe('capital and groups', () => {
  it('test 3: matches the Positions page summary for the same moment', () => {
    const b = run();
    const s = buildPortfolioSummary({ rows: ROWS, equities: [equity()], pendingOrders: [], cashBalance: 50000, nowMs: NOW });
    expect(b.summary).toEqual(s);
    expect(b.capitalDeployed).toEqual(s.total.capital);
    expect(b.capitalDeployed.value).toBe(68430);
  });
  it('test 4: capital by type sums to total capital and the groups partition the portfolio', () => {
    const b = run();
    expect(b.capitalByType.groups.reduce((n, g) => n + (g.capital.value ?? 0), 0)).toBeCloseTo(68430, 2);
    expect(b.capitalByType.groups.reduce((n, g) => n + g.count, 0)).toBe(b.summary.total.count);
    expect(b.summary.total.count).toBe(6);
    const held = new Set(b.capitalByType.groups.map(g => g.key));
    expect(b.capitalByType.notHeld.every(g => !held.has(g.key))).toBe(true);
    expect(b.capitalByType.groups.length + b.capitalByType.notHeld.length).toBe(8);
  });
});

describe('concentration by economic underlying', () => {
  it('test 5: shares sum to 100%; the limit marker uses the existing 25% constant; 15% is the watch level', () => {
    const b = run();
    expect(b.concentration.limitPct).toBe(DEFAULT_EXPOSURE_LIMIT_PCT);
    expect(b.concentration.watchPct).toBe(15);
    expect(b.concentration.rows.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100, 6);
    // MSFT 40,000/68,430 = 58.5% -> 58 OVER_LIMIT; NVDA+NVDU 14,000 = 20.5% -> 20 WATCH; SOXL 12,000 = 17.5% -> 18 WATCH.
    expect(b.concentration.rows.map(r => [r.underlying, r.capital, r.status])).toEqual([
      ['MSFT', 40000, 'OVER_LIMIT'], ['NVDA', 14000, 'WATCH'], ['SOXL', 12000, 'WATCH'], ['NFLX', 2080, 'OK'], ['SPY', 350, 'OK'],
    ]);
  });
  it('test 8: a catalogued leveraged product rolls into its economic underlying and is tagged; an uncatalogued ticker is not', () => {
    const b = run();
    const nvda = b.concentration.rows.find(r => r.underlying === 'NVDA');
    expect(nvda?.hasLeveraged).toBe(true);
    expect(nvda?.members).toEqual([
      { symbol: 'NVDU', capital: 8000, leveraged: true, signedLeverageMultiplier: 2 },
      { symbol: 'NVDA', capital: 6000, leveraged: false, signedLeverageMultiplier: null },
    ]);
    expect(b.concentration.rows.find(r => r.underlying === 'SOXL')?.hasLeveraged).toBe(false); // not in the issuer catalog: never inferred from the name
  });
  it('the largest exposure agrees with the Positions page tile', () => {
    const b = run();
    expect(b.summary.largest).toMatchObject({ symbol: 'MSFT', sharePct: 58, overLimit: true });
    expect(b.concentration.rows[0]).toMatchObject({ underlying: 'MSFT', status: 'OVER_LIMIT' });
  });
  it('is unavailable, with a reason, when total capital is unknown', () => {
    const b = run({ rows: [], equities: [] });
    expect(b.concentration).toMatchObject({ available: false, rows: [] });
  });
});

describe('position size against net liquidation value', () => {
  it('bands follow the rule set: up to 5, 5-10, above 10 percent', () => {
    expect(positionSizeBand(5)).toBe('WITHIN_RULE');
    expect(positionSizeBand(5.01)).toBe('UPPER_RANGE');
    expect(positionSizeBand(10)).toBe('UPPER_RANGE');
    expect(positionSizeBand(10.01)).toBe('OVER_MAX');
  });
  it('test 6: band counts plus positions with no capital basis equal the positions in the summary', () => {
    const b = run();
    // On 100,000: SOXL 12%, MSFT 40% over; NVDU 8%, NVDA 6% upper; SPY 0.35%, NFLX 2.08% within.
    expect(b.positionSize.bands.map(x => [x.key, x.count])).toEqual([['WITHIN_RULE', 2], ['UPPER_RANGE', 2], ['OVER_MAX', 2]]);
    expect(b.positionSize.bands.reduce((n, x) => n + x.count, 0) + b.positionSize.noCapitalBasis).toBe(b.summary.total.count);
    expect(b.positionSize.positions[0]).toMatchObject({ key: 'EQUITY:MSFT', band: 'OVER_MAX' });
  });
  it('is Unavailable, never deployed capital, when net liquidation value is missing or not positive', () => {
    for (const netLiquidity of [null, undefined, 0, -5, Number.NaN]) {
      const b = run({ netLiquidity });
      expect(b.positionSize).toMatchObject({ available: false, bands: [], positions: [] });
      expect(b.positionSize.reason).toMatch(/net liquidation/);
    }
  });
  it('counts a position with no capital basis separately instead of hiding it', () => {
    const b = run({ rows: [...ROWS, row(csp('NOBASIS', { maxRiskReliable: false }))] });
    expect(b.positionSize.noCapitalBasis).toBe(1);
    expect(b.positionSize.bands.reduce((n, x) => n + x.count, 0) + 1).toBe(b.summary.total.count);
  });
});

describe('risk summary', () => {
  it('needs-attention from the summary tile; expiring within 7 days; concentration alerts', () => {
    const b = run();
    expect(b.risk).toEqual({ needsAttention: 1, expiringWithinDays: 1, expiringDays: 7, overLimit: 1, watch: 2 });
    expect(b.risk.needsAttention).toBe(b.summary.total.needsAttention);
  });
  it('expiring is dte <= 7 (the existing critical-expiration rule), options only', () => {
    const b = run({ rows: [row(csp('A', { dte: 7 })), row(csp('B', { dte: 8 })), row(csp('C', { dte: 0 }))] });
    expect(b.risk.expiringWithinDays).toBe(2);
  });
});

describe('test 7: DTE at entry', () => {
  it('bands 0-14, 15-29, 30-45, 46+; counts plus unknown equal the included trades', () => {
    const b = run();
    expect(b.dteAtEntry.bands.map(x => [x.key, x.stats.trades, x.inTarget])).toEqual([['0-14', 1, false], ['15-29', 1, false], ['30-45', 1, true], ['46+', 1, false]]);
    expect(b.dteAtEntry.unknown).toBe(1); // t9: entry DTE not a number
    expect(b.dteAtEntry.bands.reduce((n, x) => n + x.stats.trades, 0) + b.dteAtEntry.unknown).toBe(b.realized.trades);
  });
  it('band edges: 14 -> 0-14, 15 -> 15-29, 29 -> 15-29, 30 -> 30-45, 45 -> 30-45, 46 -> 46+', () => {
    const edge = [14, 15, 29, 30, 45, 46].map((d, i) => trade(`e${i}`, 'SPY', 'CSP', '2026-10-01', 10, d));
    const b = run({ trades: edge });
    expect(b.dteAtEntry.bands.map(x => x.stats.trades)).toEqual([1, 2, 2, 1]);
  });
});

describe('monthly short-put P&L', () => {
  it('is the included CSP trades by close month: no spreads, no incomplete, no excluded', () => {
    const b = run();
    expect(b.shortPutMonthly.map(m => [m.month, m.stats.trades, m.stats.pnl])).toEqual([['2026-09', 1, -50], ['2026-10', 3, 190]]);
  });
});

describe('open P&L by position', () => {
  it('largest absolute contributors first, equities included, each with its key for the link', () => {
    const b = run({ topOpenPositions: 3 });
    expect(b.openByPosition.rows.map(r => [r.key, r.pnl])).toEqual([['NFLX', -1038], ['EQUITY:MSFT', 1000], ['SOXL', 88]]);
    expect(b.openByPosition.of).toBe(6);
    expect(b.openByPosition.unpriced).toBe(0);
  });
  it('a position without a price is counted, not shown as zero', () => {
    const b = run({ rows: [row(csp('A', { pnl: 10 })), row(csp('B', { pnl: null as unknown as number }))], equities: [] });
    expect(b.openByPosition).toMatchObject({ of: 2, unpriced: 1 });
    expect(b.openByPosition.rows.map(r => r.key)).toEqual(['A']);
  });
});
