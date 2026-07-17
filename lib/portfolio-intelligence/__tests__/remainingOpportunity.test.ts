// lib/portfolio-intelligence/__tests__/remainingOpportunity.test.ts
//
// PI-0008A: Remaining Opportunity Engine regression tests. Every scenario
// below hand-verifies calculateRemainingOpportunity()'s deterministic
// arithmetic against the exact factors documented in remainingOpportunity.ts
// (time/health/buffer/loss-drag factors multiply together, net-edge and
// earnings are flat haircuts on top). This module is independent of the
// recommendation/scoring engine -- none of these tests touch
// selectManagementIntent() or evaluatePositionObjective()'s trigger logic.

import { describe, expect, it } from 'vitest';
import { calculateRemainingOpportunity } from '@/lib/portfolio-intelligence';
import type { RemainingOpportunityInput } from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-13T13:00:00.000Z');

describe('PI-0008A: Winning spread', () => {
  it('captures pnlPct as-is and discounts the remainder by nothing when every factor is healthy', () => {
    const input: RemainingOpportunityInput = {
      creditReceived: 500,
      pnlPct: 60,
      dte: 30,
      buffer: 10,
      healthScore: 100,
      lifecycleType: 'SPREAD',
    };
    const result = calculateRemainingOpportunity(input, NOW);
    expect(result.opportunityCapturedPct).toBe(60);
    expect(result.remainingOpportunityPct).toBe(40);
    expect(result.reasons).toEqual([]);
  });
});

