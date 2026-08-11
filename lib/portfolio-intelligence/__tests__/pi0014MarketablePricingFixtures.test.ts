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
import { computePositionValuation } from '@/lib/positionValuation';

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
  // Purely observational -- no liquidityTrapTriggered on this object (PI-0014
  // follow-up, Product Owner review).
  const valuation = computePositionValuation({
    creditReceived: fixture.creditReceived,
    midValue: fixture.midValue,
    marketableValue: fixture.marketableValue,
    maxRisk: fixture.maxRisk,
  });
  const pnlPct = pctOf(fixture.creditReceived, fixture.midValue);
  const marketablePnlPct = pctOf(fixture.creditReceived, fixture.marketableValue);
  // liquidityTrapTriggered is decided by evaluatePositionObjective() itself,
  // given the valuation's own liquidityTier as one more piece of evidence --
  // matches app/portfolio/page.tsx's scorePortfolioPositionObjective wiring.
  const result = evaluatePositionObjective(
    {
      positionId: 'fixture',
      symbol: 'TEST',
      creditReceived: fixture.creditReceived,
      pnlPct,
      marketablePnlPct,
      liquidityTier: valuation.liquidityTier,
      ...fixture.input,
    },
    NOW,
  );
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

  it('keeps the 20-DTE action primary while retaining unresolved pricing as secondary state', () => {
    const { valuation, legacyRecommendation, objective, executionRealityPromoted, liquidityTrapTriggered, pricingDecisionEvidence } = evaluate(fixture);
    expect(valuation.liquidityTier).toBe('LIQUIDITY_TRAP');
    expect(executionRealityPromoted).toBe(false);
    expect(liquidityTrapTriggered).toBe(true);
    expect(legacyRecommendation.kind).toBe('roll-soon');
    expect(objective?.ruleId).toBe('OBJ-MANAGE-21-DTE');
    expect(pricingDecisionEvidence.verificationUnresolved).toBe(true);
    expect(pricingDecisionEvidence.status).toBe('MARKETABLE_OBSERVATIONAL');
  });

  it('retains both valuations and never allows the untrusted marketable loss to produce a hard exit', () => {
    const { legacyRecommendation, pricingDecisionEvidence } = evaluate(fixture);
    expect(legacyRecommendation.kind).not.toBe('close-loser');
    expect(pricingDecisionEvidence.midPnlPct).toBeCloseTo(-25.8, 1);
    expect(pricingDecisionEvidence.marketablePnlPct).toBeCloseTo(-124.8, 1);
    expect(pricingDecisionEvidence.marketableDecisionEligible).toBe(false);
    expect(pricingDecisionEvidence.verificationUnresolved).toBe(true);
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
    const { valuation, legacyRecommendation, executionRealityPromoted, liquidityTrapTriggered } = evaluate(fixture);
    expect(valuation.liquidityTier).toBe('LIQUID');
    expect(executionRealityPromoted).toBe(false);
    expect(liquidityTrapTriggered).toBe(false);
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
    const { legacyRecommendation, executionRealityPromoted, liquidityTrapTriggered } = evaluate(fixture);
    expect(legacyRecommendation.kind).toBe('assignment-risk');
    expect(legacyRecommendation.urgency).toBe('critical');
    // Neither pnlPct is anywhere near the -100%/-50% loss thresholds, so
    // marketable evidence never gets a chance to promote anything here --
    // proving liquidityTier (a valuation property) and liquidityTrapTriggered
    // (a decision-engine property, PI-0014 follow-up) are independent
    // concepts, exactly as the final ruling specifies (a position can be
    // WIDE_SPREAD or even LIQUIDITY_TRAP tier and still not have the
    // promotion boolean fire).
    expect(executionRealityPromoted).toBe(false);
    expect(liquidityTrapTriggered).toBe(false);
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
    input: {
      strategy: 'BCS', dte: 20, buffer: 10, hasGtc: true,
      marketableQuoteQuality: 'RELIABLE', marketableQuoteFreshness: 'FRESH',
      marketableQuoteCapturedAt: NOW.toISOString(),
    },
  };

  it('demotes away from close-winner once marketable pricing disagrees', () => {
    const { legacyRecommendation, executionRealityPromoted } = evaluate(fixture);
    expect(legacyRecommendation.kind).not.toBe('close-winner');
    expect(executionRealityPromoted).toBe(true);
    expect(legacyRecommendation.supportingReasons[0]).toMatch(/marketable estimate is materially worse than mid/i);
  });
});

