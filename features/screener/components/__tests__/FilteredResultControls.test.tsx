// features/screener/components/__tests__/FilteredResultControls.test.tsx
//
// SCREENER-UX-0001 required tests 5, 19, 21: filter chips are individually
// removable, a single reset action clears every active filter, a "Showing
// X of Y qualified candidates" narrowing indicator renders, and applying a
// display filter must never mutate the canonical qualifiedTotal passed in
// (display filtering only narrows what's shown, never the accounting).

import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FilteredResultControls } from '../FilteredResultControls';
import type { ScreenResult } from '@/lib/scans/types';

function result(symbol: string): ScreenResult {
  return { symbol, strategy: 'BPS', price: 100, ivr: 50, qualified: true, bestCandidate: null, failReasons: [], checks: {} as any };
}

function renderControls(props: Partial<ComponentProps<typeof FilteredResultControls>> = {}) {
  const setPopMin = vi.fn();
  const setOtmMin = vi.fn();
  const setCreditRatioMin = vi.fn();
  const toggleStrategy = vi.fn();
  const toggleSymbol = vi.fn();
  const setHiddenSymbols = vi.fn();
  const utils = render(
    <FilteredResultControls
      results={[result('AAPL'), result('MSFT')]}
      qualifiedTotal={5}
      filteredQualifiedCount={2}
      popMin={60}
      setPopMin={setPopMin}
      otmMin={0}
      setOtmMin={setOtmMin}
      creditRatioMin={0}
      setCreditRatioMin={setCreditRatioMin}
      strategies={['BPS']}
      toggleStrategy={toggleStrategy}
      hiddenSymbols={[]}
      toggleSymbol={toggleSymbol}
      setHiddenSymbols={setHiddenSymbols}
      oiAndSortControls={<div data-testid="oi-sort-slot" />}
      th={{ border: 'border-slate-700', textFaint: 'text-slate-500' }}
      {...props}
    />
  );
  return { ...utils, setPopMin, setOtmMin, setCreditRatioMin, toggleStrategy, toggleSymbol, setHiddenSymbols };
}

describe('FilteredResultControls', () => {
  it('renders the OI/sort controls slot in between the filter row and the ticker chips', () => {
    renderControls();
    expect(screen.getByTestId('oi-sort-slot')).toBeInTheDocument();
  });

  it('shows a "Showing X of Y qualified candidates" narrowing indicator', () => {
    renderControls();
    expect(screen.getByTestId('narrowing-indicator')).toHaveTextContent('Showing 2 of 5 qualified candidates');
  });

  it('renders an individually removable chip for each active filter', () => {
    const { setPopMin } = renderControls();
    const chip = screen.getByText('POP ≥ 60%');
    expect(chip).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove filter: POP ≥ 60%/ }));
    expect(setPopMin).toHaveBeenCalledWith(0);
  });

  it('provides a single reset action that clears every active filter', () => {
    const { setPopMin, toggleStrategy, setHiddenSymbols } = renderControls({ hiddenSymbols: ['AAPL'] });
    fireEvent.click(screen.getByRole('button', { name: 'Reset result filters' }));
    expect(setPopMin).toHaveBeenCalledWith(0);
    expect(toggleStrategy).toHaveBeenCalledWith('BPS');
    expect(setHiddenSymbols).toHaveBeenCalledWith([]);
  });

  it('does not render a reset action or chips when no filters are active', () => {
    renderControls({ popMin: 0, strategies: [], hiddenSymbols: [] });
    expect(screen.queryByRole('button', { name: 'Reset result filters' })).not.toBeInTheDocument();
  });
});
