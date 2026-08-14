// components/mission-control/__tests__/NewOpportunitiesSection.test.tsx
//
// WA-0005 §9/§11/§21/§22: component-level coverage proving Mission
// Control's Ranked Opportunities section is a compact count/link only --
// never the full BestOpportunitiesPanel ranked-candidate list (WA-0001's
// binding Ownership Matrix ruling, previously violated by MB-0002's
// verbatim-panel embed). Covers AC-7, AC-8, AC-9.
//
// PO corrective round 3, Finding 1: extended for all 8 required compact
// states (Loading/refreshing, Current ranked results, All candidates
// REJECTED, Empty evaluated results, Stale results, Unavailable/evaluation
// failure, Capital limited, No current results), the heading rename ("New
// Opportunities" -> "Ranked Opportunities"), and the corrected
// capital-limited gating (must appear in every applicable completed state,
// not only when a non-REJECTED candidate exists).
//
// PO corrective round 4 (Defect 1): round 3's report claimed "Stale
// results" was structurally unreachable at this boundary. That claim is
// now corrected: `opportunityEvaluationStatus`/`opportunityEvaluationError`
// (routed from the real lib/recommendations/RecommendationService.ts
// evaluation-lifecycle signal, itself sourced from /screener's real
// opportunityState/opportunityError -- see NewOpportunitiesSection.tsx's
// own module doc) make this state genuinely reachable and tested for real
// below, not asserted unreachable.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { NewOpportunitiesSection } from '../NewOpportunitiesSection';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';

function makeRecommendation(overrides: Partial<OpportunityRecommendation> = {}): OpportunityRecommendation {
  return {
    candidateId: 'cand_1',
    source: 'screener',
    symbol: 'AAPL',
    strategy: 'BPS',
    rank: 1,
    disposition: 'WATCH',
    opportunityScoreTotal: 72,
    decisionConfidenceTotal: 80,
    primaryReason: 'Strong credit ratio and probability of profit.',
    supportingFactors: [],
    riskTradeoffs: [],
    portfolioConflicts: [],
    exposureDisclosures: [],
    rejectionReasons: [],
    missingInformationDisclosures: [],
    whatWouldImprove: [],
    decisionAnalysisId: 'decision_1',
    ruleIds: [],
    ...overrides,
  };
}

