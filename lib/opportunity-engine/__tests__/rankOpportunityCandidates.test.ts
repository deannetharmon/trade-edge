// lib/opportunity-engine/__tests__/rankOpportunityCandidates.test.ts
//
// OE-0001: the main fixture-based suite covering the 16 required
// scenarios from the sprint's "Required Scenarios and Tests" section --
// deterministic ranking, capital sequencing, conflict detection, and the
// non-negotiable rule that this module never overrides an existing
// Decision Engine hard rejection or recomputes its scores.

import { describe, expect, it } from 'vitest';
import { OE_RULE_IDS } from '../ruleIds';
import { rankOpportunityCandidates } from '../rankOpportunityCandidates';
import type { OpportunityContext } from '../types';
import { buildOpportunityCandidateFixture } from './decisionAnalysisFixture';

function context(overrides: Partial<OpportunityContext> = {}): OpportunityContext {
  return {
    availableCapital: 10_000,
    generatedAt: new Date('2026-07-20T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

describe('rankOpportunityCandidates', () => {
  // 1. Basic ranking: higher opportunity score ranks first when both are
  // clean, affordable, and status "recommended".
  it('scenario 1: ranks a higher opportunity score ahead of a lower one, all else equal', () => {
    const low = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 50, capitalRequired: 500 });
    const high = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 90, capitalRequired: 500 });

    const results = rankOpportunityCandidates([low, high], context());

    expect(results[0].symbol).toBe('MSFT');
    expect(results[0].rank).toBe(1);
    expect(results[1].symbol).toBe('AAPL');
    expect(results[1].rank).toBe(2);
  });

  // 2. Regression: a hard-rejected candidate with a deliberately HIGH score
  // must never outrank or be promoted above a clean recommended candidate.
  it('scenario 2: a hard-rejected candidate never outranks or overrides its status despite a high score', () => {
    const rejected = buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended', opportunityScoreTotal: 95 });
    const recommended = buildOpportunityCandidateFixture({ symbol: 'AAPL', status: 'recommended', opportunityScoreTotal: 40 });

    const results = rankOpportunityCandidates([rejected, recommended], context());

    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].symbol).toBe('TSLA');
    expect(results[1].disposition).toBe('REJECTED');
    expect(results[1].ruleIds).toContain(OE_RULE_IDS.hardRejectedByDecisionEngine);
  });

  // 3. Conditional candidates sort between recommended and rejected, and
  // surface as WATCH.
  it('scenario 3: conditional-status candidates rank between recommended and rejected, and surface as WATCH', () => {
    const recommended = buildOpportunityCandidateFixture({ symbol: 'AAPL', status: 'recommended' });
    const conditional = buildOpportunityCandidateFixture({ symbol: 'MSFT', status: 'conditional' });
    const rejected = buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended' });

    const results = rankOpportunityCandidates([conditional, rejected, recommended], context());

    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT', 'TSLA']);
    expect(results[1].disposition).toBe('WATCH');
  });

  // 4. Capital sequencing: the top-ranked pick consumes capital, and a
  // second candidate that would have fit standalone becomes an
  // ACCEPTABLE_ALTERNATIVE once the pool is exhausted.
  it('scenario 4: sequential capital reservation demotes a second, otherwise-affordable pick to ACCEPTABLE_ALTERNATIVE', () => {
    const first = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 90, capitalRequired: 9_000 });
    const second = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 80, capitalRequired: 2_000 });

    const results = rankOpportunityCandidates([first, second], context({ availableCapital: 10_000 }));

    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[1].ruleIds).toContain(OE_RULE_IDS.capitalConsumedByHigherRanked);
  });

  // 5. A candidate that exceeds the ENTIRE available pool (not just what's
  // left after higher picks) is WATCH, never RECOMMENDED or ALTERNATIVE.
  it('scenario 5: a candidate exceeding total available capital is WATCH regardless of batch position', () => {
    const tooLarge = buildOpportunityCandidateFixture({ symbol: 'AAPL', capitalRequired: 50_000 });

    const results = rankOpportunityCandidates([tooLarge], context({ availableCapital: 10_000 }));

    expect(results[0].disposition).toBe('WATCH');
    expect(results[0].ruleIds).toContain(OE_RULE_IDS.insufficientTotalCapital);
  });

  // 6. Exact symbol+strategy+expiration duplicate against an existing open
  // position is disclosed as a conflict and caps the candidate below
  // RECOMMENDED.
  it('scenario 6: an exact duplicate of an existing open position is disclosed and demoted', () => {
    const candidate = buildOpportunityCandidateFixture({ symbol: 'AAPL', strategy: 'BPS' });
    const key = `AAPL::BPS::${candidate.expiration}`;

    const results = rankOpportunityCandidates(
      [candidate],
      context({ existingOpenPositionKeys: [key] }),
    );

    expect(results[0].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[0].portfolioConflicts.length).toBeGreaterThan(0);
    expect(results[0].ruleIds).toContain(OE_RULE_IDS.duplicateExposureDetected);
  });

  // 7. Duplicate exposure detected WITHIN the same batch (two candidates
  // proposing the identical symbol+strategy+expiration) demotes the
  // lower-ranked duplicate, not the higher-ranked one.
  it('scenario 7: a same-batch duplicate demotes only the lower-ranked of the two candidates', () => {
    const better = buildOpportunityCandidateFixture({
      symbol: 'AAPL',
      strategy: 'BPS',
      opportunityScoreTotal: 90,
      candidateOverrides: { expiration: '2026-08-21' },
    });
    const worse = buildOpportunityCandidateFixture({
      symbol: 'AAPL',
      strategy: 'BPS',
      opportunityScoreTotal: 50,
      candidateOverrides: { expiration: '2026-08-21' },
    });

    const results = rankOpportunityCandidates([worse, better], context());

    expect(results[0].opportunityScoreTotal).toBe(90);
    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].opportunityScoreTotal).toBe(50);
    expect(results[1].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[1].ruleIds).toContain(OE_RULE_IDS.duplicateExposureDetected);
  });

  // 8. Known existing ticker exposure is disclosed as a conflict even when
  // the Decision Engine itself raised no concern.
  it('scenario 8: known existing ticker exposure is disclosed as a portfolio conflict', () => {
    const candidate = buildOpportunityCandidateFixture({ symbol: 'AAPL' });

    const results = rankOpportunityCandidates(
      [candidate],
      context({ existingTickerExposure: { AAPL: 1_500 } }),
    );

    expect(results[0].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[0].portfolioConflicts.some((c) => c.includes('AAPL'))).toBe(true);
  });

  // 9. Known existing sector exposure is disclosed when the candidate's
  // sector is known, and never fabricated when it isn't.
  it('scenario 9: known sector exposure is disclosed only when the candidate sector is known', () => {
    const known = buildOpportunityCandidateFixture({ symbol: 'AAPL', candidateOverrides: { sector: 'Technology' } });
    const unknown = buildOpportunityCandidateFixture({ symbol: 'MSFT', candidateOverrides: { sector: undefined } });

    const ctx = context({ existingSectorExposure: { Technology: 5_000 } });
    const results = rankOpportunityCandidates([known, unknown], ctx);

    const knownResult = results.find((r) => r.symbol === 'AAPL')!;
    const unknownResult = results.find((r) => r.symbol === 'MSFT')!;

    expect(knownResult.portfolioConflicts.some((c) => c.includes('Technology'))).toBe(true);
    expect(unknownResult.portfolioConflicts.length).toBe(0);
  });

  // 10. Deterministic tie-break: identical score and confidence fall back to
  // stable id ordering rather than input array order.
  it('scenario 10: identical score and confidence break ties by candidate id, not array position', () => {
    // The candidate's OpportunityCandidate.id comes from the underlying
    // subject/candidate id (see decisionAnalysisAdapter.ts), not the
    // DecisionAnalysis's own id -- override it via candidateOverrides so
    // the id actually compared by the tie-break is deterministic here.
    const a = buildOpportunityCandidateFixture({
      symbol: 'AAPL',
      opportunityScoreTotal: 70,
      confidenceOverall: 80,
      candidateOverrides: { id: 'candidate_a' },
    });
    const b = buildOpportunityCandidateFixture({
      symbol: 'MSFT',
      opportunityScoreTotal: 70,
      confidenceOverall: 80,
      candidateOverrides: { id: 'candidate_b' },
    });

    const forward = rankOpportunityCandidates([a, b], context());
    const reversed = rankOpportunityCandidates([b, a], context());

    expect(forward.map((r) => r.candidateId)).toEqual(['candidate_a', 'candidate_b']);
    expect(reversed.map((r) => r.candidateId)).toEqual(['candidate_a', 'candidate_b']);
  });

  // 11. Stability: re-running the exact same batch produces an identical
  // ordering and identical dispositions every time.
  it('scenario 11: re-running the same batch produces stable, identical output', () => {
    const candidates = [
      buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 80, capitalRequired: 4_000 }),
      buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 60, capitalRequired: 4_000 }),
      buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended' }),
    ];
    const ctx = context({ availableCapital: 10_000 });

    const first = rankOpportunityCandidates(candidates, ctx);
    const second = rankOpportunityCandidates([...candidates], ctx);

    expect(second).toEqual(first);
  });

  // 12. Higher decision confidence breaks a tie when opportunity score is
  // equal.
  it('scenario 12: equal opportunity score breaks the tie by decision confidence', () => {
    const lowerConfidence = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 70, confidenceOverall: 60 });
    const higherConfidence = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 70, confidenceOverall: 85 });

    const results = rankOpportunityCandidates([lowerConfidence, higherConfidence], context());

    expect(results[0].symbol).toBe('MSFT');
    expect(results[1].symbol).toBe('AAPL');
  });

  // 13. Rank numbers are assigned sequentially starting at 1 and matching
  // final sorted position, regardless of disposition.
  it('scenario 13: rank is assigned sequentially by final sorted position', () => {
    const candidates = [
      buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended' }),
      buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 90 }),
      buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 40 }),
    ];

    const results = rankOpportunityCandidates(candidates, context());

    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  // 14. Cross-source ranking: candidates from different sources (screener,
  // repeat_trades) compare on the same footing -- source never biases rank.
  it('scenario 14: candidates from different sources are ranked purely on their existing evidence', () => {
    const screenerCandidate = buildOpportunityCandidateFixture({ symbol: 'AAPL', source: 'screener', opportunityScoreTotal: 55 });
    const repeatCandidate = buildOpportunityCandidateFixture({ symbol: 'MSFT', source: 'repeat_trades', opportunityScoreTotal: 85 });

    const results = rankOpportunityCandidates([screenerCandidate, repeatCandidate], context());

    expect(results[0].symbol).toBe('MSFT');
    expect(results[0].source).toBe('repeat_trades');
    expect(results[1].source).toBe('screener');
  });

  // 15. Empty batch input returns an empty, valid result -- no throw, no
  // fabricated recommendation.
  it('scenario 15: an empty candidate batch returns an empty result set', () => {
    const results = rankOpportunityCandidates([], context());
    expect(results).toEqual([]);
  });

  // 16. End-to-end regression proving the full contract together: scores
  // and confidence are passed through verbatim (never recalculated), a
  // hard rejection stays REJECTED even ranked last among a mixed batch, and
  // capital sequencing plus conflict detection compose correctly in one
  // realistic multi-candidate pass.
  it('scenario 16: end-to-end -- verbatim scores, hard-rejection integrity, and capital/conflict sequencing all compose correctly', () => {
    const topPick = buildOpportunityCandidateFixture({
      symbol: 'AAPL',
      opportunityScoreTotal: 88,
      confidenceOverall: 90,
      capitalRequired: 6_000,
    });
    const secondPick = buildOpportunityCandidateFixture({
      symbol: 'MSFT',
      opportunityScoreTotal: 70,
      confidenceOverall: 75,
      capitalRequired: 5_000, // fits standalone, not after topPick's reservation
    });
    const conflicted = buildOpportunityCandidateFixture({
      symbol: 'GOOGL',
      opportunityScoreTotal: 60,
      confidenceOverall: 70,
      capitalRequired: 1_000,
      candidateOverrides: { sector: 'Technology' },
    });
    const hardRejected = buildOpportunityCandidateFixture({
      symbol: 'TSLA',
      status: 'not_recommended',
      opportunityScoreTotal: 99,
    });

    const ctx = context({
      availableCapital: 10_000,
      existingSectorExposure: { Technology: 2_000 },
    });

    const results = rankOpportunityCandidates([hardRejected, conflicted, secondPick, topPick], ctx);

    // Sort order: recommended-status candidates first (by score desc: 88,
    // 70, 60), the hard-rejected candidate always last regardless of its
    // (deliberately high) score.
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT', 'GOOGL', 'TSLA']);

    const aapl = results[0];
    expect(aapl.disposition).toBe('RECOMMENDED');
    expect(aapl.opportunityScoreTotal).toBe(88);
    expect(aapl.decisionConfidenceTotal).toBe(90);

    const msft = results[1];
    expect(msft.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(msft.ruleIds).toContain(OE_RULE_IDS.capitalConsumedByHigherRanked);

    const googl = results[2];
    expect(googl.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(googl.portfolioConflicts.some((c) => c.includes('Technology'))).toBe(true);

    const tsla = results[3];
    expect(tsla.disposition).toBe('REJECTED');
    expect(tsla.opportunityScoreTotal).toBe(99);
    expect(tsla.ruleIds).toContain(OE_RULE_IDS.hardRejectedByDecisionEngine);
  });
});
