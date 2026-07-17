// lib/portfolio-intelligence/__tests__/pi0014MarketablePricingFixtures.test.ts
//
// PI-0014: Marketable Pricing for Risk-Gating (Phase 1) -- the permanent
// risk-first regression suite both external architecture reviews converged
// on, rather than a property-testing framework. See
// docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md and
// TradeEdge_Final_Architecture_Rulings.md ("Testing Strategy" /
// "Verify More Than Recommendations").
//
// Five fixtures, each exercising computePositionValuation() and
// evaluatePositionObjective() together the way they run in production
// (app/portfolio/page.tsx's scorePortfolioPositionObjective composes both).
// Each fixture asserts: mid valuation, marketable valuation, the
// recommendation outcome, and the supporting evidence -- not just the
// recommendation kind in isolation.

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';
import { attachLiquidityTrapTrigger, computePositionValuation } from '@/lib/positionValuation';

const NOW = new Date('2026-07-17T13:00:00.000Z');

// Mirrors app/portfolio/page.tsx's own null-safe pnlPct/marketablePnlPct
// convention: (credit - value) / credit * 100.
function pctOf(creditReceived: number, value: number): number {
  return ((creditReceived - value) / creditReceived) * 100;
}

interface Fixture {
  creditReceived: number;
  midValue: number;
  marketableValue: number;
  maxRisk: number;
  input: Partial<PositionObjectiveInput>;
}

function evaluate(fixture: Fixture) {
  const rawValuation = computePositionValuation({
    creditReceived: fixture.creditReceived,
    midValue: fixture.midValue,
    marketableValue: fixture.marketableValue,
    maxRisk: fixture.maxRisk,
  });
  const pnlPct = pctOf(fixture.creditReceived, fixture.midValue);
  const marketablePnlPct = pctOf(fixture.creditReceived, fixture.marketableValue);
  const result = evaluatePositionObjective(
    {
      positionId: 'fixture',
      symbol: 'TEST',
      creditReceived: fixture.creditReceived,
      pnlPct,
      marketablePnlPct,
      ...fixture.input,
    },
    NOW,
  );
  const valuation = attachLiquidityTrapTrigger(rawValuation, result.executionRealityPromoted);
  return { valuation, pnlPct, marketablePnlPct, ...result };
}

