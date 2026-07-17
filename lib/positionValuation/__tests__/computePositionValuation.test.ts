// lib/positionValuation/__tests__/computePositionValuation.test.ts
//
// PI-0014: unit tests for the pure valuation math -- tier boundaries,
// slippage clamping, and missing-maxRisk handling. See
// docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.

import { describe, expect, it } from 'vitest';
import { attachLiquidityTrapTrigger, computePositionValuation } from '../computePositionValuation';

describe('computePositionValuation', () => {
  it('computes midPnL/marketablePnL as credit minus each valuation', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 629,
      marketableValue: 1124,
      maxRisk: 644,
    });
    expect(result.midPnL).toBeCloseTo(-129, 5);
    expect(result.marketablePnL).toBeCloseTo(-624, 5);
  });

  it('reports slippage cost as the dollar gap between mid and marketable loss (real SMH-shaped case)', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 629,
      marketableValue: 1124,
      maxRisk: 644,
    });
    // midPnL - marketablePnL = -129 - (-624) = 495
    expect(result.slippageCost).toBeCloseTo(495, 5);
    expect(result.slippagePercentOfMaxRisk).toBeCloseTo(495 / 644, 5);
    expect(result.liquidityTier).toBe('LIQUIDITY_TRAP');
  });

  it('classifies LIQUID under 5% of max risk', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 400,
      marketableValue: 410, // slippage $10 vs $644 max risk = ~1.55%
      maxRisk: 644,
    });
    expect(result.slippagePercentOfMaxRisk).toBeCloseTo(10 / 644, 5);
    expect(result.liquidityTier).toBe('LIQUID');
  });

  it('classifies WIDE_SPREAD between 5% and 15% of max risk', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 400,
      marketableValue: 460, // slippage $60 vs $644 = ~9.3%
      maxRisk: 644,
    });
    expect(result.liquidityTier).toBe('WIDE_SPREAD');
  });

  it('classifies LIQUIDITY_TRAP above 15% of max risk', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 400,
      marketableValue: 600, // slippage $200 vs $644 = ~31%
      maxRisk: 644,
    });
    expect(result.liquidityTier).toBe('LIQUIDITY_TRAP');
  });

  it('is exactly at the boundary: 5% itself is still LIQUID (threshold is ">")', () => {
    const result = computePositionValuation({
      creditReceived: 0,
      midValue: 0,
      marketableValue: 5,
      maxRisk: 100,
    });
    expect(result.slippagePercentOfMaxRisk).toBeCloseTo(0.05, 5);
    expect(result.liquidityTier).toBe('LIQUID');
  });

  it('clamps slippage cost to 0 when marketable pricing is better than mid', () => {
    const result = computePositionValuation({
      creditReceived: 500,
      midValue: 460,
      marketableValue: 400, // marketable loss is smaller than mid loss
      maxRisk: 644,
    });
    expect(result.slippageCost).toBe(0);
    expect(result.liquidityTier).toBe('LIQUID');
  });

  it('treats missing or non-positive maxRisk as 0% slippage, never a divide-by-zero', () => {
    const missing = computePositionValuation({ creditReceived: 500, midValue: 400, marketableValue: 900, maxRisk: null });
    expect(missing.slippagePercentOfMaxRisk).toBe(0);
    expect(missing.liquidityTier).toBe('LIQUID');

    const zero = computePositionValuation({ creditReceived: 500, midValue: 400, marketableValue: 900, maxRisk: 0 });
    expect(zero.slippagePercentOfMaxRisk).toBe(0);

    const negative = computePositionValuation({ creditReceived: 500, midValue: 400, marketableValue: 900, maxRisk: -50 });
    expect(negative.slippagePercentOfMaxRisk).toBe(0);
  });
});

describe('attachLiquidityTrapTrigger', () => {
  it('sets liquidityTrapTriggered true only when tier is LIQUIDITY_TRAP AND marketable evidence promoted the verdict', () => {
    const raw = computePositionValuation({ creditReceived: 500, midValue: 629, marketableValue: 1124, maxRisk: 644 });
    expect(raw.liquidityTier).toBe('LIQUIDITY_TRAP');

    const promoted = attachLiquidityTrapTrigger(raw, true);
    expect(promoted.liquidityTrapTriggered).toBe(true);

    const notPromoted = attachLiquidityTrapTrigger(raw, false);
    expect(notPromoted.liquidityTrapTriggered).toBe(false);
  });

  it('never sets liquidityTrapTriggered true when tier is not LIQUIDITY_TRAP, even if promoted', () => {
    const raw = computePositionValuation({ creditReceived: 500, midValue: 400, marketableValue: 410, maxRisk: 644 });
    expect(raw.liquidityTier).toBe('LIQUID');
    const result = attachLiquidityTrapTrigger(raw, true);
    expect(result.liquidityTrapTriggered).toBe(false);
  });
});
