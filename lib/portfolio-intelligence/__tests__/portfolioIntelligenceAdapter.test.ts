// lib/portfolio-intelligence/__tests__/portfolioIntelligenceAdapter.test.ts
//
// PI-0003 integration tests: the combining adapter (objective 4), the
// portfolio evaluator's first real production wiring, and the Daily
// Priority List shim (TE-0006C consolidation, objective 3) consuming the
// same canonical engine. Also covers pending-order objectives flowing
// through the combined path, and safety across the full combined list.

import { describe, expect, it } from 'vitest';
import { buildPortfolioIntelligenceContext, computeCanonicalPortfolioPriorities } from '@/lib/portfolio-intelligence';
import { buildDailyPriorities } from '../../../features/portfolio/priorities/priority-engine';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-12T13:00:00.000Z');

describe('PI-0003: buildPortfolioIntelligenceContext', () => {
  it('builds a valid context from a financial snapshot and raw pending orders', () => {
    const context = buildPortfolioIntelligenceContext(
      { netLiquidity: 100000, cashBalance: 20000, availableBuyingPower: 30000 },
      [],
      [{ id: 'order_1', symbol: 'AMD', strategy: 'OPEN_BPS', createdAt: '2026-07-12T10:00:00.000Z', status: 'working' }],
      NOW,
    );
    expect(context.portfolio.netLiquidity).toBe(100000);
    expect(context.positions).toEqual([]);
    expect(context.pendingOrders).toHaveLength(1);
    expect(context.pendingOrders[0].ageMinutes).toBe(180); // 3 hours
  });

  it('unavailable financial data safely defaults to inert zero at the PortfolioStateInput boundary (never fabricates a trigger)', () => {
    const context = buildPortfolioIntelligenceContext({}, [], [], NOW);
    expect(context.portfolio.netLiquidity).toBe(0);
    expect(context.portfolio.idleCashPct).toBe(0);
    expect(context.portfolio.buyingPowerUtilizationPct).toBe(0);
    expect(context.portfolio.symbolConcentrationPct).toEqual({});
  });

  it('flags a pending order as review_required when its raw status mentions stale/review', () => {
    const context = buildPortfolioIntelligenceContext(
      {},
      [],
      [{ id: 'order_1', symbol: 'AMD', strategy: 'OPEN_BPS', createdAt: NOW.toISOString(), status: 'Stale - needs review' }],
      NOW,
    );
    expect(context.pendingOrders[0].status).toBe('review_required');
    expect(context.pendingOrders[0].staleOrReviewRequired).toBe(true);
  });
});

describe('PI-0003: computeCanonicalPortfolioPriorities (portfolio evaluator integration)', () => {
  it('combines position, portfolio-level, and pending-order objectives into one ranked list', () => {
    const result = computeCanonicalPortfolioPriorities(
      [
        { positionId: 'pos_1', symbol: 'AMD', strategy: 'BPS', dte: 25, pnlPct: 55, buffer: 8, hasGtc: true }, // close-winner
      ],
      { netLiquidity: 100000, cashBalance: 25000, availableBuyingPower: 70000 }, // 25% idle cash -> triggers DEPLOY_IDLE_CASH
      [{ symbol: 'AMD', maxRisk: 1000 }],
      [{ id: 'order_1', symbol: 'NVDA', strategy: 'OPEN_BPS', createdAt: new Date(NOW.getTime() - 300 * 60_000).toISOString(), status: 'working' }], // stale
      NOW,
    );

    expect(result.positionObjectiveCount).toBe(1);
    expect(result.portfolioObjectiveCount).toBe(1);
    expect(result.pendingOrderObjectiveCount).toBe(1);
    expect(result.objectives.length).toBe(3);

    const types = result.objectives.map((o) => o.type);
    expect(types).toContain('CLOSE_FOR_PROFIT');
    expect(types).toContain('DEPLOY_IDLE_CASH');
    expect(types).toContain('REVIEW_PENDING_ORDER');
  });

  it('does not duplicate position-level objectives (portfolio-level position rules are suppressed via empty positions[])', () => {
    // A single input position that would trigger both the position-level
    // evaluator (close-winner) AND, if positions[] weren't empty, the
    // portfolio-level batch evaluator's own close-for-profit rule too.
    // Only one CLOSE_FOR_PROFIT objective should result.
    const result = computeCanonicalPortfolioPriorities(
      [{ positionId: 'pos_1', symbol: 'AMD', strategy: 'BPS', dte: 25, pnlPct: 55, buffer: 8, hasGtc: true }],
      {},
      [],
      [],
      NOW,
    );
    const profitObjectives = result.objectives.filter((o) => o.type === 'CLOSE_FOR_PROFIT');
    expect(profitObjectives).toHaveLength(1);
  });

  it('a critical threatened position outranks a simultaneous idle-cash deployment opportunity in the combined list', () => {
    const result = computeCanonicalPortfolioPriorities(
      [{ positionId: 'pos_threatened', symbol: 'NVDA', strategy: 'CSP', dte: 5, buffer: 1.5, pnlPct: 10, hasGtc: true }], // assignment-risk, critical
      { netLiquidity: 100000, cashBalance: 30000, availableBuyingPower: 70000 }, // 30% idle cash -> triggers DEPLOY_IDLE_CASH
      [],
      [],
      NOW,
    );
    expect(result.objectives[0].type).toBe('REVIEW_THREATENED_POSITION');
    expect(result.objectives[0].priority).toBe('critical');
    const deployIndex = result.objectives.findIndex((o) => o.type === 'DEPLOY_IDLE_CASH');
    expect(deployIndex).toBeGreaterThan(0);
  });

  it('returns a single WAIT objective when nothing qualifies across all three sources', () => {
    const result = computeCanonicalPortfolioPriorities([], {}, [], [], NOW);
    expect(result.objectives).toHaveLength(1);
    expect(result.objectives[0].type).toBe('WAIT');
  });

  it('every objective in the combined list has both execution flags false', () => {
    const result = computeCanonicalPortfolioPriorities(
      [
        { positionId: 'pos_1', symbol: 'AMD', strategy: 'BPS', dte: 25, pnlPct: 55, buffer: 8, hasGtc: true },
        { positionId: 'pos_2', symbol: 'NVDA', strategy: 'CSP', dte: 5, buffer: 1.5, pnlPct: 10, hasGtc: true },
      ],
      { netLiquidity: 100000, cashBalance: 25000, availableBuyingPower: 70000 },
      [{ symbol: 'AMD', maxRisk: 1000 }, { symbol: 'NVDA', maxRisk: 5000 }],
      [{ id: 'order_1', symbol: 'MU', strategy: 'OPEN_BPS', createdAt: new Date(NOW.getTime() - 300 * 60_000).toISOString(), status: 'working' }],
      NOW,
    );
    expect(result.objectives.length).toBeGreaterThan(1);
    for (const objective of result.objectives) {
      expect(objective.metadata.executionAllowed).toBe(false);
      expect(objective.metadata.paperExecutionAllowed).toBe(false);
    }
  });
});

