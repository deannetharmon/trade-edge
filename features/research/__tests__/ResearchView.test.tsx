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
  const factsDeps = { loadFacts: () => new Promise<never>(() => {}), loadBroker: async () => null, loadTrend: async () => null };
  render(<ResearchView th={THEMES.dark} initialSymbol="AAPL" fetchImpl={fetchImpl} factsDeps={factsDeps} />);
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
  it('opens on the 3M chart, the window the trend label reads', async () => {
    const { calls } = setup();
    await screen.findByTestId('research-price');
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.some(c => c.url.includes('range=3M'))).toBe(true);
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
  describe('RESEARCH-RSI-0001 RSI panel', () => {
    const longChart = {
      points: Array.from({ length: 60 }, (_, i) => ({ t: 1700000000 + i * 86400, c: 100 + Math.sin(i / 3) * 5 + i * 0.2 })),
      meta: chart.meta,
    };
    function setupLong() {
      const fetchImpl = vi.fn((url: RequestInfo | URL) => {
        const u = String(url);
        if (u.startsWith('/api/research-chart')) return json(longChart);
        return json({ tickers: [] });
      }) as unknown as typeof fetch;
      const factsDeps = { loadFacts: () => new Promise<never>(() => {}), loadBroker: async () => null, loadTrend: async () => null };
      render(<ResearchView th={THEMES.dark} initialSymbol="AAPL" fetchImpl={fetchImpl} factsDeps={factsDeps} />);
      return fetchImpl;
    }

    it('shows an RSI(14) panel with the latest value on a daily range', async () => {
      const fetchImpl = setupLong();
      expect(await screen.findByTestId('research-rsi')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('research-rsi-value').textContent).toMatch(/^\d+\.\d$/));
      // 3M borrows a 1Y daily series so RSI has history to warm up on.
      expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(c => String(c[0]).includes('range=1Y'))).toBe(true);
    });

    it('the RSI button hides and shows the panel', async () => {
      setupLong();
      await screen.findByTestId('research-rsi');
      await userEvent.click(screen.getByRole('button', { name: 'RSI' }));
      expect(screen.queryByTestId('research-rsi')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'RSI' }));
      expect(await screen.findByTestId('research-rsi')).toBeInTheDocument();
    });

    it('also shows on the 1D and 1W ranges, labeled with the bar size', async () => {
      setupLong();
      await screen.findByTestId('research-rsi');
      await userEvent.click(screen.getByRole('button', { name: '1D' }));
      await waitFor(() => expect(screen.getByTestId('research-rsi')).toHaveTextContent('RSI(14) · 5m'));
      await userEvent.click(screen.getByRole('button', { name: '1W' }));
      await waitFor(() => expect(screen.getByTestId('research-rsi')).toHaveTextContent('RSI(14) · 30m'));
      expect(screen.getByRole('button', { name: 'RSI' })).toBeInTheDocument();
    });
  });

  describe('RESEARCH-VOL-0001 volume panel', () => {
    const volChart = {
      points: Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, c: 100 + i * 0.3, v: 1_000_000 + i * 10_000 })),
      meta: chart.meta,
    };
    const setupVol = (body: unknown = volChart) => {
      const fetchImpl = vi.fn((url: RequestInfo | URL) => (String(url).startsWith('/api/research-chart') ? json(body) : json({ tickers: [] }))) as unknown as typeof fetch;
      const factsDeps = { loadFacts: () => new Promise<never>(() => {}), loadBroker: async () => null, loadTrend: async () => null };
      render(<ResearchView th={THEMES.dark} initialSymbol="AAPL" fetchImpl={fetchImpl} factsDeps={factsDeps} />);
    };

    it('shows a volume panel with the latest bar volume', async () => {
      setupVol();
      expect(await screen.findByTestId('research-volume')).toBeInTheDocument();
      expect(screen.getByTestId('research-volume-value')).toHaveTextContent('1.3M');
    });

    it('the Volume button hides and shows the panel', async () => {
      setupVol();
      await screen.findByTestId('research-volume');
      await userEvent.click(screen.getByRole('button', { name: 'Volume' }));
      expect(screen.queryByTestId('research-volume')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Volume' }));
      expect(await screen.findByTestId('research-volume')).toBeInTheDocument();
    });

    it('shows no volume panel or button when the data has no volume', async () => {
      setupVol(chart);
      await screen.findByTestId('research-price');
      expect(screen.queryByTestId('research-volume')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Volume' })).not.toBeInTheDocument();
    });
  });
});
