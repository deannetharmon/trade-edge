// app/portfolio/__tests__/PortfolioPage.test.tsx
//
// WA-0002: focused coverage for the default-tab safety requirement --
// Positions renders by default (not the retired 'mission-control' tab, and
// not any blank/invalid state) now that 'mission-control' has been removed
// from activeTab's type union and the useState default changed to
// 'positions'. See docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md
// Section 9 for the navigation/persisted-state analysis this test verifies.
//
// Network calls (loadPositions/loadAccountBalances/decision-reviews fetch)
// are stubbed to reject immediately -- this test is about which tab renders
// by default, not live data acquisition.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PortfolioModeProvider } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioDataProvider } from '@/components/portfolio-data/PortfolioDataProvider';
import PortfolioPage from '../page';
import { resolvePositionsWorkspaceState } from '@/components/portfolio-data/EquityHoldingsSection';
import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import type { Position } from '@/lib/portfolio-data/types';

const portfolioContextOverride = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/components/portfolio-data/PortfolioDataProvider', async () => {
  const actual = await vi.importActual<typeof import('@/components/portfolio-data/PortfolioDataProvider')>('@/components/portfolio-data/PortfolioDataProvider');
  return {
    ...actual,
    usePortfolioData: () => {
      const value = actual.usePortfolioData();
      return portfolioContextOverride.current ? { ...value, ...portfolioContextOverride.current } : value;
    },
  };
});

// Stub the live acquisition pipeline's two entry points so the page settles
// into a clean, deterministic "loaded, zero positions" state instead of an
// error banner -- this test is about which tab renders by default, not live
// data acquisition (unaffected by WA-0002; not under test here).
vi.mock('@/lib/portfolio-data/acquisition', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio-data/acquisition')>('@/lib/portfolio-data/acquisition');
  return {
    ...actual,
    loadPositions: vi.fn().mockResolvedValue({ positions: [], pendingOrders: [] }),
    loadAccountBalances: vi.fn().mockResolvedValue(null),
    fetchSnapshotStore: vi.fn().mockResolvedValue({}),
  };
});

// FIX: LCC_0001A_SNAPSHOT_ENABLED defaults to true now (deliberately --
// "an unset variable must never silently hide stock holdings", per
// lib/portfolio-snapshot/acquire.ts's own comment), so PortfolioDataProvider's
// real refresh() always calls the real acquirePortfolioSnapshot() on mount,
// independent of the loadPositions/loadAccountBalances mocks above -- this
// file never mocked it, so it genuinely tried to resolve a real TastyTrade
// account against this test's rejected-fetch stub and failed with "account
// identity could not be resolved", setting a real error that (correctly)
// suppresses the "NO OPEN POSITIONS FOUND" empty-state message.
// Hoisted, per-test-overridable harness -- defaults to a clean, ok, empty
// snapshot (what most tests here need); the one test genuinely testing an
// unavailable-acquisition scenario overrides it to a snapshot with
// dataQuality.status: 'unavailable' before rendering.
const snapshotAcquisitionHarness = vi.hoisted(() => ({
  result: {
    pendingOrders: [] as unknown[],
    snapshot: {
      accountNumber: 'ACC1', asOf: '2026-08-22T18:00:00.000Z', quoteAsOf: null,
      equities: [] as unknown[], options: [] as unknown[], workingOrders: [] as unknown[],
      coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false },
      dataQuality: { status: 'ok' as 'ok' | 'unavailable', staleQuotes: true, warnings: [] as string[] }, freshness: 'current' as const,
      lastSuccessfulAsOf: '2026-08-22T18:00:00.000Z' as string | null,
    },
  },
}));
vi.mock('@/lib/portfolio-snapshot/acquire', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio-snapshot/acquire')>('@/lib/portfolio-snapshot/acquire');
  return {
    ...actual,
    acquirePortfolioSnapshot: vi.fn(() => Promise.resolve(snapshotAcquisitionHarness.result)),
  };
});

const emptySnapshot = (status: 'ok' | 'unavailable' = 'ok'): PortfolioSnapshot => ({
  accountNumber: 'ACC1', asOf: '2026-08-22T18:00:00.000Z', quoteAsOf: null,
  equities: [], options: [], workingOrders: [],
  coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: status === 'ok', warnings: [], hasAdjustedOrUnknownDeliverable: false },
  dataQuality: { status, staleQuotes: true, warnings: [] }, freshness: 'current',
  lastSuccessfulAsOf: status === 'ok' ? '2026-08-22T18:00:00.000Z' : null,
});

