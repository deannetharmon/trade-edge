// lib/portfolio-intelligence/__tests__/managementIntent.test.ts
//
// PI-0006B regression tests:
//   1. Unit tests on selectManagementIntent() itself -- relevant-intent-set
//      filtering, "Roll must earn it" (requirement #5), tie-break ordering,
//      Hold-as-default.
//   2. The ticket's five acceptance scenarios (SOXL BPS, NVDA Wheel CSP, AMD
//      Earnings, Profit Target, Material Loss), exercised through the real
//      producers (evaluatePositionObjective / evaluatePortfolioObjectives) so
//      these tests fail if the wiring -- not just the selector in isolation --
//      ever regresses.

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective, evaluatePortfolioObjectives } from '@/lib/portfolio-intelligence';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';
import { selectManagementIntent } from '../managementIntent';
import {
  makeContext,
  makePosition,
} from '../../../test/fixtures/portfolioIntelligenceFixtures';

const NOW = new Date('2026-07-13T13:00:00.000Z');

function baseInput(overrides: Partial<PositionObjectiveInput> = {}): PositionObjectiveInput {
  return {
    positionId: 'pos_1',
    symbol: 'TEST',
    strategy: 'BPS',
    dte: 30,
    pnlPct: 10,
    buffer: 8,
    hasGtc: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests on the selector itself
// ---------------------------------------------------------------------------

describe('selectManagementIntent: relevant intent set (ticket #2)', () => {
  it('idle-cash context never surfaces Cut Losses/Take Profit even with unrelated evidence present', () => {
    const result = selectManagementIntent({
      context: 'idle-cash',
      idleCashDeployable: true,
      materialLoss: true, // nonsensical for this context -- must be ignored
      profitTargetReached: true, // ditto
    });
    expect(result.intent).toBe('DEPLOY_IDLE_CASH');
    expect(result.alternatives.every((a) => a.intent === 'HOLD_POSITION')).toBe(true);
  });

  it('pending-order context only ever considers Replace Working Order / Hold Position', () => {
    const result = selectManagementIntent({ context: 'pending-order', orderNeedsReplacement: true });
    expect(result.intent).toBe('REPLACE_WORKING_ORDER');
    expect(result.alternatives.map((a) => a.intent)).toEqual(['HOLD_POSITION']);
  });
});

describe('selectManagementIntent: Roll must earn the recommendation (ticket #5)', () => {
  it('DTE alone never selects Roll Position -- Hold wins with no other evidence', () => {
    const result = selectManagementIntent({ context: 'credit-spread', dte: 17 });
    expect(result.intent).toBe('HOLD_POSITION');
    expect(result.alternatives.some((a) => a.intent === 'ROLL_POSITION')).toBe(true);
  });

  it('Roll wins only when explicit roll-specific evidence (rollFlagged) is present', () => {
    const result = selectManagementIntent({ context: 'credit-spread', dte: 17, rollFlagged: true });
    expect(result.intent).toBe('ROLL_POSITION');
    expect(result.reasons[0]).toMatch(/flagged for roll review/i);
  });
});

describe('selectManagementIntent: strategy awareness (ticket #7)', () => {
  it('Wheel CSP with assignment preferred does not default to Cut Losses from buffer pressure alone', () => {
    const result = selectManagementIntent({
      context: 'wheel-csp',
      assignmentPreference: 'PREFER',
      itmOrCriticalBuffer: true,
    });
    expect(result.intent).toBe('ACCEPT_ASSIGNMENT');
  });

  it('a hard loss-policy breach still overrides assignment preference (hard-risk exception)', () => {
    const result = selectManagementIntent({
      context: 'wheel-csp',
      assignmentPreference: 'PREFER',
      materialLoss: true,
    });
    expect(result.intent).toBe('CUT_LOSSES');
  });
});

// ---------------------------------------------------------------------------
// Acceptance scenario: SOXL BPS
// ---------------------------------------------------------------------------

describe('Acceptance: SOXL BPS (~17 DTE, net-edge decline, weak technical, moderate loss, no roll evidence)', () => {
  it('does not let Roll win from DTE, and resolves to Hold/Cut Losses/Reduce Risk with concise reasons', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        symbol: 'SOXL',
        dte: 17,
        pnlPct: -20, // small/moderate unrealized loss -- not a policy breach
        netEdgeDeclinePct: -40, // large decline from peak
        technicalAlignment: 'against', // weak recent technical context
      }),
      NOW,
    );

    expect(['HOLD_POSITION', 'CUT_LOSSES', 'REDUCE_RISK']).toContain(legacyRecommendation.managementIntent!.intent);
    expect(legacyRecommendation.managementIntent!.intent).not.toBe('ROLL_POSITION');
    expect(legacyRecommendation.managementIntent!.reasons.length).toBeGreaterThan(0);
    expect(objective!.managementIntent!.intent).toBe(legacyRecommendation.managementIntent!.intent);
  });

  it('with only DTE (no net-edge/technical/loss evidence), Roll is never the winner', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'SOXL', dte: 17, pnlPct: 5 }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).not.toBe('ROLL_POSITION');
  });
});

// ---------------------------------------------------------------------------
// Acceptance scenario: NVDA Wheel CSP
// ---------------------------------------------------------------------------

