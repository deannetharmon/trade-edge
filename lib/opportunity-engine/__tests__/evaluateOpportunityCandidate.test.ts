// lib/opportunity-engine/__tests__/evaluateOpportunityCandidate.test.ts
//
// OE-0001: standalone unit tests for the per-candidate disposition
// contract, independent of batch sequencing (rankOpportunityCandidates.ts
// has its own suite for the full 16 required scenarios, which exercises
// this function as part of a real batch).

import { describe, expect, it } from 'vitest';
import { evaluateOpportunityCandidate } from '../evaluateOpportunityCandidate';
import { OE_RULE_IDS } from '../ruleIds';
import type { OpportunityContext } from '../types';
import { buildOpportunityCandidateFixture } from './decisionAnalysisFixture';

const baseContext: OpportunityContext = {
  availableCapital: 10_000,
  generatedAt: new Date('2026-07-20T00:00:00.000Z').toISOString(),
};

describe('evaluateOpportunityCandidate', () => {
  it('never overrides an existing hard rejection -- status not_recommended always yields REJECTED', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'not_recommended', opportunityScoreTotal: 99 });
    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.disposition).toBe('REJECTED');
    expect(capitalConsumed).toBe(0);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.hardRejectedByDecisionEngine);
  });

  it('maps a conditional Decision Engine status to WATCH', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'conditional' });
    const { recommendation } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.disposition).toBe('WATCH');
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.conditionalByDecisionEngine);
  });

  it('cannot recommend a candidate that exceeds total available capital', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'recommended', capitalRequired: 20_000 });
    const context: OpportunityContext = { ...baseContext, availableCapital: 10_000 };
    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context,
      capitalRemainingBeforeThisCandidate: context.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.disposition).not.toBe('RECOMMENDED');
    expect(recommendation.disposition).toBe('WATCH');
    expect(capitalConsumed).toBe(0);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.insufficientTotalCapital);
  });

  it('demotes to ACCEPTABLE_ALTERNATIVE when capital fits standalone but is already spoken for', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'recommended', capitalRequired: 500 });
    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: 100, // less than capitalRequired
      conflictDescriptions: [],
    });

    expect(recommendation.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(capitalConsumed).toBe(0);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.capitalConsumedByHigherRanked);
  });

  it('demotes to ACCEPTABLE_ALTERNATIVE, never REJECTED or silently promoted, when a conflict is disclosed', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'recommended', capitalRequired: 100 });
    const { recommendation } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: ['Existing AAPL exposure of $1,000 is already on the books.'],
    });

    expect(recommendation.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(recommendation.portfolioConflicts).toContain('Existing AAPL exposure of $1,000 is already on the books.');
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.duplicateExposureDetected);
  });

  it('recommends a clean, affordable, conflict-free, recommended-status candidate and reserves its capital', () => {
    const candidate = buildOpportunityCandidateFixture({ status: 'recommended', capitalRequired: 400 });
    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.disposition).toBe('RECOMMENDED');
    expect(capitalConsumed).toBe(400);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.recommendedTopPick);
  });

  it('passes existing score/confidence through verbatim -- never recalculated', () => {
    const candidate = buildOpportunityCandidateFixture({ opportunityScoreTotal: 42, confidenceOverall: 88 });
    const { recommendation } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.opportunityScoreTotal).toBe(42);
    expect(recommendation.decisionConfidenceTotal).toBe(88);
  });

  it('discloses missing sector and earnings data without fabricating a favorable or unfavorable conclusion', () => {
    const candidate = buildOpportunityCandidateFixture({
      candidateOverrides: { sector: undefined, earningsRisk: undefined },
    });
    const { recommendation } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.missingInformationDisclosures.length).toBeGreaterThan(0);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.missingSectorDisclosure);
    expect(recommendation.ruleIds).toContain(OE_RULE_IDS.missingEarningsDisclosure);
    // Still recommendable on its own merits -- absence of data is disclosed,
    // not treated as either a black mark or a free pass.
    expect(recommendation.disposition).toBe('RECOMMENDED');
  });

  it('does not fabricate missing-information disclosures when sector and earnings are known', () => {
    const candidate = buildOpportunityCandidateFixture({
      candidate: undefined,
      candidateOverrides: { sector: 'Technology', earningsRisk: false },
    });
    const { recommendation } = evaluateOpportunityCandidate({
      candidate,
      context: baseContext,
      capitalRemainingBeforeThisCandidate: baseContext.availableCapital,
      conflictDescriptions: [],
    });

    expect(recommendation.ruleIds).not.toContain(OE_RULE_IDS.missingSectorDisclosure);
    expect(recommendation.ruleIds).not.toContain(OE_RULE_IDS.missingEarningsDisclosure);
  });
});
