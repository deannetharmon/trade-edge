// lib/portfolio-intelligence/__tests__/evaluatePortfolioObjectives.test.ts
//
// PI-0001 validation: PI-001 through PI-010 deterministic scenarios plus
// safety checks (execution flags false, no mutation, no execution code
// path). evaluatePortfolioObjectives() is a pure function -- these tests
// need no mocks, no Redis, no network.

import { describe, expect, it } from 'vitest';
import { evaluatePortfolioObjectives } from '@/lib/portfolio-intelligence';
import {
  makeContext,
  makeMarketContext,
  makePendingOrder,
  makePortfolioState,
  makePosition,
  makeThresholds,
} from '../../../test/fixtures/portfolioIntelligenceFixtures';

// ---------------------------------------------------------------------------
// PI-001 -- Close profitable position
// ---------------------------------------------------------------------------
describe('PI-001: close profitable position', () => {
  it('recommends CLOSE_FOR_PROFIT at or above the profit-target threshold, high priority, urgency today', () => {
    const context = makeContext({
      positions: [makePosition({ pctOfMaxProfitCaptured: 55, dte: 30, earningsWithinExpiration: false })],
    });
    const [objective] = evaluatePortfolioObjectives(context);

    expect(objective.type).toBe('CLOSE_FOR_PROFIT');
    expect(objective.priority).toBe('high');
    expect(objective.urgency).toBe('today');
    expect(objective.supportingEvidence.some((e) => e.id === 'profit-captured')).toBe(true);
    expect(objective.metadata.executionAllowed).toBe(false);
    expect(objective.metadata.paperExecutionAllowed).toBe(false);
  });

  it('escalates to critical priority when earnings fall inside the expiration window', () => {
    const context = makeContext({
      positions: [makePosition({ pctOfMaxProfitCaptured: 55, dte: 30, earningsWithinExpiration: true })],
    });
    const [objective] = evaluatePortfolioObjectives(context);

    expect(objective.type).toBe('CLOSE_FOR_PROFIT');
    expect(objective.priority).toBe('critical');
    expect(objective.urgency).toBe('now');
  });

  it('does not trigger below the profit-target threshold', () => {
    const context = makeContext({
      positions: [makePosition({ pctOfMaxProfitCaptured: 30 })],
    });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'CLOSE_FOR_PROFIT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-002 -- 21 DTE management
// ---------------------------------------------------------------------------
describe('PI-002: 21 DTE management', () => {
  it('recommends MANAGE_POSITION at the DTE review threshold with an explicit DTE rationale and review trigger', () => {
    const context = makeContext({
      positions: [makePosition({ strategy: 'BPS', dte: 21, assignmentIntent: 'neutral', pctOfMaxProfitCaptured: 30 })],
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'MANAGE_POSITION' || o.type === 'ROLL_POSITION');

    expect(objective).toBeDefined();
    expect(objective!.rationale).toContain('21 DTE');
    expect(objective!.reviewTriggers.some((t) => t.triggerType === 'dte')).toBe(true);
    expect(objective!.metadata.executionAllowed).toBe(false);
    expect(objective!.metadata.paperExecutionAllowed).toBe(false);
  });

  it('recommends ROLL_POSITION when the position is explicitly flagged for roll review', () => {
    const context = makeContext({
      positions: [makePosition({ strategy: 'BCS', dte: 18, managementFlags: ['roll_review'], pctOfMaxProfitCaptured: 20 })],
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'ROLL_POSITION');
    expect(objective).toBeDefined();
    expect(objective!.metadata.executionAllowed).toBe(false);
  });

  it('does not trigger for a position well outside the DTE threshold', () => {
    const context = makeContext({ positions: [makePosition({ dte: 40, pctOfMaxProfitCaptured: 20 })] });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'MANAGE_POSITION' || o.type === 'ROLL_POSITION')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-003 -- Assignment-aware CSP
// ---------------------------------------------------------------------------
describe('PI-003: assignment-aware CSP', () => {
  it('does not force a close for a willing-to-own CSP at 21 DTE; explains assignment intent instead', () => {
    const context = makeContext({
      positions: [
        makePosition({
          strategy: 'CSP',
          dte: 18,
          assignmentIntent: 'willing',
          openPlPct: 10,
          pctOfMaxProfitCaptured: 30,
          earningsWithinExpiration: false,
          managementFlags: [],
        }),
      ],
    });
    const objectives = evaluatePortfolioObjectives(context);
    const objective = objectives.find((o) => o.subject.type === 'position');

    expect(objective).toBeDefined();
    expect(objective!.type).toBe('MANAGE_POSITION');
    expect(objective!.priority).toBe('low');
    expect(objective!.urgency).toBe('monitor');
    expect(objective!.rationale.toLowerCase()).toContain('assignment');
    // Not force-closed: no CLOSE_FOR_PROFIT or high/critical REVIEW_THREATENED_POSITION generated for this position.
    expect(objectives.some((o) => o.type === 'REVIEW_THREATENED_POSITION')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-004 -- Threatened position outranks income opportunity
// ---------------------------------------------------------------------------
describe('PI-004: threatened position outranks new-income opportunity', () => {
  it('ranks the threatened position first even with a high-quality deploy-cash opportunity available', () => {
    const context = makeContext({
      positions: [
        makePosition({ id: 'threatened_1', symbol: 'NVDA', openPlPct: -250, managementFlags: [] }), // material loss: -250 <= -200
      ],
      portfolio: makePortfolioState({
        idleCashPct: 30, // well above threshold, would normally trigger DEPLOY_IDLE_CASH
        buyingPowerUtilizationPct: 30,
        currentDrawdownPct: 1,
      }),
    });
    const ranked = evaluatePortfolioObjectives(context);

    expect(ranked[0].type).toBe('REVIEW_THREATENED_POSITION');
    expect(ranked[0].priority).toBe('critical');

    const deployIndex = ranked.findIndex((o) => o.type === 'DEPLOY_IDLE_CASH');
    expect(deployIndex).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PI-005 -- Deploy idle cash
// ---------------------------------------------------------------------------
describe('PI-005: deploy idle cash', () => {
  it('recommends DEPLOY_IDLE_CASH when idle cash is high and risk/BP conditions permit, without inventing a trade', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ idleCashPct: 25, buyingPowerUtilizationPct: 35, currentDrawdownPct: 1 }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'DEPLOY_IDLE_CASH');

    expect(objective).toBeDefined();
    expect(['medium', 'high']).toContain(objective!.priority);
    expect(objective!.rationale.toLowerCase()).toContain('candidate');
    expect(objective!.linkedDecisionAnalysis).toBeUndefined();
    expect(objective!.metadata.executionAllowed).toBe(false);
  });

  it('does not trigger when buying-power utilization is already at or above the configured limit', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ idleCashPct: 25, buyingPowerUtilizationPct: 70, currentDrawdownPct: 1 }),
    });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'DEPLOY_IDLE_CASH')).toBe(false);
  });

  it('does not trigger during a defensive drawdown', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ idleCashPct: 25, buyingPowerUtilizationPct: 30, currentDrawdownPct: 10 }),
    });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'DEPLOY_IDLE_CASH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-006 -- Reduce concentration
// ---------------------------------------------------------------------------
describe('PI-006: reduce concentration', () => {
  it('recommends REDUCE_CONCENTRATION with explicit current-vs-allowed percentages when a symbol limit is exceeded', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ symbolConcentrationPct: { NVDA: 18 }, maxSymbolConcentrationPct: 10 }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REDUCE_CONCENTRATION');

    expect(objective).toBeDefined();
    expect(objective!.priority).toBe('high'); // 18 >= 10 * 1.5
    expect(objective!.supportingEvidence.some((e) => String(e.value).includes('18.0%') && String(e.value).includes('10%'))).toBe(true);
  });

  it('recommends REDUCE_CONCENTRATION at medium priority for a modest sector limit breach', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ sectorConcentrationPct: { Technology: 28 }, maxSectorConcentrationPct: 25 }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REDUCE_CONCENTRATION');
    expect(objective).toBeDefined();
    expect(objective!.priority).toBe('medium');
  });

  it('does not trigger when concentration is within configured limits', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ symbolConcentrationPct: { NVDA: 8 }, maxSymbolConcentrationPct: 10 }),
    });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'REDUCE_CONCENTRATION')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-007 -- Preserve buying power
// ---------------------------------------------------------------------------
describe('PI-007: preserve buying power', () => {
  it('recommends PRESERVE_BUYING_POWER when utilization exceeds the configured threshold', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ buyingPowerUtilizationPct: 75, idleCashPct: 20, currentDrawdownPct: 1 }),
    });
    const objectives = evaluatePortfolioObjectives(context);
    const objective = objectives.find((o) => o.type === 'PRESERVE_BUYING_POWER');

    expect(objective).toBeDefined();
    expect(objective!.priority).toBe('high');
    // Blocks new deployment: DEPLOY_IDLE_CASH must not also fire here.
    expect(objectives.some((o) => o.type === 'DEPLOY_IDLE_CASH')).toBe(false);
  });

  it('escalates to critical when the defensive drawdown circuit breaker is reached', () => {
    const context = makeContext({
      portfolio: makePortfolioState({ currentDrawdownPct: 9, buyingPowerUtilizationPct: 40 }),
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'PRESERVE_BUYING_POWER');
    expect(objective).toBeDefined();
    expect(objective!.priority).toBe('critical');
    expect(objective!.urgency).toBe('now');
  });
});

