// STOCK-RSI-0002: RSI of the underlying on a held LEAP call's card.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LeapRsiChips, LeapRsiDetail, isLeapCall, leapOpenDate } from '../LeapRsi';
import type { Position } from '@/lib/portfolio-data/types';

const days = [...Array(40)].map((_, i) => { const d = new Date(Date.UTC(2026, 8, 25 + i)); return { date: d.toISOString().slice(0, 10), rsi: 40 + i / 2 }; });
const rsi = { rsi: 54.4, previous: 51, direction: 'up' as const, points: days };
const pos = (over: Partial<Position> = {}, leg: Record<string, unknown> = {}): Position => ({
  key: 'k1', symbol: 'UBER', strategy: 'Long Call', dte: 400, entryDte: 400,
  legs: [{ direction: 'Long', optionType: 'C', strikePrice: 67.5, openedAt: `${days[5].date}T15:00:00Z`, ...leg }],
  ...over,
} as unknown as Position);

describe('LEAP RSI', () => {
  it('recognises a long LEAP call only', () => {
    expect(isLeapCall(pos())).toBe(true);
    expect(isLeapCall(pos({ dte: 20, entryDte: 20 }))).toBe(false);
    expect(isLeapCall(pos({}, { optionType: 'P' }))).toBe(false);
    expect(isLeapCall(pos({}, { direction: 'Short' }))).toBe(false);
  });

  it('reads the open date from the broker leg', () => {
    expect(leapOpenDate(pos())).toBe(days[5].date);
    expect(leapOpenDate(pos({}, { openedAt: null }))).toBeNull();
  });

  it('shows the underlying RSI, the arrow, RSI at open and the Calls chip off the saved cutoff', () => {
    render(<LeapRsiChips position={pos()} rsi={rsi} cutoff={50} textFaint="" />);
    expect(screen.getByTestId('leap-rsi-k1')).toHaveTextContent('UBER RSI 54');
    expect(screen.getByTestId('leap-rsi-k1')).toHaveTextContent('at open');
    expect(screen.getByLabelText('rising')).toBeInTheDocument();
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
  });

  it('reads Wait below the cutoff, and never says Recovery on a LEAP', () => {
    render(<LeapRsiChips position={pos()} rsi={rsi} cutoff={60} textFaint="" />);
    expect(screen.getByText('Calls: Wait')).toBeInTheDocument();
  });

  it('shows a dash, not an estimate, when RSI is unavailable or the open is outside the window', () => {
    const { rerender } = render(<LeapRsiChips position={pos()} rsi={null} cutoff={50} textFaint="" />);
    expect(screen.getByTestId('leap-rsi-k1')).toHaveTextContent('RSI —');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
    rerender(<LeapRsiChips position={pos({}, { openedAt: '2024-01-02T10:00:00Z' })} rsi={rsi} cutoff={50} textFaint="" />);
    expect(screen.getByTestId('leap-rsi-k1')).not.toHaveTextContent('at open');
  });

  it('renders nothing while the RSI is still loading', () => {
    const { container } = render(<LeapRsiChips position={pos()} rsi={undefined} cutoff={50} textFaint="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('detail shows Now / Yesterday / At LEAP open, the sparkline, and the out-of-window note', () => {
    const { rerender } = render(<LeapRsiDetail position={pos()} rsi={rsi} cutoff={50} textFaint="" />);
    expect(screen.getByTestId('rsi-sparkline-UBER')).toBeInTheDocument();
    expect(screen.getByText('At LEAP open').nextSibling).not.toHaveTextContent('—');
    rerender(<LeapRsiDetail position={pos({}, { openedAt: '2024-01-02T10:00:00Z' })} rsi={rsi} cutoff={50} textFaint="" />);
    expect(screen.getByText(/opened before the last ~5 months/)).toBeInTheDocument();
  });
});

import { PositionCards } from '../PositionCards';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/portfolio-data/useHoldingRsi', () => ({ useHoldingRsi: () => ({ UBER: rsi }) }));

describe('Sell PMCC on a LEAP card', () => {
  const th = { textFaint: '', textMuted: '', border: '' };
  const opp = (over: Record<string, unknown> = {}) => ({ id: 'o1', kind: 'pmcc-short-call', status: 'review-income-call', symbol: 'UBER', positionKey: 'k1', accountNumber: 'A1', exactContract: 'UBER  270917C00067500', ...over });
  const renderCards = (positions: Position[], opportunities: unknown[], onFind = vi.fn()) => {
    render(<PositionCards positions={positions} order={c => c} pctOfTarget={() => null} incomeOpportunities={opportunities as never} onFindPmccShortCall={onFind} th={th} emptyText="none" />);
    return onFind;
  };
  it('shows the button on a LEAP with no short call and launches the held-LEAP review', async () => {
    const onFind = renderCards([pos()], [opp()]);
    await userEvent.click(screen.getByTestId('sell-pmcc'));
    expect(onFind).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
  });
  it('no button when a short call is already open, there is no exact contract, or it is not a LEAP', () => {
    renderCards([pos()], [opp({ pairedShort: { positionKey: 's1' } })]);
    expect(screen.queryByTestId('sell-pmcc')).not.toBeInTheDocument();
  });
  it('no button without an exact contract', () => {
    renderCards([pos()], [opp({ exactContract: null })]);
    expect(screen.queryByTestId('sell-pmcc')).not.toBeInTheDocument();
  });
  it('no button on a non-LEAP card', () => {
    renderCards([pos({ dte: 20, entryDte: 20 })], [opp()]);
    expect(screen.queryByTestId('sell-pmcc')).not.toBeInTheDocument();
  });
});
