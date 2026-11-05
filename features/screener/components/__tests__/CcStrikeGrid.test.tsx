// features/screener/components/__tests__/CcStrikeGrid.test.tsx
// CC-WHEEL-0001 S4 -- clicking inside the grid must not reach the result card (which collapses on click), and a click
// reports the trade the summary describes.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
