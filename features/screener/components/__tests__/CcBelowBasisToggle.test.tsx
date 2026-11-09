// features/screener/components/__tests__/CcBelowBasisToggle.test.tsx
//
// CC-VISIBILITY-0001: the empty-scan explanation and the inline below-basis opt-in. Default OFF; saving keeps a typed
// basis; clearing with no typed basis removes the entry; nothing shows when the floor is not the blocker.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DisqualifiedSection } from '../DisqualifiedSection';
import { CcBelowBasisToggle } from '../CcBelowBasisToggle';
import type { ScreenResult } from '@/lib/scans/types';
import type { CcBasisSettings } from '@/lib/ccBasis/ccBasisSettings';

const hook = vi.hoisted(() => ({ settings: {} as CcBasisSettings, save: vi.fn() }));
vi.mock('../../useCcBasisSettings', () => ({ useCcBasisSettings: () => ({ settings: hook.settings, ready: true, save: hook.save }) }));

beforeEach(() => { hook.settings = {}; hook.save.mockReset(); hook.save.mockResolvedValue(true); });

describe('CcBelowBasisToggle', () => {
  it('explains the floor with the numbers and starts unchecked', () => {
    render(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={false} />);
    expect(screen.getByText(/Your floor is your cost basis, \$78\.75, 37% above the price, \$57\.35/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Allow below-basis calls for TQQQ/)).not.toBeChecked();
  });

  it('checking it saves the opt-in for this symbol only and says to rescan', async () => {
    const { rerender } = render(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={false} />);
    fireEvent.click(screen.getByLabelText(/Allow below-basis calls for TQQQ/));
    await waitFor(() => expect(hook.save).toHaveBeenCalledWith('TQQQ', { basis: null, allowBelowBasis: true }));
    hook.settings = { TQQQ: { basis: null, allowBelowBasis: true } };
    rerender(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Rescan to apply');
  });

  it('keeps a typed basis when turning the opt-in on, and clears the entry when turning off with none typed', async () => {
    hook.settings = { TQQQ: { basis: 80, allowBelowBasis: false } };
    const { rerender } = render(<CcBelowBasisToggle symbol="TQQQ" floor={80} price={57.35} allowBelowBasis={false} />);
    fireEvent.click(screen.getByLabelText(/Allow below-basis calls for TQQQ/));
    await waitFor(() => expect(hook.save).toHaveBeenCalledWith('TQQQ', { basis: 80, allowBelowBasis: true }));

    hook.save.mockClear();
    hook.settings = { TQQQ: { basis: null, allowBelowBasis: true } };
    rerender(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={false} />);
    fireEvent.click(screen.getByLabelText(/Allow below-basis calls for TQQQ/));
    await waitFor(() => expect(hook.save).toHaveBeenCalledWith('TQQQ', null));
  });

  it('shows nothing when the floor is not the blocker (opted in at scan time, floor at the price, no numbers)', () => {
    const { container, rerender } = render(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={true} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CcBelowBasisToggle symbol="TQQQ" floor={57.35} price={57.35} allowBelowBasis={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CcBelowBasisToggle symbol="TQQQ" floor={null} price={null} allowBelowBasis={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a failed save', async () => {
    hook.save.mockResolvedValue(false);
    render(<CcBelowBasisToggle symbol="TQQQ" floor={78.75} price={57.35} allowBelowBasis={false} />);
    fireEvent.click(screen.getByLabelText(/Allow below-basis calls for TQQQ/));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  });
});

describe('DisqualifiedSection with a covered-call floor result', () => {
  const cc = (over: Partial<ScreenResult> = {}): ScreenResult => ({
    symbol: 'TQQQ', strategy: 'CC', price: 57.35, ivr: 50, qualified: false, bestCandidate: null,
    failReasons: ['No qualifying call found'], ccBrief: 'No call in Δ0.20–0.35 · nearest Δ0.03 at $79 · floor $78.75',
    ccFloorInfo: { floor: 78.75, price: 57.35, allowBelowBasis: false },
    checks: { ivr: { status: 'pass', value: '50', reason: 'ok' } } as any, ...over,
  });

  it('puts the explanation and the toggle right under the row, without expanding anything', () => {
    render(<DisqualifiedSection results={[cc()]} hasQualifiedCandidates={false} />);
    expect(screen.getByTestId('cc-below-basis-TQQQ')).toBeInTheDocument();
  });

  it('does not show it on non-covered-call rows or when there is no floor info', () => {
    render(<DisqualifiedSection results={[cc({ strategy: 'CSP', symbol: 'AAPL' }), cc({ symbol: 'MSFT', ccFloorInfo: undefined })]} hasQualifiedCandidates={false} />);
    expect(screen.queryByTestId(/cc-below-basis-/)).not.toBeInTheDocument();
  });
});
