// lib/portfolio-intelligence/__tests__/balancesNormalization.test.ts
//
// PI-0003.5: tests for the single balances-normalization point
// (toFiniteNumber, buildPortfolioFinancialContext, derivePositionConcentration)
// plus objective-evaluation tests proving portfolio-level rules now fire
// from real (simulated) production financial data through the same
// production adapter the Portfolio page uses.

import { describe, expect, it } from 'vitest';
import {
  buildPortfolioFinancialContext,
  buildPortfolioIntelligenceContext,
  computeCanonicalPortfolioPriorities,
  derivePositionConcentration,
  evaluatePortfolioObjectives,
  toFiniteNumber,
} from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-12T13:00:00.000Z');

describe('PI-0003.5: toFiniteNumber (the single normalization point)', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber('42')).toBe(42);
    expect(toFiniteNumber('42.5')).toBe(42.5);
    expect(toFiniteNumber('-100')).toBe(-100);
  });

  it('treats zero as a valid, known value -- not "missing"', () => {
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber('0')).toBe(0);
  });

  it('returns undefined (never 0) for null, undefined, or blank string', () => {
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
    expect(toFiniteNumber('')).toBeUndefined();
    expect(toFiniteNumber('   ')).toBeUndefined();
  });

  it('rejects NaN and Infinity rather than passing them through', () => {
    expect(toFiniteNumber(NaN)).toBeUndefined();
    expect(toFiniteNumber(Infinity)).toBeUndefined();
    expect(toFiniteNumber(-Infinity)).toBeUndefined();
    expect(toFiniteNumber('not-a-number')).toBeUndefined();
  });

  it('rejects non-numeric types (objects, arrays, booleans)', () => {
    expect(toFiniteNumber({})).toBeUndefined();
    expect(toFiniteNumber([])).toBeUndefined();
    expect(toFiniteNumber(true)).toBeUndefined();
  });
});

