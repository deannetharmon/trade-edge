// lib/portfolioReview/__tests__/buildPortfolioReview.test.ts
//
// PI-0012A: Portfolio Review, Phase 1 -- Composition Layer. Targeted tests
// for the pure composition logic: verbatim reuse of Portfolio Health and
// already-scored objectives (no re-ranking, no re-scoring), portfolio-level
// objective filtering (concentration/capital/income), composition
// aggregation (strategy counts, symbol concentration, Wheel-managed
// fraction), and safe handling of missing/empty data (no NaN, no Infinity,
// no fabricated zeros).

import { describe, expect, it } from 'vitest';
import { buildPortfolioReview, selectTopRisks, DEFAULT_TOP_RISKS_LIMIT } from '../buildPortfolioReview';
import type { PortfolioReviewInput, PortfolioReviewPositionInput } from '../types';
import type { PortfolioObjective, ObjectiveImpact } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { PortfolioHealthResult } from '@/lib/portfolioHealth';

let objectiveCounter = 0;

const NEUTRAL_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  objectiveCounter += 1;
  return {
    id: `obj_${objectiveCounter}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-WATCH-POSITION',
    title: 'Manage Position',
    summary: 'test summary',
    priority: 'medium',
    urgency: 'this_week',
    actionability: 'REVIEW_SOON',
    confidence: 70,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', label: 'SOXL' },
    rationale: 'test rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: NEUTRAL_IMPACT,
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makePrioritized(overrides: Partial<PortfolioObjective> = {}, score = 50): PrioritizedObjective {
  return {
    objective: makeObjective(overrides),
    score,
    tier: score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Medium' : 'Low',
    reasons: [],
  };
}

function makeDashboard(overrides: Partial<TodaysPrioritiesDashboard> = {}): TodaysPrioritiesDashboard {
  return {
    immediateAction: [],
    reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
    monitor: [],
    opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
    ...overrides,
  };
}

function makeHealth(overrides: Partial<PortfolioHealthResult> = {}): PortfolioHealthResult {
  return {
    score: 82,
    status: 'Healthy',
    positiveContributors: [{ id: 'immediateActions', label: 'No immediate actions pending' }],
    negativeContributors: [],
    ...overrides,
  };
}

function makePosition(overrides: Partial<PortfolioReviewPositionInput> = {}): PortfolioReviewPositionInput {
  return {
    symbol: 'SOXL',
    strategy: 'BPS',
    maxRisk: 1000,
    positionStrategy: null,
    assignmentPreference: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PortfolioReviewInput> = {}): PortfolioReviewInput {
  return {
    health: makeHealth(),
    objectives: [],
    dashboard: makeDashboard(),
    positions: [],
    netLiquidity: 100_000,
    ...overrides,
  };
}

describe('buildPortfolioReview', () => {
  it('handles an empty portfolio cleanly -- no NaN, no Infinity, no fabricated data', () => {
    const result = buildPortfolioReview(baseInput());

    expect(result.composition.positionCount).toBe(0);
    expect(result.composition.byStrategy).toEqual({});
    expect(result.composition.symbolConcentrationPct).toEqual({});
    expect(result.composition.maxSymbolConcentrationPct).toBeNull();
    expect(result.composition.wheelManagedFraction).toBeNull();
    expect(result.currentState.topRisks).toEqual([]);
    expect(result.currentState.concentrationConcerns).toEqual([]);
    expect(result.currentState.capitalConcerns).toEqual([]);
    expect(result.currentState.incomeConcern).toBeNull();

    // No NaN/Infinity anywhere in the numeric output.
    const numbers = [
      result.composition.positionCount,
      result.composition.maxSymbolConcentrationPct,
      result.composition.wheelManagedFraction,
    ].filter((n): n is number => n != null);
    for (const n of numbers) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('reuses Portfolio Health verbatim -- same object, not recomputed', () => {
    const health = makeHealth({ score: 61, status: 'Needs Attention' });
    const result = buildPortfolioReview(baseInput({ health }));

    expect(result.currentState.health).toBe(health); // same reference, not a recomputed copy
    expect(result.currentState.health.score).toBe(61);
    expect(result.currentState.health.status).toBe('Needs Attention');
  });

  it('surfaces top risks from already-scored objectives without re-ranking', () => {
    const low = makePrioritized({ title: 'Low' }, 30);
    const high = makePrioritized({ title: 'High' }, 90);
    const mid = makePrioritized({ title: 'Mid' }, 55);

    const dashboard = makeDashboard({
      immediateAction: [high],
      reviewToday: { mediumPriority: [mid], earningsReviews: [], expiringPositions: [low], needsFollowUp: [] },
    });

    const result = buildPortfolioReview(baseInput({ dashboard }));

    // Sorted strictly by each entry's own already-computed score, descending.
    expect(result.currentState.topRisks.map((r) => r.score)).toEqual([90, 55, 30]);
    // The exact same PrioritizedObjective instances are passed through --
    // nothing about them (score, tier, reasons) was recomputed.
    expect(result.currentState.topRisks[0]).toBe(high);
  });

  it('respects a custom topRisksLimit and defaults to DEFAULT_TOP_RISKS_LIMIT', () => {
    const items = Array.from({ length: 8 }, (_, i) => makePrioritized({}, i + 1));
    const dashboard = makeDashboard({ immediateAction: items });

    expect(selectTopRisks(dashboard).length).toBe(Math.min(DEFAULT_TOP_RISKS_LIMIT, items.length));

    const result = buildPortfolioReview(baseInput({ dashboard, topRisksLimit: 2 }));
    expect(result.currentState.topRisks).toHaveLength(2);
    expect(result.currentState.topRisks.map((r) => r.score)).toEqual([8, 7]);
  });

  it('filters objectives into concentration, capital, and income concerns without re-evaluating them', () => {
    const concentration = makeObjective({ type: 'REDUCE_CONCENTRATION', title: 'Reduce Concentration: AAPL' });
    const buyingPower = makeObjective({ type: 'PRESERVE_BUYING_POWER', title: 'Preserve Buying Power' });
    const idleCash = makeObjective({ type: 'DEPLOY_IDLE_CASH', title: 'Deploy Idle Cash' });
    const income = makeObjective({ type: 'INCREASE_INCOME', title: 'Increase Income' });
    const unrelated = makeObjective({ type: 'MANAGE_POSITION', title: 'Manage Position' });

    const result = buildPortfolioReview(
      baseInput({ objectives: [concentration, buyingPower, idleCash, income, unrelated] }),
    );

    expect(result.currentState.concentrationConcerns).toEqual([concentration]);
    expect(result.currentState.capitalConcerns).toEqual(expect.arrayContaining([buyingPower, idleCash]));
    expect(result.currentState.capitalConcerns).toHaveLength(2);
    expect(result.currentState.incomeConcern).toBe(income);
  });

  it('returns null incomeConcern when no INCREASE_INCOME objective is present', () => {
    const result = buildPortfolioReview(baseInput({ objectives: [makeObjective({ type: 'MANAGE_POSITION' })] }));
    expect(result.currentState.incomeConcern).toBeNull();
  });

  it('counts positions by their existing raw strategy label', () => {
    const positions = [
      makePosition({ strategy: 'BPS' }),
      makePosition({ strategy: 'BPS' }),
      makePosition({ strategy: 'CSP' }),
    ];
    const result = buildPortfolioReview(baseInput({ positions }));

    expect(result.composition.positionCount).toBe(3);
    expect(result.composition.byStrategy).toEqual({ BPS: 2, CSP: 1 });
  });

  it('derives symbol concentration via the existing helper, keyed by net liquidity', () => {
    const positions = [
      makePosition({ symbol: 'AAPL', maxRisk: 20_000 }),
      makePosition({ symbol: 'TSLA', maxRisk: 5_000 }),
    ];
    const result = buildPortfolioReview(baseInput({ positions, netLiquidity: 100_000 }));

    expect(result.composition.symbolConcentrationPct.AAPL).toBeCloseTo(20);
    expect(result.composition.symbolConcentrationPct.TSLA).toBeCloseTo(5);
    expect(result.composition.maxSymbolConcentrationPct).toBeCloseTo(20);
  });

  it('returns empty concentration data (never a fabricated value) when net liquidity is unavailable', () => {
    const positions = [makePosition({ symbol: 'AAPL', maxRisk: 20_000 })];
    const result = buildPortfolioReview(baseInput({ positions, netLiquidity: null }));

    expect(result.composition.symbolConcentrationPct).toEqual({});
    expect(result.composition.maxSymbolConcentrationPct).toBeNull();
  });

  it('computes a Wheel-managed fraction using the existing WHEEL + PREFER classification', () => {
    const positions = [
      makePosition({ symbol: 'AAPL', maxRisk: 6_000, positionStrategy: 'WHEEL', assignmentPreference: 'PREFER' }),
      makePosition({ symbol: 'TSLA', maxRisk: 4_000, positionStrategy: 'INCOME', assignmentPreference: 'AVOID' }),
    ];
    const result = buildPortfolioReview(baseInput({ positions }));

    // 6000 wheel-managed of 10000 total = 60%.
    expect(result.composition.wheelManagedFraction).toBeCloseTo(0.6);
  });

  it('returns null Wheel-managed fraction (never 0) when there is no exposure at all', () => {
    const positions = [makePosition({ maxRisk: 0 }), makePosition({ maxRisk: null })];
    const result = buildPortfolioReview(baseInput({ positions }));

    expect(result.composition.wheelManagedFraction).toBeNull();
  });

  it('treats missing/non-finite maxRisk as zero exposure rather than throwing or producing NaN', () => {
    const positions = [
      makePosition({ symbol: 'AAPL', maxRisk: null }),
      makePosition({ symbol: 'TSLA', maxRisk: Number.NaN }),
      makePosition({ symbol: 'MSFT', maxRisk: 1_000 }),
    ];
    const result = buildPortfolioReview(baseInput({ positions, netLiquidity: 100_000 }));

    // Non-finite maxRisk is treated as zero exposure (derivePositionConcentration's
    // own documented behavior), not omitted and not NaN -- AAPL/TSLA appear
    // at a real 0%, never a fabricated non-zero value.
    expect(result.composition.symbolConcentrationPct.AAPL).toBe(0);
    expect(result.composition.symbolConcentrationPct.TSLA).toBe(0);
    expect(result.composition.symbolConcentrationPct.MSFT).toBeCloseTo(1);
    expect(Number.isFinite(result.composition.maxSymbolConcentrationPct)).toBe(true);
  });

  it('does not recompute Portfolio Health -- the same score/status/contributors flow through unchanged regardless of positions/objectives passed', () => {
    const health = makeHealth({ score: 44, status: 'Action Required', negativeContributors: [{ id: 'x', label: 'y' }] });
    const result = buildPortfolioReview(
      baseInput({
        health,
        positions: [makePosition()],
        objectives: [makeObjective({ type: 'REDUCE_CONCENTRATION' })],
      }),
    );

    expect(result.currentState.health).toEqual(health);
  });

  it('stamps generatedAt as an ISO timestamp from the provided clock', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const result = buildPortfolioReview(baseInput(), now);
    expect(result.generatedAt).toBe('2026-07-16T12:00:00.000Z');
  });
});