// PI-0014 corrective closeout (3.2): missing marketable execution data must
// preserve mid-only behavior exactly -- this is the real production
// contract from app/portfolio/page.tsx's computeMarketablePnlPct()/
// computeRawPositionValuation(): when pos.closeValue/pos.closeNowPnl are
// unavailable (any leg one-sided, or a quote invalid -- see
// hasCloseValue/oneSidedSymbols in that file), both are null, and null
// flows straight into these inputs. No fabricated promotion, veto, or
// trigger may result from that absence.
//
// Scope note (3.3): the leg-level quote-validity guard itself (rejecting
// zero/negative/one-sided bid/ask quotes before closeValue is ever
// computed) lives in app/portfolio/page.tsx, is pre-existing and untouched
// by PI-0014, and is not exported for isolated unit testing -- duplicating
// its bid/ask-direction logic here would mean testing a hand-rolled copy
// instead of the real thing, which was explicitly out of scope for this
// closeout. What IS verified here, directly, is the safety property that
// actually matters regardless of *why* marketable data is unavailable
// (missing vs. withheld upstream for an invalid quote): the Decision
// Engine must fall back to mid-only behavior with zero fabrication.
describe('PI-0014 corrective closeout: missing/invalid marketable data preserves mid-only behavior', () => {
  it('a materially losing position on mid alone still triggers Cut Losses when marketable data is absent', () => {
    const result = evaluatePositionObjective(
      {
        positionId: 'fixture-missing-1',
        symbol: 'TEST',
        strategy: 'BPS',
        dte: 30,
        buffer: 8,
        hasGtc: true,
        creditReceived: 500,
        pnlPct: -150, // mid alone already breaches materialLossPct (-100)
        marketablePnlPct: null,
        liquidityTier: null,
      },
      NOW,
    );
    expect(result.legacyRecommendation.kind).toBe('close-loser');
    expect(result.executionRealityPromoted).toBe(false);
    expect(result.liquidityTrapTriggered).toBe(false);
    expect(result.legacyRecommendation.supportingReasons.some((r) => r.includes('Executable pricing'))).toBe(false);
  });

  it('a comfortable mid position stays on hold when marketable data is absent -- no fabricated promotion', () => {
    const result = evaluatePositionObjective(
      {
        positionId: 'fixture-missing-2',
        symbol: 'TEST',
        strategy: 'BCS',
        dte: 30,
        buffer: 15,
        hasGtc: true,
        creditReceived: 400,
        pnlPct: 20, // comfortable, unremarkable
        marketablePnlPct: null,
        liquidityTier: null,
      },
      NOW,
    );
    expect(result.legacyRecommendation.kind).toBe('hold');
    expect(result.executionRealityPromoted).toBe(false);
    expect(result.liquidityTrapTriggered).toBe(false);
  });

  it('a real mid profit target still fires Take Profit when marketable data is absent -- no fabricated veto', () => {
    const result = evaluatePositionObjective(
      {
        positionId: 'fixture-missing-3',
        symbol: 'TEST',
        strategy: 'BCS',
        // Keep this fixture outside the independent DTE-management window so
        // it isolates the pricing-verification policy being asserted.
        dte: 30,
        buffer: 10,
        hasGtc: true,
        creditReceived: 600,
        pnlPct: 53.3, // mid alone reaches the 50% target
        marketablePnlPct: null,
        liquidityTier: null,
      },
      NOW,
    );
    expect(result.legacyRecommendation.kind).toBe('close-winner');
    expect(result.executionRealityPromoted).toBe(false);
  });

  it('undefined marketablePnlPct/liquidityTier (fields omitted entirely) behaves identically to explicit null', () => {
    const withNull = evaluatePositionObjective(
      {
        positionId: 'fixture-missing-4a',
        symbol: 'TEST',
        strategy: 'PUT',
        dte: 25,
        buffer: 10,
        hasGtc: true,
        creditReceived: 300,
        pnlPct: 33,
        marketablePnlPct: null,
        liquidityTier: null,
      },
      NOW,
    );
    const withOmitted = evaluatePositionObjective(
      {
        positionId: 'fixture-missing-4b',
        symbol: 'TEST',
        strategy: 'PUT',
        dte: 25,
        buffer: 10,
        hasGtc: true,
        creditReceived: 300,
        pnlPct: 33,
      },
      NOW,
    );
    expect(withOmitted.legacyRecommendation.kind).toBe(withNull.legacyRecommendation.kind);
    expect(withOmitted.executionRealityPromoted).toBe(withNull.executionRealityPromoted);
    expect(withOmitted.liquidityTrapTriggered).toBe(withNull.liquidityTrapTriggered);
  });
});