describe('PI-0003.5: buildPortfolioFinancialContext', () => {
  it('maps a realistic TastyTrade-shaped balance payload into the canonical context', () => {
    const raw = {
      'net-liquidating-value': '104250.55',
      'cash-balance': '18000.00',
      'derivative-buying-power': '65000.00',
    };
    const context = buildPortfolioFinancialContext(raw);
    expect(context.netLiquidity).toBe(104250.55);
    expect(context.cashBalance).toBe(18000);
    expect(context.availableBuyingPower).toBe(65000);
  });

  it('falls back through the documented field-name chain (option-buying-power, equity-buying-power)', () => {
    const context = buildPortfolioFinancialContext({ 'net-liquidating-value': '100000', 'option-buying-power': '40000' });
    expect(context.availableBuyingPower).toBe(40000);
  });

  it('preserves missing fields as undefined, not zero', () => {
    const context = buildPortfolioFinancialContext({ 'net-liquidating-value': '100000' });
    expect(context.cashBalance).toBeUndefined();
    expect(context.availableBuyingPower).toBeUndefined();
    expect(context.currentIncome).toBeUndefined();
    expect(context.targetIncome).toBeUndefined();
    expect(context.drawdownPct).toBeUndefined();
  });

  it('handles null, empty, and malformed raw payloads without crashing', () => {
    expect(buildPortfolioFinancialContext(null).netLiquidity).toBeUndefined();
    expect(buildPortfolioFinancialContext(undefined).netLiquidity).toBeUndefined();
    expect(buildPortfolioFinancialContext({}).netLiquidity).toBeUndefined();
    expect(buildPortfolioFinancialContext({ 'net-liquidating-value': 'garbage' }).netLiquidity).toBeUndefined();
  });

  it('handles a negative cash balance (e.g. margin debit) as a real, valid value -- not rejected', () => {
    const context = buildPortfolioFinancialContext({ 'cash-balance': '-500.00' });
    expect(context.cashBalance).toBe(-500);
  });

  it('does not mutate the raw input object', () => {
    const raw = { 'net-liquidating-value': '100000' };
    const snapshot = JSON.stringify(raw);
    buildPortfolioFinancialContext(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('computes buyingPowerUsedPct only when both maintenance-requirement and net liquidity are known and positive', () => {
    const withBoth = buildPortfolioFinancialContext({ 'net-liquidating-value': '100000', 'maintenance-requirement': '30000' });
    expect(withBoth.buyingPowerUsedPct).toBe(30);

    const missingMaintenance = buildPortfolioFinancialContext({ 'net-liquidating-value': '100000' });
    expect(missingMaintenance.buyingPowerUsedPct).toBeUndefined();

    const zeroNetLiq = buildPortfolioFinancialContext({ 'net-liquidating-value': '0', 'maintenance-requirement': '1000' });
    expect(zeroNetLiq.buyingPowerUsedPct).toBeUndefined();
  });
});

describe('PI-0003.5: derivePositionConcentration', () => {
  it('computes per-symbol exposure as a percentage of net liquidity', () => {
    const concentration = derivePositionConcentration(
      [{ symbol: 'AMD', maxRisk: 15000 }, { symbol: 'NVDA', maxRisk: 5000 }],
      100000,
    );
    expect(concentration.AMD).toBe(15);
    expect(concentration.NVDA).toBe(5);
  });

  it('sums exposure across multiple positions in the same symbol', () => {
    const concentration = derivePositionConcentration(
      [{ symbol: 'AMD', maxRisk: 8000 }, { symbol: 'AMD', maxRisk: 7000 }],
      100000,
    );
    expect(concentration.AMD).toBe(15);
  });

  it('does not fabricate a concentration result when net liquidity is unavailable', () => {
    const concentration = derivePositionConcentration([{ symbol: 'AMD', maxRisk: 15000 }], undefined);
    expect(concentration).toEqual({});
  });

  it('does not fabricate a concentration result when net liquidity is zero or negative', () => {
    expect(derivePositionConcentration([{ symbol: 'AMD', maxRisk: 15000 }], 0)).toEqual({});
    expect(derivePositionConcentration([{ symbol: 'AMD', maxRisk: 15000 }], -500)).toEqual({});
  });

  it('does not mutate the input positions array', () => {
    const positions = [{ symbol: 'AMD', maxRisk: 15000 }];
    const snapshot = JSON.stringify(positions);
    derivePositionConcentration(positions, 100000);
    expect(JSON.stringify(positions)).toBe(snapshot);
  });
});

describe('PI-0003.5: portfolio-level objectives fire from real financial data', () => {
  it('DEPLOY_IDLE_CASH fires with sufficient real idle cash and permitting buying-power/drawdown conditions', () => {
    const context = buildPortfolioIntelligenceContext(
      { netLiquidity: 100000, cashBalance: 25000, availableBuyingPower: 70000 }, // 25% idle cash, above 15% default threshold
      [],
      [],
      NOW,
    );
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'DEPLOY_IDLE_CASH')).toBe(true);
  });

  it('DEPLOY_IDLE_CASH does not fire when cash data is unavailable (stays 0, below any positive threshold)', () => {
    const context = buildPortfolioIntelligenceContext({ netLiquidity: 100000 }, [], [], NOW);
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'DEPLOY_IDLE_CASH')).toBe(false);
  });

  it('DEPLOY_IDLE_CASH never outranks a critical position-level risk objective in the combined list', () => {
    const result = computeCanonicalPortfolioPriorities(
      [{ positionId: 'pos_1', symbol: 'NVDA', strategy: 'CSP', dte: 5, buffer: 1.5, pnlPct: 10, hasGtc: true }], // assignment-risk, critical
      { netLiquidity: 100000, cashBalance: 30000, availableBuyingPower: 60000 }, // 30% idle cash
      [],
      [],
      NOW,
    );
    expect(result.objectives[0].type).toBe('REVIEW_THREATENED_POSITION');
    expect(result.objectives[0].priority).toBe('critical');
    const deployIndex = result.objectives.findIndex((o) => o.type === 'DEPLOY_IDLE_CASH');
    expect(deployIndex).toBeGreaterThan(0);
  });

  it('PRESERVE_BUYING_POWER fires when buyingPowerUsedPct breaches the policy threshold', () => {
    // maintenance-requirement / netLiquidity = 75000 / 100000 = 75%, above the 65% default max
    const raw = { 'net-liquidating-value': '100000', 'maintenance-requirement': '75000' };
    const financial = buildPortfolioFinancialContext(raw);
    const context = buildPortfolioIntelligenceContext(financial, [], [], NOW);
    const objectives = evaluatePortfolioObjectives(context);
    const preserve = objectives.find((o) => o.type === 'PRESERVE_BUYING_POWER');
    expect(preserve).toBeDefined();
    expect(preserve!.priority).toBe('high');
  });

  it('PRESERVE_BUYING_POWER does not fire when the account is within policy', () => {
    const raw = { 'net-liquidating-value': '100000', 'maintenance-requirement': '30000' }; // 30%, well under 65%
    const financial = buildPortfolioFinancialContext(raw);
    const context = buildPortfolioIntelligenceContext(financial, [], [], NOW);
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'PRESERVE_BUYING_POWER')).toBe(false);
  });

  it('REDUCE_CONCENTRATION uses net liquidity as the denominator, not an arbitrary or notional value', () => {
    const context = buildPortfolioIntelligenceContext(
      { netLiquidity: 50000 }, // smaller net liq -> same position is a larger % of the portfolio
      [{ symbol: 'AMD', maxRisk: 8000 }], // 16% of 50k, above the 10% default limit
      [],
      NOW,
    );
    const objectives = evaluatePortfolioObjectives(context);
    const reduceConcentration = objectives.find((o) => o.type === 'REDUCE_CONCENTRATION');
    expect(reduceConcentration).toBeDefined();
    expect(reduceConcentration!.supportingEvidence.some((e) => String(e.value).includes('16.0%'))).toBe(true);
  });

  it('missing net liquidity does not produce a fabricated concentration result', () => {
    const context = buildPortfolioIntelligenceContext(
      {}, // no net liquidity known
      [{ symbol: 'AMD', maxRisk: 999999 }], // would be enormous % of any real portfolio
      [],
      NOW,
    );
    expect(context.portfolio.symbolConcentrationPct).toEqual({});
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'REDUCE_CONCENTRATION')).toBe(false);
  });

  it('INCREASE_INCOME uses real income data when a target is supplied', () => {
    const context = buildPortfolioIntelligenceContext(
      { netLiquidity: 100000, targetIncome: 2000, currentIncome: 1000 }, // 50% deficit
      [],
      [],
      NOW,
    );
    const objectives = evaluatePortfolioObjectives(context);
    expect(objectives.some((o) => o.type === 'INCREASE_INCOME')).toBe(true);
  });

  it('missing income data does not silently become zero-income evidence -- INCREASE_INCOME simply stays silent', () => {
    const context = buildPortfolioIntelligenceContext({ netLiquidity: 100000 }, [], [], NOW);
    expect(context.portfolio.recurringIncomeTarget).toBe(0);
    const objectives = evaluatePortfolioObjectives(context);
    // Guarded by evaluateIncreaseIncome's own `if (recurringIncomeTarget <= 0) return null` --
    // a target of 0 is treated as "no target set", not "target of $0 with a 100% deficit".
    expect(objectives.some((o) => o.type === 'INCREASE_INCOME')).toBe(false);
  });
});

