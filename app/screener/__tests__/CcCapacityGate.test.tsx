// app/screener/__tests__/CcCapacityGate.test.tsx
//
// TE-0007C final corrective pass — required UI/wiring tests 9 and 10:
//   9. Account-level unattributable exposure displays a blocking
//      data-integrity message, and the scan action does not run (no market
//      metrics are fetched, no CC candidates are generated).
//  10. Per-symbol conservatively-reserved exposure (hasUnclassifiedExposure)
//      displays the disclosure warning in the eligible-holdings card, and
//      the report stays usable (available capacity is what's shown/scanned
//      — never "restored").
//
// This exercises app/screener/page.tsx's actual runCcScan() wiring (not a
// reimplementation of it) by mocking only the network boundary
// (lib/scans/tastytrade-client) and letting the real component logic run.
//
// TE-0007 final corrective pass: the ordinary Covered Call scan action is
// now driven exclusively through the unified launcher's "FIND COVERED
// CALLS" button (the eligible-holdings card's own duplicate "SCAN ELIGIBLE
// HOLDINGS FOR CC" button was removed). clickCcScan() below drives that
// real button.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { UNATTRIBUTABLE_EXPOSURE_REASON } from '@/lib/scans/covered-call-capacity';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';

const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();
const emitCoveredCallCapacityShadowMock = vi.fn();
const collectCoveredCallCapacityShadowMock = vi.fn();
const shadowHarness = vi.hoisted(() => ({ snapshot: null as PortfolioSnapshot | null }));

vi.mock('@/components/portfolio-data/PortfolioDataProvider', () => {
  // Stable references -- a fresh [] on every call would make the real
  // component's useEffect dependency array (which includes
  // portfolioData?.positions) look "changed" every render, since [] !== []
  // in JS, causing an infinite re-render loop rather than a clean mount.
  const stablePositions: unknown[] = [];
  return {
    usePortfolioData: () => ({ snapshot: shadowHarness.snapshot }),
    // FIX: CcCapacityShadowSnapshotBridge (app/screener/page.tsx) calls
    // useOptionalPortfolioData -- this mock predates that dependency and
    // was never updated, causing every test in this file to crash on
    // render. positions/refresh default to safe no-ops since none of this
    // file's assertions exercise them; only `snapshot` (shared with the
    // existing usePortfolioData mock above) matters here.
    useOptionalPortfolioData: () => ({ snapshot: shadowHarness.snapshot, positions: stablePositions, refresh: null }),
  };
});

vi.mock('@/lib/portfolio-snapshot/shadowParity', () => ({
  isCcCapacityShadowEnabled: (value = process.env.NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED) => value === 'true',
  emitCoveredCallCapacityShadow: (...args: unknown[]) => emitCoveredCallCapacityShadowMock(...args),
}));

vi.mock('@/lib/portfolio-snapshot/shadowTelemetry', () => ({
  collectCoveredCallCapacityShadow: (...args: unknown[]) => collectCoveredCallCapacityShadowMock(...args),
}));

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

async function addToUniverse(symbols: string) {
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, symbols);
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
}

async function clickCcScan() {
  const button = await screen.findByRole('button', { name: 'FIND CCs' });
  await userEvent.click(button);
  await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
}

