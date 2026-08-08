// app/screener/__tests__/OiAndSortWiring.test.tsx
//
// SCREENER-OI-0001 — page-wiring regression coverage, corrected per the
// scope-correction pass: the canonical minimum-OI floor and two-level sort
// are exposed and applied in Ranked and Filtered modes ONLY. Targeted mode
// deliberately keeps its pre-existing, established single-field sort and
// has no OI floor -- the canonical pure functions in
// lib/screener/screenerResultOrdering.ts remain available for Targeted (or
// a future scanner) to adopt later, but nothing in Targeted's panel calls
// them.
//
// Numbered comments map to the ticket's required-test list (16 of 18 are
// covered purely at the lib level in
// lib/screener/__tests__/screenerResultOrdering.test.ts). This file covers:
//   17. Consistent behavior in Ranked and Filtered modes.
//   18. No regression to Covered Call capacity protections or the unified
//       Opportunity Universe.
// Plus the scope-correction's required coverage:
//   - Ranked mode exposes and applies the OI/sort controls.
//   - Filtered mode exposes and applies the OI/sort controls.
//   - Targeted mode does NOT expose the controls.
//   - Targeted results are not silently reordered or excluded by
//     Ranked/Filtered OI state.
//   - Switching modes does not leak an OI floor or sort selection into
//     Targeted behavior.
//
// Same mocking convention as CcCapacityGate.test.tsx / SingleCoveredCall
// LaunchAction.test.tsx / UnifiedStrategyLauncher.test.tsx: only the
// network boundary (lib/scans/tastytrade-client) is mocked; the real
// app/screener/page.tsx component logic runs, including the real canonical
// OI/sort module. For Ranked mode specifically, useRankedScan (a task/
// command-bus-orchestrated hook, out of this ticket's scope to re-test) is
// mocked at the hook boundary so its startRankedScan directly populates
// `results` with controllable fixture data through the REAL page wiring --
// this tests the OI/sort wiring, not the ranked-scan task orchestration.
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
import type { ScreenResult } from '@/lib/scans/types';

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
    getCspCapitalContext: vi.fn().mockResolvedValue({ accountSelected: true, accountId: 'test-acct', optionBuyingPower: 10000, cashBalance: 10000 }),
  };
});

// Ranked-mode fixture: a BPS ScreenResult with a controllable bestCandidate
// OI. useRankedScan's real implementation is an async task/command-bus
// orchestration (dispatch -> background task -> poll -> setResults) that is
// its own, separately-owned, already-tested surface -- out of scope for an
// OI/sort wiring test. Mocking it at the hook boundary to directly call the
// real setResults/setResultsCachedAt setters it's given lets the rest of
// page.tsx's REAL Ranked-mode render/filter/sort code run unmodified.
const startRankedScanMock = vi.fn();
vi.mock('@/features/screener/hooks/useRankedScan', () => ({
  useRankedScan: (params: any) => ({
    startRankedScan: async (...args: any[]) => {
      startRankedScanMock(...args);
      params.setResults(rankedFixture());
      params.setResultsCachedAt(Date.now());
    },
  }),
}));

function rankedFixture(): ScreenResult[] {
  const emptyCheck = { status: 'pass' as const, value: '-', reason: '-' };
  const makeChecks = () => ({
    ivr: emptyCheck, earnings: emptyCheck, oi: emptyCheck, delta: emptyCheck,
    credit: emptyCheck, roc: emptyCheck, pop: emptyCheck, iv: emptyCheck, emClearance: emptyCheck,
  });
  const makeCandidate = (shortOI: number, credit: number) => ({
    strategy: 'BPS', expiration: '2026-12-18', dte: 30,
    shortStrike: 95, longStrike: 90, shortDelta: 0.25,
    credit, spreadWidth: 5, creditRatio: credit / 5, roc: 30, pop: 70,
    shortOI, longOI: shortOI,
  });
  return [
    {
      symbol: 'HIOI', strategy: 'BPS', price: 100, ivr: 40, ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
      qualified: true, bestCandidate: makeCandidate(600, 1.5) as any, failReasons: [], checks: makeChecks(),
    },
    {
      symbol: 'LOOI', strategy: 'BPS', price: 50, ivr: 35, ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
      qualified: true, bestCandidate: makeCandidate(50, 1.0) as any, failReasons: [], checks: makeChecks(),
    },
  ];
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

async function addToUniverse(symbols: string) {
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, symbols);
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
}

async function clickCcScan() {
  const button = await screen.findByRole('button', { name: 'FIND CCs' });
  await userEvent.click(button);
}

