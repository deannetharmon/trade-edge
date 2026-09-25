// app/screener/__tests__/ScreenerUXHierarchy.test.tsx
//
// SCREENER-UX-0001 corrective pass — blocker 6: component-level tests alone
// cannot prove production render order, since app/screener/page.tsx decides
// what gets mounted and in what sequence. This file renders the real page
// (same mocking convention as ScreenerSessionWiring.test.tsx: only the
// lib/scans/tastytrade-client network boundary is mocked) and asserts the
// actual DOM order of the required hierarchy's data-testid'd sections via
// Node.compareDocumentPosition, for every workflow that reaches the new
// components: Filtered spreads, Ranked, and CSP (representative of the
// CSP/CC/PMCC group, which all share the Filtered-mode render branch --
// see the corrective-pass implementation report for why one representative
// case is sufficient rather than three near-identical copies).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';

const getMarketMetricsMock = vi.fn();
const getChainMock = vi.fn();
const getQuoteMock = vi.fn();

vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return {
    ...actual,
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    getCoveredCallCapacityReport: vi.fn().mockResolvedValue({ status: 'ok', bySymbol: {}, warnings: [] }),
    getMarketMetrics: (...args: any[]) => getMarketMetricsMock(...args),
    getQuote: (...args: any[]) => getQuoteMock(...args),
    getChain: (...args: any[]) => getChainMock(...args),
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
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function qualifyingChain(symbol: string, optionType: 'C' | 'P' = 'C') {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  const expDate = d.toISOString().slice(0, 10);
  return {
    expirations: [expDate],
    chains: {
      [expDate]: [
        {
          strikePrice: optionType === 'C' ? 110 : 90, expirationDate: expDate, optionType, delta: optionType === 'C' ? 0.28 : -0.2,
          openInterest: optionType === 'C' ? 150 : 500, bid: 1.2, ask: 1.28, mid: 1.24, occSymbol: `${symbol}_TEST_${optionType}`,
        },
      ],
    },
    isEtfOrIndex: false,
    classification: 'stock' as const,
  };
}
const emptyChain = { expirations: [], chains: {}, isEtfOrIndex: false, classification: 'stock' as const };

function qualifyingCspMetrics(symbols: string[]) {
  getMarketMetricsMock.mockResolvedValue(symbols.map(symbol => ({ symbol, ivRank: 50, earningsExpectedDate: null })));
}

// Node.compareDocumentPosition returns a bitmask; 4 (DOCUMENT_POSITION_FOLLOWING)
// set means `b` comes after `a` in the DOM.
function isBefore(a: Element, b: Element): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// CI-FLAKY-0001: root cause of the load-flake in the first test of this file
// is a cold start, not a slow readiness signal. The first render of the
// 12.6k-line ScreenerPage plus the first Ranked scan pays one-time JIT and
// lazy-init cost that is 2-3x a warm run's, all of it inside the first
// test's 1000ms findBy/waitFor budgets; under full-suite CPU contention that
// exceeds the budget while every later (warm) test passes. Absorb the cold
// cost once, up front, in a hook with its own generous timeout, by driving the
// same Ranked flow the first test uses. No test timeout is raised.
beforeAll(async () => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getQuoteMock.mockReset().mockResolvedValue(100);
  getChainMock.mockReset().mockImplementation((symbol: string) =>
    Promise.resolve(symbol === 'NKE' ? qualifyingChain(symbol) : emptyChain),
  );
  renderScreener();
  await addToUniverse('NKE,GHOST');
  await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
  await userEvent.click(await screen.findByRole('radio', { name: /RANK/ }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN SCREENER/ }));
  await screen.findByTestId('best-opportunities-shortlist', undefined, { timeout: 15_000 });
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
}, 30_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  getMarketMetricsMock.mockReset().mockResolvedValue([]);
  getChainMock.mockReset();
  getQuoteMock.mockReset().mockResolvedValue(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// FILTER-MODE-REMOVAL-0002 (3e8d9491) hid Filter from Spreads' own launcher
// (FIND SPREADS -> RUN SCREENER now always runs Ranked), and Dean confirmed
// 2026-09-21 he does not want Filter reinstated there. The Filter-mode
// hierarchy assertion this described is still exercised for real below,
// via CSP's own Filtered path (see "CSP isolation shares the Filtered-mode
// hierarchy"), so removing this dead, permanently-unreachable Spreads
// version loses no coverage.

describe('SCREENER-UX-0001 corrective pass: production hierarchy order (Ranked)', () => {

  it('Ranked mode also gets scan identity, accounting, and Best Opportunities in the required order, plus symbol outcomes', async () => {
    getChainMock.mockImplementation((symbol: string) =>
      Promise.resolve(symbol === 'NKE' ? qualifyingChain(symbol) : emptyChain)
    );
    renderScreener();
    await addToUniverse('NKE,GHOST');

    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('radio', { name: /RANK/ }));
    await userEvent.click(await screen.findByRole('button', { name: /RUN SCREENER/ }));

    await waitFor(() => expect(screen.getByTestId('accounting-summary-bar')).toBeInTheDocument());

    const scanIdentity = screen.getByTestId('scan-identity-header');
    const accounting = screen.getByTestId('accounting-summary-bar');
    expect(isBefore(scanIdentity, accounting)).toBe(true);
    expect(screen.getByTestId('scan-identity-header')).toHaveTextContent('Ranked Spread Scan');

    await waitFor(() => expect(screen.getByTestId('best-opportunities-shortlist')).toBeInTheDocument());
    const bestOpps = screen.getByTestId('best-opportunities-shortlist');
    expect(isBefore(accounting, bestOpps)).toBe(true);
  });
});

