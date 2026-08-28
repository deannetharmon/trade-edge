// app/screener/__tests__/UnifiedStrategyLauncher.test.tsx
//
// TE-0007 — Unified Screener Launcher. Exercises the real page.tsx wiring
// (not a reimplementation) the same way CcCapacityGate.test.tsx does: only
// the network boundary (lib/scans/tastytrade-client) and the job store are
// mocked/spied, everything else is the real component.
//
// Covers the ticket's two required test groups:
//   - Launcher routing: LEAPS uses supplied tickers; CC and PMCC discover
//     eligible bases from the account and use supplied tickers only to narrow.
//   - Covered Call intersection (8): the universe can narrow CC's eligible
//     holdings but can never create eligibility.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import * as screenerJobStore from '@/lib/screener/screenerJobStore';

const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getCoveredCallCapacityReport: (...args: any[]) => getCoveredCallCapacityReportMock(...(args as [])),
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

async function addToUniverse(symbols: string) {
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, symbols);
  const addBtn = screen.getByRole('button', { name: 'Add' });
  await userEvent.click(addBtn);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // NOTE: deliberately not vi.restoreAllMocks() here -- the tastytrade-client
  // mock's classifyUnderlying/getQuote/getChain/getAvailableCash are plain
  // vi.fn() instances defined inside the vi.mock() factory above (no real
  // implementation to "restore" to); restoreAllMocks() would reset them to
  // return undefined for every subsequent test in this file. Individual
  // spies (e.g. the startScreenerJob spy in test 8) are restored inline.
});

describe('TE-0007: launcher routing', () => {
  it('1. Find Spreads opens the existing config modal, preserving current behavior', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    const findSpreads = await screen.findByRole('button', { name: 'FIND SPREADS' });
    await userEvent.click(findSpreads);
    expect(await screen.findByRole('radio', { name: /FILTER/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /RANK/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /TARGETED/ })).toBeInTheDocument();
  });

  it('2. Find CSPs passes the canonical Opportunity Universe to the CSP scan', async () => {
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['NKE', 'MU']));
  });

  it('3. Find PMCCs starts directly from held long calls and never opens a long-leg configuration dialog', async () => {
    renderScreener();
    await addToUniverse('NVDA,AAPL');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND PMCCs' }));
    expect(screen.queryByRole('button', { name: 'RUN PMCC SCAN →' })).not.toBeInTheDocument();
    expect(await screen.findByText(/No eligible held long calls match the selected tickers/i)).toBeInTheDocument();
  });

  it('4. CSP and PMCC no longer maintain independent ticker states — no separate LIST cards remain', async () => {
    renderScreener();
    expect(await screen.findByText('OPPORTUNITY UNIVERSE')).toBeInTheDocument();
    expect(screen.queryByText('PMCC LIST')).not.toBeInTheDocument();
    expect(screen.queryByText('CSP LIST')).not.toBeInTheDocument();
  });

  it('5. empty universe disables Find Spreads and Find CSPs, but PMCC remains available for portfolio-held long calls', async () => {
    renderScreener();
    expect(await screen.findByRole('button', { name: 'FIND SPREADS' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND CSPs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'FIND PMCCs' })).toBeEnabled();
  });

  it('6. Find LEAPS is enabled for a supplied ticker universe', async () => {
    renderScreener();
    await addToUniverse('NVDA');
    const findLeaps = await screen.findByRole('button', { name: /FIND LEAPS/i });
    expect(findLeaps).toBeEnabled();
    expect(findLeaps).toHaveAttribute('title', 'Finds new long-call candidates for the selected tickers.');
  });

  it('7. confirming the default CSP modal selection switches the visible results mode to filter', async () => {
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    expect(screen.getByRole('dialog', { name: 'CASH-SECURED PUT SCAN' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(localStorage.getItem('hunter-screen-mode')).toBe('filter'));
  });

  it('8. Find CSPs starts a "csp"-kind background job with the correct progressTotal', async () => {
    const startSpy = vi.spyOn(screenerJobStore, 'startScreenerJob');
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    const call = startSpy.mock.calls.find(c => c[0].kind === 'csp');
    expect(call).toBeTruthy();
    expect(call![0].total).toBe(2);
    startSpy.mockRestore();
  });
});

