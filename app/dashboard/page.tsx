// app/dashboard/page.tsx
//
// MB-0002: Mission Control -- the approved Review experience (Concept B),
// replacing TC-0001's Trade Command Center as /dashboard's layout. See
// docs/design/MB-0002-Review-Concepts.md (Phase 1) and
// docs/design/MB-0002-Mission-Control-Implementation.md (Phase 2) for the
// full account.
//
// This route remains a thin consumer, same as TC-0001 before it: it never
// computes a recommendation, score, ranking, or revalidation itself. It
// builds one MissionControlViewModel (lib/mission-control) from
// already-computed domain outputs -- DashboardComposition
// (lib/portfolio-intelligence), the ranked OpportunityRecommendation[] feed
// (lib/recommendations + lib/opportunity-engine, unchanged from TC-0001/
// OE-0002B) -- and renders it. lib/mission-control internally calls
// lib/morning-briefing's buildAttentionFeed() and lib/review-conductor's
// conductReview() exactly as those modules already exist; this page has no
// knowledge of how a ReviewNarrative is assembled.
//
// Every acquisition/composition dependency below (PortfolioDataProvider,
// PortfolioMode gating, the Recommendation Service) is unchanged from
// TC-0001/PT-0002B/OE-0002B -- MB-0002 replaces the presentation layer only.
//
// MB-0002 explicit non-goal: Trader Commitment persistence. No commitment
// store is wired to this page, so lib/mission-control always passes an
// empty revalidationResults array into conductReview() -- "Since Your Last
// Review" will read as empty until a future sprint wires up real
// commitments. See docs/design/MB-0002-Mission-Control-Implementation.md,
// Known Limitations.
//
// Background Tasks: retained, unchanged, but deliberately placed outside
// and below the Review narrative itself. It answers a different question
// ("is a scan still running?") than Review does ("what deserves my
// attention?"), and folding it into the narrative would dilute "attention
// is the product." Removing it entirely was rejected -- no other page
// currently surfaces the global Task Manager's state, and doing so would be
// an undisclosed regression, not a Review-experience improvement.

'use client';

import { useEffect, useMemo } from 'react';
import { THEMES, getSavedTheme } from '@/lib/theme';
import { useTaskManager } from '@/hooks/useTaskManager';
import { usePortfolioData } from '@/components/portfolio-data/PortfolioDataProvider';
import { usePortfolioMode } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioModeGateNotice } from '@/components/portfolio-mode/PortfolioModeGateNotice';
import { buildOpportunityRecommendations } from '@/lib/command-center/buildOpportunityRecommendations';
import { buildMissionControlViewModel } from '@/lib/mission-control';
import { MissionControl } from '@/components/mission-control/MissionControl';
import { BackgroundTaskCard } from '@/components/command-center/BackgroundTaskCard';
import { useCurrentRecommendations } from '@/lib/recommendations';

export default function DashboardPage() {
  const th = THEMES[getSavedTheme()];
  const { tasks } = useTaskManager();
  const { composition, loading, error, lastRefresh, refresh, refreshBalances, refreshDecisionReviews } = usePortfolioData();
  const portfolioMode = usePortfolioMode();

  // Refresh on every visit to this page, same "fresh on every visit"
  // behavior app/portfolio/page.tsx has always had -- unchanged from
  // TC-0001.
  useEffect(() => {
    refresh();
    refreshBalances();
    refreshDecisionReviews();
  }, []);

  // Acquisition happens entirely inside the Recommendation Service -- this
  // page only asks for "the current set" and ranks it for display via the
  // existing, unmodified Opportunity Engine wrapper. Unchanged from
  // TC-0001/OE-0002B.
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
      buildMissionControlViewModel({
        composition,
        compositionLoading: loading,
        compositionError: error || undefined,
        opportunityRecommendations,
        lastRefreshedAt: lastRefresh ? lastRefresh.toISOString() : null,
      }),
    [composition, loading, error, opportunityRecommendations, lastRefresh],
  );

  const backgroundTasks = useMemo(
    () =>
      tasks.length > 0
        ? { state: 'loaded' as const, tasks }
        : { state: 'empty' as const, tasks: [], message: 'No background tasks are running.' },
    [tasks],
  );

  if (!(portfolioMode.status === 'ready' && portfolioMode.mode === 'LIVE')) {
    return <PortfolioModeGateNotice portfolioMode={portfolioMode} th={th} screenName="Dashboard" />;
  }

  return (
    <>
      <MissionControl viewModel={viewModel} th={th} />
      <div className="mx-auto max-w-3xl px-4 pb-6">
        <BackgroundTaskCard backgroundTasks={backgroundTasks} th={th} />
      </div>
    </>
  );
}
