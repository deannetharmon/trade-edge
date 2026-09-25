// components/__tests__/RsiLine.test.tsx

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RsiLine } from '../RsiLine';
import { THEMES } from '@/lib/theme';

const BASE = [...Array.from({ length: 11 }, () => [100, 101]).flat(), 100];
const TURNED_UP = [...BASE, 99, 98, 97, 96, 95, 94, 93, 94, 95.5];

describe('RsiLine', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads daily closes and shows the plain-words RSI state in the order window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ bars: TURNED_UP.map(c => ({ c })) }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RsiLine symbol="NVDA" th={THEMES.dark} />);
    expect(screen.getByText('RSI(14), daily')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('rsi-line')).toHaveTextContent('RSI 41 · turned up from 29, 2 bars ago'));
    expect(fetchMock).toHaveBeenCalledWith('/api/chart?symbol=NVDA');
  });

  it('maps index symbols to the chart provider symbol', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ bars: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RsiLine symbol="SPX" th={THEMES.dark} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/chart?symbol=%5EGSPC'));
  });

  it('says RSI n/a when the request fails or there is too little data, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { unmount } = render(<RsiLine symbol="NVDA" th={THEMES.dark} />);
    await waitFor(() => expect(screen.getByTestId('rsi-line')).toHaveTextContent('RSI n/a'));
    unmount();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ bars: [{ c: 100 }, { c: 101 }] }) }));
    render(<RsiLine symbol="NVDA" th={THEMES.dark} />);
    await waitFor(() => expect(screen.getByTestId('rsi-line')).toHaveTextContent('RSI n/a'));
  });
});
