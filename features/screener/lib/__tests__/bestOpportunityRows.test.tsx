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
