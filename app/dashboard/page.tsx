// app/dashboard/page.tsx
//
// TC-0001: Trade Command Center -- a single morning landing experience that
// composes existing intelligence into one decision-oriented dashboard. See
// docs/design/TC-0001-Trade-Command-Center.md for the full spec.
//
// This route is a thin consumer: it never computes a recommendation, score,
// or ranking itself. It builds one CommandCenterViewModel (lib/command-center)
// from already-computed domain outputs and renders it.
//
// TC-0001 corrective round: this page now consumes the shared
// PortfolioDataProvider (mounted in app/providers.tsx) -- the same live
// TastyTrade acquisition + composition pipeline app/portfolio/page.tsx uses,
// not a second, independently-fetched copy. Daily Briefing, Today's
// Priorities, and Portfolio Health now render real, live data. See
// components/portfolio-data/PortfolioDataProvider.tsx and
// docs/reviews/TC-0001-Implementation-Report.md's Corrective Round Addendum
// for the full account, including why this required relocating (not
// duplicating) app/portfolio/page.tsx's acquisition pipeline into
// lib/portfolio-data/.
//
// CES-0001 (OE-0002B): the Best Opportunity card's feed now comes from
// lib/recommendations/RecommendationService -- the canonical acquisition
// boundary for "what is the current, real, evaluated candidate set." This
// page has no knowledge of where that data originates (today, only the
// Screener publishes to it), no knowledge of IndexedDB, and no knowledge of
// audit/decision-log persistence. It still performs zero evaluation or
// ranking itself: it reads DecisionAnalysis[] from the service and passes
// it through the exact same, unmodified buildOpportunityRecommendations()
// (OE-0001's adapter + ranker) TC-0001 always called here. If nothing has
// been published yet in this browser session, the service returns an
// honest empty set and the card renders its own empty state -- never a
// fabricated one. See docs/design/OE-0002B-Recommendation-Service-Foundation.md.
//
// PT-0002B: this page now reads the global PortfolioMode
// (lib/portfolio-mode) and renders the LIVE composition below only when
// mode is resolved and confirmed LIVE. See
// docs/design/PT-0002B-Portfolio-Context-Integration.md §3.2. PAPER
// rendering is deliberately NOT built here (§2.2 item 5 of that doc) --
// selecting PAPER shows a placeholder pointing at /paper-trading instead of
// forcing PT-0001's ledger shape through this LIVE-only composition.

'use client';

import { useEffect, useMemo } from 'react';
import { THEMES, getSavedTheme } from '@/lib/theme';
import { useTaskManager } from '@/hooks/useTaskManager';
import { usePortfolioData } from '@/components/portfolio-data/PortfolioDataProvider';
import { usePortfolioMode } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioModeGateNotice } from '@/components/portfolio-mode/PortfolioModeGateNotice';
import { buildCommandCenterViewModel } from '@/lib/command-center';
import { buildOpportunityRecommendations } from '@/lib/command-center/buildOpportunityRecommendations';
import { CommandCenter } from '@/components/command-center/CommandCenter';
import { useCurrentRecommendations } from '@/lib/recommendations/RecommendationService';

export default function DashboardPage() {
  const th = THEMES[getSavedTheme()];
  const { tasks } = useTaskManager();
  const { composition, lastRefresh, refresh, refreshBalances, refreshDecisionReviews } = usePortfolioData();
  const portfolioMode = usePortfolioMode();

  // Refresh on every visit to this page, same "fresh on every visit"
  // behavior app/portfolio/page.tsx has always had -- this page does not
  // pass the snapshot-capture callbacks (onRawPositionsLoaded/
  // onSnapshotHistoryAttached), since snapshot-history bookkeeping remains
  // app/portfolio/page.tsx's own responsibility, not this page's, avoiding a
  // duplicate write if both pages are open in the same session.
  useEffect(() => {
    refresh();
    refreshBalances();
    refreshDecisionReviews();
  }, []);

  // Acquisition happens entirely inside the Recommendation Service -- this
  // page only asks for "the current set" and ranks it for display via the
  // existing, unmodified Opportunity Engine wrapper. See module doc above.
  const currentRecommendations = useCurrentRecommendations();
  const { recommendations: opportunityRecommendations } = useMemo(
    () =>
      buildOpportunityRecommendations(currentRecommendations.analyses, {
        availableCapital: 0,
        generatedAt: currentRecommendations.generatedAt ?? new Date().toISOString(),
      }),
    [currentRecommendations],
  );

  const viewModel = useMemo(
    () =>
      buildCommandCenterViewModel({
        composition,
        opportunityRecommendations,
        tasks,
        lastRefreshedAt: lastRefresh ? lastRefresh.toISOString() : null,
      }),
    [composition, opportunityRecommendations, tasks, lastRefresh],
  );

  if (!(portfolioMode.status === 'ready' && portfolioMode.mode === 'LIVE')) {
    return <PortfolioModeGateNotice portfolioMode={portfolioMode} th={th} screenName="Dashboard" />;
  }

  return <CommandCenter viewModel={viewModel} th={th} />;
}
