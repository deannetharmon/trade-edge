// app/screener/__tests__/OpportunityUniverseMigration.test.tsx
//
// TE-0007 corrective pass — required correction 1's page-level regression
// test. Exercises the REAL app/screener/page.tsx migration effect (not a
// reimplementation) against the exact failing scenario from the ticket:
// a legacy primary watchlist ticker that's inactive but also present in a
// legacy CSP/PMCC list must be reactivated in the migrated Opportunity
// Universe, not silently dropped because "it already existed."
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import {
  LS_OPPORTUNITY_UNIVERSE,
  LS_LEGACY_PRIMARY_WATCHLIST,
  LS_LEGACY_CSP_TICKERS,
  LS_LEGACY_PMCC_TICKERS,
} from '@/lib/screener/opportunityUniverse';

const getMarketMetricsMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getCoveredCallCapacityReport: vi.fn().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] }),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: vi.fn().mockResolvedValue(100),
    getChain: vi.fn().mockResolvedValue({ expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' }),
    classifyUnderlying: vi.fn().mockResolvedValue('stock'),
    getAvailableCash: vi.fn().mockResolvedValue(10000),
    getCspCapitalContext: vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 10000, cashBalance: 10000 }),
  };
});

function renderScreener() {
  return render(
    <TaskProvider>
      <CommandProvider>
        <ScreenerPage />
      </CommandProvider>
    </TaskProvider>,
  );
}

function seedLegacy(opts: { primary?: Array<{ symbol: string; active: boolean }>; csp?: string; pmcc?: string }) {
  if (opts.primary) {
    localStorage.setItem(
      LS_LEGACY_PRIMARY_WATCHLIST,
      JSON.stringify(opts.primary.map(t => ({ ...t, classification: 'stock' })))
    );
  }
  if (opts.csp) localStorage.setItem(LS_LEGACY_CSP_TICKERS, opts.csp);
  if (opts.pmcc) localStorage.setItem(LS_LEGACY_PMCC_TICKERS, opts.pmcc);
}

function canonicalUniverse(): string[] {
  const raw = localStorage.getItem(LS_OPPORTUNITY_UNIVERSE);
  return raw ? JSON.parse(raw) : [];
}

async function waitForMigration(expectedLength: number) {
  await waitFor(() => expect(canonicalUniverse().length).toBe(expectedLength));
}

async function clickFindCsps() {
  await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
  await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TE-0007 corrective pass: Opportunity Universe migration reactivates legacy CSP/PMCC tickers', () => {
  it('exact required scenario: NKE active + MU inactive in the primary list, MU also in the legacy CSP list → both NKE and MU end up in the universe, both active', async () => {
    seedLegacy({
      primary: [{ symbol: 'NKE', active: true }, { symbol: 'MU', active: false }],
      csp: 'MU',
    });

    renderScreener();
    await waitForMigration(2);

    // Canonical persisted universe contains both.
    expect(canonicalUniverse().sort()).toEqual(['MU', 'NKE']);

    // A strategy launch receives both -- proves both are ACTIVE scan inputs,
    // not just present-but-inactive in the visible list.
    await clickFindCsps();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0].sort()).toEqual(['MU', 'NKE']);
  });

  it('remount after migration is idempotent — no duplication, no symbol loss', async () => {
    seedLegacy({
      primary: [{ symbol: 'NKE', active: true }, { symbol: 'MU', active: false }],
      csp: 'MU',
    });

    const first = renderScreener();
    await waitForMigration(2);
    first.unmount();

    getMarketMetricsMock.mockClear();
    renderScreener();
    // Migration is a no-op the second time (hasCanonicalUniverse() is
    // already true) -- give the mount effects a tick, then assert the
    // canonical universe is unchanged, not doubled.
    await screen.findByText('OPPORTUNITY UNIVERSE');
    await waitFor(() => expect(canonicalUniverse().sort()).toEqual(['MU', 'NKE']));

    await clickFindCsps();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0].sort()).toEqual(['MU', 'NKE']);
  });

  it('a legacy PMCC-only ticker (no primary entry at all) is added and active', async () => {
    seedLegacy({
      primary: [{ symbol: 'NKE', active: true }],
      pmcc: 'AAPL',
    });

    renderScreener();
    await waitForMigration(2);
    expect(canonicalUniverse().sort()).toEqual(['AAPL', 'NKE']);

    await clickFindCsps();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0].sort()).toEqual(['AAPL', 'NKE']);
  });

  it('overlapping symbols across all three legacy sources collapse to one active entry each, nothing lost', async () => {
    seedLegacy({
      primary: [{ symbol: 'NKE', active: true }, { symbol: 'MU', active: false }],
      csp: 'MU,AAPL',
      pmcc: 'MU,NVDA',
    });

    renderScreener();
    await waitForMigration(4);
    expect(canonicalUniverse().sort()).toEqual(['AAPL', 'MU', 'NKE', 'NVDA']);

    await clickFindCsps();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0].sort()).toEqual(['AAPL', 'MU', 'NKE', 'NVDA']);
  });
});
