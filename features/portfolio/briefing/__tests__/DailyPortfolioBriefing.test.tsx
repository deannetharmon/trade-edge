// features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx
//
// WA-0004: component-level coverage for Briefing's new canonical
// composition -- section order/content, canonical health (not the retired
// bespoke derivation), the legacy Priority List's removal, contextual
// risks, the honest empty-briefing state, and the tracking-unavailable
// state (today's real, only-possible state -- TRADER_COMMITMENT_TRACKING_ACTIVE
// is false). Two companion files cover the hypothetical tracking-active
// states via a module mock: DailyPortfolioBriefing.trackingActive.test.tsx
// (genuine zero changes) and DailyPortfolioBriefing.trackingActiveChanges.test.tsx
// (changes present -- conductReview() itself mocked to return a populated
// sinceLastReview.changes array).

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { DailyPortfolioBriefing } from '../DailyPortfolioBriefing';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { DailyBriefing } from '@/lib/dailyBriefing';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Review AMD before earnings later this week.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD' },
    rationale: 'rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeDailyBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    generatedAt: '2026-07-25T00:00:00.000Z',
    executiveSummary: 'Portfolio is Healthy. No positions require immediate attention today. No earnings events occur before the next management window.',
    priorities: [],
    snapshot: {
      healthScore: 82,
      healthStatus: 'Healthy',
      openPositionCount: 3,
      capitalDeploymentPct: 45,
      largestConcentrationPct: 22.5,
      averagePositionHealth: 74,
    },
    upcomingEvents: [],
    opportunities: [
      { kind: 'roll', label: 'Roll Opportunities', count: 0 },
      { kind: 'covered_call', label: 'Covered Call Opportunities', count: 0 },
      { kind: 'csp', label: 'CSP Opportunities', count: 0 },
      { kind: 'screener', label: 'Screener Candidates Available', count: 0 },
    ],
    risks: [],
    ...overrides,
  };
}

const EMPTY_DASHBOARD: TodaysPrioritiesDashboard = {
  immediateAction: [],
  reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
  monitor: [],
  opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
} as any;

function makePortfolioReview(overrides: Partial<PortfolioReviewSnapshot> = {}): PortfolioReviewSnapshot {
  return {
    generatedAt: '2026-07-25T00:00:00.000Z',
    currentState: {
      health: { score: 82, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
      topRisks: [],
      concentrationConcerns: [],
      capitalConcerns: [],
      incomeConcern: null,
    },
    composition: {
      positionCount: 3,
      byStrategy: { BPS: 3 },
      symbolConcentrationPct: {},
      maxSymbolConcentrationPct: null,
      wheelManagedFraction: null,
    },
    ...overrides,
  } as any;
}

describe('WA-0004: DailyPortfolioBriefing -- section order and canonical sources', () => {
  it('renders every section in the required order', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );

    const container = screen.getByLabelText('Daily Portfolio Briefing');
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
    expect(sectionLabels).toEqual([
      'Portfolio Health',
      'Executive Summary',
      'Portfolio Snapshot',
      'Since Your Last Review',
      'Upcoming Events',
      'Contextual Risks',
      'Suggested Focus',
    ]);
  });

  it('renders the canonical health status/score from buildDailyBriefing()\'s snapshot, not a bespoke derivation', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective({ priority: 'critical', actionability: 'CRITICAL' })]}
        dailyBriefing={makeDailyBriefing({ snapshot: { ...makeDailyBriefing().snapshot, healthStatus: 'Action Required', healthScore: 40 } })}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    // Canonical status strings ('Healthy' | 'Needs Attention' | 'Action
    // Required'), never the retired bespoke 3-bucket labels ('Healthy' |
    // 'Needs Attention' | 'Action Required' happen to overlap in English for
    // two of three, but the *source* is what this test guards -- see the
    // "does not import the bespoke sources" test below for the real guard).
    const healthSection = within(screen.getByLabelText('Portfolio Health'));
    expect(healthSection.getByText('Action Required')).toBeInTheDocument();
    expect(healthSection.getByText('Score 40')).toBeInTheDocument();
  });

  it('renders Executive Summary, Portfolio Snapshot, and Upcoming Events fields verbatim from buildDailyBriefing()', () => {
    const briefing = makeDailyBriefing({
      executiveSummary: 'Portfolio is Needs Attention. 2 positions require attention today.',
      upcomingEvents: [{ id: 'e1', kind: 'earnings', label: 'Earnings Risk: AMD', symbol: 'AMD', detail: 'Earnings before expiration.' }],
    });
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={briefing}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    expect(screen.getByText(briefing.executiveSummary)).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument(); // health score stat
    expect(screen.getByText('45%')).toBeInTheDocument(); // capital deployment
    expect(screen.getByText('22.5%')).toBeInTheDocument(); // largest concentration
    expect(screen.getByText('Earnings Risk: AMD')).toBeInTheDocument();
  });

  it('renders Suggested Focus from the top objective, unchanged', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const focusSection = within(screen.getByLabelText('Suggested Focus'));
    expect(focusSection.getByText('AMD: Review AMD before earnings later this week.')).toBeInTheDocument();
  });
});

