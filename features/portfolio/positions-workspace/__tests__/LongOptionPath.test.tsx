// LONG-OPTION-PATH-0001: the user story's NFLX Sep-17-2027 $70 call bought at $20.85.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { buildLongOptionPath, longStrikeChipLabel } from '../model/longOptionPath';
import { LongOptionPathPanel } from '../LongOptionPathPanel';
import type { Position } from '@/lib/portfolio-data/types';

const pos = (stock: number, leg: Record<string, unknown> = {}): Position => ({
  symbol: 'NFLX', stockPrice: stock,
  legs: [{ direction: 'Long', optionType: 'C', strikePrice: 70, avgOpenPrice: 20.85, currentPrice: 7.6, quantity: 1, ...leg }],
} as unknown as Position);

describe('buildLongOptionPath: the story numbers', () => {
  const path = buildLongOptionPath(pos(63.42))!;
  it('stock $63.42, $6.58 below the $70 strike, $27.43 below the $90.85 breakeven', () => {
    expect(path.breakeven).toBeCloseTo(90.85, 2);
    expect(path.toStrike).toBeCloseTo(6.58, 2);
    expect(path.toBreakeven).toBeCloseTo(27.43, 2);
  });
  it('$0.00 intrinsic, the whole $7.60 is extrinsic', () => {
    expect(path.intrinsic).toBe(0);
    expect(path.extrinsic).toBeCloseTo(7.6, 2);
    expect(path.hasIntrinsic).toBe(false);
  });
  it('the status message is the plain-language sentence from the story', () => {
    expect(path.status).toBe('NFLX is below your strike, so this call has no intrinsic value today. Its current value is entirely time and volatility value. At expiration, NFLX must be above $90.85 to recover your original cost.');
  });
  it('the chip says distance to strike, never OTM', () => {
    expect(longStrikeChipLabel(path, 10.4)).toBe('10.4% below strike');
    expect(longStrikeChipLabel(buildLongOptionPath(pos(71.7))!, 1.7)).toBe('1.7% above strike');
  });
});

describe('other cases', () => {
  it('above the strike but under breakeven: part intrinsic, still short of breakeven', () => {
    const p = buildLongOptionPath(pos(75, { currentPrice: 9 }))!;
    expect(p.intrinsic).toBe(5);
    expect(p.extrinsic).toBe(4);
    expect(p.status).toContain('$5.00 of this option');
    expect(p.status).toContain('must be above $90.85');
  });
  it('past breakeven', () => {
    expect(buildLongOptionPath(pos(95, { currentPrice: 25 }))!.status).toMatch(/would recover its cost/);
  });
  it('a long put mirrors: breakeven is strike minus premium, stock above the strike is no intrinsic', () => {
    const p = buildLongOptionPath(pos(80, { optionType: 'P', strikePrice: 70, avgOpenPrice: 5, currentPrice: 1 }))!;
    expect(p.breakeven).toBe(65);
    expect(p.toStrike).toBe(10);
    expect(p.status).toContain('NFLX is above your strike');
    expect(p.status).toContain('must be below $65.00');
    expect(longStrikeChipLabel(p, 12.5)).toBe('12.5% above strike');
  });
  it('null for shorts, spreads, and missing data; no mark means no extrinsic claim', () => {
    expect(buildLongOptionPath(pos(63.42, { direction: 'Short' }))).toBeNull();
    expect(buildLongOptionPath(pos(63.42, { avgOpenPrice: null }))).toBeNull();
    expect(buildLongOptionPath({ ...pos(63.42), legs: [...pos(63.42).legs, ...pos(63.42).legs] } as Position)).toBeNull();
    const noMark = buildLongOptionPath(pos(63.42, { currentPrice: null }))!;
    expect(noMark.extrinsic).toBeNull();
    expect(noMark.status).not.toMatch(/entirely time/);
  });
});

describe('LongOptionPathPanel', () => {
  it('draws stock, strike, breakeven in that order with the gaps and the two value labels', () => {
    render(<LongOptionPathPanel path={buildLongOptionPath(pos(63.42))!} textFaint="" />);
    expect(screen.getByLabelText('Price path')).toHaveAttribute('data-order', 'stock>strike>breakeven');
    const items = within(screen.getByLabelText('Price path')).getAllByRole('listitem').map(li => li.textContent);
    expect(items).toEqual(['NFLX $63.42', 'Strike $70.00$6.58 to go', 'Breakeven $90.85$27.43 to go']);
    expect(screen.getByText('Intrinsic value (locked in)').nextSibling).toHaveTextContent('$0.00');
    expect(screen.getByText('Extrinsic value (future possibility)').nextSibling).toHaveTextContent('$7.60');
    expect(screen.getByText(/Profit at expiration begins above strike \+ premium paid/)).toBeInTheDocument();
  });
});

