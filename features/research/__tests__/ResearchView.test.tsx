// features/research/__tests__/ResearchView.test.tsx

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchView } from '../ResearchView';
import { THEMES } from '@/lib/theme';

const chart = {
  points: [{ t: 1700000000, c: 190 }, { t: 1700086400, c: 198 }, { t: 1700172800, c: 200 }],
  meta: { symbol: 'AAPL', name: 'Apple Inc.', price: 200, previousClose: 195, fiftyTwoWeekHigh: 220, fiftyTwoWeekLow: 150, volume: 5_000_000, currency: 'USD' },
};
const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

function setup(watchlist: { symbol: string; active: boolean }[] = []) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith('/api/research-chart')) return u.includes('symbol=NOPE') ? json({ error: 'No data for NOPE' }, false) : json(chart);
    if (u === '/api/watchlist' && init?.method === 'PUT') return json({ success: true });
    return json({ tickers: watchlist });
  }) as unknown as typeof fetch;
  render(<ResearchView th={THEMES.dark} initialSymbol="AAPL" fetchImpl={fetchImpl} />);
  return { calls, fetchImpl };
}

describe('RESEARCH-0001 ResearchView', () => {
  it('loads the initial symbol and shows price, day change and stats', async () => {
    setup();
    expect(await screen.findByTestId('research-price')).toHaveTextContent('$200.00');
    expect(screen.getByTestId('research-day-change')).toHaveTextContent('+$5.00 (+2.56%)');
    const stats = screen.getByTestId('research-stats');
    expect(stats).toHaveTextContent('$220.00');
    expect(stats).toHaveTextContent('$150.00');
    expect(stats).toHaveTextContent('5M');
  });
  it('a range button refetches with that range', async () => {
    const { calls } = setup();
    await screen.findByTestId('research-price');
    await userEvent.click(screen.getByRole('button', { name: '1Y' }));
    await waitFor(() => expect(calls.some(c => c.url.includes('range=1Y'))).toBe(true));
    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('a lookup error is shown and the old chart is cleared', async () => {
    setup();
    await screen.findByTestId('research-price');
    const box = screen.getByLabelText('Ticker');
    await userEvent.clear(box);
    await userEvent.type(box, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No data for NOPE');
    expect(screen.queryByTestId('research-price')).not.toBeInTheDocument();
  });
  it('rejects a junk ticker without calling the API', async () => {
    const { calls } = setup();
    await screen.findByTestId('research-price');
    const before = calls.length;
    const box = screen.getByLabelText('Ticker');
    await userEvent.clear(box);
    await userEvent.type(box, 'a b');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a ticker');
    expect(calls.length).toBe(before);
  });
  it('adds the symbol to the screener list once, keeping what is already there', async () => {
    const { calls } = setup([{ symbol: 'TQQQ', active: true }]);
    await screen.findByTestId('research-price');
    await userEvent.click(screen.getByRole('button', { name: 'Add to screener list' }));
    expect(await screen.findByRole('button', { name: 'Added to screener list' })).toBeDisabled();
    const put = calls.find(c => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body))).toEqual({ tickers: [{ symbol: 'TQQQ', active: true }, { symbol: 'AAPL', active: true }] });
  });
  it('does not add a symbol that is already in the list', async () => {
    const { calls } = setup([{ symbol: 'aapl', active: false }]);
    await screen.findByTestId('research-price');
    await userEvent.click(screen.getByRole('button', { name: 'Add to screener list' }));
    expect(await screen.findByRole('button', { name: 'Already in screener list' })).toBeDisabled();
    expect(calls.some(c => c.init?.method === 'PUT')).toBe(false);
  });
});
