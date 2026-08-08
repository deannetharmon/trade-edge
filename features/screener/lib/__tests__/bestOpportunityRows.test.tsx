// features/screener/lib/__tests__/bestOpportunityRows.test.ts
//
// SCREENER-UX-0001 required tests 6-7, 15-18: the Best Opportunities view
// model never fabricates numbers (pure join/formatting over existing
// fields), and strategy-specific strike/credit summaries are correct for
// CSP, CC, PMCC, and IC — including "never show a CSP as a BPS" (verified
// by strategy passing through untouched) and never fabricating a PMCC
// fixed max profit / breakeven (verified by this module not reading or
// inventing those fields at all).

import { describe, expect, it } from 'vitest';
import { buildBestOpportunityRows } from '../bestOpportunityRows';
import type { ScreenResult } from '@/lib/scans/types';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';

// NOTE: AutopilotStrategy (lib/autopilot/types.ts), which
// OpportunityRecommendation['strategy'] is typed against, does not include
// 'PMCC' -- a pre-existing gap in the Opportunity Engine unrelated to this
// ticket (recorded as a deviation in the implementation report, not fixed
// here per the ticket's explicit "no scanner/scoring/new-strategy change"
// boundary). The PMCC formatting test below casts through `any` to exercise
// buildBestOpportunityRows' PMCC strike/credit formatting in isolation.
function rec(overrides: Partial<OpportunityRecommendation> = {}): OpportunityRecommendation {
  return {
    candidateId: 'c1',
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — the canonical join
    // key. Matches result()'s default candidateId below so existing tests
    // that don't care about identity still join correctly; tests that
    // specifically exercise multiple CSP contracts override both.
    screenerCandidateId: 'c1',
    source: 'screener',
    symbol: 'AAPL',
    strategy: 'BPS',
    rank: 1,
    disposition: 'RECOMMENDED',
    opportunityScoreTotal: 80,
    decisionConfidenceTotal: 90,
    primaryReason: 'Strong setup',
    supportingFactors: [],
    riskTradeoffs: [],
    portfolioConflicts: [],
    exposureDisclosures: [],
    rejectionReasons: [],
    missingInformationDisclosures: [],
    whatWouldImprove: [],
    decisionAnalysisId: 'd1',
    ruleIds: [],
    ...overrides,
  } as OpportunityRecommendation;
}

function result(overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AAPL',
    strategy: 'BPS',
    price: 100,
    ivr: 50,
    qualified: true,
    bestCandidate: null,
    failReasons: [],
    checks: {} as any,
    candidateId: 'c1',
    ...overrides,
  };
}

describe('buildBestOpportunityRows', () => {
  it('CSP shows a single strike, never a spread pair', () => {
    const results = [result({ strategy: 'CSP', bestCandidate: { strategy: 'CSP', expiration: '2026-09-18', dte: 30, shortStrike: 95, longStrike: 0, shortDelta: -0.2, credit: 1.5, spreadWidth: 0, creditRatio: 0, roc: 5, pop: 80, shortOI: 500, longOI: 0 } as any })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CSP' })]);
    expect(rows[0].strikeSummary).toBe('95');
    expect(rows[0].strategy).toBe('CSP');
  });

  it('CC shows a single strike', () => {
    const results = [result({ strategy: 'CC', bestCandidate: { strategy: 'CC', expiration: '2026-09-18', dte: 30, shortStrike: 110, longStrike: 0, shortDelta: 0.2, credit: 2, spreadWidth: 0, creditRatio: 0, roc: 3, pop: 70, shortOI: 300, longOI: 0 } as any })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CC' })]);
    expect(rows[0].strikeSummary).toBe('110');
  });

  it('PMCC shows long/short strikes and a debit label, never a fabricated fixed max profit or breakeven', () => {
    const results = [result({
      strategy: 'PMCC',
      bestCandidate: {
        strategy: 'PMCC', expiration: '2026-09-18', dte: 30, shortStrike: 150, longStrike: 100,
        shortDelta: 0.3, credit: 0, spreadWidth: 0, creditRatio: 0, roc: 4, pop: 65, shortOI: 200, longOI: 100,
        netDebit: 25.5,
      } as any,
    })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'PMCC' as any })]);
    expect(rows[0].strikeSummary).toBe('100L / 150S');
    expect(rows[0].creditDebitLabel).toBe('$25.50 debit');
    // This module never reads maxProfit/breakeven fields into the row at all.
    expect(Object.keys(rows[0])).not.toContain('maxProfit');
    expect(Object.keys(rows[0])).not.toContain('breakeven');
  });

  it('IC shows both sides and takes the minimum relevant-leg OI', () => {
    const results = [result({
      strategy: 'IC',
      bestCandidate: {
        strategy: 'IC', expiration: '2026-09-18', dte: 30, shortStrike: 90, longStrike: 85,
        shortDelta: -0.15, credit: 1, spreadWidth: 5, creditRatio: 0.2, roc: 6, pop: 75,
        shortOI: 400, longOI: 100, shortCallStrike: 120, longCallStrike: 125, shortCallOI: 250, longCallOI: 80,
      } as any,
    })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'IC' })]);
    expect(rows[0].strikeSummary).toBe('90/85 · 120/125');
    expect(rows[0].relevantLegOi).toBe(250); // min(400, 250)
  });

  it('never fabricates a numeric field — rows come only from existing ScreenResult/SpreadCandidate fields', () => {
    const results = [result({ bestCandidate: null })];
    const rows = buildBestOpportunityRows(results, [rec()]);
    expect(rows[0].strikeSummary).toBe('—');
    expect(rows[0].pop).toBeNull();
    expect(rows[0].otmPct).toBeNull();
  });
});