describe('Acceptance: NVDA Wheel CSP (strategy=Wheel, assignment preferred, concentration elevated)', () => {
  it('resolves to Accept Assignment (or Hold), not an abandon-the-Wheel recommendation', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'NVDA',
        strategy: 'CSP',
        positionStrategy: 'WHEEL',
        assignmentPreference: 'PREFER',
        dte: 25,
        pnlPct: 8,
      }),
      NOW,
    );
    expect(['ACCEPT_ASSIGNMENT', 'HOLD_POSITION']).toContain(legacyRecommendation.managementIntent!.intent);
  });

  it('still resolves to Cut Losses if a hard loss-policy breach is also present', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'NVDA',
        strategy: 'CSP',
        positionStrategy: 'WHEEL',
        assignmentPreference: 'PREFER',
        dte: 25,
        pnlPct: -110, // beyond the -100% loss-stop policy
      }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('CUT_LOSSES');
  });

  it('portfolio-level concentration awareness for Wheel-managed exposure is preserved (evaluateConcentration untouched)', () => {
    const context = makeContext({
      portfolio: {
        ...makeContext().portfolio,
        symbolConcentrationPct: { NVDA: 12 },
        symbolWheelDominance: { NVDA: 0.8 },
      },
    });
    const objectives = evaluatePortfolioObjectives(context);
    const concentration = objectives.find((o) => o.type === 'REDUCE_CONCENTRATION' && o.subject.symbol === 'NVDA');
    expect(concentration).toBeDefined();
    expect(concentration!.rationale).toMatch(/does not recommend reducing or abandoning/i);
    expect(concentration!.rationale).not.toMatch(/consider trimming/i);
  });
});

// ---------------------------------------------------------------------------
// Acceptance scenario: AMD Earnings
// ---------------------------------------------------------------------------

describe('Acceptance: AMD Earnings review window', () => {
  it('outside the review window: no earnings-driven intent boost, defaults to Hold with no generic label', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        symbol: 'AMD',
        dte: 30,
        pnlPct: 8,
        earningsDate: '2026-08-10', // 28 days out, > 10-day review window
        expDate: '2026-08-21',
      }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('HOLD_POSITION');
    expect(legacyRecommendation.managementIntent!.reasons.join(' ')).not.toMatch(/earnings/i);
    // Still surfaced (existing PI-0004B behavior), just not actionable yet.
    expect(objective!.actionability).toBe('MONITOR');
  });

  it('inside the review window with supporting evidence: a concrete intent, not a generic "Review Earnings Plan"', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        symbol: 'AMD',
        dte: 30,
        pnlPct: -20,
        buffer: 1.5, // tight buffer -- concrete de-risking evidence
        earningsDate: '2026-07-18', // 5 days out, inside the 10-day window
        expDate: '2026-08-21',
      }),
      NOW,
    );
    expect(legacyRecommendation.label).not.toBe('Review Earnings Plan');
    expect(['REDUCE_RISK', 'HOLD_POSITION', 'CUT_LOSSES']).toContain(legacyRecommendation.managementIntent!.intent);
    expect(legacyRecommendation.managementIntent!.reasons.join(' ')).toMatch(/earnings/i);
    expect(objective!.actionability).not.toBe('MONITOR');
  });
});

// ---------------------------------------------------------------------------
// Acceptance scenario: Profit Target
// ---------------------------------------------------------------------------

describe('Acceptance: Profit Target', () => {
  it('Take Profit wins in evaluatePositionObjective when the profit-target rule is satisfied', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'PLTR', hitTarget: true, pnlPct: 55, dte: 25 }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('TAKE_PROFIT');
    expect(legacyRecommendation.label).toBe('Take Profit');
  });

  it('Take Profit wins in evaluatePortfolioObjectives when pctOfMaxProfitCaptured clears the threshold', () => {
    const context = makeContext({ positions: [makePosition({ pctOfMaxProfitCaptured: 60 })] });
    const [objective] = evaluatePortfolioObjectives(context);
    expect(objective.type).toBe('CLOSE_FOR_PROFIT');
    expect(objective.managementIntent!.intent).toBe('TAKE_PROFIT');
    expect(objective.title).toMatch(/^Take Profit:/);
  });
});

// ---------------------------------------------------------------------------
// Acceptance scenario: Material Loss
// ---------------------------------------------------------------------------

describe('Acceptance: Material Loss', () => {
  it('Cut Losses wins in evaluatePositionObjective when the loss-stop policy is breached', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'SOFI', pnlPct: -110 }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('CUT_LOSSES');
    expect(legacyRecommendation.label).toBe('Cut Losses');
  });

  it('Cut Losses wins in evaluatePortfolioObjectives when openPlPct breaches materialLossPct', () => {
    const context = makeContext({
      positions: [makePosition({ openPlPct: -210, dte: 30 })],
    });
    const objectives = evaluatePortfolioObjectives(context);
    const threatened = objectives.find((o) => o.type === 'REVIEW_THREATENED_POSITION');
    expect(threatened).toBeDefined();
    expect(threatened!.managementIntent!.intent).toBe('CUT_LOSSES');
    expect(threatened!.title).toMatch(/^Cut Losses:/);
  });
});
