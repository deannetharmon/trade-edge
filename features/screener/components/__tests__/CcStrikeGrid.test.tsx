// features/screener/components/__tests__/CcStrikeGrid.test.tsx
// CC-WHEEL-0001 S4 + CC-PMCC-GUIDANCE-0001 -- clicking inside the grid must not reach the result card (which collapses on
// click); a click reports the call the headline describes; wide and low-pay calls are never picks; no below-cost call exists.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { CcStrikeGrid } from '../CcStrikeGrid';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';

const th = { border: 'border-x', text: 't', textMuted: 'm', textFaint: 'f' };
const cell = (strike: number, over: Partial<CcGridCell> = {}): CcGridCell => ({
  expiration: '2030-01-10', dte: 10, strike, delta: 0.25, bid: 1, ask: 1.1, premiumPerShare: 1.05, openInterest: 500, occSymbol: `C${strike}`,
  wide: false, thinOi: false, calledAwayTotal: (strike - 80) * 100 + 105, calledAwayPct: 2, premiumTotal: 105, notCalledBasis: 78.95, ...over,
});
const grid: CcGrid = {
  basis: 80, floor: 80, stockPrice: 70, contracts: 1, expirations: [{ expiration: '2030-01-10', dte: 10 }],
  cells: [cell(82), cell(85)], left: { inTheMoney: 0, belowCost: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 },
};

describe('CcStrikeGrid', () => {
  beforeEach(() => { window.localStorage.clear(); });
  it('clicks inside the grid do not reach the card', async () => {
    const parent = vi.fn();
    render(<div onClick={parent}><CcStrikeGrid grid={grid} th={th} /></div>);
    await userEvent.click(screen.getByRole('button', { name: 'Balanced POP 65–80%' }));
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(parent).not.toHaveBeenCalled();
  });
  it('reports the trade the summary describes, starting from the scan pick', async () => {
    const onAnchor = vi.fn();
    render(<CcStrikeGrid grid={grid} th={th} initial={{ expiration: '2030-01-10', strike: 82 }} onAnchorChange={onAnchor} />);
    expect(onAnchor).toHaveBeenLastCalledWith(expect.objectContaining({ strike: 82 }));
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(onAnchor).toHaveBeenLastCalledWith(expect.objectContaining({ strike: 85 }));
    expect(screen.getByTestId('cc-headline')).toHaveTextContent('Sell 1 $85C · Exp Jan 10');
  });
  it('"I would sell at $X" selects the lowest strike at or above X and says so when it is not exact', async () => {
    const onAnchor = vi.fn();
    const parent = vi.fn();
    render(<div onClick={parent}><CcStrikeGrid grid={grid} th={th} initial={{ expiration: '2030-01-10', strike: 82 }} onAnchorChange={onAnchor} /></div>);
    await userEvent.type(screen.getByLabelText('Price I would sell my shares at'), '84');
    await userEvent.click(screen.getByText('Find the call'));
    expect(onAnchor).toHaveBeenLastCalledWith(expect.objectContaining({ strike: 85 }));
    expect(screen.getByRole('status')).toHaveTextContent('closest at or above it is $85');
    expect(parent).not.toHaveBeenCalled();
  });
  it('clicking a cell moves the highlight only: the table does not re-center or reshuffle', async () => {
    const wide: CcGrid = { ...grid, cells: [82, 83, 84, 85, 86, 87, 88, 89, 90, 91].map(k => cell(k)) };
    render(<CcStrikeGrid grid={wide} th={th} />);
    const labels = () => screen.getAllByLabelText(/ call 2030-01-10$/).map(e => e.getAttribute('aria-label'));
    const before = labels();
    expect(before.length).toBeLessThan(10);
    await userEvent.click(screen.getByLabelText(before[0]!));
    expect(labels()).toEqual(before);
    await userEvent.click(screen.getByLabelText(before[before.length - 1]!));
    expect(labels()).toEqual(before);
  });
  it('a call under the minimum stays in the grid, marked, and is not a pick; Any (floor $10) makes a $12 call a pick', async () => {
    const mixed: CcGrid = { ...grid, cells: [cell(82), cell(85, { premiumPerShare: 0.12, bid: 0.12, ask: 0.12 })] };
    render(<CcStrikeGrid grid={mixed} th={th} initial={{ expiration: '2030-01-10', strike: 82 }} />);
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(screen.getByTestId('cc-headline')).toHaveTextContent('$85C · Exp Jan 10 · pays too little');
    await userEvent.click(screen.getByRole('button', { name: 'Any' }));
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(screen.getByTestId('cc-headline')).toHaveTextContent('Sell 1 $85C');
  });
  it('a wide call shows the bid price, a price gap and "not a pick", and Review order is off', async () => {
    const onReview = vi.fn();
    const g: CcGrid = { ...grid, cells: [cell(82), cell(85, { bid: 0.3, ask: 0.55, premiumPerShare: 0.42, wide: true })] };
    render(<CcStrikeGrid grid={g} th={th} initial={{ expiration: '2030-01-10', strike: 82 }} onReview={onReview} />);
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(screen.getByTestId('cc-headline')).toHaveTextContent('not a pick');
    expect(screen.getByTestId('cc-fact-fill')).toHaveTextContent('Price gap too big');
    expect(screen.getByTestId('cc-review-order')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('82 call 2030-01-10'));
    expect(screen.getByTestId('cc-review-order')).toBeEnabled();
    await userEvent.click(screen.getByTestId('cc-review-order'));
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ strike: 82 }));
  });
  it('Small & safe: nothing meets the minimum, so the best call with POP 90% or more is chosen and tagged', () => {
    const g: CcGrid = { ...grid, cells: [cell(85, { delta: 0.07, bid: 0.14, ask: 0.15, premiumPerShare: 0.14 }), cell(90, { delta: 0.04, bid: 0.11, ask: 0.12, premiumPerShare: 0.11 })] };
    render(<CcStrikeGrid grid={g} th={th} />);
    expect(screen.getByTestId('cc-small-safe-tag')).toHaveTextContent('SMALL & SAFE');
    expect(screen.getByTestId('cc-headline')).toHaveTextContent('Sell 1 $85C');
  });
  it('S1: when no call fits, it says so with the real numbers', () => {
    const g: CcGrid = { ...grid, cells: [cell(85, { delta: 0.3, bid: 0.14, ask: 0.15, premiumPerShare: 0.14 })] };
    render(<CcStrikeGrid grid={g} th={th} />);
    expect(screen.getByTestId('cc-none-fits')).toHaveTextContent('No call fits.');
    expect(screen.getByTestId('cc-none-fits')).toHaveTextContent('$14');
    expect(screen.queryByTestId('cc-decision')).toBeNull();
  });
  it('R1: there is no below-cost switch', () => {
    render(<CcStrikeGrid grid={grid} th={th} />);
    expect(screen.queryByLabelText(/below cost basis/i)).toBeNull();
  });
  it('S7: "Show the calls" lists every call with POP, what you would collect, the price gap and why it is outside', async () => {
    const g: CcGrid = { ...grid, cells: [cell(82), cell(85, { bid: 0.3, ask: 0.55, premiumPerShare: 0.42, wide: true })] };
    render(<CcStrikeGrid grid={g} th={th} />);
    await userEvent.click(screen.getByText('Show the calls'));
    const t = screen.getByTestId('cc-calls-table');
    expect(t).toHaveTextContent('$82C');
    expect(t).toHaveTextContent('Price gap too big, never a pick');
  });
});
