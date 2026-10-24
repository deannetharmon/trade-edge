// features/portfolio/positions-workspace/__tests__/cardModel.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { assignmentStrip, buildPositionCard, cardBucketOf, compareCards, matchesSymbolSearch, shortDate, sortCards, updatedLabel, type PositionCard } from '../model/cardModel';
import { decodePositionsViewStored, DEFAULT_POSITIONS_VIEW_STORED, isCardsDisabled, resolvePositionsView } from '../model/positionsViewSetting';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P', strikePrice = 50) => ({ symbol: 'x', optionType, strikePrice, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 }) as unknown as PositionLeg;
const rec = (kind: string, intent: string | undefined, label = 'Label') => ({ kind, label, primaryReason: 'because', managementIntent: intent ? { intent, reasons: [] } : undefined }) as unknown as Position['recommendation'];
const pos = (o: Partial<Position>) => ({ key: 'k', symbol: 'AAA', strategy: 'PUT', legs: [leg('Short', 'P')], intent: 'income', quantity: 1, dte: 30, stockPrice: 60, entryPriceEffect: 'Credit', ...o }) as unknown as Position;
const card = (bucket: PositionCard['bucket'], dollarsAtRisk: number | null, dte: number, symbol = 'AAA'): PositionCard => ({ key: symbol + dte, position: { symbol, dte } as unknown as Position, bucket, verdictLabel: '', reason: null, pnl: null, pnlNote: '', dollarsAtRisk, chips: [], assignment: null, itmShortPut: false, unverifiedQuote: false, pctOfAccount: null, overSizing: false, stats: [] });

describe('verdict bucket', () => {
  it('no recommendation is Unjudged, never Hold', () => {
    expect(cardBucketOf(pos({ recommendation: undefined }))).toBe('Unjudged');
  });
  it('intent maps to the verdict module buckets', () => {
    expect(cardBucketOf(pos({ recommendation: rec('hold', 'HOLD_POSITION') }))).toBe('Hold');
    expect(cardBucketOf(pos({ recommendation: rec('close-winner', 'TAKE_PROFIT') }))).toBe('Close');
    expect(cardBucketOf(pos({ recommendation: rec('roll-soon', 'ROLL_POSITION') }))).toBe('Roll');
    expect(cardBucketOf(pos({ recommendation: rec('x', 'REDUCE_RISK') }))).toBe('Manage');
    expect(cardBucketOf(pos({ recommendation: rec('assignment-risk', 'ACCEPT_ASSIGNMENT') }))).toBe('Manage');
  });
  it('a hard rule lifts a Hold intent but never overrides a stronger one', () => {
    expect(cardBucketOf(pos({ recommendation: rec('earnings-risk', 'HOLD_POSITION') }))).toBe('Manage');
    expect(cardBucketOf(pos({ recommendation: rec('roll-soon', 'CUT_LOSSES') }))).toBe('Close');
  });
});

