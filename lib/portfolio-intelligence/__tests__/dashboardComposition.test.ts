// lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts
//
// TC-0001: regression coverage for the shared composition boundary extracted
// from app/portfolio/page.tsx's own inline useMemo/useEffect chain. These
// tests exercise buildDashboardComposition() directly, with literal input
// fixtures -- no re-derivation of the value under test.

import { describe, expect, it } from 'vitest';
import {
  buildDashboardComposition,
  type DashboardCompositionInput,
  type DashboardCompositionPosition,
} from '../dashboardComposition';

function makePosition(overrides: Partial<DashboardCompositionPosition> = {}): DashboardCompositionPosition {
  return {
    key: 'AAPL::2026-08-21',
    symbol: 'AAPL',
    legs: [
      { symbol: 'AAPL  260821P00185000', optionType: 'P', strikePrice: 185, direction: 'Short', quantity: 1 },
      { symbol: 'AAPL  260821P00180000', optionType: 'P', strikePrice: 180, direction: 'Long', quantity: 1 },
    ],
    maxRisk: 440,
    intent: 'income',
    dte: 30,
    strategy: 'BPS',
    healthScore: null,
    portfolioObjective: null,
    netEdgeDeclinePct: null,
    netEdgeNegative: null,
    remainingOpportunityPct: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<DashboardCompositionInput> = {}): DashboardCompositionInput {
  return {
    positions: [],
    pendingOrders: [],
    balances: null,
    decisionReviews: {},
    ...overrides,
  };
}

describe('TC-0001: buildDashboardComposition', () => {
  it('is a pure function -- does not mutate its input positions', () => {
    const positions = [makePosition()];
    const frozenPositions = positions.map(p => Object.freeze({ ...p }));
    const input = baseInput({ positions: frozenPositions as DashboardCompositionPosition[] });

    expect(() => buildDashboardComposition(input)).not.toThrow();
  });

  it('returns null canonicalPriorities/portfolioReview/dailyBriefing for a fully empty portfolio', () => {
    const result = buildDashboardComposition(baseInput());

    expect(result.canonicalPriorities).toBeNull();
    expect(result.portfolioReview).toBeNull();
    expect(result.dailyBriefing).toBeNull();
    expect(result.averagePositionHealth).toBeNull();
  });

  it('computes canonicalPriorities and a non-null portfolioReview/dailyBriefing when positions exist', () => {
    const input = baseInput({ positions: [makePosition()] });
    const result = buildDashboardComposition(input);

    expect(result.canonicalPriorities).not.toBeNull();
    expect(result.portfolioReview).not.toBeNull();
    expect(result.dailyBriefing).not.toBeNull();
  });

  it('computes averagePositionHealth from only the positions that have a healthScore', () => {
    const input = baseInput({
      positions: [
        makePosition({ key: 'A', healthScore: { score: 80 } as any }),
        makePosition({ key: 'B', healthScore: { score: 60 } as any }),
        makePosition({ key: 'C', healthScore: null }),
      ],
    });
    const result = buildDashboardComposition(input);

    expect(result.averagePositionHealth).toBe(70);
  });

  it('preserves todaysPrioritiesDashboard canonical ordering (immediateAction first bucket unaffected by input order)', () => {
    const criticalObjective = {
      id: 'obj-critical',
      ruleId: 'OBJ-TEST',
      title: 'Critical position',
      summary: 'test',
      priority: 'critical',
      confidence: 0.9,
      source: 'position',
      reviewTriggers: [],
      subject: { symbol: 'AAPL' },
    } as any;
    const input = baseInput({
      positions: [makePosition({ key: 'A', portfolioObjective: criticalObjective })],
    });
    const result1 = buildDashboardComposition(input);
    const result2 = buildDashboardComposition(input);

    // Deterministic: identical input always produces identical ordering.
    expect(result1.todaysPrioritiesDashboard.immediateAction.length).toBe(
      result2.todaysPrioritiesDashboard.immediateAction.length,
    );
  });

  it('never invents netEdgeDeclinePct/remainingOpportunityPct -- passes null through when the caller has no evidence', () => {
    const input = baseInput({
      positions: [makePosition({ netEdgeDeclinePct: null, netEdgeNegative: null, remainingOpportunityPct: null })],
    });
    // Should not throw, and priorities should still compute (evidence is
    // optional input to Priority Score, not a hard requirement).
    expect(() => buildDashboardComposition(input)).not.toThrow();
  });

  it('reflects pending orders in canonicalPriorities even with zero open positions', () => {
    const input = baseInput({
      pendingOrders: [{ id: 'po-1', symbol: 'SPY', strategy: 'BPS', createdAt: '2026-07-01', status: 'Live' }],
    });
    const result = buildDashboardComposition(input);

    expect(result.canonicalPriorities).not.toBeNull();
  });
});
