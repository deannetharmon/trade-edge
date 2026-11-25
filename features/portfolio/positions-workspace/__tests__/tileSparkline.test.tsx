// SPARKLINES-0001B/C: the real Total tile end to end, plus the cannot-grow structure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { buildPortfolioSummary } from '../model/portfolioSummary';
import { PortfolioSummaryStrip } from '../PortfolioSummaryStrip';
import { TileSparkline } from '../TileSparkline';

const NOW = Date.parse('2026-11-24T22:00:00Z');
const equity = (symbol: string, unrealizedPnl: number) => ({ accountNumber: 'a', symbol, direction: 'Long', quantity: 10, settledQuantity: null, basis: 10, basisComplete: true, currentPrice: 11, marketValue: 110, unrealizedPnl, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [] });

function renderStrip(snapshots: Record<string, unknown>) {
  const calls: Array<[string, unknown]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push([url, init?.body ? JSON.parse(init.body) : null]);
    return { ok: true, status: 200, json: async () => ({ snapshots, history: [] }) };
  }));
  const summary = buildPortfolioSummary({ rows: [], equities: [equity('SOXL', 30) as never], pendingOrders: [], cashBalance: 1000, netLiquidity: 5000, optionBuyingPower: 0, nowMs: NOW });
  render(<PortfolioSummaryStrip summary={summary} selected={null} onSelect={() => {}} />);
  return calls;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('tile sparklines', () => {
  it('Equity tile with stored history draws a line; Total does too', async () => {
    renderStrip({ 'EQUITY:SOXL': [{ date: '2026-11-20', pnl: 10 }, { date: '2026-11-23', pnl: 20 }] });
    await waitFor(() => expect(screen.getAllByTestId('tile-line').length).toBe(2));
  });
  it('no history yet: dashed placeholder on the tiles', async () => {
    renderStrip({});
    await waitFor(() => expect(screen.getAllByTestId('tile-placeholder').length).toBe(2));
  });
  it('records today for each stock holding', async () => {
    const calls = renderStrip({});
    await waitFor(() => expect(calls.some(([u, b]) => u === '/api/position-snapshots' && b != null)).toBe(true));
    const body = calls.find(([, b]) => b != null)![1] as { entries: Array<{ positionKey: string; snapshot: { pnl: number; date: string } }> };
    const eq = body.entries.find(e => e.positionKey === 'EQUITY:SOXL')!;
    expect(eq.snapshot.pnl).toBe(30);
    expect(eq.snapshot.date).toBe('2026-11-24');
  });
  it('cannot add height: the box is absolutely filled, flex-1, with no intrinsic height', () => {
    render(<TileSparkline spark={null} />);
    const box = screen.getByTestId('tile-spark');
    expect(box.className).toContain('relative');
    expect(box.className).toContain('flex-1');
    expect(screen.getByTestId('tile-placeholder').getAttribute('class')).toContain('absolute');
  });
});

describe('wide tile layout', () => {
  it('a wide tile puts the chart on the right at full tile height instead of the inline line', async () => {
    class RO { cb: (e: unknown[]) => void; constructor(cb: (e: unknown[]) => void) { this.cb = cb; } observe() { this.cb([{ contentRect: { width: 600, height: 100 } }]); } disconnect() {} }
    vi.stubGlobal('ResizeObserver', RO);
    renderStrip({});
    await waitFor(() => expect(screen.getAllByTestId('tile-side-chart').length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId('tile-spark').length).toBe(0);
  });
});
