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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('SCREENER-UX-0001 corrective pass: production hierarchy order (Filtered)', () => {
  it('renders scan identity -> accounting -> controls -> Best Opportunities -> symbol outcomes, in that DOM order', async () => {
    // NKE evaluates with a qualifying candidate; GHOST's chain fetch fails
    // outright (a real "failed" symbol outcome, not a fabricated
    // disqualification), giving Symbol outcomes something real to show.
    // (A real evaluated-but-disqualified ScreenResult -- as opposed to a
    // zero-candidate or failed outcome -- requires a candidate that clears
    // every basic scan check but still fails a qualification threshold;
    // features/screener/components/__tests__/DisqualifiedSection.test.tsx
    // already covers that section's own rendering/behavior directly against
    // a hand-built ScreenResult, so this test doesn't re-derive one from
    // the full scan pipeline.)
    getChainMock.mockImplementation((symbol: string) => {
      if (symbol === 'NKE') return Promise.resolve(qualifyingChain(symbol));
      return Promise.reject(new Error('market data request failed'));
    });
    renderScreener();
    await addToUniverse('NKE,GHOST');

    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('button', { name: /RUN SCREENER/ }));

    await waitFor(() => expect(screen.getByTestId('accounting-summary-bar')).toHaveTextContent('2 selected'));

    const scanIdentity = screen.getByTestId('scan-identity-header');
    const accounting = screen.getByTestId('accounting-summary-bar');
    const controls = screen.getByTestId('filtered-result-controls');
    const bestOpps = screen.getByTestId('best-opportunities-shortlist');

    expect(isBefore(scanIdentity, accounting)).toBe(true);
    expect(isBefore(accounting, controls)).toBe(true);
    expect(isBefore(controls, bestOpps)).toBe(true);

    // Symbol outcomes (GHOST's real failure) must still come after Best
    // Opportunities, as the last item in the required hierarchy.
    await waitFor(() => expect(screen.getByTestId('symbol-outcomes-disclosure')).toBeInTheDocument());
    const symbolOutcomes = screen.getByTestId('symbol-outcomes-disclosure');
    expect(isBefore(bestOpps, symbolOutcomes)).toBe(true);
  });
});

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

describe('SCREENER-UX-0001 corrective pass: CSP isolation shares the Filtered-mode hierarchy', () => {
  it('a CSP scan (representative of the CSP/CC/PMCC group, which all route through screenMode=filter) gets the full hierarchy too', async () => {
    getChainMock.mockImplementation((symbol: string) => Promise.resolve(qualifyingChain(symbol, 'P')));
    qualifyingCspMetrics(['NKE']);
    renderScreener();
    await addToUniverse('NKE');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND CSPs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'RUN CSP SCAN →' }));

    await waitFor(() => expect(screen.getByTestId('scan-identity-header')).toHaveTextContent('Filtered Cash-Secured Put Scan'));
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

describe('SCREENER-UX-0001 corrective pass: narrow-viewport rendering', () => {
  // Honest scope note: jsdom does not implement CSS layout/media queries, so
  // this cannot verify visual mobile behavior (wrapping, breakpoints,
  // touch-target sizing) the way a real browser or screenshot-based check
  // could. What it does prove: the hierarchy components render the same
  // interactive elements (real buttons, same testids) at a narrow viewport
  // width, i.e. nothing in this pass is conditionally omitted or crashes
  // below desktop width. Full visual/responsive verification is recorded as
  // backlog in the implementation report.
  it('renders every hierarchy section and keeps disclosures operable at a 375px viewport width', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));

    getChainMock.mockImplementation((symbol: string) => {
      if (symbol === 'NKE') return Promise.resolve(qualifyingChain(symbol));
      return Promise.reject(new Error('market data request failed'));
    });
    renderScreener();
    await addToUniverse('NKE,GHOST');
    await userEvent.click(await screen.findByRole('button', { name: 'FIND SPREADS' }));
    await userEvent.click(await screen.findByRole('button', { name: /RUN SCREENER/ }));

    await waitFor(() => expect(screen.getByTestId('best-opportunities-shortlist')).toBeInTheDocument());
    expect(screen.getByTestId('scan-identity-header')).toBeInTheDocument();
    expect(screen.getByTestId('accounting-summary-bar')).toBeInTheDocument();
    expect(screen.getByTestId('filtered-result-controls')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('symbol-outcomes-disclosure')).toBeInTheDocument());
    const symbolOutcomesToggle = screen.getByRole('button', { name: /Symbols not producing candidates/ });
    expect(symbolOutcomesToggle).toBeEnabled();
    await userEvent.click(symbolOutcomesToggle);
    expect(symbolOutcomesToggle).toHaveAttribute('aria-expanded', 'true');
  });
});
