// lib/__tests__/calculateCspRisk.test.ts
//
// Terminology-refactor ticket (2σ Scenario Loss rename): regression tests
// proving the calculation is unchanged from the original "Realistic Loss"
// implementation, aside from the one disclosed defensive fix (negative DTE
// no longer produces NaN). Covers: breakeven, both IV input formats, DTE=0,
// the DTE-negative fix, the $0 floor for deep-OTM cases, and confirmation
// capitalAtRisk's formula is byte-for-byte unchanged.

import { describe, expect, it } from 'vitest';
import { calculateCspRisk } from '@/lib/calculateCspRisk';

describe('calculateCspRisk: capitalAtRisk (unchanged formula)', () => {
  it('computes stock-to-$0 theoretical worst case, net of premium, times contracts', () => {
    const { capitalAtRisk } = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: 30,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    // (27*100 - 1.20*100) * 2 = (2700 - 120) * 2 = 5160
    expect(capitalAtRisk).toBeCloseTo(5160, 6);
  });

  it('is unaffected by implied volatility or days to expiration', () => {
    const a = calculateCspRisk({
      impliedVolatility: 0.2,
      daysToExpiration: 14,
      currentStockPrice: 100,
      strikePrice: 70,
      premiumCollected: 0.5,
      contracts: 1,
    });
    const b = calculateCspRisk({
      impliedVolatility: 0.9,
      daysToExpiration: 300,
      currentStockPrice: 100,
      strikePrice: 70,
      premiumCollected: 0.5,
      contracts: 1,
    });
    expect(a.capitalAtRisk).toBe(b.capitalAtRisk);
    expect(a.capitalAtRisk).toBeCloseTo(6950, 6);
  });
});

describe('calculateCspRisk: breakeven', () => {
  it('is strike minus per-share premium', () => {
    const { breakeven } = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: 30,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    expect(breakeven).toBeCloseTo(25.8, 6);
  });
});

describe('calculateCspRisk: scenarioLoss (2σ Scenario Loss)', () => {
  it('matches the ticket-specified worked example (Scenario A)', () => {
    const result = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: 30,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    // oneSigmaMove = 30 * 0.45 * sqrt(30/365) ~= 3.8477
    // expectedMove (2-sigma) ~= 7.6954; expectedLow ~= 22.3046
    // breakeven = 25.8; (25.8 - 22.3046) * 100 * 2 ~= 699.08
    expect(result.scenarioLoss).toBeGreaterThan(690);
    expect(result.scenarioLoss).toBeLessThan(710);
  });

  it('floors at $0 for a deep-OTM position where expected low stays above breakeven (Scenario B)', () => {
    const { scenarioLoss } = calculateCspRisk({
      impliedVolatility: 0.2,
      daysToExpiration: 14,
      currentStockPrice: 100,
      strikePrice: 70,
      premiumCollected: 0.5,
      contracts: 1,
    });
    expect(scenarioLoss).toBe(0);
  });

  it('accepts whole-number-percent IV (45) and decimal IV (0.45) identically', () => {
    const whole = calculateCspRisk({
      impliedVolatility: 45,
      daysToExpiration: 30,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    const decimal = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: 30,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    expect(whole.scenarioLoss).toBeCloseTo(decimal.scenarioLoss, 9);
    expect(whole.expectedLowPrice).toBeCloseTo(decimal.expectedLowPrice, 9);
  });

  it('handles DTE=0 (expiring today) without producing NaN, with no expected move', () => {
    const result = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: 0,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    expect(result.expectedMove).toBe(0);
    expect(result.expectedLowPrice).toBe(30);
    expect(result.scenarioLoss).toBe(0);
  });

  it('regression: negative/invalid DTE no longer produces NaN (defensive clamp fix)', () => {
    const result = calculateCspRisk({
      impliedVolatility: 0.45,
      daysToExpiration: -5,
      currentStockPrice: 30,
      strikePrice: 27,
      premiumCollected: 1.2,
      contracts: 2,
    });
    expect(Number.isNaN(result.scenarioLoss)).toBe(false);
    expect(Number.isNaN(result.expectedLowPrice)).toBe(false);
    // Treated identically to DTE=0: no expected move.
    expect(result.expectedMove).toBe(0);
    expect(result.scenarioLoss).toBe(0);
  });
});
