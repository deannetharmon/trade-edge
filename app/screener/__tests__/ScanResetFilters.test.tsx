// app/screener/__tests__/ScanResetFilters.test.tsx
//
// SCAN-RESET-0001 -- post-scan result filters narrow what a scan returned; they
// must never silently carry over into a NEW scan. Repro: a leftover "DTE >= 21d"
// chip hid every 18-DTE contract from the next scan's 7-60 DTE range, with no
// explanation. Every new scan now starts with all result filters open (the CSP
// delta chip returns to the scan's own preferred band, CSP-DEFAULT-DELTA-0001),
// and a filtered view says how many qualified candidates it is hiding.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { warmScreenerPage, WARM_HOOK_TIMEOUT_MS, WARM_FLOW_TIMEOUT_MS } from './helpers/warmScreenerPage';

const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getCspCapitalContextMock = vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 1_000_000, cashBalance: 1_000_000 });

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: vi.fn(),
    getChain: (...args: any[]) => getChainMock(...args),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(1_000_000),
    getCspCapitalContext: (...args: any[]) => getCspCapitalContextMock(...args),
  };
});

function expDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  return d.toISOString().slice(0, 10);
}

// Same AMD acceptance-fixture strikes as CspDefaultDeltaFilter.test.tsx: 405/420
// sit inside the balanced 0.15-0.25 band, 440 (delta 0.30) is market-qualified
// but outside it. All three expire in 35 days.
function chain() {
  const exp = expDate();
  const legs = [
    { strike: 405, delta: -0.16, oi: 245, bid: 6.90, ask: 7.60 },
    { strike: 420, delta: -0.22, oi: 409, bid: 11.45, ask: 13.20 },
    { strike: 440, delta: -0.30, oi: 600, bid: 17.00, ask: 17.90 },
  ];
  return {
    expirations: [exp],
    chains: {
      [exp]: legs.map((l, i) => ({
        strikePrice: l.strike, expirationDate: exp, optionType: 'P' as const,
        delta: l.delta, bid: l.bid, ask: l.ask, mid: (l.bid + l.ask) / 2,
        openInterest: l.oi, occSymbol: `AMD_${exp}_P${l.strike}_${i}`,
      })),
    },
  };
}

function renderScreener() {
  return render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
}

async function runCspScan(opts?: { timeout: number }) {
  await userEvent.click(screen.getByRole('button', { name: /Find CSPs/i }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN CSP SCAN/i }, opts));
}

async function firstAmdCspScan(readyTimeout?: number) {
  getChainMock.mockResolvedValue(chain());
  getMarketMetricsMock.mockResolvedValue([{ symbol: 'AMD', price: 477.85, ivRank: 40, earningsExpectedDate: null, expirationIvxMap: {} }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { recommendations: [] } }) }));

  renderScreener();
  const opts = readyTimeout ? { timeout: readyTimeout } : undefined;
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i, undefined, opts);
  await userEvent.type(input, 'AMD');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await runCspScan(opts);
  await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled(), opts);
}

beforeAll(() => warmScreenerPage(async () => { await firstAmdCspScan(WARM_FLOW_TIMEOUT_MS); }), WARM_HOOK_TIMEOUT_MS);

/** The result-controls row containing the Delta chip -- unique via its "0.10–0.16" preset label. */
function deltaControlsRow(): HTMLElement {
  return screen.getByText('0.10–0.16').closest('div') as HTMLElement;
}

describe('SCAN-RESET-0001: result filters do not carry over into a new scan', () => {
  it('a DTE chip set after one scan is cleared when the next scan runs', async () => {
    await firstAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    // The fixture's contracts are 35 DTE, so DTE >= 45d hides all of them.
    await userEvent.click(screen.getByRole('button', { name: '45d' }));
    await waitFor(() => expect(screen.getByText('Showing 0 of 3 qualified candidates')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Remove filter: DTE ≥ 45/ })).toBeInTheDocument();

    await runCspScan();

    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Remove filter: DTE/ })).not.toBeInTheDocument();
  });

  it('an explicit Delta "Any" returns to the scan\'s preferred band on the next scan', async () => {
    await firstAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    await userEvent.click(within(deltaControlsRow()).getByRole('button', { name: 'Any' }));
    await waitFor(() => expect(screen.getByText('Showing 3 of 3 qualified candidates')).toBeInTheDocument());

    await runCspScan();

    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Remove filter: Δ 0\.15–0\.25/i })).toBeInTheDocument();
  });

  it('the hidden-by-filters banner reports the hidden count and its button restores every result', async () => {
    await firstAmdCspScan();
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 qualified candidates')).toBeInTheDocument());

    // The default delta band already hides the 0.30-delta strike, so the banner is up on first view.
    expect(screen.getByTestId('hidden-by-filters-banner')).toHaveTextContent('1 of 3 qualified candidates hidden by result filters');

    await userEvent.click(screen.getByRole('button', { name: 'Show all hidden results' }));

    await waitFor(() => expect(screen.getByText('Showing 3 of 3 qualified candidates')).toBeInTheDocument());
    expect(screen.queryByTestId('hidden-by-filters-banner')).not.toBeInTheDocument();
  });
});