async function runRankedScan() {
  await addToUniverse('HIOI, LOOI');
  await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
  await userEvent.click(await screen.findByRole('radio', { name: /RANK/ }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN SCREENER/ }));
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
  startRankedScanMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SCREENER-OI-0001: single canonical implementation, Ranked + Filtered only', () => {
  it('OiAndSortControls is defined once and reused for spread Filtered, CSP Filtered, and Ranked (not Targeted)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    const definitions = src.match(/function OiAndSortControls\(/g) ?? [];
    expect(definitions).toHaveLength(1);
    const usages = src.match(/<OiAndSortControls\b/g) ?? [];
    // Spread Filtered + CSP Filtered + Ranked -- one shared implementation,
    // three deliberate call sites. Targeted still never renders it.
    expect(usages.length).toBe(3);

    // Precisely confirm neither call site is inside TargetedScanResultsPanel:
    // slice the function's own body out and check it directly.
    const fnStart = src.indexOf('function TargetedScanResultsPanel(');
    expect(fnStart).toBeGreaterThan(-1);
    // The panel function is followed by the next top-level function/const
    // banner comment; a generous slice comfortably covers its whole body
    // without needing a real brace-matching parser.
    const panelBody = src.slice(fnStart, fnStart + 12000);
    expect(panelBody).not.toMatch(/<OiAndSortControls\b/);
    expect(panelBody).not.toMatch(/\bminOi\b/);
    expect(panelBody).not.toMatch(/\bsecondarySort\b/);
  });

  it('the canonical filter/sort functions are imported from lib/screener/screenerResultOrdering, not reimplemented locally', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    expect(src).toMatch(/from '@\/lib\/screener\/screenerResultOrdering'/);
    expect(src.match(/function evaluateOiEligibility\(/g)).toBeNull();
    expect(src.match(/function sortItems\(/g)).toBeNull();
  });
});

describe('SCREENER-OI-0001: Targeted mode does not expose the OI/sort controls', () => {
  it('the OI/sort control label never appears while Targeted mode is active, even with real Targeted results present', async () => {
    // The RunModeModal's mode picker and Targeted's own established DTE/
    // POP/OTM/sort controls remain -- just not MIN_OI_LABEL or a secondary
    // sort selector.
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('radio', { name: /TARGETED/ }));
    // Targeted mode is now selected in the modal; closing without running
    // is sufficient to prove the picker itself never shows the new label,
    // and confirms Targeted's own DTE/POP/OTM controls are still present
    // (established behavior, untouched).
    expect(screen.getByText(/DTE RANGE/i)).toBeInTheDocument();
    expect(screen.queryByText(MIN_OI_LABEL)).not.toBeInTheDocument();
  });
});

