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
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PortfolioModeProvider } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioDataProvider } from '@/components/portfolio-data/PortfolioDataProvider';
import PortfolioPage from '../page';

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

describe('WA-0002: Portfolio default tab', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Anything still calling fetch directly (e.g. the decision-reviews
    // route) rejects quickly and non-blockingly rather than hanging.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  });

  afterEach(() => {
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
});

describe('WA-0003: explicit tab query-param deep links', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
