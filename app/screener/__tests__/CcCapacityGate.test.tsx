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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

async function clickCcScan() {
  const button = await screen.findByRole('button', { name: /SCAN ELIGIBLE HOLDINGS FOR CC/i });
  await userEvent.click(button);
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