describe('WA-0004: DailyPortfolioBriefing -- contextual risks', () => {
  it('renders a risk as context, with no completion control, even when it is already queue-eligible', () => {
    const briefing = makeDailyBriefing({
      risks: [{ id: 'immediate_obj_1', kind: 'immediate_attention', label: 'Manage AAPL', detail: 'Assignment risk crossed threshold.' }],
    });
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={briefing}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const risksSection = screen.getByLabelText('Contextual Risks');
    expect(within(risksSection).getByText('Manage AAPL')).toBeInTheDocument();
    expect(within(risksSection).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the honest empty state when there are no risks', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    expect(screen.getByText('No active risks right now.')).toBeInTheDocument();
  });
});

describe('WA-0004: DailyPortfolioBriefing -- Since Your Last Review, tracking-unavailable state (today\'s real state)', () => {
  it('renders the honest unavailable copy, never "Nothing changed since your last review." and never a numeric count', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const section = screen.getByLabelText('Since Your Last Review');
    expect(within(section).getByText('Change tracking is not yet active.')).toBeInTheDocument();
    expect(within(section).queryByText('Nothing changed since your last review.')).not.toBeInTheDocument();
    expect(within(section).queryByText(/^0 /)).not.toBeInTheDocument();
  });
});

describe('WA-0004: DailyPortfolioBriefing -- legacy Priority List removal', () => {
  it('renders no Mark Complete/Reopen control anywhere', () => {
    render(
      <DailyPortfolioBriefing
        objectives={[makeObjective()]}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Open Priorities')).not.toBeInTheDocument();
  });

  it('does not import TodaysPrioritiesWorkflow or the retired bespoke portfolioHealth/whatChanged sources', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile('features/portfolio/briefing/DailyPortfolioBriefing.tsx', 'utf-8');
    expect(text).not.toMatch(/import\s*\{[^}]*TodaysPrioritiesWorkflow/);
    expect(text).not.toContain("from '../components/TodaysPrioritiesWorkflow'");
    expect(text).not.toContain('derivePortfolioHealth');
    expect(text).not.toContain('computeWhatChanged');
    expect(text).not.toContain('markComplete');
    expect(text).not.toContain('partitionPriorities');
  });

  it('imports TRADER_COMMITMENT_TRACKING_ACTIVE from the same shared module Mission Control uses', async () => {
    const fs = await import('node:fs/promises');
    const briefingText = await fs.readFile('features/portfolio/briefing/DailyPortfolioBriefing.tsx', 'utf-8');
    const missionControlText = await fs.readFile('lib/mission-control/buildMissionControlViewModel.ts', 'utf-8');
    expect(briefingText).toContain("from '@/lib/review-conductor'");
    expect(briefingText).toMatch(/TRADER_COMMITMENT_TRACKING_ACTIVE/);
    expect(missionControlText).toContain("from '@/lib/review-conductor'");
    expect(missionControlText).toMatch(/TRADER_COMMITMENT_TRACKING_ACTIVE/);
  });
});

describe('WA-0004: DailyPortfolioBriefing -- loading state and honest empty-briefing state', () => {
  it('shows a loading placeholder when dailyBriefing is null and loading is true', () => {
    render(
      <DailyPortfolioBriefing
        objectives={null}
        dailyBriefing={null}
        portfolioReview={null}
        todaysPrioritiesDashboard={null}
        loading={true}
        th={THEMES.dark}
      />,
    );
    expect(screen.getByText(/Loading Today.s Briefing/)).toBeInTheDocument();
  });

  it('renders the honest empty-briefing state -- not a blank workspace -- when dailyBriefing is null and not loading, and preserves the Briefing landmark', () => {
    render(
      <DailyPortfolioBriefing
        objectives={null}
        dailyBriefing={null}
        portfolioReview={null}
        todaysPrioritiesDashboard={null}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const landmark = screen.getByLabelText('Daily Portfolio Briefing');
    expect(within(landmark).getByText('No briefing available right now.')).toBeInTheDocument();
    expect(within(landmark).getByText('There is no portfolio data or open positions to summarize.')).toBeInTheDocument();
  });

  it('the empty-briefing state never implies portfolio health is good, that nothing changed, or that no risks exist', () => {
    render(
      <DailyPortfolioBriefing
        objectives={null}
        dailyBriefing={null}
        portfolioReview={null}
        todaysPrioritiesDashboard={null}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const landmark = screen.getByLabelText('Daily Portfolio Briefing');
    expect(within(landmark).queryByText('Nothing changed since your last review.')).not.toBeInTheDocument();
    expect(within(landmark).queryByText('Healthy')).not.toBeInTheDocument();
    expect(within(landmark).queryByText(/no active risks/i)).not.toBeInTheDocument();
    expect(within(landmark).queryByRole('status')).not.toBeInTheDocument();
  });
});
