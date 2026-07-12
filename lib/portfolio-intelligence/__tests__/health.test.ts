// lib/portfolio-intelligence/__tests__/health.test.ts
//
// PI-0002 regression: calculatePositionHealthScore was moved verbatim from
// features/portfolio/health/health-score.ts (confirmed byte-identical via
// diff at move time, save for the file header comment). These tests lock in
// its behavior post-move as a parity guard against future accidental drift
// -- not because the logic itself is new.

import { describe, expect, it } from 'vitest';
import { calculatePositionHealthScore } from '@/lib/portfolio-intelligence';
import type { PositionHealthInput } from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-11T13:00:00.000Z');

describe('health score parity', () => {
  it('scores a clean, early, in-the-money-buffer credit spread as excellent/good', () => {
    const input: PositionHealthInput = {
      symbol: 'AMD',
      strategy: 'BPS',
      dte: 35,
      pnlPct: 25,
      buffer: 8,
      netDelta: 0.15,
      ivr: 40,
    };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(['excellent', 'good']).toContain(result.grade);
    expect(result.factors.some((f) => f.key === 'profit-progress')).toBe(true);
  });

  it('scores a position with 1x credit loss as critical', () => {
    const input: PositionHealthInput = { symbol: 'NVDA', strategy: 'CSP', dte: 20, pnlPct: -110, buffer: 3 };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.grade).toBe('critical');
    expect(result.factors.some((f) => f.key === 'loss-1x-credit')).toBe(true);
  });

  it('penalizes ITM strike buffer heavily', () => {
    const input: PositionHealthInput = { symbol: 'MU', strategy: 'CSP', dte: 10, buffer: -2 };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.factors.some((f) => f.key === 'itm')).toBe(true);
    expect(result.score).toBeLessThan(80);
  });

  it('flags expiration risk at <=7 DTE', () => {
    const input: PositionHealthInput = { symbol: 'MRVL', strategy: 'BPS', dte: 5 };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.factors.some((f) => f.key === 'dte-critical')).toBe(true);
  });

  it('flags earnings risk when earnings fall on or before expiration', () => {
    const input: PositionHealthInput = { symbol: 'AAPL', strategy: 'CSP', dte: 15, earningsDate: '2026-07-15', expDate: '2026-07-25' };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.factors.some((f) => f.key === 'earnings-risk')).toBe(true);
  });

  it('falls back to a neutral limited-data factor with no crash when almost nothing is supplied', () => {
    const input: PositionHealthInput = { symbol: 'X' };
    const result = calculatePositionHealthScore(input, NOW);
    expect(result.factors.some((f) => f.key === 'limited-data')).toBe(true);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('is deterministic given the same input and now', () => {
    const input: PositionHealthInput = { symbol: 'AMD', strategy: 'BPS', dte: 20, pnlPct: 30, buffer: 6 };
    const a = calculatePositionHealthScore(input, NOW);
    const b = calculatePositionHealthScore(input, NOW);
    expect(a.score).toBe(b.score);
    expect(a.grade).toBe(b.grade);
    expect(a.factors).toEqual(b.factors);
  });
});
