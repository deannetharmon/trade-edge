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
// Known, disclosed limitation (unchanged from TC-0001A/B): no real
// DecisionAnalysis[] feed exists anywhere in the app yet (see
// lib/command-center/buildOpportunityRecommendations.ts's doc), so the Best
// Opportunity card always renders its real, honest empty state today.

'use client';

import { useEffect, useMemo } from 'react';
import { THEMES, getSavedTheme } from '@/lib/theme';
import { useTaskManager } from '@/hooks/useTaskManager';
import { usePortfolioData } from '@/components/portfolio-data/PortfolioDataProvider';
import { buildCommandCenterViewModel } from '@/lib/command-center';
import { buildOpportunityRecommendations } from '@/lib/command-center/buildOpportunityRecommendations';
import { CommandCenter } from '@/components/command-center/CommandCenter';
import type { DecisionAnalysis } from '@/lib/decision-engine';

export default function DashboardPage() {
  const th = THEMES[getSavedTheme()];
  const { tasks } = useTaskManager();
  const { composition, lastRefresh, refresh, refreshBalances, refreshDecisionReviews } = usePortfolioData();

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

  // No real DecisionAnalysis[] acquisition mechanism exists yet (see module
  // doc) -- an honest empty array, never a fabricated candidate.
  const analyses: DecisionAnalysis[] = [];
  const { recommendations: opportunityRecommendations } = useMemo(
    () => buildOpportunityRecommendations(analyses, { availableCapital: 0, generatedAt: new Date().toISOString() }),
    [],
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

  return <CommandCenter viewModel={viewModel} th={th} />;
}