describe('buildBestOpportunityRows — CSP-WORKFLOW-0001 core-correction (BLOCKER-03): cspScore is authoritative', () => {
  function cspCandidate(overrides: Record<string, unknown> = {}) {
    return {
      strategy: 'CSP', expiration: '2026-09-18', dte: 30, shortStrike: 95, longStrike: 0,
      shortDelta: -0.2, credit: 1.5, spreadWidth: 0, creditRatio: 0, roc: 5, pop: 80,
      shortOI: 500, longOI: 0,
      ...overrides,
    } as any;
  }

  it('Best Opportunities uses cspScore.total (rounded), not the generic opportunityScoreTotal, for a CSP row', () => {
    const results = [result({
      strategy: 'CSP',
      bestCandidate: cspCandidate({ cspScore: { scoreStatus: 'AVAILABLE', total: 72.6, components: {}, inputsUsed: [], missingInputs: [], scoreVersion: 'csp-score-v1' } }),
    })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CSP', opportunityScoreTotal: 12 })]);
    expect(rows[0].opportunityScore).toBe(73); // rounded, not the generic 12
  });

  it('UI never displays a long floating-point score -- the CSP row score is always a whole number', () => {
    const results = [result({
      strategy: 'CSP',
      bestCandidate: cspCandidate({ cspScore: { scoreStatus: 'AVAILABLE', total: 41.3333333, components: {}, inputsUsed: [], missingInputs: [], scoreVersion: 'csp-score-v1' } }),
    })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CSP' })]);
    expect(Number.isInteger(rows[0].opportunityScore)).toBe(true);
  });

  it('a CSP candidate with an UNAVAILABLE cspScore is excluded from Best Opportunities entirely', () => {
    const results = [result({
      strategy: 'CSP',
      bestCandidate: cspCandidate({ cspScore: { scoreStatus: 'UNAVAILABLE', total: null, components: {}, inputsUsed: [], missingInputs: ['technical'], scoreVersion: 'csp-score-v1' } }),
    })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CSP' })]);
    expect(rows.length).toBe(0);
  });

  it('excludes a canonical Targeted failure from Best Opportunities even when its market and account states pass', () => {
    const results = [result({
      strategy: 'CSP', qualified: false,
      bestCandidate: cspCandidate({
        cspMarketQualification: 'QUALIFIED', cspAccountEligibility: 'ELIGIBLE',
        cspModeQualification: 'FAILED', cspModeQualificationReasons: ['POP below 70%'],
        cspScore: { scoreStatus: 'AVAILABLE', total: 90, components: {}, inputsUsed: [], missingInputs: [], scoreVersion: 'csp-score-v1' },
      }),
    })];
    expect(buildBestOpportunityRows(results, [rec({ strategy: 'CSP' })])).toEqual([]);
  });

  it('CSP rows are re-ranked by cspScore.total (highest first), independent of the recommendation pipeline rank order', () => {
    const results = [
      result({ symbol: 'AAA', strategy: 'CSP', candidateId: 'aaa-1', bestCandidate: cspCandidate({ cspScore: { scoreStatus: 'AVAILABLE', total: 40, components: {}, inputsUsed: [], missingInputs: [], scoreVersion: 'csp-score-v1' } }) }),
      result({ symbol: 'BBB', strategy: 'CSP', candidateId: 'bbb-1', bestCandidate: cspCandidate({ shortStrike: 100, cspScore: { scoreStatus: 'AVAILABLE', total: 90, components: {}, inputsUsed: [], missingInputs: [], scoreVersion: 'csp-score-v1' } }) }),
    ];
    const rows = buildBestOpportunityRows(results, [
      rec({ candidateId: 'c1', screenerCandidateId: 'aaa-1', symbol: 'AAA', strategy: 'CSP', rank: 1, opportunityScoreTotal: 99 }),
      rec({ candidateId: 'c2', screenerCandidateId: 'bbb-1', symbol: 'BBB', strategy: 'CSP', rank: 2, opportunityScoreTotal: 10 }),
    ]);
    expect(rows[0].symbol).toBe('BBB'); // cspScore 90 beats 40, despite generic rank/score saying the opposite
    expect(rows[0].rank).toBe(1);
    expect(rows[1].symbol).toBe('AAA');
    expect(rows[1].rank).toBe(2);
  });

  it('a legacy/test CSP candidate with no cspScore at all (not yet computed) falls back to the generic score unchanged, for backward compatibility', () => {
    const results = [result({ strategy: 'CSP', bestCandidate: cspCandidate() })]; // no cspScore field
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'CSP', opportunityScoreTotal: 55 })]);
    expect(rows.length).toBe(1);
    expect(rows[0].opportunityScore).toBe(55);
  });

  it('non-CSP strategies are unaffected -- opportunityScore remains the generic score, no exclusion', () => {
    const results = [result({ strategy: 'BPS', bestCandidate: { strategy: 'BPS', expiration: '2026-09-18', dte: 30, shortStrike: 90, longStrike: 85, shortDelta: -0.2, credit: 1, spreadWidth: 5, creditRatio: 0.2, roc: 4, pop: 70, shortOI: 300, longOI: 100 } as any })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'BPS', opportunityScoreTotal: 66 })]);
    expect(rows.length).toBe(1);
    expect(rows[0].opportunityScore).toBe(66);
  });
});

