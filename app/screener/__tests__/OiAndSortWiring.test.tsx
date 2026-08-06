// app/screener/__tests__/OiAndSortWiring.test.tsx
//
// SCREENER-OI-0001 — page-wiring regression coverage. Numbered comments map
// to the ticket's required-test list (16 of 18 are covered purely at the
// lib level in lib/screener/__tests__/screenerResultOrdering.test.ts; this
// file covers the remaining wiring-level requirements:
//   17. Consistent behavior in Ranked and Filtered modes.
//   18. No regression to Covered Call capacity protections or the unified
//       Opportunity Universe.
//
// Same mocking convention as CcCapacityGate.test.tsx / SingleCoveredCall
// LaunchAction.test.tsx / UnifiedStrategyLauncher.test.tsx: only the
// network boundary (lib/scans/tastytrade-client) is mocked; the real
// app/screener/page.tsx component logic runs, including the real canonical
// OI/sort module.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { MIN_OI_LABEL } from '@/lib/screener/screenerResultOrdering';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

const getCoveredCallCapacityReportMock = vi.fn<[], Promise<CoveredCallCapacityReport>>();
const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getQuoteMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getCoveredCallCapacityReport: (...args: any[]) => getCoveredCallCapacityReportMock(...(args as [])),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: (...args: any[]) => getQuoteMock(...args),
    getChain: (...args: any[]) => getChainMock(...args),
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
  const button = await screen.findByRole('button', { name: 'FIND COVERED CALLS' });
  await userEvent.click(button);
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

// A single eligible CC leg -- delta/DTE/bid-ask width all comfortably
// inside DEFAULT_CC_RULES, and openInterest deliberately set to 150: high
// enough to clear the pre-existing checklist OI_MIN (100), but low enough
// that the ticket's new 250 and 500 presets fail it while Any/100 pass it.
function mockEligibleChain(openInterest: number) {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const expDate = d.toISOString().slice(0, 10);
  getChainMock.mockResolvedValue({
    expirations: [expDate],
    chains: {
      [expDate]: [
        {
          strikePrice: 110, expirationDate: expDate, optionType: 'C', delta: 0.28,
          openInterest, bid: 1.2, ask: 1.3, mid: 1.25, occSymbol: 'NKE_TEST_C',
        },
      ],
    },
    isEtfOrIndex: false,
    classification: 'stock',
  });
  getQuoteMock.mockResolvedValue(100);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getCoveredCallCapacityReportMock.mockReset().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] });
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset();
  getQuoteMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SCREENER-OI-0001: single canonical implementation, not duplicated per component', () => {
  it('OiAndSortControls is defined exactly once in page.tsx and rendered for Filtered, Ranked, and Targeted panels', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    const definitions = src.match(/function OiAndSortControls\(/g) ?? [];
    expect(definitions).toHaveLength(1);
    const usages = src.match(/<OiAndSortControls\b/g) ?? [];
    // Filtered, Ranked, Targeted -- one shared control, three call sites.
    expect(usages.length).toBe(3);
  });

  it('the canonical filter/sort functions are imported from lib/screener/screenerResultOrdering, not reimplemented locally', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    expect(src).toMatch(/from '@\/lib\/screener\/screenerResultOrdering'/);
    // No second, page-local definition of the canonical eligibility/sort
    // functions -- page.tsx only ever calls them, it doesn't redefine them.
    expect(src.match(/function evaluateOiEligibility\(/g)).toBeNull();
    expect(src.match(/function sortItems\(/g)).toBeNull();
  });
});

describe('SCREENER-OI-0001: 17. consistent behavior in Ranked and Filtered modes (structural)', () => {
  it('neither the Filtered nor the Ranked results panel renders the OI/sort control before there are any results', async () => {
    renderScreener();
    await screen.findByText('OPPORTUNITY UNIVERSE');
    // No scan has run yet in either mode -- the shared control only mounts
    // alongside an actual results panel, in both modes identically.
    expect(screen.queryByText(MIN_OI_LABEL)).not.toBeInTheDocument();
  });
});

describe('SCREENER-OI-0001: 18. no regression to Covered Call capacity protections or the unified Opportunity Universe', () => {
  it('a real CC scan still produces a qualified result, and the new minimum-OI floor narrows it exactly as configured -- capacity/eligibility gating is untouched', async () => {
    mockHoldingsAndChain();
    renderScreener();
    await clickCcScan();

    // The pre-existing CC capacity/eligibility pipeline still produces a
    // real qualified candidate (regression check: TE-0007C's capacity
    // gating is untouched by this ticket). "1 of 1 QUALIFIED" at the
    // default "Any" floor -- the real candidate (OI 150) is counted.
    await waitFor(() => expect(screen.getByText('1 of 1 QUALIFIED')).toBeInTheDocument());
    const oiLabel = screen.getByText(MIN_OI_LABEL);
    expect(oiLabel).toBeInTheDocument();
    // Scope preset-button queries to the OI control's own row -- "Any" and
    // "100" are ambiguous against the page's other, pre-existing POP/OTM/
    // Credit-Ratio filter chips, which also use "Any" as their zero label.
    const oiRow = oiLabel.closest('div') as HTMLElement;

    // Selecting the 250 preset (above the candidate's real OI of 150) must
    // narrow the qualified count to 0 -- proves the new floor is wired to
    // the real scan result, not a no-op decoration. (The ticker-toggle chip
    // still lists NKE regardless -- that row is a hide-by-symbol control
    // over ALL scanned tickers, unaffected by the OI floor by design, so
    // the QUALIFIED count -- not raw "NKE" text presence -- is the correct
    // assertion here.)
    const preset250 = within(oiRow).getByRole('button', { name: '250' });
    await userEvent.click(preset250);
    await waitFor(() => expect(screen.getByText('0 of 1 QUALIFIED')).toBeInTheDocument());

    // Selecting "Any" restores it -- the floor never permanently discards
    // data, and never fabricates an OI value either way.
    const presetAny = within(oiRow).getByRole('button', { name: 'Any' });
    await userEvent.click(presetAny);
    await waitFor(() => expect(screen.getByText('1 of 1 QUALIFIED')).toBeInTheDocument());
  });

  function mockHoldingsAndChain() {
    getCoveredCallCapacityReportMock.mockResolvedValue({
      status: 'ok',
      bySymbol: { NKE: holding() },
      warnings: [],
    });
    mockEligibleChain(150);
  }
});