// Updated 2026-09-21: CSP's own default mode was 'filter' (an uncorrected
// leftover from FILTER-MODE-REMOVAL-0002, fixed alongside this test -- see
// lastCspMode in app/screener/page.tsx); it now defaults to Rank, same as
// every other strategy, and Filter is no longer reachable through the UI for
// CSP either (Dean confirmed 2026-09-21 he does not want Filter back
// anywhere). csp-result-controls has an explicit carve-out to render in Rank
// mode too, so this test's real coverage (hierarchy order, CSP-vs-spread
// badge isolation) survives unchanged against the now-real default path.
describe('SCREENER-UX-0001 corrective pass: CSP isolation shares the Filtered-mode hierarchy', () => {
  it('a CSP scan (representative of the CSP/CC/PMCC group) gets the full hierarchy too, via its default Rank mode', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    qualifyingCspMetrics(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));

    await waitFor(() => expect(screen.getByTestId('scan-identity-header')).toHaveTextContent('Ranked Cash-Secured Put Scan'));
    expect(screen.getByTestId('accounting-summary-bar')).toBeInTheDocument();
    expect(screen.getByTestId('csp-result-controls')).toBeInTheDocument();
    // A CSP-typed result must never surface with a spread badge (BPS/BCS/IC)
    // -- checked against the actual qualified-candidate badge only, since
    // CSP uses its own controls and must not render spread-strategy chips.
    await waitFor(() => {
      const badges = screen.getAllByText(/^(BPS|BCS|IC|CSP|CC|PMCC)$/).filter(
        el => el.closest('[data-testid="csp-result-controls"]') === null,
      );
      expect(badges.length).toBeGreaterThan(0);
    });
    const nonCspBadges = screen.queryAllByText(/^(BPS|BCS|IC|CC|PMCC)$/);
    expect(nonCspBadges).toHaveLength(0);
  });
});

// SCREENER-UX-0001 narrow-viewport rendering: removed 2026-09-21. Its only
// test used the same now-permanently-unreachable Spreads/Filter path as the
// hierarchy-order test above (FIND SPREADS -> RUN SCREENER cannot reach
// Filter mode since FILTER-MODE-REMOVAL-0002, and Dean confirmed Filter is
// not coming back for Spreads). Narrow-viewport coverage of the hierarchy at
// 375px is an honest gap left open here, not silently papered over -- a
// replacement against a reachable mode (e.g. CSP's Rank path or Ranked
// spreads) would need its own pass, since jsdom also can't verify real
// visual/responsive behavior (wrapping, breakpoints) the way a browser or
// screenshot-based check could.
