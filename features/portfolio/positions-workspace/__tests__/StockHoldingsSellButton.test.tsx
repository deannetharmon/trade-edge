// features/portfolio/positions-workspace/__tests__/StockHoldingsSellButton.test.tsx
//
// STOCKS-ORDERS-0001 -- Ian's requirement: the Sell action is disabled, with
// a tooltip, before the dialog can ever open, whenever 0 shares are sellable
// -- the dialog itself never has to say no.

import { THEMES } from '@/lib/theme';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { StockHoldings } from '../StockHoldings';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import type { CapacityViewModel } from '../model/types';

const th = THEMES.dark;
const holding = (over: Partial<EquityHolding>): EquityHolding => ({
  accountNumber: 'ACCT-1', symbol: 'MRVL', direction: 'Long', quantity: 200, settledQuantity: null, basis: 60, basisComplete: true, currentPrice: 74.5, marketValue: 14900, unrealizedPnl: 2900,
  quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...over,
});
const capacity = (over: Partial<CapacityViewModel> = {}): CapacityViewModel => ({ status: 'ok', sharesOwned: 200, allocatedContracts: 0, reservedContracts: 0, availableContracts: 2, remainderShares: 0, basisComplete: true, blockingReason: null, unallocatedShares: 200, ...over });

const props = (h: EquityHolding, cap: Partial<CapacityViewModel> = {}) => ({
  groups: [{ symbol: h.symbol, equities: [h], capacity: capacity(cap) }], quoteAsOf: null, th,
  storageKey: (a: string, k: string) => `${a}::${k}`, notes: {}, onSaveNote: vi.fn(), alerts: {}, onSaveAlert: vi.fn(),
  sellDeps: { onRefreshCapacity: vi.fn(), onSubmitOrder: vi.fn() },
});

