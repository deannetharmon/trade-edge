// lib/portfolio/__tests__/cutLossesAvailability.test.ts

import { describe, expect, it } from 'vitest';
import type { ActionType, Position, PositionLeg } from '@/lib/portfolio-data/types';
import { assignmentIsThePlan, cutLossesAvailable } from '@/lib/portfolio/cutLossesAvailability';

const leg = (o: Partial<PositionLeg> = {}): PositionLeg => ({
  symbol: 'TQQQ  261120P00080000', optionType: 'P', strikePrice: 80, direction: 'Short', quantity: 1,
  avgOpenPrice: 2.5, currentPrice: 3.1, currentDelta: null, ...o,
} as PositionLeg);

const pos = (o: Partial<Position> = {}): Position => ({
  key: 'k', symbol: 'TQQQ', strategy: 'CSP', legs: [leg()], quantity: 1, pnl: -60, intent: 'acquisition', ...o,
} as unknown as Position);

const cc = (o: Partial<Position> = {}) => pos({
  symbol: 'AAPL', strategy: 'CC', intent: 'wheel',
  legs: [leg({ symbol: 'AAPL  261120C00200000', optionType: 'C', strikePrice: 200 })],
  stockPosition: { symbol: 'AAPL', quantity: 100, averageOpenPrice: 190, currentPrice: 210 },
  ...o,
} as Partial<Position>);

const HOLD: ActionType = 'HOLD';

describe('CUTLOSS-ACQUIRE-0001', () => {
  it('Acquire CSP at a loss, recommended Hold: no Cut Losses', () => {
    expect(assignmentIsThePlan(pos())).toBe(true);
    expect(cutLossesAvailable(pos(), HOLD)).toBe(false);
    expect(cutLossesAvailable(pos(), null)).toBe(false);
  });

  it('Acquire CSP recommended Cut Losses: offered', () => {
    expect(cutLossesAvailable(pos(), 'CUT_LOSSES')).toBe(true);
  });

  it('Wheel covered call at a loss, recommended Hold: no Cut Losses', () => {
    expect(assignmentIsThePlan(cc())).toBe(true);
    expect(cutLossesAvailable(cc(), HOLD)).toBe(false);
    expect(cutLossesAvailable(cc(), 'CUT_LOSSES')).toBe(true);
  });

  it('Income CSP and unset intent at a loss: unchanged (offered)', () => {
    expect(cutLossesAvailable(pos({ intent: 'income' }), HOLD)).toBe(true);
    expect(cutLossesAvailable(pos({ intent: 'undecided' }), HOLD)).toBe(true);
    expect(cutLossesAvailable(pos({ intent: undefined as unknown as Position['intent'] }), HOLD)).toBe(true);
  });

  it('Acquire intent on a structure that is not a short put or covered call: unchanged', () => {
    const spread = pos({ strategy: 'BPS', legs: [leg(), leg({ symbol: 'TQQQ  261120P00075000', strikePrice: 75, direction: 'Long' })] });
    expect(assignmentIsThePlan(spread)).toBe(false);
    expect(cutLossesAvailable(spread, HOLD)).toBe(true);
  });

  it('no loss: not offered unless recommended (all intents)', () => {
    expect(cutLossesAvailable(pos({ intent: 'income', pnl: 20 }), HOLD)).toBe(false);
    expect(cutLossesAvailable(pos({ intent: 'income', pnl: null as unknown as number }), 'CUT_LOSSES')).toBe(true);
  });

  it('batch selection: Cut Losses targets exclude Acquire/Wheel positions on Hold', () => {
    const selected = [pos({ key: 'acq' }), pos({ key: 'inc', intent: 'income' }), cc({ key: 'whl' }), pos({ key: 'acqCut' })];
    const canonical: Record<string, ActionType> = { acq: 'HOLD', inc: 'HOLD', whl: 'HOLD', acqCut: 'CUT_LOSSES' };
    expect(selected.filter(p => cutLossesAvailable(p, canonical[p.key])).map(p => p.key)).toEqual(['inc', 'acqCut']);
  });
});
