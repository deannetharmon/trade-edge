// lib/opportunity-engine/__tests__/decisionAnalysisAdapter.test.ts
//
// OE-0001: proves the adapter preserves identity and canonical Decision
// Engine evidence from a real DecisionAnalysis shape (required scenario
// 14), and that it never fabricates candidates from analyses with no
// underlying candidate data.

import { describe, expect, it } from 'vitest';
import {
  decisionAnalysesToOpportunityCandidates,
  decisionAnalysisToOpportunityCandidate,
} from '../adapters/decisionAnalysisAdapter';
import { buildCandidateFixture, buildDecisionAnalysisFixture } from './decisionAnalysisFixture';

describe('decisionAnalysisToOpportunityCandidate', () => {
  it('preserves candidate identity and carries the full DecisionAnalysis through unchanged', () => {
    const analysis = buildDecisionAnalysisFixture({ symbol: 'MSFT', strategy: 'BCS', capitalRequired: 500 });
    const result = decisionAnalysisToOpportunityCandidate(analysis);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(analysis.subject.id);
    expect(result!.symbol).toBe('MSFT');
    expect(result!.strategy).toBe('BCS');
    expect(result!.capitalRequired).toBe(500);
    // The canonical Decision Engine result is carried through verbatim --
    // not copied field-by-field, not recomputed.
    expect(result!.decisionAnalysis).toBe(analysis);
    expect(result!.decisionAnalysis.opportunityScore?.total).toBe(analysis.opportunityScore?.total);
  });

  it('maps metadata.source to the narrower OpportunityCandidateSource vocabulary', () => {
    const screener = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ source: 'screener' }));
    const repeatTrades = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ source: 'repeat_trades' }));
    const portfolio = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ source: 'portfolio' }));
    const autopilot = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ source: 'autopilot' }));

    expect(screener!.source).toBe('screener');
    expect(repeatTrades!.source).toBe('repeat_trades');
    // Sources outside OE-0001's four discovery sources map to 'manual'
    // rather than being guessed at -- documented, not fabricated.
    expect(portfolio!.source).toBe('manual');
    expect(autopilot!.source).toBe('manual');
  });

  it('derives dte from the latest leg expiration without fabricating one when legs have none', () => {
    const withExpiration = decisionAnalysisToOpportunityCandidate(
      buildDecisionAnalysisFixture(),
      { now: new Date('2026-07-20T00:00:00.000Z') },
    );
    expect(withExpiration!.expiration).toBe('2026-08-21');
    expect(withExpiration!.dte).toBe(32);

    const noLegs = decisionAnalysisToOpportunityCandidate(
      buildDecisionAnalysisFixture({ candidate: buildCandidateFixture({ legs: [] }) }),
    );
    expect(noLegs!.expiration).toBeUndefined();
    expect(noLegs!.dte).toBeUndefined();
  });

  it('derives earningsRisk from the existing earnings-risk concern rather than recomputing date math', () => {
    const unknown = decisionAnalysisToOpportunityCandidate(
      buildDecisionAnalysisFixture({ candidate: buildCandidateFixture({ earningsDate: undefined }) }),
    );
    expect(unknown!.earningsRisk).toBeUndefined();

    const knownSafe = decisionAnalysisToOpportunityCandidate(
      buildDecisionAnalysisFixture({
        candidate: buildCandidateFixture({ earningsDate: '2026-09-01' }),
        concerns: [],
      }),
    );
    expect(knownSafe!.earningsRisk).toBe(false);

    const knownRisky = decisionAnalysisToOpportunityCandidate(
      buildDecisionAnalysisFixture({
        candidate: buildCandidateFixture({ earningsDate: '2026-08-01' }),
        concerns: [{ id: 'earnings-risk', label: 'Earnings risk', severity: 'critical', explanation: 'x' }],
      }),
    );
    expect(knownRisky!.earningsRisk).toBe(true);
  });

  it('marks CSP/CC as wheel-suitable and BPS/BCS/IC as not, reflecting the existing strategy taxonomy', () => {
    const csp = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ strategy: 'CSP' }));
    const bps = decisionAnalysisToOpportunityCandidate(buildDecisionAnalysisFixture({ strategy: 'BPS' }));
    expect(csp!.wheelSuitable).toBe(true);
    expect(bps!.wheelSuitable).toBe(false);
  });

  it('returns null for an analysis with no underlying candidate, rather than fabricating one', () => {
    const analysis = buildDecisionAnalysisFixture();
    const noCandidateAnalysis = { ...analysis, candidate: undefined };
    expect(decisionAnalysisToOpportunityCandidate(noCandidateAnalysis)).toBeNull();
  });
});

describe('decisionAnalysesToOpportunityCandidates', () => {
  it('accounts for every analysis as either converted or explicitly skipped -- never silently dropped', () => {
    const good = buildDecisionAnalysisFixture({ symbol: 'AAPL' });
    const bad = { ...buildDecisionAnalysisFixture({ symbol: 'MSFT' }), candidate: undefined };

    const result = decisionAnalysesToOpportunityCandidates([good, bad]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].symbol).toBe('AAPL');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].decisionAnalysisId).toBe(bad.id);
  });
});