describe('buildBestOpportunityRows — CSP-WORKFLOW-0001 core-correction (BLOCKER-04): canonical candidateId propagation', () => {
  function cspCandidate(overrides: Record<string, unknown> = {}) {
    return {
      strategy: 'CSP', expiration: '2026-09-18', dte: 30, shortStrike: 95, longStrike: 0,
      shortDelta: -0.2, credit: 1.5, spreadWidth: 0, creditRatio: 0, roc: 5, pop: 80,
      shortOI: 500, longOI: 0,
      ...overrides,
    } as any;
  }

  it('a CSP recommendation with no resolvable screenerCandidateId fails closed (excluded), never attached to an arbitrary same-symbol contract', () => {
    const results = [result({ symbol: 'AMD', strategy: 'CSP', candidateId: 'occ:AMD240119P00415000', bestCandidate: cspCandidate() })];
    const rows = buildBestOpportunityRows(results, [rec({ symbol: 'AMD', strategy: 'CSP', screenerCandidateId: 'occ:AMD240119P00430000' })]); // a different, non-matching contract id
    expect(rows.length).toBe(0);
  });

  it('a CSP recommendation with no screenerCandidateId at all (undefined) also fails closed rather than guessing symbol+strategy', () => {
    const results = [result({ symbol: 'AMD', strategy: 'CSP', candidateId: 'occ:AMD240119P00415000', bestCandidate: cspCandidate() })];
    const rows = buildBestOpportunityRows(results, [rec({ symbol: 'AMD', strategy: 'CSP', screenerCandidateId: undefined })]);
    expect(rows.length).toBe(0);
  });

  it('two CSP contracts on the same symbol never collide -- each recommendation joins to its own exact contract by candidateId, not symbol+strategy', () => {
    const results = [
      result({ symbol: 'AMD', strategy: 'CSP', candidateId: 'occ:AMD240119P00415000', bestCandidate: cspCandidate({ shortStrike: 415, credit: 3.1 }) }),
      result({ symbol: 'AMD', strategy: 'CSP', candidateId: 'occ:AMD240119P00405000', bestCandidate: cspCandidate({ shortStrike: 405, credit: 1.8 }) }),
    ];
    const rows = buildBestOpportunityRows(results, [
      rec({ candidateId: 'c1', screenerCandidateId: 'occ:AMD240119P00405000', symbol: 'AMD', strategy: 'CSP', rank: 1, primaryReason: 'for the 405 strike' }),
      rec({ candidateId: 'c2', screenerCandidateId: 'occ:AMD240119P00415000', symbol: 'AMD', strategy: 'CSP', rank: 2, primaryReason: 'for the 415 strike' }),
    ]);
    expect(rows.length).toBe(2);
    const row405 = rows.find(r => r.primaryReason === 'for the 405 strike');
    const row415 = rows.find(r => r.primaryReason === 'for the 415 strike');
    expect(row405?.strikeSummary).toBe('405');
    expect(row415?.strikeSummary).toBe('415');
  });

  it('non-CSP strategies still join by symbol+strategy (not yet multi-candidate per ScreenResult), unaffected by the CSP fail-closed rule', () => {
    const results = [result({ symbol: 'AAPL', strategy: 'BPS', candidateId: 'composite:BPS:AAPL:2026-09-18:P:90', bestCandidate: { strategy: 'BPS', expiration: '2026-09-18', dte: 30, shortStrike: 90, longStrike: 85, shortDelta: -0.2, credit: 1, spreadWidth: 5, creditRatio: 0.2, roc: 4, pop: 70, shortOI: 300, longOI: 100 } as any })];
    const rows = buildBestOpportunityRows(results, [rec({ strategy: 'BPS', screenerCandidateId: undefined })]);
    expect(rows.length).toBe(1);
    expect(rows[0].strikeSummary).toBe('90/85');
  });
});