describe('PI-0003.5: integration -- realistic combined balances through the production adapter', () => {
  it('a realistic portfolio context with balances, positions, and pending orders produces the expected mix of objectives', () => {
    const raw = {
      'net-liquidating-value': '150000.00',
      'cash-balance': '35000.00',
      'derivative-buying-power': '90000.00',
      'maintenance-requirement': '40000.00', // 40000/150000 = 26.7%, well under 65% -- no PRESERVE_BUYING_POWER
    };
    const financial = buildPortfolioFinancialContext(raw);

    const result = computeCanonicalPortfolioPriorities(
      [
        { positionId: 'pos_1', symbol: 'AMD', strategy: 'BPS', dte: 25, pnlPct: 55, buffer: 8, hasGtc: true }, // close-winner
      ],
      financial,
      [{ symbol: 'AMD', maxRisk: 12000 }], // 8% of 150k -- under the 10% limit, no REDUCE_CONCENTRATION
      [{ id: 'order_1', symbol: 'MU', strategy: 'OPEN_BPS', createdAt: new Date(NOW.getTime() - 300 * 60_000).toISOString(), status: 'working' }],
      NOW,
    );

    const types = result.objectives.map((o) => o.type);
    expect(types).toContain('CLOSE_FOR_PROFIT'); // position-level
    // 35000 / 150000 = 23.3% idle cash, above the 15% default threshold
    expect(types).toContain('DEPLOY_IDLE_CASH'); // portfolio-level, from real balances
    expect(types).toContain('REVIEW_PENDING_ORDER'); // pending-order
    expect(types).not.toContain('PRESERVE_BUYING_POWER');
    expect(types).not.toContain('REDUCE_CONCENTRATION');

    for (const objective of result.objectives) {
      expect(objective.metadata.executionAllowed).toBe(false);
      expect(objective.metadata.paperExecutionAllowed).toBe(false);
    }
  });
});
