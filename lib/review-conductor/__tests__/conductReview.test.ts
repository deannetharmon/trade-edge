// lib/review-conductor/__tests__/conductReview.test.ts
//
// MB-0001B: coverage for the Review Conductor's composition contract --
// narrative section assembly from already-computed inputs, deduplication
// between "Since Your Last Review" and "Attention Required", the lead-item
// interruption policy (commitment change > canonical top attention item >
// nothing), the "silence is a feature" complete state, and determinism.
// Does not re-test buildAttentionFeed, buildPortfolioReview,
// rankOpportunityCandidates, or revalidateCommitment -- those already have
// their own passing test suites, unchanged by this sprint.

import { describe, expect, it } from 'vitest';
import { conductReview } from '../conductReview';
import type { ConductReviewInput } from '../types';
import type { AttentionFeed, AttentionItem } from '@/lib/morning-briefing';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { RevalidationResult } from '@/lib/revalidation';
import { createTraderCommitment } from '@/lib/trader-commitments';

const GENERATED_AT = '2026-07-25T09:00:00.000Z';

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'obj_1',
    subjectId: 'pos_1',
    symbol: 'AAPL',
    strategy: null,
    band: 'WATCH',
    source: 'MEDIUM_PRIORITY',
    score: 50,
    tier: 'Medium',
    headline: 'Hold Position: AAPL',
    recommendedAction: 'Hold the position.',
    reasons: ['Test reason'],
    explanation: { confidenceLabel: 'High', confidenceScore: 80, decisionDrivers: ['Net Edge'], whyNow: ['Risk threshold crossed.'] },
    objective: null,
    ...overrides,
  };
}

function makeAttentionFeed(overrides: Partial<AttentionFeed> = {}): AttentionFeed {
  const immediate = overrides.immediate ?? [];
  const watch = overrides.watch ?? [];
  const healthy = overrides.healthy ?? [];
  const orderedActionable = overrides.orderedActionable ?? [...immediate, ...watch];
  return {
    generatedAt: GENERATED_AT,
    immediate,
    watch,
    healthy,
    orderedActionable,
    topAttentionItem: overrides.topAttentionItem !== undefined ? overrides.topAttentionItem : (orderedActionable[0] ?? null),
    counts: overrides.counts ?? {
      immediate: immediate.length,
      watch: watch.length,
      healthy: healthy.length,
      actionable: orderedActionable.length,
    },
  };
}

function makePortfolioReview(overrides: Partial<PortfolioReviewSnapshot> = {}): PortfolioReviewSnapshot {
  return {
    generatedAt: GENERATED_AT,
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
  };
}

function makeOpportunity(overrides: Partial<OpportunityRecommendation> = {}): OpportunityRecommendation {
  return {
    candidateId: 'cand_1',
    source: 'screener',
    symbol: 'SPY',
    strategy: 'BPS',
    rank: 1,
    disposition: 'RECOMMENDED',
    opportunityScoreTotal: 80,
    decisionConfidenceTotal: 75,
    primaryReason: 'Strong edge.',
    supportingFactors: [],
    riskTradeoffs: [],
    portfolioConflicts: [],
    exposureDisclosures: [],
    rejectionReasons: [],
    missingInformationDisclosures: [],
    whatWouldImprove: [],
    decisionAnalysisId: 'analysis_1',
    ruleIds: [],
    ...overrides,
  };
}

function makeRevalidationResult(overrides: Partial<RevalidationResult> = {}): RevalidationResult {
  const commitment = createTraderCommitment(
    { kind: 'HOLD_UNTIL_DTE', subject: { type: 'position', id: 'pos_1', symbol: 'AAPL', label: 'AAPL BPS' }, targetDte: 21 },
    new Date(GENERATED_AT),
  );
  return {
    commitment,
    changed: true,
    change: { whatChanged: 'DTE reached target.', whyItMatters: 'Matters.', whyNow: 'Now.' },
    ...overrides,
  };
}

function baseInput(overrides: Partial<ConductReviewInput> = {}): ConductReviewInput {
  return {
    generatedAt: GENERATED_AT,
    portfolioReview: makePortfolioReview(),
    attentionFeed: makeAttentionFeed(),
    opportunities: [],
    revalidationResults: [],
    ...overrides,
  };
}

describe('conductReview: empty/quiet review', () => {
  it('is complete, non-interrupting, and carries no lead item when nothing changed and nothing is actionable', () => {
    const narrative = conductReview(baseInput());

    expect(narrative.shouldInterrupt).toBe(false);
    expect(narrative.leadItem).toBeNull();
    expect(narrative.sinceLastReview.changes).toEqual([]);
    expect(narrative.attention.items).toEqual([]);
    expect(narrative.complete.isComplete).toBe(true);
    expect(narrative.complete.message.length).toBeGreaterThan(0);
    expect(narrative.counts).toEqual({ changes: 0, attention: 0, opportunities: 0 });
  });
});

