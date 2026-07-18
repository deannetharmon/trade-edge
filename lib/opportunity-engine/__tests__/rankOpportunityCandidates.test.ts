// lib/opportunity-engine/__tests__/rankOpportunityCandidates.test.ts
//
// OE-0001: the main fixture-based suite covering the 16 required
// scenarios from the sprint's "Required Scenarios and Tests" section --
// deterministic ranking, capital sequencing, conflict detection, and the
// non-negotiable rule that this module never overrides an existing
// Decision Engine hard rejection or recomputes its scores.
//
// Product Owner correction round adds: disposition-changing conflicts vs.
// informational exposure disclosures are now strictly separate (ordinary
// nonzero ticker/sector exposure never demotes a candidate), and final
// display order always respects disposition precedence (RECOMMENDED,
// then ACCEPTABLE_ALTERNATIVE, then WATCH, then REJECTED) even when that
// differs from the evaluation/capital-sequencing order.

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

  // 3. Conditional candidates surface as WATCH and display after every
  // RECOMMENDED/ACCEPTABLE_ALTERNATIVE candidate, ahead only of REJECTED.
  it('scenario 3: conditional-status candidates display after recommended, ahead of rejected, and surface as WATCH', () => {
    const recommended = buildOpportunityCandidateFixture({ symbol: 'AAPL', status: 'recommended' });
    const conditional = buildOpportunityCandidateFixture({ symbol: 'MSFT', status: 'conditional' });
    const rejected = buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended' });

    const results = rankOpportunityCandidates([conditional, rejected, recommended], context());

    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT', 'TSLA']);
    expect(results[1].disposition).toBe('WATCH');
  });

  // 4. Capital sequencing: the top-ranked pick consumes capital, and a
  // second candidate that would have fit standalone becomes an
  // ACCEPTABLE_ALTERNATIVE once the pool is exhausted. The demotion
  // explanation must reference the actual remaining/short amounts.
  it('scenario 4: sequential capital reservation demotes a second, otherwise-affordable pick to ACCEPTABLE_ALTERNATIVE, with an internally consistent explanation', () => {
    const first = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 90, capitalRequired: 9_000 });
    const second = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 80, capitalRequired: 2_000 });

    const results = rankOpportunityCandidates([first, second], context({ availableCapital: 10_000 }));

    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[1].ruleIds).toContain(OE_RULE_IDS.capitalConsumedByHigherRanked);
    // $10,000 pool - $9,000 (AAPL) = $1,000 remaining; MSFT needs $2,000, so
    // it is $1,000 short -- both figures must appear together and agree.
    expect(results[1].portfolioConflicts.some((c) => c.includes('$1,000 remains') && c.includes('$1,000 short'))).toBe(true);
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
  // position is a disposition-changing conflict and caps the candidate
  // below RECOMMENDED.
  it('scenario 6: an exact duplicate of an existing open position affects disposition', () => {
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
  // lower-ranked duplicate, not the higher-ranked one, and still affects
  // disposition (it is an exact duplicate, not an ordinary exposure
  // disclosure).
  it('scenario 7: a same-batch exact duplicate demotes only the lower-ranked of the two candidates', () => {
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

  // 8. Corrected behavior: ordinary nonzero existing ticker exposure is
  // disclosed for awareness but must NEVER, by itself, demote a candidate.
  it('scenario 8: ordinary nonzero ticker exposure is disclosed without automatic demotion', () => {
    const candidate = buildOpportunityCandidateFixture({ symbol: 'AAPL', status: 'recommended', capitalRequired: 400 });

    const results = rankOpportunityCandidates(
      [candidate],
      context({ existingTickerExposure: { AAPL: 1_500 } }),
    );

    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[0].portfolioConflicts).toEqual([]);
    expect(results[0].exposureDisclosures.some((d) => d.includes('AAPL'))).toBe(true);
    expect(results[0].ruleIds).toContain(OE_RULE_IDS.tickerExposureDisclosed);
    expect(results[0].ruleIds).not.toContain(OE_RULE_IDS.duplicateExposureDetected);
  });

  // 9. Corrected behavior: ordinary nonzero existing sector exposure is
  // disclosed only when the candidate's sector is known, never fabricated
  // when it isn't, and never demotes disposition either way.
  it('scenario 9: ordinary nonzero sector exposure is disclosed (only when sector is known) without automatic demotion', () => {
    const known = buildOpportunityCandidateFixture({ symbol: 'AAPL', status: 'recommended', capitalRequired: 400, candidateOverrides: { sector: 'Technology' } });
    const unknown = buildOpportunityCandidateFixture({ symbol: 'MSFT', status: 'recommended', capitalRequired: 400, candidateOverrides: { sector: undefined } });

    const ctx = context({ availableCapital: 10_000, existingSectorExposure: { Technology: 5_000 } });
    const results = rankOpportunityCandidates([known, unknown], ctx);

    const knownResult = results.find((r) => r.symbol === 'AAPL')!;
    const unknownResult = results.find((r) => r.symbol === 'MSFT')!;

    expect(knownResult.disposition).toBe('RECOMMENDED');
    expect(knownResult.exposureDisclosures.some((d) => d.includes('Technology'))).toBe(true);
    expect(knownResult.portfolioConflicts).toEqual([]);
    expect(knownResult.ruleIds).toContain(OE_RULE_IDS.sectorExposureDisclosed);

    expect(unknownResult.disposition).toBe('RECOMMENDED');
    expect(unknownResult.exposureDisclosures).toEqual([]);
    expect(unknownResult.portfolioConflicts).toEqual([]);
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
  // final disposition-respecting display order.
  it('scenario 13: rank is assigned sequentially by final display order', () => {
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

  // 16. End-to-end regression proving the full corrected contract together:
  // scores/confidence passed through verbatim, a hard rejection stays
  // REJECTED and last even with a deliberately high score, ordinary sector
  // exposure does NOT demote a clean candidate (corrected behavior), and
  // capital sequencing still produces a RECOMMENDED candidate that
  // display-outranks an ACCEPTABLE_ALTERNATIVE candidate evaluated ahead of
  // it in capital order -- proving display order follows disposition, not
  // evaluation order.
  it('scenario 16: end-to-end -- verbatim scores, hard-rejection integrity, corrected exposure disclosure, and disposition-respecting display order', () => {
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
    const cleanLowerScore = buildOpportunityCandidateFixture({
      symbol: 'GOOGL',
      opportunityScoreTotal: 60,
      confidenceOverall: 70,
      capitalRequired: 1_000,
      candidateOverrides: { sector: 'Technology' }, // has nonzero sector exposure in context below
    });
    const hardRejected = buildOpportunityCandidateFixture({
      symbol: 'TSLA',
      status: 'not_recommended',
      opportunityScoreTotal: 99,
    });

    const ctx = context({
      availableCapital: 10_000,
      existingSectorExposure: { Technology: 2_000 }, // ordinary disclosure only, not a conflict
    });

    const results = rankOpportunityCandidates([hardRejected, cleanLowerScore, secondPick, topPick], ctx);

    // Evaluation order (by score, for capital sequencing) would have been
    // AAPL, MSFT, GOOGL, TSLA. But MSFT's capital gets exhausted by AAPL and
    // it becomes ACCEPTABLE_ALTERNATIVE, while GOOGL -- evaluated after MSFT
    // -- still fits and has no disposition-changing conflict (its sector
    // exposure is disclosed only), so it is RECOMMENDED. Final display
    // order must reflect disposition: both RECOMMENDED candidates (AAPL,
    // GOOGL) display ahead of the ACCEPTABLE_ALTERNATIVE (MSFT), which
    // displays ahead of the REJECTED candidate (TSLA).
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'GOOGL', 'MSFT', 'TSLA']);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4]);

    const aapl = results[0];
    expect(aapl.disposition).toBe('RECOMMENDED');
    expect(aapl.opportunityScoreTotal).toBe(88);
    expect(aapl.decisionConfidenceTotal).toBe(90);

    const googl = results[1];
    expect(googl.disposition).toBe('RECOMMENDED');
    expect(googl.portfolioConflicts).toEqual([]);
    expect(googl.exposureDisclosures.some((d) => d.includes('Technology'))).toBe(true);

    const msft = results[2];
    expect(msft.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(msft.ruleIds).toContain(OE_RULE_IDS.capitalConsumedByHigherRanked);

    const tsla = results[3];
    expect(tsla.disposition).toBe('REJECTED');
    expect(tsla.opportunityScoreTotal).toBe(99);
    expect(tsla.ruleIds).toContain(OE_RULE_IDS.hardRejectedByDecisionEngine);
  });

  // 17. Product Owner correction: a higher-score exact-duplicate alternative
  // must never display above a clean recommended candidate.
  it('scenario 17: a higher-score exact-duplicate ACCEPTABLE_ALTERNATIVE never displays above a clean RECOMMENDED candidate', () => {
    const cleanLowerScore = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 55, capitalRequired: 500 });
    const duplicateHigherScore = buildOpportunityCandidateFixture({
      symbol: 'MSFT',
      strategy: 'BPS',
      opportunityScoreTotal: 95,
      capitalRequired: 500,
      candidateOverrides: { expiration: '2026-08-21' },
    });
    const key = `MSFT::BPS::2026-08-21`;

    const results = rankOpportunityCandidates(
      [duplicateHigherScore, cleanLowerScore],
      context({ existingOpenPositionKeys: [key] }),
    );

    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].symbol).toBe('MSFT');
    expect(results[1].disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
  });

  // 18. Product Owner correction: a high-score candidate that cannot be
  // afforded at all (WATCH) must never display above an affordable,
  // lower-score RECOMMENDED candidate.
  it('scenario 18: a high-score unaffordable WATCH candidate never displays above an affordable RECOMMENDED candidate', () => {
    const affordable = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 50, capitalRequired: 500 });
    const unaffordable = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 98, capitalRequired: 50_000 });

    const results = rankOpportunityCandidates([unaffordable, affordable], context({ availableCapital: 10_000 }));

    expect(results[0].symbol).toBe('AAPL');
    expect(results[0].disposition).toBe('RECOMMENDED');
    expect(results[1].symbol).toBe('MSFT');
    expect(results[1].disposition).toBe('WATCH');
    expect(results[0].rank).toBe(1);
    expect(results[1].rank).toBe(2);
  });

  // 19. Product Owner correction: rejected candidates always appear after
  // every non-rejected candidate, across a mixed batch of all four
  // dispositions, regardless of input order.
  it('scenario 19: rejected candidates always appear after every non-rejected candidate, across all four dispositions', () => {
    const recommended = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 90, capitalRequired: 500 });
    const watch = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 99, capitalRequired: 50_000 });
    const alternative = buildOpportunityCandidateFixture({
      symbol: 'GOOGL',
      strategy: 'BPS',
      opportunityScoreTotal: 97,
      capitalRequired: 500,
      candidateOverrides: { expiration: '2026-08-21' },
    });
    const rejected = buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended', opportunityScoreTotal: 100 });
    const key = `GOOGL::BPS::2026-08-21`;

    const results = rankOpportunityCandidates(
      [rejected, watch, alternative, recommended],
      context({ availableCapital: 10_000, existingOpenPositionKeys: [key] }),
    );

    const rejectedIndex = results.findIndex((r) => r.disposition === 'REJECTED');
    const otherIndices = results
      .map((r, i) => (r.disposition !== 'REJECTED' ? i : -1))
      .filter((i) => i !== -1);

    expect(rejectedIndex).toBe(results.length - 1);
    expect(otherIndices.every((i) => i < rejectedIndex)).toBe(true);
  });

  // 20. Product Owner correction: reversing input order produces identical
  // final results, including for a mixed-disposition batch where display
  // order differs from evaluation order.
  it('scenario 20: reversing input order produces identical final results for a mixed-disposition batch', () => {
    const topPick = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 90, capitalRequired: 6_000 });
    const capitalBlocked = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 80, capitalRequired: 5_000 });
    const cleanRecommended = buildOpportunityCandidateFixture({ symbol: 'GOOGL', opportunityScoreTotal: 60, capitalRequired: 1_000 });
    const rejected = buildOpportunityCandidateFixture({ symbol: 'TSLA', status: 'not_recommended', opportunityScoreTotal: 99 });

    const candidates = [topPick, capitalBlocked, cleanRecommended, rejected];
    const ctx = context({ availableCapital: 10_000 });

    const forward = rankOpportunityCandidates(candidates, ctx);
    const reversed = rankOpportunityCandidates([...candidates].reverse(), ctx);

    expect(reversed).toEqual(forward);
  });

  // 21. Capital allocation and "higher-ranked candidate" explanations
  // remain internally consistent: the demoted candidate's explanation must
  // name the same higher-ranked symbol whose consumption actually caused
  // the shortfall, and the arithmetic must agree with the batch's real
  // capital pool.
  it('scenario 21: capital-consumed explanations are internally consistent with the actual pool and higher-ranked pick', () => {
    const higherRanked = buildOpportunityCandidateFixture({ symbol: 'AAPL', opportunityScoreTotal: 95, capitalRequired: 7_500 });
    const blocked = buildOpportunityCandidateFixture({ symbol: 'MSFT', opportunityScoreTotal: 80, capitalRequired: 3_000 });

    const results = rankOpportunityCandidates([higherRanked, blocked], context({ availableCapital: 10_000 }));

    const higherRankedResult = results.find((r) => r.symbol === 'AAPL')!;
    const blockedResult = results.find((r) => r.symbol === 'MSFT')!;

    expect(higherRankedResult.disposition).toBe('RECOMMENDED');
    expect(blockedResult.disposition).toBe('ACCEPTABLE_ALTERNATIVE');
    // $10,000 - $7,500 = $2,500 remains; $3,000 required means $500 short.
    expect(blockedResult.portfolioConflicts.some((c) => c.includes('$2,500 remains') && c.includes('$500 short'))).toBe(true);
  });
});
