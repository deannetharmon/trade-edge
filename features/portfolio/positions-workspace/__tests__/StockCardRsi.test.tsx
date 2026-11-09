// features/portfolio/positions-workspace/__tests__/StockCardRsi.test.tsx
//
// STOCK-RSI-0001 (cards): the RSI chip, "Calls:" chip and basis -> price line on the stock card, and the detail panel
// with RSI at entry and the entry date input.

import { THEMES } from '@/lib/theme';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { StockHoldings } from '../StockHoldings';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import type { CapacityViewModel } from '../model/types';

const rsiMap: Record<string, unknown> = {};
vi.mock('@/components/portfolio-data/useHoldingRsi', () => ({ useHoldingRsi: () => rsiMap }));

const th = THEMES.dark;
const holding = (over: Partial<EquityHolding> = {}): EquityHolding => ({
  accountNumber: 'ACCT-1', symbol: 'MRVL', direction: 'Long', quantity: 200, settledQuantity: null, basis: 60, basisComplete: true, currentPrice: 74.5, marketValue: 14900, unrealizedPnl: 2900,
  quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...over,
});
const capacity = {
  status: 'ok', sharesOwned: 200, allocatedContracts: 0, reservedContracts: 0, availableContracts: 2, remainderShares: 0, basisComplete: true, unallocatedShares: 200,
} as unknown as CapacityViewModel;
const props = (h: EquityHolding) => ({
  cards: true, groups: [{ symbol: h.symbol, equities: [h], capacity }], quoteAsOf: null, th,
  storageKey: (a: string, k: string) => `${a}::${k}`, notes: {}, onSaveNote: vi.fn(), alerts: {}, onSaveAlert: vi.fn(),
});

const points = Array.from({ length: 40 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, rsi: 40 + i / 2 }));
// dates beyond 30 are invalid calendar days but only compared as strings; use real ones instead:
const realPoints = [...Array(40)].map((_, i) => {
  const d = new Date(Date.UTC(2026, 8, 25 + i)); return { date: d.toISOString().slice(0, 10), rsi: 40 + i / 2 };
});
void points;

const fetchMock = vi.fn();
beforeEach(() => {
  for (const k of Object.keys(rsiMap)) delete rsiMap[k];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (String(url).includes('position-entry-dates')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(init?.method === 'POST' ? { ok: true } : { entryDates: { 'ACCT-1::equity:MRVL:long': realPoints[5].date } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('stock card RSI', () => {
  it('shows RSI, the arrow, the Calls chip and the basis -> price line', () => {
    rsiMap.MRVL = { rsi: 54.4, previous: 51, direction: 'up', points: realPoints };
    render(<StockHoldings {...props(holding())} />);
    const rsi = screen.getByTestId('stock-rsi-equity:MRVL:long');
    expect(rsi).toHaveTextContent('RSI 54');
    expect(screen.getByLabelText('rising')).toBeInTheDocument();
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
    expect(screen.getByTestId('stock-price-move-equity:MRVL:long')).toHaveTextContent('+24.2% since you bought');
  });

  it('labels the RSI with the completed bar it comes from', () => {
    rsiMap.MRVL = { rsi: 30, previous: 31, direction: 'down', points: [{ date: '2026-11-05', rsi: 31 }, { date: '2026-11-06', rsi: 30 }] };
    render(<StockHoldings {...props(holding())} />);
    expect(screen.getByTestId('stock-rsi-equity:MRVL:long')).toHaveTextContent('RSI 30');
    expect(screen.getByTestId('stock-rsi-equity:MRVL:long')).toHaveTextContent('Fri close');
    expect(screen.getByText('Calls: Wait')).toHaveAttribute('title', expect.stringContaining('Fri 11/6'));
  });

  it('shows a dash while RSI cannot be computed and no chip', () => {
    rsiMap.MRVL = null;
    render(<StockHoldings {...props(holding())} />);
    expect(screen.getByTestId('stock-rsi-equity:MRVL:long')).toHaveTextContent('RSI —');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
  });

  it('shows nothing for RSI while loading (undefined)', () => {
    render(<StockHoldings {...props(holding())} />);
    expect(screen.queryByTestId('stock-rsi-equity:MRVL:long')).not.toBeInTheDocument();
  });

  it('no chip and no price line for a Short holding with incomplete basis', () => {
    rsiMap.MRVL = { rsi: 54, previous: 54, direction: 'flat', points: realPoints };
    render(<StockHoldings {...props(holding({ direction: 'Short', basisComplete: false }))} />);
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stock-price-move-equity:MRVL:short')).not.toBeInTheDocument();
  });

  it('detail panel shows Now / Yesterday / At entry from the saved entry date, with the sparkline', async () => {
    rsiMap.MRVL = { rsi: 59.5, previous: 59, direction: 'flat', points: realPoints };
    render(<StockHoldings {...props(holding())} />);
    await waitFor(() => expect(screen.getByTestId('stock-rsi-equity:MRVL:long')).toHaveTextContent('43 at entry'));
    await userEvent.click(screen.getByText('Show detail'));
    expect(screen.getByTestId('stock-rsi-detail')).toBeInTheDocument();
    expect(screen.getByTestId('rsi-sparkline-MRVL')).toBeInTheDocument();
    expect(screen.getByLabelText(/Entry date/)).toHaveValue(realPoints[5].date);
  });

  it('saving a date posts it; clearing posts null', async () => {
    rsiMap.MRVL = { rsi: 59.5, previous: 59, direction: 'flat', points: realPoints };
    render(<StockHoldings {...props(holding())} />);
    await userEvent.click(screen.getByText('Show detail'));
    const input = screen.getByLabelText(/Entry date/);
    await userEvent.clear(input);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => String(u).includes('position-entry-dates') && i?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body)).toEqual({ accountNumber: 'ACCT-1', positionKey: 'equity:MRVL:long', entryDate: null });
    });
  });

  it('an entry date outside the loaded window shows a note and no invented number', async () => {
    rsiMap.MRVL = { rsi: 59.5, previous: 59, direction: 'flat', points: realPoints.slice(20) };
    render(<StockHoldings {...props(holding())} />);
    await userEvent.click(screen.getByText('Show detail'));
    await waitFor(() => expect(screen.getByText(/outside the last ~5 months/)).toBeInTheDocument());
  });

  it('CARD-CHART-SLOT-0001: the chart link sits in the ticker line, next to the STOCK badge, not in the action row', () => {
    render(<StockHoldings {...props(holding())} />);
    const heading = screen.getByRole('heading', { name: /MRVL/ });
    expect(heading).toHaveTextContent(/STOCK/);
    expect(heading.textContent).toMatch(/chart/i);
    expect(heading.parentElement!.querySelectorAll('button').length).toBeGreaterThan(0);
  });
});