describe('NewOpportunitiesSection (WA-0005 compact summary)', () => {
  it('AC-7: renders only a compact count/link -- never the full recommendation list (no per-candidate rank/score/reason content)', () => {
    const items = [
      makeRecommendation({ candidateId: 'c1', symbol: 'AAPL', primaryReason: 'A unique reason only the full panel would show.' }),
    ];
    render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);

    expect(screen.queryByText('A unique reason only the full panel would show.')).not.toBeInTheDocument();
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('AC-8: the headline count equals non-REJECTED recommendations only (RECOMMENDED + ACCEPTABLE_ALTERNATIVE + WATCH), excluding REJECTED', () => {
    const items = [
      makeRecommendation({ candidateId: 'c1', disposition: 'RECOMMENDED' }),
      makeRecommendation({ candidateId: 'c2', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
      makeRecommendation({ candidateId: 'c3', disposition: 'WATCH' }),
      makeRecommendation({ candidateId: 'c4', disposition: 'REJECTED' }),
      makeRecommendation({ candidateId: 'c5', disposition: 'REJECTED' }),
    ];
    render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);

    expect(screen.getByText('3 ranked opportunities to review')).toBeInTheDocument();
  });

  it('Finding 1: the section heading is "Ranked Opportunities", not "New Opportunities"', () => {
    render(<NewOpportunitiesSection items={[makeRecommendation()]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);
    expect(screen.getByRole('heading', { name: 'Ranked Opportunities' })).toBeInTheDocument();
    expect(screen.queryByText('New Opportunities')).not.toBeInTheDocument();
  });

  it('Finding 1: no visible text anywhere in this component claims the results are "new" (standalone word, case-insensitive)', () => {
    const items = [
      makeRecommendation({ candidateId: 'c1', disposition: 'RECOMMENDED' }),
      makeRecommendation({ candidateId: 'c2', disposition: 'REJECTED' }),
    ];
    const { container } = render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);
    const allText = container.textContent ?? '';
    // Standalone "new" as a word boundary match -- excludes unrelated
    // substrings (there are none in this component's copy today, but this
    // guards future regressions precisely rather than banning the letters
    // "new" from appearing inside any other word).
    expect(allText).not.toMatch(/\bnew\b/i);
  });

  it('never labels the count "new" (no snapshot-comparison mechanism exists to prove newness)', () => {
    const items = [makeRecommendation({ disposition: 'WATCH' })];
    render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);

    const countText = screen.getByText(/ranked opportunit/);
    expect(countText.textContent).not.toMatch(/new/i);
  });

  describe('8 required compact states (Finding 1)', () => {
    it('state: Loading/refreshing -- reviewState="loading" renders a distinct, real-signal-driven compact message', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="loading" />);
      expect(screen.getByText(/Preparing your Review/)).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('state: Current ranked results -- reviewState="loaded", non-REJECTED items present', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText('1 ranked opportunity to review')).toBeInTheDocument();
    });

    it('state: All candidates REJECTED -- distinct, truthful copy, never the generic empty wording', () => {
      const items = [
        makeRecommendation({ candidateId: 'c1', disposition: 'REJECTED' }),
        makeRecommendation({ candidateId: 'c2', disposition: 'REJECTED' }),
      ];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText(/evaluated 2 candidates — every one was rejected/)).toBeInTheDocument();
      expect(screen.queryByText('0 ranked opportunities to review')).not.toBeInTheDocument();
      expect(screen.queryByText('The most recent scan produced no ranked opportunities.')).not.toBeInTheDocument();
    });

    it('state: Empty evaluated results -- a scan published and produced zero candidates', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText('The most recent scan produced no ranked opportunities.')).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('state: Stale results -- now genuinely reachable: a newer evaluation running (opportunityEvaluationStatus="loading") while a prior published set exists renders a distinct banner without hiding it', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      // The last successfully published set remains visible underneath --
      // never cleared just because a newer attempt is in flight.
      expect(screen.getByText('1 ranked opportunity to review')).toBeInTheDocument();
      expect(screen.getByText(/newer ranked-opportunities evaluation is running/)).toBeInTheDocument();
    });

    it('state: Stale results -- now genuinely reachable: the most recent evaluation attempt failing (opportunityEvaluationStatus="error") while a prior published set exists renders a distinct banner without blanking it out', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
          opportunityEvaluationError="Recommendation engine unavailable."
        />,
      );
      expect(screen.getByText('1 ranked opportunity to review')).toBeInTheDocument();
      expect(screen.getByText(/most recent ranked-opportunities evaluation attempt failed/)).toBeInTheDocument();
      expect(screen.getByText(/Recommendation engine unavailable\./)).toBeInTheDocument();
    });

    it('state: Unavailable/evaluation failure -- reviewState="error" renders distinct copy from "no current results"', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="error" />);
      expect(screen.getByText(/Ranked opportunities can't be confirmed right now/)).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities — run a scan/)).not.toBeInTheDocument();
    });

    it('state: Unavailable/evaluation failure -- reviewState="unavailable" renders the same distinct copy', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="unavailable" />);
      expect(screen.getByText(/Ranked opportunities can't be confirmed right now/)).toBeInTheDocument();
    });

    it('state: Capital limited -- renders for the Current-ranked-results state when no RECOMMENDED item is present', () => {
      const items = [
        makeRecommendation({ candidateId: 'c1', disposition: 'WATCH' }),
        makeRecommendation({ candidateId: 'c2', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
      ];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText(/Available capital is not connected/)).toBeInTheDocument();
    });

    it('state: No current results -- reviewState="loaded", generatedAt null', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText(/No current ranked opportunities/)).toBeInTheDocument();
    });
  });

  // PO corrective round 4 (Defect 1): dedicated coverage for the corrected
  // "Stale results" state -- proven genuinely reachable via the real
  // evaluation-lifecycle signal, not merely re-asserted unreachable.
  describe('Stale results (evaluation-lifecycle signal), corrected (Defect 1)', () => {
    it('does not render either evaluation-lifecycle banner when opportunityEvaluationStatus="idle" (the default, common case)', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.queryByText(/newer ranked-opportunities evaluation is running/)).not.toBeInTheDocument();
      expect(screen.queryByText(/most recent ranked-opportunities evaluation attempt failed/)).not.toBeInTheDocument();
    });

    it('PO corrective round 5 (Defect 2): renders the first-ever-loading message (not the generic "No current ranked opportunities" copy) when nothing has ever been published yet and opportunityEvaluationStatus="loading"', () => {
      render(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      expect(screen.getByText(/A ranked-opportunities evaluation is running/)).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('PO corrective round 5 (Defect 2): renders the first-ever-failure message (not the generic "No current ranked opportunities" copy) when nothing has ever been published yet and opportunityEvaluationStatus="error"', () => {
      render(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
          opportunityEvaluationError="boom"
        />,
      );
      expect(screen.getByText(/The ranked-opportunities evaluation failed: boom/)).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('does not render either evaluation-lifecycle banner during page-level Loading/Unavailable/Error reviewState, even if opportunityEvaluationStatus is set -- the page-level condition takes priority and describes a different concern', () => {
      const { rerender } = render(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="loading"
          opportunityEvaluationStatus="loading"
        />,
      );
      expect(screen.queryByText(/newer ranked-opportunities evaluation is running/)).not.toBeInTheDocument();

      rerender(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="error"
          opportunityEvaluationStatus="error"
          opportunityEvaluationError="boom"
        />,
      );
      expect(screen.queryByText(/most recent ranked-opportunities evaluation attempt failed/)).not.toBeInTheDocument();
    });

    it('renders the "refreshing" banner for the All-REJECTED state too (the last known-good REJECTED-only presentation stays fully visible underneath)', () => {
      const items = [makeRecommendation({ candidateId: 'c1', disposition: 'REJECTED' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      expect(screen.getByText(/evaluated 1 candidate — every one was rejected/)).toBeInTheDocument();
      expect(screen.getByText(/newer ranked-opportunities evaluation is running/)).toBeInTheDocument();
    });

    it('omits the ": <message>" suffix on the failed banner when no error message is given', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
        />,
      );
      const banner = screen.getByText(/most recent ranked-opportunities evaluation attempt failed/);
      expect(banner.textContent).not.toContain(':');
    });

    it('PO corrective round 5 (Defect 2): the refreshing (loading) banner uses role="status", but the failure banner uses role="alert" -- matching the established convention for genuine failures elsewhere in this sprint (e.g. BestOpportunitiesPanel\'s failure banner)', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      const { rerender } = render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      expect(screen.getByText(/newer ranked-opportunities evaluation is running/).closest('[role="status"]')).not.toBeNull();

      rerender(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
        />,
      );
      const failureBanner = screen.getByText(/most recent ranked-opportunities evaluation attempt failed/);
      expect(failureBanner.closest('[role="alert"]')).not.toBeNull();
      expect(failureBanner.closest('[role="status"]')).toBeNull();
    });
  });

  describe('Capital-limited annotation gating, corrected (Finding 1c)', () => {
    it('renders for the Empty-evaluated-results state (a completed evaluation with nothing to recommend)', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText(/Available capital is not connected/)).toBeInTheDocument();
    });

    it('renders for the All-REJECTED state (a completed evaluation with nothing to recommend)', () => {
      const items = [makeRecommendation({ candidateId: 'c1', disposition: 'REJECTED' })];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.getByText(/Available capital is not connected/)).toBeInTheDocument();
    });

    it('does not render when a RECOMMENDED candidate is present', () => {
      const items = [makeRecommendation({ candidateId: 'c1', disposition: 'RECOMMENDED' })];
      render(<NewOpportunitiesSection items={items} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} reviewState="loaded" />);
      expect(screen.queryByText(/Available capital is not connected/)).not.toBeInTheDocument();
    });

    it('does not render in the No-current-results state (nothing published yet -- a premature claim)', () => {
      render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="loaded" />);
      expect(screen.queryByText(/Available capital is not connected/)).not.toBeInTheDocument();
    });

    it('does not render during Loading or Unavailable/error states', () => {
      const { rerender } = render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="loading" />);
      expect(screen.queryByText(/Available capital is not connected/)).not.toBeInTheDocument();
      rerender(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} reviewState="error" />);
      expect(screen.queryByText(/Available capital is not connected/)).not.toBeInTheDocument();
    });
  });

  // PO corrective round 5 (WA-0005 Defect 2): the four required combinations
  // of "has anything ever been published?" x "is the most recent evaluation
  // attempt loading/failed?", named explicitly and tested independently so
  // none of them can silently regress into another.
  describe('Four required lifecycle x prior-results combinations (Defect 2)', () => {
    it('(a) first-ever loading -- no prior results, evaluation running: shows a genuine loading state, not the generic "run a scan" copy', () => {
      render(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      const banner = screen.getByText(/A ranked-opportunities evaluation is running/);
      expect(banner).toBeInTheDocument();
      expect(banner.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('(b) first-ever failure -- no prior results, evaluation failed: shows a genuine failure state with role="alert", not the generic "run a scan" copy', () => {
      render(
        <NewOpportunitiesSection
          items={[]}
          generatedAt={null}
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
          opportunityEvaluationError="Recommendation engine unavailable."
        />,
      );
      const banner = screen.getByText(/The ranked-opportunities evaluation failed/);
      expect(banner).toBeInTheDocument();
      expect(banner.closest('[role="alert"]')).not.toBeNull();
      expect(screen.getByText(/Recommendation engine unavailable\./)).toBeInTheDocument();
      expect(screen.queryByText(/No current ranked opportunities/)).not.toBeInTheDocument();
    });

    it('(c) refresh loading with prior results -- evaluation running, prior published results exist: prior results remain visible, annotated with a loading banner', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="loading"
        />,
      );
      expect(screen.getByText('1 ranked opportunity to review')).toBeInTheDocument();
      const banner = screen.getByText(/newer ranked-opportunities evaluation is running/);
      expect(banner.closest('[role="status"]')).not.toBeNull();
    });

    it('(d) refresh failure with prior results -- evaluation failed, prior published results exist: prior results remain visible, annotated with a role="alert" failure banner', () => {
      const items = [makeRecommendation({ disposition: 'WATCH' })];
      render(
        <NewOpportunitiesSection
          items={items}
          generatedAt="2026-07-25T09:00:00.000Z"
          th={THEMES.dark}
          reviewState="loaded"
          opportunityEvaluationStatus="error"
          opportunityEvaluationError="Recommendation engine unavailable."
        />,
      );
      expect(screen.getByText('1 ranked opportunity to review')).toBeInTheDocument();
      const banner = screen.getByText(/most recent ranked-opportunities evaluation attempt failed/);
      expect(banner.closest('[role="alert"]')).not.toBeNull();
      expect(screen.getByText(/Recommendation engine unavailable\./)).toBeInTheDocument();
    });
  });

  it('Finding 6: the review action link meets the 44x44 CSS-pixel minimum touch-target convention', () => {
    render(<NewOpportunitiesSection items={[makeRecommendation()]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /review/i });
    expect(link.className).toMatch(/min-h-\[44px\]/);
    expect(link.className).toMatch(/min-w-\[44px\]/);
  });

  it('AC-9: the action link targets exactly /screener#ranked-opportunities', () => {
    render(<NewOpportunitiesSection items={[makeRecommendation()]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);

    const link = screen.getByRole('link', { name: /review/i });
    expect(link).toHaveAttribute('href', '/screener#ranked-opportunities');
  });

  it('retains its own id="best-opportunity" anchor for backward link compatibility, wrapping only the compact summary', () => {
    const { container } = render(<NewOpportunitiesSection items={[]} generatedAt={null} th={THEMES.dark} />);
    const anchor = container.querySelector('#best-opportunity');
    expect(anchor).not.toBeNull();
    expect(anchor?.querySelector('button, input, select, textarea, form')).toBeNull();
  });

  it('is strictly read-only -- no button, form, or execution affordance', () => {
    const { container } = render(<NewOpportunitiesSection items={[makeRecommendation()]} generatedAt="2026-07-25T09:00:00.000Z" th={THEMES.dark} />);
    expect(container.querySelectorAll('button, input, select, textarea, form')).toHaveLength(0);
  });
});
