// lib/portfolio-ai/__tests__/snapshot.test.ts

import { describe, expect, it } from 'vitest';
import {
  buildPortfolioAiSnapshot,
  extractFigures,
  findUnsupportedFigures,
  redactUnsupportedFigures,
  type PortfolioAiPositionInput,
} from '../snapshot';

const pos = (over: Partial<PortfolioAiPositionInput>): PortfolioAiPositionInput => ({
  key: 'k', symbol: 'AAA', strategy: 'Bull Put Spread', dte: 30,
  entryPnlPct: 10, maxRisk: 400, bufferPct: 8,
  recommendationLabel: 'Hold', recommendationDetail: null,
  needsClose: false, hitTarget: false, hasGtc: true, ...over,
});

const base = (positions: PortfolioAiPositionInput[], over = {}) => buildPortfolioAiSnapshot({
  generatedAt: '2026-10-13T15:00:00.000Z', positions, thetaPerDay: 12.5, leverageGroups: [], ...over,
});

describe('buildPortfolioAiSnapshot', () => {
  it('golden: totals, concentration and close-now count', () => {
    const s = base([
      pos({ key: '1', symbol: 'AAA', maxRisk: 600 }),
      pos({ key: '2', symbol: 'BBB', maxRisk: 300, needsClose: true, dte: 19, recommendationLabel: 'Close or roll' }),
      pos({ key: '3', symbol: 'AAA', maxRisk: 100 }),
    ]);
    const tile = (id: string) => s.tiles.find(t => t.id === id)!;
    expect(tile('at-risk').value).toBe('$1,000');
    expect(tile('concentration').value).toBe('70%');
    expect(tile('concentration').detail).toBe('AAA share of at-risk');
    expect(tile('close-now').value).toBe('1');
    expect(tile('theta').value).toBe('+$12.50');
    expect(s.watch[0]).toBe('BBB Bull Put Spread is at 19 DTE; the app suggests Close or roll.');
  });

  it('fails closed: unreliable max risk is excluded and reported, never estimated', () => {
    const s = base([pos({ key: '1', maxRisk: 500 }), pos({ key: '2', symbol: 'ZZZ', maxRisk: null })]);
    expect(s.tiles.find(t => t.id === 'at-risk')!.value).toBe('$500');
    expect(s.tiles.find(t => t.id === 'at-risk')!.detail).toContain('1 position excluded');
    expect(s.contextText).toContain('ZZZ Bull Put Spread | DTE 30 | entry P&L 10% | max risk not available');
    expect(s.notAvailable.join(' ')).toContain('Max risk for 1 position');
  });

  it('shows Not available when no position has reliable max risk or theta is unknown', () => {
    const s = base([pos({ maxRisk: null })], { thetaPerDay: null });
    expect(s.tiles.find(t => t.id === 'at-risk')!.value).toBe('Not available');
    expect(s.tiles.find(t => t.id === 'concentration')!.value).toBe('Not available');
    expect(s.tiles.find(t => t.id === 'theta')!.value).toBe('Not available');
    expect(s.contextText).toContain('NOT AVAILABLE (do not estimate these)');
  });

  it('handles an empty account', () => {
    const s = base([]);
    expect(s.positionCount).toBe(0);
    expect(s.notAvailable).toEqual([]);
    expect(s.contextText).toContain('No open positions.');
  });

  it('carries the canonical action into the context and instructs the AI not to contradict it', () => {
    const s = base([pos({ recommendationLabel: 'Take profit', recommendationDetail: 'Close at 50%' })]);
    expect(s.contextText).toContain('app suggests: Take profit (Close at 50%)');
    expect(s.contextText).toContain('AI NOTE:');
  });

  it('flags a tight buffer and a leveraged cluster in the watch list, capped at five lines', () => {
    const many = Array.from({ length: 8 }, (_, i) => pos({ key: String(i), symbol: `S${i}`, bufferPct: 2 }));
    expect(base(many).watch).toHaveLength(5);
    const s = base([pos({ bufferPct: 3.2 })], {
      leverageGroups: [{ economicUnderlying: 'GOOGL', memberSymbols: ['GGLL', 'GOOGL'], maxCapitalLoss: null, capitalRiskComplete: false }],
    });
    expect(s.watch[0]).toBe('AAA buffer is 3.2% with 30 DTE; the app suggests Hold.');
    expect(s.watch[1]).toContain('GGLL, GOOGL share one leveraged-ETF cluster on GOOGL');
    expect(s.notAvailable.join(' ')).toContain('leveraged-ETF cluster');
  });
});

describe('figure check', () => {
  const s = base([pos({ maxRisk: 400 }), pos({ key: '2', symbol: 'BBB', maxRisk: 600, entryPnlPct: 42 })]);

  it('extracts dollars and percents only', () => {
    expect(extractFigures('Risk $1,000 and 70% on 21 DTE, $2k').map(f => f.value)).toEqual([1000, 70, 2000]);
  });

  it('accepts figures present in the snapshot or typed by the trader', () => {
    expect(findUnsupportedFigures('At risk is $1,000 and BBB is up 42%.', s.allowedFigures)).toEqual([]);
    expect(findUnsupportedFigures('Selling $750 of risk frees cash.', s.allowedFigures, ['free up $750'])).toEqual([]);
  });

  it('flags and hides figures that are not in the snapshot', () => {
    expect(findUnsupportedFigures('You could lose $5,000 (35%).', s.allowedFigures)).toEqual(['$5,000', '35%']);
    const r = redactUnsupportedFigures('At risk $1,000 but you could lose $5,000.', s.allowedFigures);
    expect(r.text).toBe('At risk $1,000 but you could lose [figure hidden].');
    expect(r.removedCount).toBe(1);
  });
});