describe('Stock holdings Sell action', () => {
  it('is a real, clickable button when shares are sellable', () => {
    render(<StockHoldings {...props(holding({}))} />);
    expect(screen.getByTestId('sell-button-equity:MRVL:long')).toBeEnabled();
  });

  it('is disabled with a tooltip when fully committed -- the dialog never opens for this case', async () => {
    render(<StockHoldings {...props(holding({}), { unallocatedShares: 0, allocatedContracts: 2 })} />);
    const el = screen.getByTestId('sell-button-equity:MRVL:long');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('title', 'All 200 shares are committed to an open call.');
    await userEvent.click(el);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is disabled with the data-quality tooltip when capacity is unverifiable', () => {
    render(<StockHoldings {...props(holding({}), { status: 'unavailable', unallocatedShares: 0 })} />);
    expect(screen.getByTestId('sell-button-equity:MRVL:long')).toHaveAttribute('title', 'Share commitment could not be verified. Selling is blocked until it can be.');
  });

  it('Sell is not offered at all for a Short holding (Buy to Cover is out of v1)', () => {
    render(<StockHoldings {...props(holding({ direction: 'Short' }))} />);
    expect(screen.queryByTestId('sell-button-equity:MRVL:short')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('without sellDeps, the row still renders but Sell never opens a dialog', async () => {
    const { sellDeps, ...rest } = props(holding({}));
    void sellDeps;
    render(<StockHoldings {...rest} />);
    await userEvent.click(screen.getByTestId('sell-button-equity:MRVL:long'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Stock holdings quick chart', () => {
  it('each holding has the same chart link under its symbol, and opening it shows the RSI strip for that symbol', async () => {
    const base = [...Array.from({ length: 11 }, () => [100, 101]).flat(), 100];
    const closes = [...base, 99, 98, 97, 96, 95, 94, 93, 94, 95.5];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ bars: closes.map(c => ({ c })) }) }));
    render(<StockHoldings {...props(holding({}))} />);
    const link = screen.getByRole('button', { name: 'Quick chart for MRVL' });
    expect(link.closest('[role="row"]')).toHaveAttribute('data-testid', 'stock-row-equity:MRVL:long');
    await userEvent.click(link);
    expect(await screen.findByRole('dialog', { name: 'Quick chart for MRVL' })).toBeInTheDocument();
    expect(await screen.findByTestId('rsi-strip')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('Stock holdings column widths', () => {
  const widths = { identity: 120, dates: 100, underlying: 150, strike: 130, capital: 90, entry: 80, value: 100, pnl: 190, orders: 130, notes: 140, priceAlert: 110, recommendation: 200 };

  it('takes its column widths from the options table above when they are measured', () => {
    render(<StockHoldings {...props(holding({}))} columnWidths={widths} />);
    const header = screen.getAllByRole('row')[0];
    expect(header).toHaveStyle({ gridTemplateColumns: '120px 100px 150px 130px 90px 180px 320px 140px 110px 200px' });
    expect(screen.getByTestId('stock-row-equity:MRVL:long')).toHaveStyle({ gridTemplateColumns: '120px 100px 150px 130px 90px 180px 320px 140px 110px 200px' });
    expect(screen.getByTestId('stock-totals')).toHaveStyle({ gridTemplateColumns: '120px 100px 150px 130px 90px 180px 320px 140px 110px 200px' });
  });

  it('keeps its own default widths when nothing usable was measured', () => {
    render(<StockHoldings {...props(holding({}))} columnWidths={{ ...widths, notes: 0 }} />);
    expect(screen.getAllByRole('row')[0].getAttribute('style') ?? '').not.toContain('gridTemplateColumns');
    expect(screen.getAllByRole('row')[0].getAttribute('style') ?? '').not.toContain('grid-template-columns');
  });
});

describe('Stock holdings intent', () => {
  it('shows Hold / Wheel / Undecided on each holding, loads the saved value, and saves a change under the account and holding key', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { method?: string }) => (
      init?.method === 'POST' ? { json: async () => ({ ok: true }) } : { json: async () => ({ intents: { 'ACCT-1::equity:MRVL:long': 'wheel' }, bars: [] }) }
    ));
    vi.stubGlobal('fetch', fetchMock);
    render(<StockHoldings {...props(holding({}))} intentEnabled />);
    const select = screen.getByRole('combobox', { name: 'Intent for MRVL shares' });
    expect(Array.from(select.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Hold', 'Wheel', 'Undecided']);
    await vi.waitFor(() => expect(select).toHaveValue('wheel'));
    await userEvent.selectOptions(select, 'hold');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/position-intent', expect.objectContaining({ method: 'POST', body: JSON.stringify({ positionKey: 'ACCT-1::equity:MRVL:long', intent: 'hold' }) }));
    expect(select).toHaveValue('hold');
    vi.unstubAllGlobals();
  });

  it('shows no intent control unless the workspace turns it on', () => {
    render(<StockHoldings {...props(holding({}))} />);
    expect(screen.queryByRole('combobox', { name: /Intent for/ })).not.toBeInTheDocument();
  });
});

describe('Stock holdings symbol cell order and earnings', () => {
  it('reads: symbol, intent, chart link, then the next earnings date (the same order as the options table)', async () => {
    // New York calendar date, the same basis the app uses (a UTC date is a day off in the evening).
    const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + 30 * 86400000));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => (
      String(url).startsWith('/api/tastytrade/proxy')
        ? { json: async () => ({ data: { items: [{ symbol: 'MRVL', earnings: { 'expected-report-date': future, estimated: true } }] } }) }
        : { json: async () => ({ intents: {}, bars: [] }) }
    ));
    vi.stubGlobal('fetch', fetchMock);
    render(<StockHoldings {...props(holding({}))} intentEnabled earningsEnabled />);
    const earnings = await screen.findByTestId('stock-next-earnings');
    expect(earnings).toHaveTextContent(/^Earnings [A-Z][a-z]{2} \d{1,2} \(est\.\) · in 30d$/);
    const cell = earnings.parentElement!.parentElement!;
    const intent = screen.getByRole('combobox', { name: 'Intent for MRVL shares' });
    const chart = screen.getByRole('button', { name: 'Quick chart for MRVL' });
    const order = [intent, chart, earnings].map(el => Array.from(cell.querySelectorAll('*')).indexOf(el));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(fetchMock).toHaveBeenCalledWith('/api/tastytrade/proxy?path=%2Fmarket-metrics%3Fsymbols%3DMRVL', expect.anything());
    vi.unstubAllGlobals();
  });

  it('shows no earnings line when the provider has no date for the symbol', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ data: { items: [{ symbol: 'MRVL' }] }, intents: {} }) }));
    render(<StockHoldings {...props(holding({}))} intentEnabled earningsEnabled />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('stock-next-earnings')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
