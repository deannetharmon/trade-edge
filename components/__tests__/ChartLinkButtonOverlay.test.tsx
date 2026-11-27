// components/__tests__/ChartLinkButtonOverlay.test.tsx
//
// SPARKLINES-0002: the quick chart draws the underlying as a thin gray line plus a "2x of NVDA" caption for a listed leveraged fund,
// and is unchanged for everything else (and when the underlying cannot be fetched).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ChartLinkButton } from '../ChartLinkButton';
import { THEMES } from '@/lib/theme';

const th = THEMES.dark;
const closes = (start: number, step: number, n = 40) => Array.from({ length: n }, (_, i) => start + i * step);

function renderChart(symbol: string, fetchImpl: (url: string) => Promise<unknown>) {
  const fetchMock = vi.fn(fetchImpl as never);
  vi.stubGlobal('fetch', fetchMock);
  render(<ChartLinkButton symbol={symbol} instanceKey={`t-${symbol}`} th={th} showChart setShowChart={() => {}} sparkData={closes(50, 1)} setSparkData={() => {}} sparkLoading={false} setSparkLoading={() => {}} />);
  return fetchMock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('quick chart underlying overlay', () => {
  it('leveraged fund: fetches the underlying once and draws the gray line, zero line and caption', async () => {
    const fetchMock = renderChart('NVDL', async () => ({ ok: true, json: async () => ({ bars: closes(100, 1).map(c => ({ c })) }) }));
    await waitFor(() => expect(screen.getByTestId('overlay-underlying-line')).toBeTruthy());
    expect(screen.getByTestId('overlay-underlying-line').getAttribute('stroke')).toBe('#cbd5e1');
    expect(screen.getByTestId('overlay-zero-line')).toBeTruthy();
    expect(screen.getByTestId('leverage-caption').textContent).toBe('2x of NVDA');
    expect(fetchMock).toHaveBeenCalledWith('/api/chart?symbol=NVDA');
  });

  it('not leveraged: no fetch, no overlay, no caption', () => {
    const fetchMock = renderChart('AAPL', async () => { throw new Error('should not fetch'); });
    expect(screen.queryByTestId('overlay-underlying-line')).toBeNull();
    expect(screen.queryByTestId('leverage-caption')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('underlying fetch fails: plain price line only, no caption', async () => {
    const fetchMock = renderChart('TSLL', async () => { throw new Error('network'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('overlay-underlying-line')).toBeNull();
    expect(screen.queryByTestId('leverage-caption')).toBeNull();
  });
});