describe('PI-0003: Daily Priority List integration (TE-0006C consolidation)', () => {
  it('buildDailyPriorities ranks positions using the canonical prioritizer, ordering critical above medium', () => {
    const threatenedInput = { positionId: 'pos_1', key: 'pos_1', symbol: 'NVDA', strategy: 'CSP', dte: 5, buffer: 1.5, pnlPct: 10, hasGtc: true };
    const watchInput = {
      positionId: 'pos_2', key: 'pos_2', symbol: 'AMD', strategy: 'BPS', dte: 30, pnlPct: 5, buffer: 8, hasGtc: true,
      healthScore: { positionId: 'pos_2', symbol: 'AMD', score: 65, grade: 'watch' as const, summary: '', factors: [], computedAt: NOW.toISOString() },
    };

    const threatenedResult = evaluatePositionObjective(threatenedInput, NOW);
    const watchResult = evaluatePositionObjective(watchInput, NOW);

    const priorities = buildDailyPriorities([
      { key: 'pos_2', symbol: 'AMD', dte: 30, pnlPct: 5, healthScore: watchInput.healthScore, recommendation: watchResult.legacyRecommendation, objective: watchResult.objective },
      { key: 'pos_1', symbol: 'NVDA', dte: 5, pnlPct: 10, recommendation: threatenedResult.legacyRecommendation, objective: threatenedResult.objective },
    ]);

    expect(priorities).toHaveLength(2);
    expect(priorities[0].positionId).toBe('pos_1'); // threatened (critical) ranks first
    expect(priorities[0].rank).toBe(1);
    expect(priorities[1].positionId).toBe('pos_2');
  });

  it('excludes positions with no canonical objective (e.g. a clean "hold" position) from the ranked list', () => {
    const holdInput = {
      positionId: 'pos_hold', key: 'pos_hold', symbol: 'MU', strategy: 'BPS', dte: 30, pnlPct: 10, buffer: 8, hasGtc: true,
      healthScore: { positionId: 'pos_hold', symbol: 'MU', score: 85, grade: 'excellent' as const, summary: '', factors: [], computedAt: NOW.toISOString() },
    };
    const holdResult = evaluatePositionObjective(holdInput, NOW);
    expect(holdResult.objective).toBeNull();

    const priorities = buildDailyPriorities([
      { key: 'pos_hold', symbol: 'MU', dte: 30, pnlPct: 10, recommendation: holdResult.legacyRecommendation, objective: holdResult.objective },
    ]);
    expect(priorities).toHaveLength(0);
  });

  it('is deterministic across repeated calls', () => {
    const input = { positionId: 'pos_1', key: 'pos_1', symbol: 'AMD', strategy: 'BPS', dte: 18, pnlPct: 10, buffer: 8, hasGtc: true };
    const result = evaluatePositionObjective(input, NOW);
    const positions = [{ key: 'pos_1', symbol: 'AMD', dte: 18, pnlPct: 10, recommendation: result.legacyRecommendation, objective: result.objective }];

    const run1 = buildDailyPriorities(positions).map((p) => p.positionId);
    const run2 = buildDailyPriorities(positions).map((p) => p.positionId);
    expect(run1).toEqual(run2);
  });
});