describe('PI-0014 fixture 1: real production failure (SMH-shaped BPS)', () => {
  const fixture: Fixture = {
    creditReceived: 500,
    midValue: 629,      // mid buyback -> midPnL -$129
    marketableValue: 1124, // marketable buyback -> marketablePnL -$624
    maxRisk: 644,
    input: { strategy: 'BPS', dte: 20, buffer: 8, hasGtc: true },
  };

  it('mid valuation alone looks survivable', () => {
    const { valuation, pnlPct } = evaluate(fixture);
    expect(valuation.midPnL).toBeCloseTo(-129, 5);
    expect(pnlPct).toBeCloseTo(-25.8, 1);
  });

  it('marketable valuation reveals the real loss', () => {
    const { valuation, marketablePnlPct } = evaluate(fixture);
    expect(valuation.marketablePnL).toBeCloseTo(-624, 5);
    expect(marketablePnlPct).toBeCloseTo(-124.8, 1);
  });

  it('is classified LIQUIDITY_TRAP and promotes the recommendation to Cut Losses', () => {
    const { valuation, legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(valuation.liquidityTier).toBe('LIQUIDITY_TRAP');
    expect(executionRealityPromoted).toBe(true);
    expect(valuation.liquidityTrapTriggered).toBe(true);
    expect(legacyRecommendation.kind).toBe('close-loser');
    expect(legacyRecommendation.urgency).toBe('critical');
  });

  it('states the execution-reality divergence as explicit evidence', () => {
    const { legacyRecommendation } = evaluate(fixture);
    expect(legacyRecommendation.supportingReasons[0]).toMatch(/Executable pricing is materially worse than mid/);
    expect(legacyRecommendation.supportingReasons[0]).toMatch(/-125%/);
    expect(legacyRecommendation.supportingReasons[0]).toMatch(/-26%/);
  });
});

describe('PI-0014 fixture 2: plain, tight-spread CSP', () => {
  const fixture: Fixture = {
    creditReceived: 300,
    midValue: 200,        // midPnL +$100
    marketableValue: 210, // marketablePnL +$90 -- trivial slippage
    maxRisk: 2000,
    input: { strategy: 'PUT', dte: 25, buffer: 10, hasGtc: true },
  };

  it('mid and marketable valuations agree closely', () => {
    const { valuation } = evaluate(fixture);
    expect(valuation.midPnL).toBeCloseTo(100, 5);
    expect(valuation.marketablePnL).toBeCloseTo(90, 5);
    expect(valuation.slippagePercentOfMaxRisk).toBeCloseTo(10 / 2000, 5);
  });

  it('is LIQUID, does not promote, and holds', () => {
    const { valuation, legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(valuation.liquidityTier).toBe('LIQUID');
    expect(executionRealityPromoted).toBe(false);
    expect(valuation.liquidityTrapTriggered).toBe(false);
    expect(legacyRecommendation.kind).toBe('hold');
    expect(legacyRecommendation.supportingReasons.some((r) => r.includes('Executable pricing'))).toBe(false);
  });
});

describe('PI-0014 fixture 3: comfortable OTM spread', () => {
  const fixture: Fixture = {
    creditReceived: 400,
    midValue: 300,        // midPnL +$100, 25%
    marketableValue: 320, // marketablePnL +$80, 20%
    maxRisk: 1000,
    input: { strategy: 'BCS', dte: 35, buffer: 15, hasGtc: true },
  };

  it('small, unremarkable slippage stays LIQUID', () => {
    const { valuation } = evaluate(fixture);
    expect(valuation.slippagePercentOfMaxRisk).toBeCloseTo(20 / 1000, 5);
    expect(valuation.liquidityTier).toBe('LIQUID');
  });

  it('holds with no promotion -- comfortable profit, nothing to act on', () => {
    const { legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(executionRealityPromoted).toBe(false);
    expect(legacyRecommendation.kind).toBe('hold');
  });
});

describe('PI-0014 fixture 4: ITM / breached spread', () => {
  const fixture: Fixture = {
    creditReceived: 400,
    midValue: 520,         // midPnL -$120, -30%
    marketableValue: 580,  // marketablePnL -$180, -45%
    maxRisk: 800,
    input: { strategy: 'PUT', dte: 5, buffer: -5, hasGtc: true },
  };

  it('wide but not trap-tier slippage', () => {
    const { valuation } = evaluate(fixture);
    expect(valuation.slippagePercentOfMaxRisk).toBeCloseTo(60 / 800, 5);
    expect(valuation.liquidityTier).toBe('WIDE_SPREAD');
  });

  it('assignment-risk fires from the strike breach itself, independent of the marketable gate', () => {
    const { legacyRecommendation, executionRealityPromoted, valuation } = evaluate(fixture);
    expect(legacyRecommendation.kind).toBe('assignment-risk');
    expect(legacyRecommendation.urgency).toBe('critical');
    // Neither pnlPct is anywhere near the -100%/-50% loss thresholds, so
    // marketable evidence never gets a chance to promote anything here --
    // proving liquidityTier and liquidityTrapTriggered are independent
    // concepts, exactly as the final ruling specifies (a position can be
    // WIDE_SPREAD or even LIQUIDITY_TRAP tier and still not have the
    // promotion boolean fire).
    expect(executionRealityPromoted).toBe(false);
    expect(valuation.liquidityTrapTriggered).toBe(false);
  });
});

describe('PI-0014 fixture 5: highly liquid baseline (tight ETF spread)', () => {
  const fixture: Fixture = {
    creditReceived: 600,
    midValue: 280,         // midPnL +$320, 53.3%
    marketableValue: 290,  // marketablePnL +$310, 51.7% -- confirms the target
    maxRisk: 2000,
    input: { strategy: 'BCS', dte: 20, buffer: 10, hasGtc: true },
  };

  it('negligible slippage, LIQUID tier', () => {
    const { valuation } = evaluate(fixture);
    expect(valuation.slippagePercentOfMaxRisk).toBeCloseTo(10 / 2000, 5);
    expect(valuation.liquidityTier).toBe('LIQUID');
  });

  it('take-profit fires and marketable pricing confirms it -- no veto', () => {
    const { legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(legacyRecommendation.kind).toBe('close-winner');
    expect(executionRealityPromoted).toBe(false);
  });
});

// Beyond the five required archetypes: confirms the profit-target veto path
// itself (the "TAKE_PROFIT -> HOLD/MANAGE" promotion example from the final
// ruling) actually fires when marketable pricing contradicts a mid-based
// profit claim.
describe('PI-0014 supplementary: marketable pricing vetoes a false profit target', () => {
  const fixture: Fixture = {
    creditReceived: 600,
    midValue: 280,         // midPnL +$320, 53.3% -- mid alone says close-winner
    marketableValue: 340,  // marketablePnL +$260, 43.3% -- below the 50% target
    maxRisk: 2000,
    input: { strategy: 'BCS', dte: 20, buffer: 10, hasGtc: true },
  };

  it('demotes away from close-winner once marketable pricing disagrees', () => {
    const { legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(legacyRecommendation.kind).not.toBe('close-winner');
    expect(executionRealityPromoted).toBe(true);
    expect(legacyRecommendation.supportingReasons[0]).toMatch(/Executable pricing is materially worse than mid/);
  });
});