const optionPosition = {
  key: 'AAPL::2026-09-18::200P', symbol: 'AAPL', expDate: '2026-09-18', dte: 27,
  strategy: 'Short Put', legs: [{ symbol: 'AAPL  260918P00200000', optionType: 'P', strikePrice: 200, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1 }],
  quantity: 1, identity: null, structureAmbiguous: true, structureBlockMessage: 'Test fixture — actions blocked',
  entryPriceEffect: 'Credit', entryCredit: 200, entryEconomicsComplete: true, creditReceived: 200,
  currentValue: 100, closeValue: 100, closeNowPnl: 100, pnl: 100, pnlPct: 50, pnlReliable: true,
  intent: 'income', plOpen: 100, targetPrice: 1, profitTarget: 0.5, maxRisk: 19800,
  hitTarget: true, needsClose: false, entryDte: 30, entryDate: '2026-08-19', accountNumber: 'ACC1',
  ivr: 30, iv: 25, hv30: 20, beta: 1, netDelta: 20, netVega: -5, pop: 70,
  hasGtc: false, gtcOrderId: null, gtcOrderPrice: null, stopLossStatus: 'none', stopLossPrice: null,
  stopLossPolicy: null, stopLossDisplayPolicy: null, stopLossClassification: null, stopLossBreach: null,
  recommendation: null, objective: null, healthScore: null,
} as unknown as Position;

const populatedSnapshot: PortfolioSnapshot = {
  ...emptySnapshot('ok'),
  equities: [{
    accountNumber: 'ACC1', symbol: 'MSFT', direction: 'Long', quantity: 250,
    settledQuantity: null, basis: null, basisComplete: false, currentPrice: 310,
    marketValue: 77500, unrealizedPnl: 2500, quoteAsOf: null, staleQuote: true,
    deliverable: 'standard', dataQualityWarnings: [],
  }],
  options: [optionPosition],
};

describe('LCC-0001A PR3: Portfolio equity composition gate', () => {
  it('preserves the legacy empty state when display is off', () => {
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: false, loading: false, snapshot: null, optionCount: 0, pendingOrderCount: 0 })).toBe('legacy-empty');
  });

  it('renders an unavailable workspace, never a definitive empty claim, when display is on and snapshot is null', () => {
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: false, snapshot: null, optionCount: 0, pendingOrderCount: 0 })).toBe('workspace');
  });

  it('uses only the loading state during initial acquisition', () => {
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: true, snapshot: null, optionCount: 0, pendingOrderCount: 0 })).toBe('loading');
  });

  it('keeps a prior snapshot and option cards visible during refresh', () => {
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: true, snapshot: emptySnapshot('unavailable'), optionCount: 1, pendingOrderCount: 0 })).toBe('workspace');
  });

  it('renders one definitive empty state only when a successful snapshot proves the whole portfolio empty', () => {
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: false, snapshot: emptySnapshot('ok'), optionCount: 0, pendingOrderCount: 0 })).toBe('empty');
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: false, snapshot: emptySnapshot('unavailable'), optionCount: 0, pendingOrderCount: 0 })).toBe('workspace');
  });

  it('keeps equity and option surfaces coexisting in the same workspace', () => {
    const withEquity = { ...emptySnapshot('ok'), equities: [{ accountNumber: 'ACC1', symbol: 'MSFT', direction: 'Long' as const, quantity: 250, settledQuantity: null, basis: 300, basisComplete: true, currentPrice: 310, marketValue: 77500, unrealizedPnl: 2500, quoteAsOf: null, staleQuote: true, deliverable: 'standard' as const, dataQualityWarnings: [] }] };
    expect(resolvePositionsWorkspaceState({ equityDisplayEnabled: true, loading: false, snapshot: withEquity, optionCount: 1, pendingOrderCount: 0 })).toBe('workspace');
  });
});

