// lib/__tests__/cellDetailPanel.test.tsx
//
// OPTMAP-0001 S4a: the cell panel shows the scenario's numbers and never labels anything good/bad/recommended.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CellDetailPanel from '@/features/trade-map/CellDetailPanel';
import { cellDetail } from '@/lib/trademap/cellDetail';
import { DEFAULT_PRICING_PARAMS } from '@/lib/trademap/gridModel';
import type { TradeLeg } from '@/lib/trademap/strategyLegs';

const th = { text: '', textFaint: '', border: '' };
const exp = '2026-12-18';
const legs: TradeLeg[] = [
  { right: 'P', side: 'short', strike: 45, expiration: exp, quantity: 1, entryPrice: 1.9, iv: 1.2 },
  { right: 'P', side: 'long', strike: 40, expiration: exp, quantity: 1, entryPrice: 0.45, iv: 1.2 },
];

describe('CellDetailPanel', () => {
  it('shows P/L, chance of profit, the four Greeks and each leg delta for a selected cell', () => {
    const d = cellDetail(legs, 45, '2026-12-11', '2026-11-17', DEFAULT_PRICING_PARAMS, 1.2)!;
    render(<CellDetailPanel th={th} detail={d} selected movePct={-3.8} onClear={() => {}} />);
    expect(screen.getByText('If the stock is $45 on Dec 11')).toBeTruthy();
    for (const label of ['P/L', 'CHANCE OF PROFIT', 'DELTA', 'GAMMA', 'THETA', 'VEGA']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(/Short 45 put · delta/)).toBeTruthy();
    expect(screen.getByText(/-3\.8% from now/)).toBeTruthy();
    expect(screen.getByText(/24 days from now · 7 days left to expiration/)).toBeTruthy();
    expect(screen.getByText(/Your legs if the stock is \$45:/)).toBeTruthy();
  });
  it('Clear calls onClear; with nothing selected there is no Clear and the title says today', () => {
    const d = cellDetail(legs, 46.76, '2026-11-17', '2026-11-17', DEFAULT_PRICING_PARAMS, 1.2)!;
    const onClear = vi.fn();
    const { rerender } = render(<CellDetailPanel th={th} detail={d} selected movePct={0} onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear (Esc)'));
    expect(onClear).toHaveBeenCalledTimes(1);
    rerender(<CellDetailPanel th={th} detail={d} selected={false} movePct={null} onClear={onClear} />);
    expect(screen.queryByText('Clear (Esc)')).toBeNull();
    expect(screen.getByText('Today at $46.76')).toBeTruthy();
  });
  it('at expiration the chance of profit is a dash, not a number', () => {
    const d = cellDetail(legs, 43, exp, '2026-11-17', DEFAULT_PRICING_PARAMS, 1.2)!;
    render(<CellDetailPanel th={th} detail={d} selected movePct={0} onClear={() => {}} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('result is final at expiration')).toBeTruthy();
  });
});