describe('conductReview: section pass-through', () => {
  it('carries the PortfolioReviewSnapshot through unchanged as Portfolio Status', () => {
    const review = makePortfolioReview({ currentState: { ...makePortfolioReview().currentState, health: { score: 40, status: 'Needs Attention', positiveContributors: [], negativeContributors: [] } } });
    const narrative = conductReview(baseInput({ portfolioReview: review }));

    expect(narrative.portfolioStatus.review).toBe(review);
  });

  it('carries the opportunity feed through unchanged as New Opportunities, never triggering interruption on its own', () => {
    const opportunities = [makeOpportunity()];
    const narrative = conductReview(baseInput({ opportunities }));

    expect(narrative.newOpportunities.items).toBe(opportunities);
    expect(narrative.counts.opportunities).toBe(1);
    expect(narrative.shouldInterrupt).toBe(false);
  });
});

describe('conductReview: Since Your Last Review', () => {
  it('includes only revalidation results that actually changed', () => {
    const changed = makeRevalidationResult({ changed: true });
    const silent = makeRevalidationResult({
      changed: false,
      change: null,
      commitment: createTraderCommitment({ kind: 'MONITOR', subject: { type: 'position', id: 'pos_2', symbol: 'MSFT', label: 'MSFT' } }),
    });

    const narrative = conductReview(baseInput({ revalidationResults: [changed, silent] }));

    expect(narrative.sinceLastReview.changes).toEqual([changed]);
    expect(narrative.counts.changes).toBe(1);
    expect(narrative.shouldInterrupt).toBe(true);
  });
});

describe('conductReview: deduplication against Attention Required', () => {
  it('removes an attention item whose subject a commitment change already covers this cycle', () => {
    const changed = makeRevalidationResult(); // subject pos_1
    const coveredItem = makeAttentionItem({ id: 'obj_1', subjectId: 'pos_1' });
    const unrelatedItem = makeAttentionItem({ id: 'obj_2', subjectId: 'pos_2', symbol: 'MSFT' });
    const feed = makeAttentionFeed({ watch: [coveredItem, unrelatedItem], orderedActionable: [coveredItem, unrelatedItem] });

    const narrative = conductReview(baseInput({ attentionFeed: feed, revalidationResults: [changed] }));

    expect(narrative.attention.items.map((i) => i.id)).toEqual(['obj_2']);
    expect(narrative.counts.attention).toBe(1);
  });

  it('never dedupes a portfolio-level item (subjectId: null) against a commitment change', () => {
    const changed = makeRevalidationResult(); // subject pos_1
    const portfolioLevelItem = makeAttentionItem({ id: 'obj_portfolio', subjectId: null, symbol: null });
    const feed = makeAttentionFeed({ watch: [portfolioLevelItem], orderedActionable: [portfolioLevelItem] });

    const narrative = conductReview(baseInput({ attentionFeed: feed, revalidationResults: [changed] }));

    expect(narrative.attention.items).toEqual([portfolioLevelItem]);
  });
});

describe('conductReview: lead item interruption policy', () => {
  it('leads with a commitment change over the canonical top attention item when both exist', () => {
    const changed = makeRevalidationResult();
    const item = makeAttentionItem({ id: 'obj_2', subjectId: 'pos_2' });
    const feed = makeAttentionFeed({ watch: [item], orderedActionable: [item], topAttentionItem: item });

    const narrative = conductReview(baseInput({ attentionFeed: feed, revalidationResults: [changed] }));

    expect(narrative.leadItem).toEqual({ kind: 'COMMITMENT_CHANGE', result: changed });
  });

  it('leads with the canonical topAttentionItem (never independently re-derived) when there is no commitment change', () => {
    const item = makeAttentionItem({ id: 'obj_1' });
    const feed = makeAttentionFeed({ watch: [item], orderedActionable: [item], topAttentionItem: item });

    const narrative = conductReview(baseInput({ attentionFeed: feed }));

    expect(narrative.leadItem).toEqual({ kind: 'ATTENTION_ITEM', item });
  });

  it('has no lead item when there is neither a commitment change nor a top attention item', () => {
    const narrative = conductReview(baseInput());
    expect(narrative.leadItem).toBeNull();
  });
});

describe('conductReview: determinism', () => {
  it('does not mutate its inputs', () => {
    const input = baseInput({
      attentionFeed: makeAttentionFeed({ watch: [makeAttentionItem()], orderedActionable: [makeAttentionItem()] }),
      revalidationResults: [makeRevalidationResult()],
      opportunities: [makeOpportunity()],
    });
    const before = JSON.parse(JSON.stringify(input));

    conductReview(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });

  it('produces deeply equal output across repeated calls with identical input', () => {
    const input = baseInput({
      attentionFeed: makeAttentionFeed({ watch: [makeAttentionItem()], orderedActionable: [makeAttentionItem()] }),
      revalidationResults: [makeRevalidationResult()],
    });

    const first = conductReview(input);
    const second = conductReview(input);

    expect(second).toEqual(first);
  });
});
