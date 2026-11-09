// features/screener/components/__tests__/CcStrikeGrid.test.tsx
// CC-WHEEL-0001 S4 -- clicking inside the grid must not reach the result card (which collapses on click), and a click
// reports the trade the summary describes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { CcStrikeGrid } from '../CcStrikeGrid';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';

const th = { border: 'border-x', text: 't', textMuted: 'm', textFaint: 'f' };
const cell = (strike: number, over: Partial<CcGridCell> = {}): CcGridCell => ({
  expiration: '2030-01-10', dte: 10, strike, delta: 0.25, bid: 1, ask: 1.1, premiumPerShare: 1.05, openInterest: 500, occSymbol: `C${strike}`,
  belowFloor: false, wide: false, thinOi: false, calledAwayTotal: (strike - 80) * 100 + 105, calledAwayPct: 2, premiumTotal: 105, notCalledBasis: 78.95, ...over,
});
const grid: CcGrid = {
  basis: 80, floor: 80, stockPrice: 70, contracts: 1, expirations: [{ expiration: '2030-01-10', dte: 10 }],
  cells: [cell(82), cell(85)], left: { inTheMoney: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 },
};

describe('CcStrikeGrid', () => {
  beforeEach(() => { window.localStorage.clear(); });
  it('clicks inside the grid do not reach the card', async () => {
    const parent = vi.fn();
    render(<div onClick={parent}><CcStrikeGrid grid={grid} th={th} /></div>);
    await userEvent.click(screen.getByRole('button', { name: 'Balanced Δ0.20–0.35' }));
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(parent).not.toHaveBeenCalled();
  });
  it('reports the trade the summary describes, starting from the scan pick', async () => {
    const onAnchor = vi.fn();
    render(<CcStrikeGrid grid={grid} th={th} initial={{ expiration: '2030-01-10', strike: 82 }} onAnchorChange={onAnchor} />);
    expect(onAnchor).toHaveBeenLastCalledWith(expect.objectContaining({ strike: 82 }));
    await userEvent.click(screen.getByLabelText('85 call 2030-01-10'));
    expect(onAnchor).toHaveBeenLastCalledWith(expect.objectContaining({ strike: 85 }));
    expect(screen.getByTestId('cc-grid-summary')).toHaveTextContent('$85 strike');
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
  it('hides calls that pay under the minimum and says how many', async () => {
    const mixed: CcGrid = { ...grid, cells: [cell(82), cell(85, { premiumPerShare: 0.02, bid: 0.02, ask: 0.03 })] };
    render(<CcStrikeGrid grid={mixed} th={th} />);
    expect(screen.queryByLabelText('85 call 2030-01-10')).toBeNull();
    expect(screen.getByTestId('cc-grid-hidden')).toHaveTextContent('1 paying under $25');
    await userEvent.click(screen.getByRole('button', { name: 'Any' }));
    expect(screen.getByLabelText('85 call 2030-01-10')).toBeTruthy();
  });
  it('starts with below-basis calls shown when the trader already allowed them, and hidden otherwise', () => {
    const g: CcGrid = { ...grid, cells: [cell(82), cell(70, { belowFloor: true })] };
    const { unmount } = render(<CcStrikeGrid grid={g} th={th} belowBasisAllowed />);
    expect(screen.getByLabelText('70 call 2030-01-10')).toBeInTheDocument();
    expect((screen.getByLabelText(/Show below cost basis/) as HTMLInputElement).checked).toBe(true);
    unmount();
    render(<CcStrikeGrid grid={g} th={th} />);
    expect(screen.queryByLabelText('70 call 2030-01-10')).not.toBeInTheDocument();
    expect((screen.getByLabelText(/Show below cost basis/) as HTMLInputElement).checked).toBe(false);
  });
});