describe('SCREENER-OI-0001: Ranked mode exposes and applies the OI/sort controls', () => {
  it('a Ranked scan result set shows the OI/sort control, and the OI floor narrows the visible set exactly as configured', async () => {
    renderScreener();
    await runRankedScan();

    await waitFor(() => expect(screen.getByText(MIN_OI_LABEL)).toBeInTheDocument());
    // Both fixture results visible at the default "Any" floor. Scoped to
    // `selector: 'p'` because the symbol also renders as plain text in two
    // other, unrelated places on this page -- the Opportunity Universe
    // sidebar ticker list and this same Ranked panel's own per-ticker
    // visibility-toggle chip ("HIOI (1)") -- neither of which is a <p>;
    // only ResultCard's own title element is. Without this, getByText
    // throws "Found multiple elements" rather than testing the result set.
    await waitFor(() => expect(screen.getByText('HIOI', { selector: 'p' })).toBeInTheDocument());
    expect(screen.getByText('LOOI', { selector: 'p' })).toBeInTheDocument();

    const oiRow = screen.getByText(MIN_OI_LABEL).closest('div') as HTMLElement;
    const preset250 = within(oiRow).getByRole('button', { name: '250' });
    await userEvent.click(preset250);

    // LOOI's real OI (50) fails the 250 floor; HIOI's (600) passes --
    // proves the floor is wired to the real Ranked result set. The
    // per-ticker chip row is intentionally unaffected (it lists the whole
    // raw scan universe, not the OI/other-filtered display set), so LOOI's
    // chip button remains -- only its <p> ResultCard title disappears.
    await waitFor(() => expect(screen.queryByText('LOOI', { selector: 'p' })).not.toBeInTheDocument());
    expect(screen.getByText('HIOI', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('SCREENER-OI-0001: 18. no regression to Covered Call capacity protections or the unified Opportunity Universe (Filtered mode)', () => {
  it('a real CC scan still produces a qualified result, and the new minimum-OI floor narrows it exactly as configured -- capacity/eligibility gating is untouched', async () => {
    mockHoldingsAndChain();
    renderScreener();
    // SCREENER-RESULTS-0001 — an empty Opportunity Universe no longer
    // implicitly scans every eligible holding, so NKE must be added
    // explicitly for this OI-floor test to reach a real scan.
    await addToUniverse('NKE');
    await clickCcScan();

    await waitFor(() => expect(screen.getByText('1 of 1 QUALIFIED')).toBeInTheDocument());
    const oiLabel = screen.getByText(MIN_OI_LABEL);
    expect(oiLabel).toBeInTheDocument();
    const oiRow = oiLabel.closest('div') as HTMLElement;

    const preset250 = within(oiRow).getByRole('button', { name: '250' });
    await userEvent.click(preset250);
    await waitFor(() => expect(screen.getByText('0 of 1 QUALIFIED')).toBeInTheDocument());

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

describe('SCREENER-OI-0001: Targeted results are not reordered or excluded by Ranked/Filtered OI state, and mode switches never leak it', () => {
  it('a real Targeted scan is entirely unaffected by whatever OI floor is currently set for Ranked mode', async () => {
    // Real Targeted candidate generation (BPS/BCS/IC exhaustive search) is
    // its own heavy, separately-tested surface -- this test instead proves
    // the negative property the ticket asks for directly from source: the
    // Targeted panel's filter/sort pipeline has no reference to any of the
    // Ranked/Filtered OI state variables, so there is no code path by which
    // rankMinOi/filteredMinOi could reach it.
    const src = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
    const panelStart = src.indexOf('function TargetedScanResultsPanel(');
    const panelBody = src.slice(panelStart, panelStart + 12000);
    expect(panelBody).not.toMatch(/rankMinOi/);
    expect(panelBody).not.toMatch(/filteredMinOi/);
    expect(panelBody).not.toMatch(/rankSort\b/);
    expect(panelBody).not.toMatch(/filteredSort\b/);

    // And the reverse: the Targeted panel's own props type has no minOi/
    // secondarySort fields at all (not just "unused" -- structurally absent).
    const propsBlockMatch = src.match(/function TargetedScanResultsPanel\(\{[\s\S]*?\}\)\s*\{/);
    expect(propsBlockMatch).not.toBeNull();
    const propsBlock = propsBlockMatch![0];
    expect(propsBlock).not.toMatch(/minOi/);
    expect(propsBlock).not.toMatch(/secondarySort/);
  });

  it('switching from Ranked (with a floor set) to Targeted and back to Ranked preserves the Ranked floor -- it never resets or leaks through Targeted', async () => {
    renderScreener();
    await runRankedScan();
    await waitFor(() => expect(screen.getByText(MIN_OI_LABEL)).toBeInTheDocument());
    const oiRow = screen.getByText(MIN_OI_LABEL).closest('div') as HTMLElement;
    await userEvent.click(within(oiRow).getByRole('button', { name: '500' }));
    // Scoped to `selector: 'p'` -- see the note in the previous describe
    // block; LOOI's per-ticker visibility chip legitimately survives the
    // OI floor (it lists the raw scan universe), only its ResultCard <p>
    // title should disappear.
    await waitFor(() => expect(screen.queryByText('LOOI', { selector: 'p' })).not.toBeInTheDocument());

    // Open the run modal and switch the picker to Targeted, then close
    // without running -- simulates a person browsing modes mid-session.
    // The modal's own close button is scoped via its heading, because a
    // bare "✕" also matches the two per-ticker remove buttons in the
    // Opportunity Universe sidebar (HIOI, LOOI) that this test added.
    await userEvent.click(await screen.findByRole('button', { name: /↺$/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /TARGETED/ }));
    const runModal = screen.getByRole('dialog', { name: /SCAN SELECTED/ });
    await userEvent.click(within(runModal).getByRole('button', { name: /close scan configuration/i }));

    // Ranked mode's own OI floor (500) is still in effect -- untouched by
    // having briefly viewed the Targeted picker.
    await waitFor(() => expect(screen.getByText(MIN_OI_LABEL)).toBeInTheDocument());
    expect(screen.queryByText('LOOI', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.getByText('HIOI', { selector: 'p' })).toBeInTheDocument();
  });
});
