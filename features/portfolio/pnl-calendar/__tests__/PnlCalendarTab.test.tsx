// features/portfolio/pnl-calendar/__tests__/PnlCalendarTab.test.tsx

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClosedTrade } from '@/lib/tradeLog/types';

const loadClosedTradesMock = vi.fn();
vi.mock('../../positions-workspace/cycleTradesLoader', () => ({ loadClosedTrades: (...a: unknown[]) => loadClosedTradesMock(...a) }));

import PnlCalendarTab from '../PnlCalendarTab';

let seq = 0;
const trade = (closeDate: string, pnl: number): ClosedTrade => ({
  id: `t${seq += 1}`, symbol: 'GGLL', strategy: 'CSP', openDate: '2026-09-01', closeDate, openTime: '10:00', openDow: 2, expiry: '2026-11-20',
  holdDays: 5, strikes: '75P', creditReceived: 300, closePrice: 1, pnl, pnlPct: 0, outcome: 'WIN' as ClosedTrade['outcome'], quantity: 1, fees: 1,
  dteAtClose: 20, dteAtEntry: 30, exitType: 'TARGET' as ClosedTrade['exitType'], reconstructionStatus: 'COMPLETE', closureMechanism: 'BTC' as ClosedTrade['closureMechanism'],
  openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [],
});

const TRADES = [trade('2026-10-01', -112), trade('2026-10-05', 50), trade('2026-10-09', 1800), trade('2026-10-13', -155), trade('2026-09-15', 400)];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
  localStorage.clear();
  loadClosedTradesMock.mockResolvedValue({ trades: TRADES, unmatchedClosures: [], windowFrom: '2025-10-27', accountNumber: 'A' });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [{ date: '2026-09-30', netLiquidatingValue: 45000 }] }) }) as unknown as typeof fetch;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('PnlCalendarTab', () => {
  it('shows the month total, day cells, week totals and the goal against the month-start balance', async () => {
    render(<PnlCalendarTab />);
    await waitFor(() => expect(screen.getByTestId('month-total')).toBeInTheDocument());
    expect(screen.getByTestId('month-total')).toHaveTextContent('+$1,583');
    expect(screen.getByTestId('day-2026-10-09')).toHaveTextContent('+$1.8k');
    expect(screen.getByTestId('day-2026-10-13')).toHaveTextContent('-$155');
    expect(screen.getByTestId('week-2026-09-27')).toHaveTextContent('-$112');
    expect(screen.getByText(/% of target/)).toBeInTheDocument();
    expect(screen.getByText(/Day/)).toHaveTextContent('27/31');
  });

  it('reads the target percent as 5 by default and lets the viewer change it', async () => {
    render(<PnlCalendarTab />);
    const input = (await screen.findByLabelText('Target percent')) as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '3' } });
    expect(localStorage.getItem('tradeedge-pnl-calendar-target-pct')).toBe('3');
    expect(screen.getByText(/Goal achieved/)).toBeInTheDocument(); // 3% of 45,000 = 1,350 < 1,583
  });

  it('navigates to the previous month and cannot go past the current one', async () => {
    render(<PnlCalendarTab />);
    await screen.findByTestId('month-total');
    expect(screen.getByLabelText('Next month')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('Sep 2026')).toBeInTheDocument();
    expect(screen.getByTestId('day-2026-09-15')).toHaveTextContent('+$400');
    expect(screen.getByLabelText('Next month')).not.toBeDisabled();
  });

  it('without a stored month-start balance it still shows the calendar and says there is no goal amount', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ history: [] }) }) as unknown as typeof fetch;
    render(<PnlCalendarTab />);
    await screen.findByTestId('month-total');
    expect(screen.getByText(/no goal amount/i)).toBeInTheDocument();
    expect(screen.queryByText(/Goal achieved/)).not.toBeInTheDocument();
  });

  it('shows the load error instead of an empty calendar', async () => {
    loadClosedTradesMock.mockRejectedValue(new Error('Session expired'));
    render(<PnlCalendarTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  });
});