// PI-0014 corrective closeout (3.4 follow-through): a position can have
// perfectly valid, usable marketablePnlPct evidence while its liquidityTier
// is unknown (maxRisk missing/zero/negative) -- these are independent
// pieces of evidence. The material-loss/weak-health-loss/profit-target-veto
// gates must keep working from marketablePnlPct alone; only
// liquidityTrapTriggered (which requires liquidityTier === 'LIQUIDITY_TRAP'
// specifically) should read false when the tier itself is unknown.
describe('PI-0014C: unknown liquidity/freshness cannot independently promote a hard exit', () => {
  it('routes marketable-only loss evidence to Verify Pricing when decision eligibility is unproved', () => {
    // Mirrors fixture 1's real SMH-shaped numbers, but with maxRisk missing
    // -- computePositionValuation now classifies liquidityTier as null,
    // not LIQUIDITY_TRAP, per the corrected classifier.
    const valuation = computePositionValuation({
      creditReceived: 500,
      midValue: 629,
      marketableValue: 1124,
      maxRisk: null,
    });
    expect(valuation.liquidityTier).toBeNull();

    const result = evaluatePositionObjective(
      {
        positionId: 'fixture-unknown-tier-1',
        symbol: 'TEST',
        strategy: 'BPS',
        // Outside the independent DTE-management window: this fixture is
        // specifically about pricing evidence, not lifecycle precedence.
        dte: 30,
        buffer: 8,
        hasGtc: true,
        creditReceived: 500,
        pnlPct: pctOf(500, 629),
        marketablePnlPct: pctOf(500, 1124),
        liquidityTier: valuation.liquidityTier,
      },
      NOW,
    );
    expect(result.legacyRecommendation.kind).toBe('verify-pricing');
    expect(result.legacyRecommendation.label).toBe('Verify Pricing');
    expect(result.executionRealityPromoted).toBe(false);
    // Correctly false: the gate that fired is materialLoss (from
    // marketablePnlPct), not the liquidity-trap tier, which is unknown here.
    expect(result.liquidityTrapTriggered).toBe(false);
  });
});

describe('PI-0014C MU 800/790 five-lot pricing-conflict regression', () => {
  const creditReceived = 1260;
  const midValue = 1600;
  const marketableValue = 3650;
  const maxRisk = 3740;

  function mu(overrides: Partial<PositionObjectiveInput> = {}) {
    const valuation = computePositionValuation({ creditReceived, midValue, marketableValue, maxRisk });
    return {
      valuation,
      result: evaluatePositionObjective({
        positionId: 'MU-800-790', symbol: 'MU', strategy: 'BPS', dte: 29,
        buffer: 7, hasGtc: true, creditReceived,
        pnlPct: pctOf(creditReceived, midValue),
        marketablePnlPct: pctOf(creditReceived, marketableValue),
        liquidityTier: valuation.liquidityTier,
        ...overrides,
      }, NOW),
    };
  }

  it('reconciles the exact production economics', () => {
    const { valuation } = mu();
    expect(valuation.midPnL).toBe(-340);
    expect(pctOf(creditReceived, midValue)).toBeCloseTo(-26.98, 2);
    expect(valuation.marketablePnL).toBe(-2390);
    expect(pctOf(creditReceived, marketableValue)).toBeCloseTo(-189.68, 2);
    expect(valuation.slippageCost).toBe(2050);
    expect(valuation.slippagePercentOfMaxRisk).toBeCloseTo(2050 / 3740, 5);
    expect(valuation.liquidityTier).toBe('LIQUIDITY_TRAP');
  });

  it('does not emit a hard exit from degraded/unknown-freshness marketable evidence', () => {
    const { result } = mu({ marketableQuoteQuality: 'DEGRADED', marketableQuoteFreshness: 'UNKNOWN' });
    expect(result.legacyRecommendation.kind).toBe('verify-pricing');
    expect(result.legacyRecommendation.label).toBe('Verify Pricing');
    expect(result.legacyRecommendation.urgency).toBe('high');
    expect(result.legacyRecommendation.suggestedAction).toMatch(/refresh broker leg quotes/i);
    expect(result.legacyRecommendation.suggestedAction).toMatch(/not a guaranteed fill price/i);
    expect(result.executionRealityPromoted).toBe(false);
    expect(result.liquidityTrapTriggered).toBe(true);
    expect(result.pricingDecisionEvidence.status).toBe('VERIFY_PRICING');
    expect(result.pricingDecisionEvidence.controllingBasis).toBe('MID');
    expect(result.pricingDecisionEvidence.marketableDecisionEligible).toBe(false);
    expect(result.objective?.metadata.executionAllowed).toBe(false);
    expect(result.objective?.metadata.paperExecutionAllowed).toBe(false);
  });

  it('allows the same marketable breach only when quality and freshness are both proven', () => {
    const { result } = mu({
      marketableQuoteQuality: 'RELIABLE', marketableQuoteFreshness: 'FRESH',
      marketableQuoteCapturedAt: NOW.toISOString(),
    });
    expect(result.legacyRecommendation.kind).toBe('close-loser');
    expect(result.executionRealityPromoted).toBe(true);
    expect(result.pricingDecisionEvidence.status).toBe('MARKETABLE_CONFIRMED');
    expect(result.pricingDecisionEvidence.controllingBasis).toBe('MARKETABLE');
    expect(result.legacyRecommendation.primaryReason).toMatch(/midpoint -27%/);
    expect(result.legacyRecommendation.primaryReason).toMatch(/marketable -190%/);
  });
});