describe('sort: bucket, then dollars at risk, then DTE', () => {
  it('orders Close before Roll before Manage before Hold before Unjudged', () => {
    const sorted = [card('Unjudged', 1, 1), card('Hold', 1, 1), card('Manage', 1, 1), card('Roll', 1, 1), card('Close', 1, 1)].sort(compareCards);
    expect(sorted.map(c => c.bucket)).toEqual(['Close', 'Roll', 'Manage', 'Hold', 'Unjudged']);
  });
  it('within a bucket the larger dollars at risk comes first, unknown last', () => {
    const sorted = [card('Hold', null, 5, 'N'), card('Hold', 1000, 5, 'S'), card('Hold', 9000, 5, 'B')].sort(compareCards);
    expect(sorted.map(c => c.position.symbol)).toEqual(['B', 'S', 'N']);
  });
  it('ties on dollars go to the sooner expiry', () => {
    const sorted = [card('Hold', 500, 40, 'L'), card('Hold', 500, 7, 'E')].sort(compareCards);
    expect(sorted.map(c => c.position.symbol)).toEqual(['E', 'L']);
  });
  it('the sort menu options order and keep unknown P/L last', () => {
    const a = { ...card('Hold', 1, 1, 'A'), pnl: -50 }; const b = { ...card('Hold', 1, 1, 'B'), pnl: 20 }; const c = card('Hold', 1, 1, 'C');
    expect(sortCards([c, b, a], 'pnl-worst').map(x => x.position.symbol)).toEqual(['A', 'B', 'C']);
    expect(sortCards([c, a, b], 'pnl-best').map(x => x.position.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortCards([b, a, c], 'symbol').map(x => x.position.symbol)).toEqual(['A', 'B', 'C']);
  });
});

describe('card content', () => {
  it('an ITM Wheel short put is flagged and shows the assignment line from the break-even', () => {
    const p = pos({ intent: 'wheel', stockPrice: 40, legs: [leg('Short', 'P', 50)], breakEven: 48 } as Partial<Position>);
    const c = buildPositionCard(p, { pctOfTarget: null });
    expect(c.itmShortPut).toBe(true);
    expect(c.chips.some(x => x.id === 'moneyness' && x.tone === 'bad' && x.label.startsWith('ITM'))).toBe(true);
    expect(c.assignment?.shares).toBe(100);
  });
  it('Wheel and Acquire puts never get a No stop chip; an Income put does', () => {
    const base = { stopLossClassification: 'NO_STOP' } as Partial<Position>;
    expect(buildPositionCard(pos({ ...base, intent: 'wheel' }), { pctOfTarget: null }).chips.some(x => x.id === 'no-stop')).toBe(false);
    expect(buildPositionCard(pos({ ...base, intent: 'acquisition' }), { pctOfTarget: null }).chips.some(x => x.id === 'no-stop')).toBe(false);
    expect(buildPositionCard(pos({ ...base, intent: 'income' }), { pctOfTarget: null }).chips.some(x => x.id === 'no-stop')).toBe(true);
  });
  it('earnings before expiry reads "Earnings before Exp (date)" in amber', () => {
    const next = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const exp = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const c = buildPositionCard(pos({ nextEarningsDate: next, expDate: exp } as Partial<Position>), { pctOfTarget: null });
    const chip = c.chips.find(x => x.id === 'earnings');
    expect(chip?.label).toBe(`Earnings before Exp (${shortDate(next)})`);
    expect(chip?.tone).toBe('warn');
    expect(chip?.tone).toBe('warn');
  });
  it('a LEAP shows earnings only inside 30 days; a short-dated option keeps it for the whole life', () => {
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const leap = (e: number) => pos({ strategy: 'CALL', legs: [{ ...leg('Long', 'C'), symbol: 'UBER  270917C00067500' }], entryPriceEffect: 'Debit', dte: 329, entryDte: 400, nextEarningsDate: day(e), expDate: day(329) } as Partial<Position>);
    expect(buildPositionCard(leap(60), { pctOfTarget: null }).chips.some(x => x.id === 'earnings')).toBe(false);
    expect(buildPositionCard(leap(12), { pctOfTarget: null }).chips.some(x => x.id === 'earnings')).toBe(true);
    const near = pos({ nextEarningsDate: day(60), expDate: day(90), dte: 90 } as Partial<Position>);
    expect(buildPositionCard(near, { pctOfTarget: null }).chips.some(x => x.id === 'earnings')).toBe(true);
  });
  it('a verify-pricing recommendation sets the unverified-quote flag and its chip', () => {
    const c = buildPositionCard(pos({ recommendation: rec('verify-pricing', 'HOLD_POSITION') }), { pctOfTarget: null });
    expect(c.unverifiedQuote).toBe(true);
    expect(c.pnlNote).toBe('unverified quote');
    expect(c.chips.some(x => x.id === 'verify')).toBe(true);
  });
  it('a normal credit position shows the target percent under P/L', () => {
    expect(buildPositionCard(pos({ closeNowPnl: 40 } as Partial<Position>), { pctOfTarget: 80 }).pnlNote).toBe('if closed now · 80% of target');
  });
});

describe('% of account', () => {
  const csp = (maxRisk: number) => pos({ strategy: 'CSP', maxRisk, maxRiskReliable: true, identity: { quantity: 1 } } as unknown as Partial<Position>);
  it('is capital at risk over net liquidating value, amber only above 10%', () => {
    const over = buildPositionCard(csp(18500), { pctOfTarget: null, netLiquidity: 100000 });
    expect(over.pctOfAccount).toBeCloseTo(18.5, 5);
    expect(over.overSizing).toBe(true);
    expect(over.stats.find(x => x.label === '% of account')?.value).toBe('18.5%');
    const ok = buildPositionCard(csp(10000), { pctOfTarget: null, netLiquidity: 100000 });
    expect(ok.overSizing).toBe(false);
  });
  it('is absent when net liquidating value or the risk figure is unknown', () => {
    expect(buildPositionCard(csp(5000), { pctOfTarget: null, netLiquidity: null }).pctOfAccount).toBeNull();
    expect(buildPositionCard(csp(5000), { pctOfTarget: null }).stats.some(x => x.label === '% of account')).toBe(false);
  });
});

describe('symbol search and assignment strip', () => {
  it('matches tickers by prefix, several at once, empty matches all', () => {
    expect(matchesSymbolSearch('TQQQ', 'tq')).toBe(true);
    expect(matchesSymbolSearch('SOXL', 'tq, so')).toBe(true);
    expect(matchesSymbolSearch('UBER', 'tq')).toBe(false);
    expect(matchesSymbolSearch('UBER', '')).toBe(true);
  });
  it('counts every ITM Wheel put and nothing else', () => {
    const itmWheel = pos({ intent: 'wheel', stockPrice: 40, legs: [leg('Short', 'P', 50)], quantity: 2 });
    const otmWheel = pos({ intent: 'wheel', stockPrice: 60, legs: [leg('Short', 'P', 50)] });
    const itmIncome = pos({ intent: 'income', stockPrice: 40, legs: [leg('Short', 'P', 50)] });
    expect(assignmentStrip([itmWheel, otmWheel, itmIncome])).toEqual({ count: 1, shares: 200, symbols: ['AAA'] });
    expect(assignmentStrip([otmWheel])).toBeNull();
  });
});

describe('updated label', () => {
  it('turns stale after five minutes and is null without a time', () => {
    const now = Date.parse('2026-10-23T15:00:00Z');
    expect(updatedLabel('2026-10-23T14:59:00Z', now)?.stale).toBe(false);
    expect(updatedLabel('2026-10-23T14:50:00Z', now)).toMatchObject({ stale: true });
    expect(updatedLabel(null, now)).toBeNull();
  });
});

describe('opt-in: a fresh browser lands on Table', () => {
  it('no stored value, corrupt value, or unknown value all resolve to Table', () => {
    expect(resolvePositionsView(decodePositionsViewStored(null), false)).toBe('table');
    expect(resolvePositionsView(decodePositionsViewStored('{'), false)).toBe('table');
    expect(resolvePositionsView(decodePositionsViewStored(JSON.stringify({ setting: 'weird', last: 'cards' })), false)).toBe('table');
    expect(decodePositionsViewStored(null)).toEqual(DEFAULT_POSITIONS_VIEW_STORED);
  });
  it('Cards setting opens Cards; Last used follows the last view; the kill switch beats both', () => {
    expect(resolvePositionsView({ setting: 'cards', last: 'table' }, false)).toBe('cards');
    expect(resolvePositionsView({ setting: 'last', last: 'cards' }, false)).toBe('cards');
    expect(resolvePositionsView({ setting: 'last', last: 'table' }, false)).toBe('table');
    expect(resolvePositionsView({ setting: 'cards', last: 'cards' }, true)).toBe('table');
  });
  it('only the exact string true disables Cards', () => {
    expect(isCardsDisabled('true')).toBe(true);
    expect(isCardsDisabled(undefined)).toBe(false);
    expect(isCardsDisabled('1')).toBe(false);
  });
  it('chips keep two fixed rows and order: status on row 1, flags (incl. Wide market) on row 2', () => {
    const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const c = buildPositionCard(pos({ nextEarningsDate: d(5), expDate: d(30), dte: 30 } as Partial<Position>), { pctOfTarget: 60 });
    const rows = c.chips.map(x => x.row);
    expect([...rows].sort()).toEqual(rows);
    for (const x of c.chips) if (x.id === 'wide' || x.id === 'verify') expect(x.row).toBe(2);
    for (const x of c.chips) if (x.id === 'net-edge' || x.id === 'earnings') expect(x.row).toBe(2);
    for (const x of c.chips) if (x.id === 'no-stop' || x.id === 'moneyness' || x.id === 'target' || x.id === 'buffer') expect(x.row).toBe(1);
    expect(Math.max(...c.chips.map(x => x.row))).toBeLessThanOrEqual(2);
  });
});
