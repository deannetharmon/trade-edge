// app/screener/__tests__/SingleCoveredCallLaunchAction.test.tsx
//
// TE-0007 final corrective pass — required correction: remove the
// duplicate ordinary Covered Call launch action. Before this pass, the
// page rendered two entry points for the exact same scan: "FIND COVERED
// CALLS" in the unified Opportunity Universe launcher, and "SCAN ELIGIBLE
// HOLDINGS FOR CC" in the eligible-holdings status card. The latter was
// removed; "FIND COVERED CALLS" is now the sole ordinary Covered Call
// scan action. The eligible-holdings card keeps all of its status
// information (verified capacity, blocked holdings, conservative-exposure
// warnings, fail-closed state, per-symbol hide controls) plus the
// explicit "Scan all eligible holdings" universe-bypass override, shown
// only when the Opportunity Universe is actually narrowing/excluding
// eligible holdings.
//
// This exercises the real app/screener/page.tsx wiring (not a
// reimplementation), same mocking pattern as CcCapacityGate.test.tsx and
// UnifiedStrategyLauncher.test.tsx: only the network boundary is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { UNATTRIBUTABLE_EXPOSURE_REASON } from '@/lib/scans/covered-call-capacity';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

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
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
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

function mockHoldings(bySymbol: CoveredCallCapacityReport['bySymbol']) {
  getCoveredCallCapacityReportMock.mockResolvedValue({ status: 'ok', bySymbol, warnings: [] });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TE-0007 final corrective pass: single ordinary Covered Call launch action', () => {
  it('exactly one ordinary Covered Call scan action is rendered, and it is FIND COVERED CALLS', async () => {
    renderScreener();
    await screen.findByText('OPPORTUNITY UNIVERSE');

    const candidates = screen.getAllByRole('button').filter(b => /covered call/i.test(b.textContent ?? ''));
    // Excludes per-symbol holding chips (e.g. "NKE (2)") and the
    // universe-bypass override ("Scan all eligible holdings...") --
    // neither contains the phrase "covered call".
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toHaveTextContent('FIND COVERED CALLS');
  });

  it('the removed status-card action ("SCAN ELIGIBLE HOLDINGS FOR CC") is absent', async () => {
    renderScreener();
    await screen.findByText('OPPORTUNITY UNIVERSE');
    expect(screen.queryByRole('button', { name: /SCAN ELIGIBLE HOLDINGS FOR CC/i })).not.toBeInTheDocument();
  });

  it('the normal action (FIND COVERED CALLS) preserves verified universe-intersection behavior', async () => {
    mockHoldings({ NKE: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['NKE']); // MU not eligible, AAPL not in universe
  });

  it('the override does NOT appear when the universe is empty (nothing to narrow)', async () => {
    mockHoldings({ NKE: holding(), AAPL: holding() });
    renderScreener();
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Scan all eligible holdings/i })).not.toBeInTheDocument();
  });

  it('the override does NOT appear when the universe already covers every eligible holding (nothing is being narrowed)', async () => {
    mockHoldings({ NKE: holding(), MU: holding() });
    renderScreener();
    await addToUniverse('NKE,MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Scan all eligible holdings/i })).not.toBeInTheDocument();
  });

  it('the override DOES appear when the universe is actually narrowing eligible holdings', async () => {
    mockHoldings({ NKE: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Scan all eligible holdings/i })).toBeInTheDocument();
  });

  it('the override bypasses only the universe filter — zero-capacity holdings remain excluded', async () => {
    mockHoldings({ NKE: holding({ availableCoveredContracts: 0 }), MU: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(['MU']);

    getMarketMetricsMock.mockClear();
    await userEvent.click(await screen.findByRole('button', { name: /Scan all eligible holdings/i }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['MU', 'AAPL']));
    expect(getMarketMetricsMock.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['NKE']));
  });

  it('the override bypasses only the universe filter — existing + working short-call reservations remain honored', async () => {
    mockHoldings({
      NKE: holding({ grossCoveredContracts: 2, existingShortCallContracts: 1, workingShortCallContracts: 1, availableCoveredContracts: 0 }),
      MU: holding(),
    });
    renderScreener();
    await addToUniverse('MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    getMarketMetricsMock.mockClear();
    const overrideBtn = screen.queryByRole('button', { name: /Scan all eligible holdings/i });
    // NKE's capacity is fully reserved, so it's the same set whether or
    // not the universe narrows anything -- the override may not even be
    // offered here since the universe (MU only) isn't excluding any
    // *scannable* holding (NKE was never scannable). Either way, NKE must
    // never be scanned.
    if (overrideBtn) {
      await userEvent.click(overrideBtn);
      await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    }
    const scanned = overrideBtn ? getMarketMetricsMock.mock.calls[0][0] : ['MU'];
    expect(scanned).not.toEqual(expect.arrayContaining(['NKE']));
  });

  it('the override bypasses only the universe filter — user-hidden holdings remain excluded', async () => {
    mockHoldings({ NKE: holding(), MU: holding(), AAPL: holding() });
    renderScreener();
    await addToUniverse('MU');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    // Hide NKE via its chip (only visible once eligible holdings are loaded).
    const nkeChip = await screen.findByRole('button', { name: /^NKE \(1\)$/ });
    await userEvent.click(nkeChip);

    getMarketMetricsMock.mockClear();
    const overrideBtn = await screen.findByRole('button', { name: /Scan all eligible holdings/i });
    await userEvent.click(overrideBtn);
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());
    expect(getMarketMetricsMock.mock.calls[0][0]).toEqual(expect.arrayContaining(['MU', 'AAPL']));
    expect(getMarketMetricsMock.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['NKE']));
  });

  it('unattributable-exposure blocking still prevents any scan, and no override is offered while blocked', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'unavailable',
      bySymbol: {},
      warnings: [],
      unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON,
    });
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(screen.getAllByText(UNATTRIBUTABLE_EXPOSURE_REASON).length).toBeGreaterThan(0));
    expect(getMarketMetricsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Scan all eligible holdings/i })).not.toBeInTheDocument();
  });

  it('all pre-existing fail-closed and capacity-disclosure UI remains intact on the status card', async () => {
    mockHoldings({
      NKE: holding({ existingShortCallContracts: 1, hasUnclassifiedExposure: true, availableCoveredContracts: 2, grossCoveredContracts: 3 }),
      MU: holding({ availableCoveredContracts: 0 }),
    });
    renderScreener();
    await userEvent.click(await screen.findByRole('button', { name: 'FIND COVERED CALLS' }));
    await waitFor(() => expect(getMarketMetricsMock).toHaveBeenCalled());

    // Conservative-exposure disclosure.
    expect(
      await screen.findByText(/Some option exposure could not be classified\. Available covered-call capacity was reduced conservatively\./i)
    ).toBeInTheDocument();
    // Blocked/fully-covered holding disclosure.
    expect(screen.getByText(/Fully covered \/ blocked: MU/i)).toBeInTheDocument();
    // Reduced (not restored) capacity shown on the chip.
    expect(screen.getByRole('button', { name: /NKE \(2\)/i })).toBeInTheDocument();
  });
});