describe('TE-0007: Covered Call universe intersection', () => {
  function mockHoldings(bySymbol: CoveredCallCapacityReport['bySymbol']) {
    getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol, warnings: [] });
  }
  const holding = (overrides: Partial<CoveredCallCapacityReport['bySymbol'][string]> = {}) => ({
    sharesOwned: 100,
    costBasis: 50,
    costBasisComplete: true,
    grossCoveredContracts: 1,
    existingShortCallContracts: 0,
    workingShortCallContracts: 0,
    availableCoveredContracts: 1,
    oversubscribed: false,
    hasUnclassifiedExposure: false,
    ...overrides,
  });

  async function clickFindCoveredCalls() {
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
  }

  it('1. universe [NKE, MU], eligible [NKE, AAPL] → scans only NKE', async () => {
    mockHoldings({ NKE: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('NKE,MU');
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['NKE']);
  });

  it('2. empty selected-ticker list scans every verified eligible stock holding', async () => {
    mockHoldings({ NKE: holding(), AAPL: holding() });
    renderScreener();
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['NKE', 'AAPL']));
    expect(getMarketMetricsMock.mock.calls[0][0]).toHaveLength(2);
  });

  it('3. a universe ticker with no verified coverage is never scanned', async () => {
    mockHoldings({ NKE: holding() });
    renderScreener();
    await addToUniverse('NKE,UNCOVERED');
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['NKE']);
  });

  it('4. no overlap between universe and eligible holdings shows the exact clear empty-state message', async () => {
    mockHoldings({ AAPL: holding() });
    renderScreener();
    await addToUniverse('NKE');
    await clickFindCoveredCalls();
    // Legitimately appears twice — the dedicated CC card and the shared
    // transient-error banner both surface it (same pattern as
    // CcCapacityGate.test.tsx's unavailable-reason assertion).
    await waitFor(() =>
      expect(screen.getAllByText('No covered-call-eligible holdings match the current Opportunity Universe.').length).toBeGreaterThan(0)
    );
    expect(getMarketMetricsMock).not.toHaveBeenCalled();
  });

  it('5. a fully-covered / zero-capacity holding remains excluded even if in the universe', async () => {
    mockHoldings({ NKE: holding({ availableCoveredContracts: 0 }), MU: holding() });
    renderScreener();
    await addToUniverse('NKE,MU');
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['MU']);
  });

  it('6. unavailable holdings/order evidence prevents scanning entirely, regardless of the universe', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'unavailable',
      bySymbol: {},
      warnings: [],
      unavailableReason: 'Could not verify covered-call capacity.',
    });
    renderScreener();
    await addToUniverse('NKE');
    await clickFindCoveredCalls();
    await waitFor(() => expect(screen.getAllByText('Could not verify covered-call capacity.').length).toBeGreaterThan(0));
    expect(getMarketMetricsMock).not.toHaveBeenCalled();
  });

  it('7. "Scan all eligible holdings" bypasses only the universe filter, never capacity verification', async () => {
    mockHoldings({ NKE: holding({ availableCoveredContracts: 0 }), MU: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('MU');
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['MU']);

    getMarketMetricsMock.mockClear();
    const bypassBtn = await screen.findByRole('button', { name: /Scan all eligible holdings/i });
    await userEvent.click(bypassBtn);
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    // NKE still excluded (zero capacity) even though the universe filter was bypassed.
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['MU', 'AAPL']));
    expect(getMarketMetricsMock.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['NKE']));
  });

  it('8. working-order reservations (existingShortCallContracts/workingShortCallContracts) remain honored inside the universe intersection', async () => {
    mockHoldings({
      NKE: holding({ grossCoveredContracts: 2, existingShortCallContracts: 1, workingShortCallContracts: 1, availableCoveredContracts: 0 }),
      MU: holding(),
    });
    renderScreener();
    await addToUniverse('NKE,MU');
    await clickFindCoveredCalls();
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    // NKE's capacity was fully reserved by existing + working short calls -- excluded despite being in the universe.
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['MU']);
  });
});
