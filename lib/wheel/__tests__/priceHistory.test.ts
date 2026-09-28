// lib/wheel/__tests__/priceHistory.test.ts
//
// WHEEL-SYSTEM-0003 Slice B -- fixtures from the ticket's own "Fixtures for Alan" table, recomputed
// and confirmed exact, plus the edge cases the ticket names.

import { describe, expect, it } from 'vitest';
import { analyzePriceHistory, MIN_CLOSES_FOR_HISTORY, suggestedDropBps, worseThanEffectiveDropBps } from '../priceHistory';

describe('analyzePriceHistory', () => {
  // Ticket fixture: index 0-20 all 100.00, index 21 = 52.30, index 22 = 60.00 (23 closes, 2 windows of 21 days).
  const fixtureCloses = [...Array(21).fill(100.0), 52.3, 60.0];

  it('matches the ticket\'s worked fixture exactly', () => {
    const result = analyzePriceHistory(fixtureCloses);
    expect(result).not.toBeNull();
    const r = result!;
    // Window from index 0: floor(523,000 x 10000 / 1,000,000) - 10000 = -4,770 bps
    // Window from index 1: floor(600,000 x 10000 / 1,000,000) - 10000 = -4,000 bps
    expect(r.worstMonthBps).toBe(-4770);
    expect(r.maxDrawdownBps).toBe(-4770); // peak 100.00 to 52.30
    expect(r.share30Bps).toBe(10_000); // both windows at or below -30%
    expect(r.years).toBe(0.1);
    expect(r.shortHistory).toBe(true); // well under 3 years
  });

  it('suggested drop rounds up to the next 5% from the fixture\'s worst month, given a 30% plan drop', () => {
    const r = analyzePriceHistory(fixtureCloses)!;
    expect(suggestedDropBps(r.worstMonthBps, 3_000)).toBe(5_000);
  });

  it('returns null (unavailable) with fewer than 22 closes -- never a guess', () => {
    expect(analyzePriceHistory(Array(MIN_CLOSES_FOR_HISTORY - 1).fill(100))).toBeNull();
    expect(analyzePriceHistory([])).toBeNull();
  });

  it('a flat series is 0 bps worst month and 0 bps drawdown, and suggests the plan-wide drop', () => {
    const flat = Array(60).fill(100.0);
    const r = analyzePriceHistory(flat)!;
    expect(r.worstMonthBps).toBe(0);
    expect(r.maxDrawdownBps).toBe(0);
    expect(r.share30Bps).toBe(0);
    expect(suggestedDropBps(r.worstMonthBps, 3_000)).toBe(3_000); // never below the plan-wide drop
  });

  it('exactly -30.00% counts toward the share', () => {
    // 22 closes: index 0 = 100.00, index 21 = 70.00 -> exactly -30.00% for the one window.
    const closes = [100.0, ...Array(20).fill(50.0), 70.0];
    const r = analyzePriceHistory(closes)!;
    // Window from index 0: floor(700,000 x 10000 / 1,000,000) - 10000 = -3000 bps exactly.
    expect(r.worstMonthBps).toBe(-3000);
    expect(r.share30Bps).toBe(10_000); // the one window counts (at or below -30%)
  });

  it('a single bad close is still reported, with years and short-history intact, never used automatically', () => {
    // A data-error spike at one point still flows through the same integer arithmetic --
    // no outlier rejection, no special-casing, per the ticket's own edge case.
    const closes = [...Array(21).fill(100.0), 0.01, 100.0];
    const r = analyzePriceHistory(closes)!;
    expect(r.worstMonthBps).toBeLessThan(-9000); // a near-total, honestly reported drop
    expect(r.years).toBe(0.1);
    expect(r.shortHistory).toBe(true);
  });

  it('years reads 5.0 for a full 5-year run of trading days', () => {
    const closes = Array(251 * 5).fill(50.0);
    const r = analyzePriceHistory(closes)!;
    expect(r.years).toBe(5.0);
    expect(r.shortHistory).toBe(false);
  });

  it('a reverse split is handled by using the split-adjusted closes as given -- no detection logic here', () => {
    // The route supplies Yahoo's `quote` series (split-adjusted already); this module just takes
    // whatever closes it's given, so a split shows as a real, continuous price series with no jump.
    const closes = [...Array(21).fill(100.0), 98.0, 99.0];
    const r = analyzePriceHistory(closes)!;
    expect(r.worstMonthBps).toBeGreaterThan(-500); // a mild, ordinary move, not a false "reverse-split crash"
  });
});

describe('suggestedDropBps', () => {
  it('rounds up to the next 5%', () => {
    expect(suggestedDropBps(-4501, 0)).toBe(5000);
    expect(suggestedDropBps(-4500, 0)).toBe(4500);
    expect(suggestedDropBps(-1, 0)).toBe(500);
  });

  it('never suggests below the plan-wide drop', () => {
    expect(suggestedDropBps(-1000, 3000)).toBe(3000);
  });

  it('caps at 95%', () => {
    expect(suggestedDropBps(-9900, 3000)).toBe(9500);
  });
});

describe('worseThanEffectiveDropBps (Ian\'s relative-margin threshold)', () => {
  it('is positive when the worst month is worse than the effective drop', () => {
    // TQQQ: worst month -44%, plan default 30% -> 14 points worse.
    expect(worseThanEffectiveDropBps(-4400, 3000)).toBe(1400);
  });

  it('is at or below zero when the effective drop already covers the worst month', () => {
    // CONL: worst month -71%, but the trader already set its own Drop to 70% -> only 1 point short.
    expect(worseThanEffectiveDropBps(-7100, 7000)).toBe(100);
    expect(worseThanEffectiveDropBps(-1200, 3000)).toBe(-1800); // KO: comfortably within the plan default
  });
});