describe('PI-0008A: Losing spread', () => {
  it('captures 0% and heavily discounts the theoretical remainder via loss-drag and weak health', () => {
    const input: RemainingOpportunityInput = {
      creditReceived: 500,
      pnlPct: -60,
      dte: 30,
      buffer: 8,
      healthScore: 40,
      lifecycleType: 'SPREAD',
    };
    const result = calculateRemainingOpportunity(input, NOW);
    expect(result.opportunityCapturedPct).toBe(0);
    // timeFactor=1, healthFactor=0.4, bufferFactor=1, lossDrag=0.4 -> 100 * 0.16 = 16
    expect(result.remainingOpportunityPct).toBe(16);
    expect(result.reasons.some((r) => r.includes('Health score is 40'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('-60% of credit'))).toBe(true);
  });
});

describe('PI-0008A: Early lifecycle (far from expiration)', () => {
  it('shows high remaining opportunity when time is not yet a constraint', () => {
    const input: RemainingOpportunityInput = {
      creditReceived: 500,
      pnlPct: 10,
      dte: 45,
      buffer: 10,
      healthScore: 90,
      lifecycleType: 'SPREAD',
    };
    const result = calculateRemainingOpportunity(input, NOW);
    expect(result.opportunityCapturedPct).toBe(10);
    // timeFactor clamps to 1 well outside the 21-DTE window; only healthFactor (0.9) discounts. 90 * 0.9 = 81
    expect(result.remainingOpportunityPct).toBe(81);
  });
});

describe('PI-0008A: Late lifecycle (near expiration)', () => {
  it('shows low remaining opportunity even with healthy P/L, once time runs out', () => {
    const input: RemainingOpportunityInput = {
      creditReceived: 500,
      pnlPct: 10,
      dte: 3,
      buffer: 10,
      healthScore: 90,
      lifecycleType: 'SPREAD',
    };
    const result = calculateRemainingOpportunity(input, NOW);
    expect(result.opportunityCapturedPct).toBe(10);
    // timeFactor = 3/21, healthFactor = 0.9 -> 90 * (3/21) * 0.9 = 11.571... -> rounds to 12
    expect(result.remainingOpportunityPct).toBe(12);
    expect(result.reasons.some((r) => r.includes('3 DTE'))).toBe(true);
  });

  it('early lifecycle shows materially more remaining opportunity than late lifecycle, all else equal', () => {
    const base: RemainingOpportunityInput = {
      creditReceived: 500, pnlPct: 10, buffer: 10, healthScore: 90, lifecycleType: 'SPREAD',
    };
    const early = calculateRemainingOpportunity({ ...base, dte: 45 }, NOW);
    const late = calculateRemainingOpportunity({ ...base, dte: 3 }, NOW);
    expect(early.remainingOpportunityPct!).toBeGreaterThan(late.remainingOpportunityPct!);
  });
});

describe('PI-0008A: Wheel CSP', () => {
  it('computes captured/remaining the same way for a CSP lifecycle position', () => {
    const input: RemainingOpportunityInput = {
      creditReceived: 800,
      pnlPct: 30,
      dte: 15,
      buffer: 6,
      healthScore: 75,
      lifecycleType: 'CSP',
    };
    const result = calculateRemainingOpportunity(input, NOW);
    expect(result.opportunityCapturedPct).toBe(30);
    // timeFactor = 15/21, healthFactor = 0.75, bufferFactor clamps to 1 (6/5 > 1)
    // 70 * (15/21) * 0.75 = 37.5 -> rounds to 38
    expect(result.remainingOpportunityPct).toBe(38);
  });

  it('an assigned Wheel CSP (converted to stock) has zero remaining option-based opportunity', () => {
    const result = calculateRemainingOpportunity({
      creditReceived: 800,
      pnlPct: 30,
      dte: 15,
      buffer: 6,
      healthScore: 75,
      lifecycleType: 'ASSIGNED_STOCK',
    }, NOW);
    expect(result.opportunityCapturedPct).toBe(100);
    expect(result.remainingOpportunityPct).toBe(0);
    expect(result.reasons).toEqual(['Position has been assigned; the original option-based opportunity is fully resolved.']);
  });
});

describe('PI-0008A: no credit basis', () => {
  it('returns null/null (not a fabricated percentage) when creditReceived is absent', () => {
    const result = calculateRemainingOpportunity({ pnlPct: 20, dte: 30 }, NOW);
    expect(result.opportunityCapturedPct).toBeNull();
    expect(result.remainingOpportunityPct).toBeNull();
  });

  it('returns null/null when creditReceived is zero or negative', () => {
    const result = calculateRemainingOpportunity({ creditReceived: 0, pnlPct: 20, dte: 30 }, NOW);
    expect(result.opportunityCapturedPct).toBeNull();
    expect(result.remainingOpportunityPct).toBeNull();
  });
});

describe('PI-0008A: net edge and earnings haircuts', () => {
  it('applies the same -25%-decline / negative-net-edge thresholds managementIntent.ts already uses', () => {
    const result = calculateRemainingOpportunity({
      creditReceived: 500, pnlPct: 0, dte: 30, buffer: 10, healthScore: 100,
      netEdgeNegative: true, lifecycleType: 'SPREAD',
    }, NOW);
    // 100 theoretical * 0.85 net-edge haircut = 85
    expect(result.remainingOpportunityPct).toBe(85);
    expect(result.reasons).toContain('Net edge is negative, reducing remaining opportunity.');
  });

  it('applies an earnings-inside-window haircut using the existing review-window convention', () => {
    const result = calculateRemainingOpportunity({
      creditReceived: 500, pnlPct: 0, dte: 30, buffer: 10, healthScore: 100,
      earningsDate: '2026-07-18', expDate: '2026-08-15', lifecycleType: 'SPREAD',
    }, NOW);
    // 5 days out, inside the 10-day review window -> 100 * 0.85 = 85
    expect(result.remainingOpportunityPct).toBe(85);
    expect(result.reasons.some((r) => r.includes('Earnings fall before expiration'))).toBe(true);
  });

  it('does not apply an earnings haircut when earnings fall outside the review window', () => {
    const result = calculateRemainingOpportunity({
      creditReceived: 500, pnlPct: 0, dte: 30, buffer: 10, healthScore: 100,
      earningsDate: '2026-08-10', expDate: '2026-08-15', lifecycleType: 'SPREAD',
    }, NOW);
    expect(result.remainingOpportunityPct).toBe(100);
    expect(result.reasons).toEqual([]);
  });
});

describe('PI-0008A: determinism and bounds', () => {
  it('is a pure function: identical input produces identical output', () => {
    const input: RemainingOpportunityInput = { creditReceived: 500, pnlPct: 25, dte: 18, buffer: 4, healthScore: 60, lifecycleType: 'SPREAD' };
    const a = calculateRemainingOpportunity(input, NOW);
    const b = calculateRemainingOpportunity(input, NOW);
    expect(a).toEqual(b);
  });

  it('never returns a percentage outside [0, 100]', () => {
    const scenarios: RemainingOpportunityInput[] = [
      { creditReceived: 500, pnlPct: 500, dte: 30 }, // absurdly large pnlPct
      { creditReceived: 500, pnlPct: -500, dte: 30 }, // absurdly large loss
      { creditReceived: 500, pnlPct: 10, dte: -5 }, // negative dte (expired)
    ];
    for (const input of scenarios) {
      const result = calculateRemainingOpportunity(input, NOW);
      expect(result.opportunityCapturedPct).toBeGreaterThanOrEqual(0);
      expect(result.opportunityCapturedPct).toBeLessThanOrEqual(100);
      expect(result.remainingOpportunityPct).toBeGreaterThanOrEqual(0);
      expect(result.remainingOpportunityPct).toBeLessThanOrEqual(100);
    }
  });
});
