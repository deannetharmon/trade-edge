// lib/autopilot/scoring/__tests__/confidence.test.ts
//
// Sprint 2 validation, item 5: Decision Confidence. Verifies each of the
// four scored dimensions (liquidity, latency/staleness, macro proximity,
// volatility stability) moves in the correct direction and the correct
// magnitude for known inputs, against calculateDecisionConfidence() directly.

import { describe, expect, it } from 'vitest';
import { calculateDecisionConfidence } from '@/lib/autopilot/scoring/confidence';
import { makeConfidenceLeg } from '../../../../test/fixtures/autopilotFixtures';

const NOW = new Date('2026-07-11T13:00:00.000Z');

describe('liquidity scoring (bid/ask spread vs 20-period average)', () => {
  it('scores full 40 points when spread is at or near the recent average', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ bidAskSpread: 0.05, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() })],
      now: NOW,
    });
    expect(result.liquidityScore).toBe(40);
  });

  it('scores 0 and adds a note when spread is a stress-level multiple of the average', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ bidAskSpread: 0.5, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() })],
      now: NOW,
    });
    expect(result.liquidityScore).toBe(0);
    expect(result.notes.some((n) => n.toLowerCase().includes('liquidity'))).toBe(true);
  });

  it('scores 0 when no legs are supplied', () => {
    const result = calculateDecisionConfidence({ legs: [], now: NOW });
    expect(result.liquidityScore).toBe(0);
    expect(result.notes.some((n) => n.includes('no legs supplied'))).toBe(true);
  });

  it('scores the worst leg in a multi-leg spread, not the average of legs', () => {
    const result = calculateDecisionConfidence({
      legs: [
        makeConfidenceLeg({ bidAskSpread: 0.05, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() }),
        makeConfidenceLeg({ bidAskSpread: 0.5, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() }),
      ],
      now: NOW,
    });
    expect(result.liquidityScore).toBe(0);
  });
});

describe('latency / stale quote scoring', () => {
  it('scores full 20 points for a quote fetched seconds ago', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ quoteTimestamp: new Date(NOW.getTime() - 5_000).toISOString() })],
      now: NOW,
    });
    expect(result.latencyScore).toBe(20);
  });

  it('scores 0 and adds a note for a quote older than 5 minutes', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ quoteTimestamp: new Date(NOW.getTime() - 10 * 60_000).toISOString() })],
      now: NOW,
    });
    expect(result.latencyScore).toBe(0);
    expect(result.notes.some((n) => n.toLowerCase().includes('stalest quote'))).toBe(true);
  });

  it('scores 0 and notes "missing quote timestamps" when no leg has a quoteTimestamp', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ quoteTimestamp: undefined })],
      now: NOW,
    });
    expect(result.latencyScore).toBe(0);
    expect(result.notes.some((n) => n.includes('missing quote timestamps'))).toBe(true);
  });

  it('uses the stalest leg across a multi-leg spread', () => {
    const result = calculateDecisionConfidence({
      legs: [
        makeConfidenceLeg({ quoteTimestamp: new Date(NOW.getTime() - 5_000).toISOString() }),
        makeConfidenceLeg({ quoteTimestamp: new Date(NOW.getTime() - 10 * 60_000).toISOString() }),
      ],
      now: NOW,
    });
    expect(result.latencyScore).toBe(0);
  });
});

describe('macro event proximity scoring', () => {
  it('scores full 20 points when no macro event is scheduled', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      nextMacroEventAt: undefined,
    });
    expect(result.macroProximityScore).toBe(20);
  });

  it('scores 0 and notes a hard-gate breach when the event is inside the gate window', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      nextMacroEventAt: new Date(NOW.getTime() + 6 * 3600_000).toISOString(), // 6h away, default gate 24h
    });
    expect(result.macroProximityScore).toBe(0);
    expect(result.notes.some((n) => n.toLowerCase().includes('hard gate'))).toBe(true);
  });

  it('respects a custom hardMacroGateHours threshold', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      nextMacroEventAt: new Date(NOW.getTime() + 6 * 3600_000).toISOString(),
      hardMacroGateHours: 4, // event is now outside the (shorter) gate
    });
    expect(result.macroProximityScore).toBeGreaterThan(0);
  });

  it('scores full 20 points when the event is well beyond the gate + grace windows', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      nextMacroEventAt: new Date(NOW.getTime() + 72 * 3600_000).toISOString(),
    });
    expect(result.macroProximityScore).toBe(20);
  });
});

describe('volatility stability scoring', () => {
  it('scores full 20 points for a small (<=2%) 30-minute change', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      vixNow: 15.1,
      vixThirtyMinutesAgo: 15.0,
    });
    expect(result.volatilityStabilityScore).toBe(20);
  });

  it('scores 0 and adds a note for a >10% 30-minute swing', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      vixNow: 20,
      vixThirtyMinutesAgo: 15,
    });
    expect(result.volatilityStabilityScore).toBe(0);
    expect(result.notes.some((n) => n.toLowerCase().includes('volatility'))).toBe(true);
  });

  it('falls back to underlyingIv fields when VIX fields are absent', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg()],
      now: NOW,
      underlyingIvNow: 44.5,
      underlyingIvThirtyMinutesAgo: 44,
    });
    expect(result.volatilityStabilityScore).toBe(20);
  });

  it('scores a neutral 12/20 when no volatility data is available at all', () => {
    const result = calculateDecisionConfidence({ legs: [makeConfidenceLeg()], now: NOW });
    expect(result.volatilityStabilityScore).toBe(12);
  });
});

describe('total confidence composition', () => {
  it('sums all four dimensions and clamps to [0, 100]', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ bidAskSpread: 0.05, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() })],
      now: NOW,
      vixNow: 15.1,
      vixThirtyMinutesAgo: 15.0,
    });
    expect(result.total).toBe(
      result.liquidityScore + result.latencyScore + result.macroProximityScore + result.volatilityStabilityScore,
    );
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('worst-case inputs across every dimension produce total 0, not a negative or NaN', () => {
    const result = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ bidAskSpread: 1.0, averageBidAskSpread20: 0.05, quoteTimestamp: undefined })],
      now: NOW,
      nextMacroEventAt: NOW.toISOString(),
      vixNow: 30,
      vixThirtyMinutesAgo: 15,
    });
    expect(result.total).toBe(0);
    expect(Number.isFinite(result.total)).toBe(true);
  });

  it('adds a clean-conditions note only when no dimension produced a warning note', () => {
    const clean = calculateDecisionConfidence({
      legs: [makeConfidenceLeg({ bidAskSpread: 0.05, averageBidAskSpread20: 0.05, quoteTimestamp: NOW.toISOString() })],
      now: NOW,
      vixNow: 15.1,
      vixThirtyMinutesAgo: 15.0,
    });
    expect(clean.notes).toEqual(['Decision conditions are clean enough for framework evaluation.']);
  });
});