describe('TE-0007C final corrective pass: CC capacity gate wiring', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Every OTHER network path this page touches on mount (watchlists,
    // filters, presets, decision reviews, etc.) is irrelevant to this test
    // and already fails gracefully to empty/default state in existing
    // coverage (see PortfolioPage.test.tsx for the same pattern) — stub
    // global fetch to reject so none of it blocks rendering.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
    getCoveredCallCapacityReportMock.mockReset();
    getMarketMetricsMock.mockReset().mockResolvedValue([]);
    emitCoveredCallCapacityShadowMock.mockReset();
    collectCoveredCallCapacityShadowMock.mockReset();
    shadowHarness.snapshot = null;
    vi.stubEnv('NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps the legacy capacity report authoritative when shadow comparison differs', async () => {
    vi.stubEnv('NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED', 'true');
    shadowHarness.snapshot = { asOf: '2026-08-22T18:00:00.000Z', freshness: 'current' } as PortfolioSnapshot;
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: {
        NKE: {
          sharesOwned: 300,
          costBasis: 90,
          costBasisComplete: true,
          grossCoveredContracts: 3,
          existingShortCallContracts: 1,
          workingShortCallContracts: 0,
          availableCoveredContracts: 2,
          oversubscribed: false,
          hasUnclassifiedExposure: false,
        },
      },
      warnings: [],
    });
    emitCoveredCallCapacityShadowMock.mockReturnValue({ outcome: 'difference' });

    renderScreener();
    await addToUniverse('NKE');
    await clickCcScan();

    await waitFor(() => expect(emitCoveredCallCapacityShadowMock).toHaveBeenCalled());
    expect(emitCoveredCallCapacityShadowMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', bySymbol: expect.objectContaining({ NKE: expect.any(Object) }) }),
      shadowHarness.snapshot,
      expect.any(Function),
    );
    expect(await screen.findByRole('button', { name: /NKE \(2\)/i })).toBeInTheDocument();
  });

  it('suppresses the older shadow diagnostic when overlapping capacity loads resolve out of order', async () => {
    vi.stubEnv('NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED', 'true');
    shadowHarness.snapshot = { asOf: '2026-08-22T18:00:00.000Z', freshness: 'current' } as PortfolioSnapshot;
    const older = deferred<CoveredCallCapacityReport>();
    const newer = deferred<CoveredCallCapacityReport>();
    getCoveredCallCapacityReportMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CCs' }));
    await waitFor(() => expect(getCoveredCallCapacityReportMock).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CC SCAN →' }));
    await waitFor(() => expect(getCoveredCallCapacityReportMock).toHaveBeenCalledTimes(2));

    const newerReport = {
      status: 'ok' as const,
      bySymbol: { NKE: {
        sharesOwned: 200, costBasis: 90, costBasisComplete: true, grossCoveredContracts: 2,
        existingShortCallContracts: 0, workingShortCallContracts: 0, availableCoveredContracts: 2,
        oversubscribed: false, hasUnclassifiedExposure: false,
      } },
      warnings: [],
    };
    newer.resolve(newerReport);
    await waitFor(() => expect(emitCoveredCallCapacityShadowMock).toHaveBeenCalledTimes(1));
    expect(emitCoveredCallCapacityShadowMock.mock.calls[0][0]).toBe(newerReport);
    expect(await screen.findByRole('button', { name: /NKE \(2\)/i })).toBeInTheDocument();

    older.resolve({ status: 'ok', bySymbol: {}, warnings: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(emitCoveredCallCapacityShadowMock).toHaveBeenCalledTimes(1);
  });

  it('isolates an unexpected page-boundary shadow throw from the authoritative legacy result', async () => {
    vi.stubEnv('NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED', 'true');
    shadowHarness.snapshot = { asOf: '2026-08-22T18:00:00.000Z', freshness: 'current' } as PortfolioSnapshot;
    emitCoveredCallCapacityShadowMock.mockImplementation(() => { throw new Error('unexpected shadow failure'); });
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: {
        sharesOwned: 100, costBasis: 90, costBasisComplete: true, grossCoveredContracts: 1,
        existingShortCallContracts: 0, workingShortCallContracts: 0, availableCoveredContracts: 1,
        oversubscribed: false, hasUnclassifiedExposure: false,
      } },
      warnings: [],
    });

    renderScreener();
    await addToUniverse('NKE');
    await clickCcScan();
    expect(await screen.findByRole('button', { name: /NKE \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByText(/unexpected shadow failure/i)).not.toBeInTheDocument();
    expect(collectCoveredCallCapacityShadowMock).not.toHaveBeenCalled();
  });

  it('9. account-level unattributable exposure blocks the scan and shows the data-integrity message, not "no eligible holdings"', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'unavailable',
      bySymbol: {},
      warnings: ['Existing short option position (symbol "unknown") could not be attributed to an underlying holding — Covered Call capacity cannot be safely verified.'],
      unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON,
    });

    renderScreener();
    await clickCcScan();

    // The exact blocking message must be shown verbatim -- it legitimately
    // appears twice (the dedicated CC card, and the shared transient-error
    // banner both surface it), so assert on presence, not single-element
    // uniqueness.
    await waitFor(() => expect(screen.getAllByText(UNATTRIBUTABLE_EXPOSURE_REASON).length).toBeGreaterThan(0));

    // Must NOT be misrepresented as an ordinary empty result.
    expect(screen.queryByText(/No eligible holdings loaded yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No eligible covered-call holdings with available capacity/i)).not.toBeInTheDocument();

    // The scan itself must not have run: no market-data fetch for any
    // symbol, meaning no holding was scanned.
    expect(getMarketMetricsMock).not.toHaveBeenCalled();
  });

  it('10. per-symbol conservatively-reserved exposure shows the warning and keeps the reduced capacity as the cap — report stays usable', async () => {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: {
        NKE: {
          sharesOwned: 300,
          costBasis: 90,
          costBasisComplete: true,
          grossCoveredContracts: 3,
          existingShortCallContracts: 1, // conservatively reserved unclassified exposure
          workingShortCallContracts: 0,
          availableCoveredContracts: 2,
          oversubscribed: false,
          hasUnclassifiedExposure: true,
        },
      },
      warnings: [],
    });

    renderScreener();
    // SCREENER-RESULTS-0001 — an empty Opportunity Universe no longer
    // implicitly scans every eligible holding, so NKE must be added
    // explicitly for this capacity-disclosure test to reach a real scan.
    await addToUniverse('NKE');
    await clickCcScan();

    // The eligible-holdings card must disclose the conservative reservation.
    await waitFor(() =>
      expect(
        screen.getByText(/Some option exposure could not be classified\. Available covered-call capacity was reduced conservatively\./i),
      ).toBeInTheDocument(),
    );

    // The report is still usable: NKE shows as an eligible, clickable symbol
    // chip with its REDUCED (not restored) available count.
    const chip = screen.getByRole('button', { name: /NKE \(2\)/i });
    expect(chip).toBeInTheDocument();
    expect(chip).not.toBeDisabled();
  });
});