describe('WA-0002: Portfolio default tab', () => {
  beforeEach(() => {
    portfolioContextOverride.current = null;
    window.localStorage.clear();
    // Reset per test -- see the acquirePortfolioSnapshot mock above.
    snapshotAcquisitionHarness.result.snapshot.dataQuality = { status: 'ok', staleQuotes: true, warnings: [] };
    snapshotAcquisitionHarness.result.snapshot.equities = [];
    // Anything still calling fetch directly (e.g. the decision-reviews
    // route) rejects quickly and non-blockingly rather than hanging.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  });

  afterEach(() => {
    portfolioContextOverride.current = null;
    vi.unstubAllGlobals();
  });

  it('renders the Positions experience by default, with no blank or invalid tab state', async () => {
    render(
      <PortfolioModeProvider>
        <PortfolioDataProvider>
          <PortfolioPage />
        </PortfolioDataProvider>
      </PortfolioModeProvider>,
    );

    // PortfolioModeProvider starts 'resolving' (fail-closed gate active);
    // first-use resolves to LIVE/'ready' asynchronously. Wait for the real
    // sub-tab bar to appear before asserting on tab content.
    await waitFor(() => expect(screen.getByText('Positions')).toBeInTheDocument());

    // The retired legacy Mission Control tab must not exist anywhere.
    expect(screen.queryByText('Mission Control')).not.toBeInTheDocument();

    // Positions-tab-only content renders without clicking any tab -- proof
    // the default activeTab is 'positions', not blank/invalid. With zero
    // positions/pending orders and no canonical priorities, portfolioReview/
    // dailyBriefing compose to null (a valid, documented empty state), so
    // the page's own "no positions" empty state is what should appear.
    await waitFor(() => expect(screen.getByText('NO OPEN POSITIONS FOUND')).toBeInTheDocument());

    // Neither the 'today', 'briefing', 'priorities', 'history', nor
    // 'balances' tab content is present -- only one tab's content renders.
    expect(screen.queryByText('Immediate Action')).not.toBeInTheDocument();
  });

  it('renders equity unavailable without claiming the portfolio is empty when acquisition fails', async () => {
    process.env.NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED = 'true';
    // FIX: acquirePortfolioSnapshot's own unavailableSnapshot() helper
    // always returns a real, non-null PortfolioSnapshot object (just with
    // dataQuality.status: 'unavailable') -- snapshot state is never
    // actually null once a resolution attempt completes, success or
    // failure. This means EquityHoldingsSection's `!snapshot` branch
    // ("unified portfolio snapshot... enabled and refreshed") is
    // unreachable via this path; the real, reachable "unavailable"
    // messaging is the status-role banner shown once snapshot IS present
    // but dataQuality.status is 'unavailable' (confirmed directly from
    // EquityHoldingsSection.tsx). Reproducing that real scenario here
    // instead of the unreachable null-snapshot one this test assumed.
    snapshotAcquisitionHarness.result.snapshot.dataQuality = { status: 'unavailable', staleQuotes: false, warnings: [] };
    try {
      render(
        <PortfolioModeProvider>
          <PortfolioDataProvider>
            <PortfolioPage />
          </PortfolioDataProvider>
        </PortfolioModeProvider>,
      );
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Coverage-dependent data is unavailable'));
      expect(screen.queryByText('NO OPEN POSITIONS FOUND')).not.toBeInTheDocument();
    } finally {
      delete process.env.NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED;
    }
  });

  it('renders a populated equity row and existing option card together through PortfolioPage', async () => {
    process.env.NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED = 'true';
    portfolioContextOverride.current = {
      positions: [optionPosition], pendingOrders: [], snapshot: populatedSnapshot,
      snapshotDataQuality: populatedSnapshot.dataQuality, loading: false, error: '',
    };
    try {
      render(
        <PortfolioModeProvider>
          <PortfolioDataProvider>
            <PortfolioPage />
          </PortfolioDataProvider>
        </PortfolioModeProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('equity-holding-MSFT-Long')).toBeInTheDocument());
      const equity = screen.getByTestId('equity-holding-MSFT-Long');
      expect(equity).toHaveTextContent('250 shares');
      expect(equity).toHaveTextContent('Basis incomplete');
      expect(equity).toHaveTextContent('Basis unavailable');
      expect(equity).toHaveTextContent('Reference price');
      expect(equity).not.toHaveTextContent('Current price');
      expect(equity).toHaveTextContent('Market valueUnavailable');
      expect(equity).toHaveTextContent('Unrealized P/LUnavailable');
      expect(screen.getByText('AAPL')).toBeInTheDocument();
      // Badge now reflects the accurate resolvePositionStrategyDisplayLabel(pos) classification
      // (a single short put with no hedge is a CSP) rather than the fixture's literal
      // pos.strategy string ('Short Put'), per the Positions Strategy Filter card-label fix.
      // getAllByText, not getByText -- 'CSP' now also appears as a filter chip label above the
      // position list, so the exact string is no longer unique to the card badge.
      expect(screen.getAllByText('CSP').length).toBeGreaterThan(0);
      expect(screen.queryByText('NO OPEN POSITIONS FOUND')).not.toBeInTheDocument();
    } finally {
      portfolioContextOverride.current = null;
      delete process.env.NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED;
    }
  });
});

describe('WA-0003: explicit tab query-param deep links', () => {
  beforeEach(() => {
    window.localStorage.clear();
    snapshotAcquisitionHarness.result.snapshot.dataQuality = { status: 'ok', staleQuotes: true, warnings: [] };
    snapshotAcquisitionHarness.result.snapshot.equities = [];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/portfolio');
  });

  it('opens the Today\'s Priorities tab directly when ?tab=todays-priorities is present, without requiring a click', async () => {
    window.history.pushState({}, '', '/portfolio?tab=todays-priorities');
    render(
      <PortfolioModeProvider>
        <PortfolioDataProvider>
          <PortfolioPage />
        </PortfolioDataProvider>
      </PortfolioModeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Positions')).toBeInTheDocument());
    // Today's Priorities' own "Open Priorities" section only renders when
    // that tab is active.
    await waitFor(() => expect(screen.getByLabelText('Open Priorities')).toBeInTheDocument());
    expect(screen.queryByText('NO OPEN POSITIONS FOUND')).not.toBeInTheDocument();
  });

  it('still defaults to Positions when ?tab is present but not one of the three deep-linkable values', async () => {
    window.history.pushState({}, '', '/portfolio?tab=not-a-real-tab');
    render(
      <PortfolioModeProvider>
        <PortfolioDataProvider>
          <PortfolioPage />
        </PortfolioDataProvider>
      </PortfolioModeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Positions')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('NO OPEN POSITIONS FOUND')).toBeInTheDocument());
  });

  // WA-0004: 'briefing' is now a recognized deep-link value (previously only
  // reachable by clicking the tab -- CES section 13). With a zero-position
  // fixture, dailyBriefing composes to null (portfolioReview is null exactly
  // when there are zero positions, zero pending orders, and no canonical
  // priorities -- lib/portfolio-intelligence/dashboardComposition.ts), so
  // DailyPortfolioBriefing renders its explicit, honest empty-briefing state
  // (never a blank workspace -- WA-0004 corrective round). Both the Briefing
  // landmark and its empty-state copy must render, and Positions'/Today's
  // Priorities' own content must not, proving activeTab actually switched
  // away from the 'positions' default.
  it('opens the Briefing tab directly when ?tab=briefing is present, without falling back to Positions', async () => {
    window.history.pushState({}, '', '/portfolio?tab=briefing');
    render(
      <PortfolioModeProvider>
        <PortfolioDataProvider>
          <PortfolioPage />
        </PortfolioDataProvider>
      </PortfolioModeProvider>,
    );

    await waitFor(() => expect(screen.getByText('Positions')).toBeInTheDocument());
    // Positions' own "no positions" empty state must not render while
    // 'briefing' is the active tab -- proof the allow-list actually routed
    // to Briefing rather than silently falling through to 'positions'.
    await waitFor(() => expect(screen.queryByText('NO OPEN POSITIONS FOUND')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Open Priorities')).not.toBeInTheDocument();

    // The Briefing landmark renders, and it renders its own explicit,
    // honest empty-state message -- not a blank pane. Never presents this
    // as "portfolio is healthy" or "nothing changed."
    const briefingLandmark = await screen.findByLabelText('Daily Portfolio Briefing');
    expect(within(briefingLandmark).getByText('No briefing available right now.')).toBeInTheDocument();
    expect(within(briefingLandmark).getByText('There is no portfolio data or open positions to summarize.')).toBeInTheDocument();
    expect(within(briefingLandmark).queryByText('Nothing changed since your last review.')).not.toBeInTheDocument();
  });
});

describe('WA-0004: transitional DailyBriefingCard call site fully removed from Positions', () => {
  it('page.tsx no longer imports DailyBriefingCard (WA-0002\'s transitional call site is closed, not merely hidden)', async () => {
    const fs = await import('node:fs/promises');
    const pageText = await fs.readFile('app/portfolio/page.tsx', 'utf-8');
    expect(pageText).not.toMatch(/import\s*\{[^}]*DailyBriefingCard/);
    expect(pageText).not.toContain('variant="transitional"');
  });
});
