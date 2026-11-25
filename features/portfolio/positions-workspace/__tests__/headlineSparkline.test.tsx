// features/portfolio/positions-workspace/__tests__/headlineSparkline.test.tsx

// SPARKLINES-0001A2: the real Portfolio Value tile, end to end, with stored history coming from /api/balance-history.
// Live finding (Dean, 2026-11-24): stale history produced "-$18,326 vs prior close" and a dashed line; both are now guarded.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { buildPortfolioSummary } from '../model/portfolioSummary';
import { PortfolioSummaryStrip } from '../PortfolioSummaryStrip';

const NOW = Date.parse('2026-11-24T22:00:00Z');
const day = (date: string, netLiquidatingValue: number) => ({ date, netLiquidatingValue, cashBalance: 1, netOptionsValue: 1 });

function renderTile(history: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ history }) })));
  const summary = buildPortfolioSummary({ rows: [], equities: [], pendingOrders: [], cashBalance: 1109, netLiquidity: 26452, optionBuyingPower: 5085, nowMs: NOW });
  render(<PortfolioSummaryStrip summary={summary} selected={null} onSelect={() => {}} />);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Portfolio Value tile sparkline', () => {
  it('recent history: shows the day-change arrow and the line', async () => {
    renderTile([day('2026-11-20', 26000), day('2026-11-23', 26290)]);
    await waitFor(() => expect(screen.getByTestId('nlv-day-change').textContent).toContain('▲ +$162 vs prior close'));
    expect(screen.getByTestId('nlv-line')).toBeTruthy();
  });

  it('stale history (last stored day weeks old): no arrow, no fake change, dashed placeholder', async () => {
    renderTile([day('2026-10-06', 44713)]);
    await waitFor(() => expect(screen.getByTestId('nlv-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('nlv-day-change')).toBeNull();
  });

  it('no history at all: no arrow, dashed placeholder', async () => {
    renderTile([]);
    await waitFor(() => expect(screen.getByTestId('nlv-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('nlv-day-change')).toBeNull();
  });
});
