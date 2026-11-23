// features/portfolio/positions-workspace/__tests__/tradeEvolutionModel.test.ts

// TRADE-EVOLUTION-CARDS-0001: the Cards view entry -> now panel. Strategy-aware colour, dashes for missing, RSI always gray.

import { describe, expect, it } from 'vitest';
import { buildTradeEvolution, openDateOf, type EvoRsi } from '../model/tradeEvolutionModel';
import type { Position } from '@/lib/portfolio-data/types';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P', extra: Record<string, unknown> = {}) => ({ symbol: 'x', optionType, strikePrice: 140, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1, ...extra });
const credit = (o: Partial<Position> = {}): Position => ({
  key: 'k', symbol: 'AAA', strategy: 'Bull Put Spread', legs: [leg('Short', 'P'), leg('Long', 'P', { strikePrice: 135 })], entryPriceEffect: 'Credit', dte: 30, entryDte: 45, dteAtEntry: 45,
  deltaAtEntry: -0.3, netDelta: -0.2, thetaAtEntry: 0.04, theta: 0.06, gammaAtEntry: -0.02, gamma: -0.06, vegaAtEntry: -0.1, netVega: -0.08,
  ivAtEntry: 40, iv: 35, ivrAtEntry: 60, ivr: 50, popAtEntry: 70, pop: 75, otmAtEntry: 8, buffer: 6.1, ...o,
}) as unknown as Position;
const debit = (o: Partial<Position> = {}): Position => credit({ strategy: 'Long Call', legs: [leg('Long', 'C')] as never, entryPriceEffect: 'Debit', dte: 400, entryDte: 400, dteAtEntry: 400, ...o });
const none: EvoRsi = { now: null, atOpen: null };
const tile = (p: Position, id: string, rsi = none) => buildTradeEvolution(p, rsi).tiles.find(t => t.id === id)!;

describe('trade evolution tiles', () => {
  it('credit position: ten tiles, shrinking exposure and falling IV read green, growing |gamma| outside 21 DTE stays gray', () => {
    const evo = buildTradeEvolution(credit(), none);
    expect(evo.tiles.map(t => t.id)).toEqual(['pop', 'delta', 'theta', 'gamma', 'vega', 'otm', 'iv', 'ivr', 'dte', 'rsi']);
    expect(tile(credit(), 'delta').tone).toBe('good');
    expect(tile(credit(), 'vega').tone).toBe('good');
    expect(tile(credit(), 'iv').tone).toBe('good');
    expect(tile(credit(), 'ivr').tone).toBe('good');
    expect(tile(credit(), 'pop').tone).toBe('good');
    expect(tile(credit(), 'gamma').tone).toBe('neutral');
  });

  it('gamma growing is amber only inside 21 DTE and never on a CSP or CC', () => {
    expect(tile(credit({ dte: 15 }), 'gamma').tone).toBe('warn');
    const csp = credit({ dte: 15, strategy: 'Cash Secured Put', legs: [leg('Short', 'P')] as never });
    expect(tile(csp, 'gamma').tone).toBe('neutral');
    const cc = credit({ dte: 15, strategy: 'Covered Call', legs: [leg('Short', 'C')] as never });
    expect(tile(cc, 'gamma').tone).toBe('neutral');
  });

  it('debit position: nine tiles, no OTM, no strip; colour is moved-toward-profit, so growing exposure and richer IV are green', () => {
    const p = debit({ deltaAtEntry: 0.5, netDelta: 0.6, gammaAtEntry: 0.01, gamma: 0.02, vegaAtEntry: 0.3, netVega: 0.4, thetaAtEntry: -0.05, theta: -0.08, ivAtEntry: 30, iv: 35, ivrAtEntry: 40, ivr: 50 });
    const evo = buildTradeEvolution(p, none);
    expect(evo.tiles.map(t => t.id)).toEqual(['pop', 'delta', 'theta', 'gamma', 'vega', 'iv', 'ivr', 'dte', 'rsi']);
    expect(evo.strip).toBeNull();
    for (const id of ['delta', 'gamma', 'vega', 'iv', 'ivr', 'pop']) expect(tile(p, id).tone).toBe('good');
    expect(tile(p, 'theta').tone).toBe('bad');
    const worse = debit({ deltaAtEntry: 0.5, netDelta: 0.3, ivAtEntry: 35, iv: 28 });
    expect(tile(worse, 'delta').tone).toBe('bad');
    expect(tile(worse, 'iv').tone).toBe('bad');
  });

  it('a missing entry value is a dash and gray, never a made-up number', () => {
    const p = credit({ deltaAtEntry: null, popAtEntry: null, otmAtEntry: null });
    expect(tile(p, 'delta')).toMatchObject({ value: '—', tone: 'neutral' });
    expect(tile(p, 'pop')).toMatchObject({ value: '—', tone: 'neutral' });
    expect(tile(p, 'otm').value).toBe('—');
  });

  it('OTM colours by the existing buffer rule (breached = red)', () => {
    expect(tile(credit({ buffer: 6.1, dte: 40 }), 'otm').tone).toBe('good');
    expect(tile(credit({ buffer: -1, dte: 40 }), 'otm').tone).toBe('bad');
  });

  it('RSI is always gray: open -> now, dash for an unknown open, dash when RSI is unavailable', () => {
    expect(tile(credit(), 'rsi', { now: 54.4, atOpen: 41.2 })).toMatchObject({ value: '41→54', tone: 'neutral', label: 'RSI (daily)' });
    expect(tile(credit(), 'rsi', { now: 54.4, atOpen: null }).value).toBe('—→54');
    expect(tile(credit(), 'rsi', none).value).toBe('—');
    expect(tile(debit(), 'rsi', { now: 30, atOpen: 60 }).tone).toBe('neutral');
  });

  it('reads the first-tracked date and the open date for RSI', () => {
    expect(buildTradeEvolution(credit({ entrySnapshotCreatedAt: '2026-11-05T14:00:00Z' }), none).since).toBe('2026-11-05');
    expect(buildTradeEvolution(credit(), none).since).toBeNull();
    expect(openDateOf(credit({ legs: [leg('Short', 'P', { openedAt: '2026-10-02T15:00:00Z' })] as never, entryDate: '2026-10-03' }))).toBe('2026-10-02');
    expect(openDateOf(credit({ entryDate: '2026-10-03' }))).toBe('2026-10-03');
    expect(openDateOf(credit({ entryDate: null }))).toBeNull();
  });
});

describe('debit hope line', () => {
  const longCall = (o: Partial<Position> = {}) => debit({ symbol: 'AAA', stockPrice: 100, stockPriceAtEntry: 110, iv: 40, dte: 400,
    legs: [leg('Long', 'C', { strikePrice: 120, avgOpenPrice: 10, currentPrice: 6, quantity: 1 })] as never, ...o });
  it('shows the move still needed now vs at open, and none on a credit position', () => {
    const hope = buildTradeEvolution(longCall(), none).hope;
    expect(hope).not.toBeNull();
    expect(hope!.neededNow).toBeCloseTo(30, 0);
    expect(hope!.neededAtOpen).toBeCloseTo(18.2, 0);
    expect(buildTradeEvolution(credit(), none).hope).toBeNull();
  });
  it('no price at open -> no "was" figure', () => {
    expect(buildTradeEvolution(longCall({ stockPriceAtEntry: null }), none).hope?.neededAtOpen).toBeNull();
  });
});