import { PositionCards } from '../PositionCards';
import { vi } from 'vitest';
vi.mock('@/components/portfolio-data/useHoldingRsi', () => ({ useHoldingRsi: () => ({}) }));

describe('breakeven chip placement', () => {
  it('sits in the same group as the distance-to-strike chip', () => {
    render(<PositionCards positions={[{ ...pos(63.42), key: 'k1', dte: 313, entryDte: 313, strategy: 'Long Call' } as unknown as Position]} order={c => c} pctOfTarget={() => null} th={{ textFaint: '', textMuted: '', border: '' }} emptyText="none" />);
    const strike = screen.getByTestId('card-moneyness');
    expect(strike).toHaveTextContent('below strike');
    expect(strike.parentElement).toContainElement(screen.getByTestId('card-breakeven'));
    expect(screen.getByTestId('card-breakeven')).toHaveTextContent('Breakeven $90.85');
  });
});

import { breakevenProbability, breakevenTone, probabilityLabel } from '../model/longOptionPath';
import { buildPositionCard } from '../model/cardModel';

describe('breakeven probability (Alan: lognormal, risk-neutral, 4% rate)', () => {
  it('matches the reference values', () => {
    expect(breakevenProbability('C', 63.42, 90.85, 35, 313)).toBeCloseTo(0.12197, 4);
    expect(breakevenProbability('C', 63.42, 90.85, 50, 313)).toBeCloseTo(0.17523, 4);
    expect(breakevenProbability('P', 80, 65, 40, 200)).toBeCloseTo(0.26525, 4);
  });
  it('is null without IV or time left, never a guess', () => {
    expect(breakevenProbability('C', 63.42, 90.85, null, 313)).toBeNull();
    expect(breakevenProbability('C', 63.42, 90.85, 35, 0)).toBeNull();
    expect(breakevenProbability('C', 63.42, 90.85, 0, 313)).toBeNull();
  });
  it('labels and bands', () => {
    expect(probabilityLabel(0.122)).toBe('~12%');
    expect(probabilityLabel(0.004)).toBe('<1%');
    expect(probabilityLabel(0.995)).toBe('>99%');
    expect(breakevenTone(0.45)).toBe('ok');
    expect(breakevenTone(0.2)).toBe('warn');
    expect(breakevenTone(0.12)).toBe('bad');
    expect(breakevenTone(null)).toBe('info');
  });
  it('the path carries the needed move and the probability', () => {
    const p = buildLongOptionPath({ ...pos(63.42), iv: 35, dte: 313 } as Position)!;
    expect(p.neededMovePct).toBeCloseTo(43.25, 2);
    expect(p.probability).toBeCloseTo(0.12197, 4);
  });
});

describe('card chips for a bought LEAP call', () => {
  const leap = { ...pos(63.42), key: 'k1', dte: 313, entryDte: 313, iv: 35, strategy: 'Long Call' } as unknown as Position;
  it('breakeven chip shows the needed move; chance chip shows the model estimate; all three share a tone', () => {
    const chips = buildPositionCard(leap, { pctOfTarget: null }).chips;
    const by = (id: string) => chips.find(c => c.id === id)!;
    expect(by('moneyness').label).toBe('10.4% below strike');
    expect(by('breakeven').label).toBe('Breakeven $90.85 · +43.25%');
    expect(by('chance').label).toBe('~12% chance');
    expect([by('moneyness').tone, by('breakeven').tone, by('chance').tone]).toEqual(['bad', 'bad', 'bad']);
  });
});

describe('IV source (0001D): the contract first, the stock as fallback', () => {
  const withIv = (legIv: number | null | undefined, stockIv: number | null) => buildLongOptionPath({ ...pos(63.42, { currentIv: legIv }), iv: stockIv, dte: 313 } as Position)!;
  it('uses the contract IV when the broker supplied it', () => {
    const p = withIv(28, 35);
    expect(p.ivPct).toBe(28);
    expect(p.ivSource).toBe('contract');
    expect(p.probability).toBeCloseTo(breakevenProbability('C', 63.42, 90.85, 28, 313)!, 6);
  });
  it('falls back to the stock IV, and says so', () => {
    const p = withIv(null, 35);
    expect(p.ivPct).toBe(35);
    expect(p.ivSource).toBe('stock');
    render(<LongOptionPathPanel path={p} textFaint="" />);
    expect(screen.getByTestId('path-chance')).toHaveTextContent("the stock's IV");
  });
  it('the panel names the contract IV when used', () => {
    render(<LongOptionPathPanel path={withIv(28, 35)} textFaint="" />);
    expect(screen.getByTestId('path-chance')).toHaveTextContent("28% this contract's IV");
  });
  it('no IV from either source: no chance, no source', () => {
    const p = withIv(undefined, null);
    expect(p.probability).toBeNull();
    expect(p.ivSource).toBeNull();
  });
});