// ---------------------------------------------------------------------------
// PI-008 -- Review pending order
// ---------------------------------------------------------------------------
describe('PI-008: review pending order', () => {
  it('recommends REVIEW_PENDING_ORDER for a stale order, linking the order subject and explaining age/status', () => {
    const context = makeContext({
      pendingOrders: [makePendingOrder({ id: 'order_stale', ageMinutes: 300, status: 'working', staleOrReviewRequired: false })],
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REVIEW_PENDING_ORDER');

    expect(objective).toBeDefined();
    expect(objective!.subject.type).toBe('pending_order');
    expect(objective!.subject.id).toBe('order_stale');
    expect(objective!.rationale).toContain('300 minutes');
    expect(objective!.metadata.executionAllowed).toBe(false);
  });

  it('recommends REVIEW_PENDING_ORDER for a materially off-market order', () => {
    const context = makeContext({
      pendingOrders: [makePendingOrder({ ageMinutes: 5, fillDistancePct: 25, status: 'working' })],
    });
    const objective = evaluatePortfolioObjectives(context).find((o) => o.type === 'REVIEW_PENDING_ORDER');
    expect(objective).toBeDefined();
    expect(objective!.rationale).toContain('25.0%');
  });

  it('does not trigger for a fresh, on-market, unflagged order', () => {
    const context = makeContext({ pendingOrders: [makePendingOrder()] });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'REVIEW_PENDING_ORDER')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PI-009 -- Wait
// ---------------------------------------------------------------------------
describe('PI-009: wait', () => {
  it('returns exactly one WAIT objective at informational priority when nothing needs action', () => {
    const context = makeContext(); // all defaults are within safe ranges, no positions/orders
    const objectives = evaluatePortfolioObjectives(context);

    expect(objectives).toHaveLength(1);
    expect(objectives[0].type).toBe('WAIT');
    expect(objectives[0].priority).toBe('informational');
    expect(objectives[0].urgency).toBe('none');
    expect(objectives[0].rationale.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// PI-010 -- Deterministic ranking
// ---------------------------------------------------------------------------
describe('PI-010: deterministic ranking', () => {
  it('produces identical objective ordering across repeated runs with identical input', () => {
    const context = makeContext({
      positions: [
        makePosition({ id: 'a', symbol: 'AMD', openPlPct: -250 }), // threatened
        makePosition({ id: 'b', symbol: 'NVDA', pctOfMaxProfitCaptured: 60, dte: 30 }), // close for profit
      ],
      pendingOrders: [makePendingOrder({ ageMinutes: 300 })],
      portfolio: makePortfolioState({ idleCashPct: 25, buyingPowerUtilizationPct: 30 }),
    });

    const runs = Array.from({ length: 5 }, () => evaluatePortfolioObjectives(context).map((o) => `${o.type}:${o.subject.symbol ?? o.subject.label}`));
    for (const run of runs.slice(1)) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('does not use random IDs as a ranking input (priority/urgency/type fully determine order)', () => {
    const context = makeContext({
      positions: [makePosition({ id: 'a', pctOfMaxProfitCaptured: 60 }), makePosition({ id: 'b', symbol: 'NVDA', pctOfMaxProfitCaptured: 60 })],
    });
    const run1 = evaluatePortfolioObjectives(context);
    const run2 = evaluatePortfolioObjectives(context);
    // IDs differ (random suffix) but ordering of types/subjects is stable.
    expect(run1.map((o) => o.type)).toEqual(run2.map((o) => o.type));
    expect(run1[0].id).not.toBe(run2[0].id);
  });
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
describe('safety', () => {
  it('every objective across a large mixed scenario has both execution flags false', () => {
    const context = makeContext({
      positions: [
        makePosition({ id: 'a', symbol: 'AMD', openPlPct: -250 }),
        makePosition({ id: 'b', symbol: 'NVDA', pctOfMaxProfitCaptured: 60 }),
        makePosition({ id: 'c', symbol: 'MU', dte: 15, strategy: 'BPS' }),
        makePosition({ id: 'd', symbol: 'MRVL', strategy: 'CSP', assignmentIntent: 'willing', dte: 10 }),
      ],
      pendingOrders: [makePendingOrder({ ageMinutes: 300 }), makePendingOrder({ id: 'order_2', fillDistancePct: 30 })],
      portfolio: makePortfolioState({
        idleCashPct: 25,
        symbolConcentrationPct: { AMD: 15 },
        buyingPowerUtilizationPct: 40,
      }),
    });
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.length).toBeGreaterThan(1);
    for (const objective of objectives) {
      expect(objective.metadata.executionAllowed).toBe(false);
      expect(objective.metadata.paperExecutionAllowed).toBe(false);
    }
  });

  it('is a pure function: calling it twice with the same input produces equivalent objectives (excluding id/createdAt-derived randomness)', () => {
    const context = makeContext({ positions: [makePosition({ pctOfMaxProfitCaptured: 60 })] });
    const [first] = evaluatePortfolioObjectives(context);
    const [second] = evaluatePortfolioObjectives(context);

    const strip = (o: typeof first) => ({ ...o, id: undefined });
    expect(strip(first)).toEqual(strip(second));
  });

  it('does not mutate the input context', () => {
    const context = makeContext({ positions: [makePosition({ pctOfMaxProfitCaptured: 60 })] });
    const snapshot = JSON.parse(JSON.stringify(context));
    evaluatePortfolioObjectives(context);
    expect(context).toEqual(snapshot);
  });
});
