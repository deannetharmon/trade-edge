// lib/help/__tests__/optionsStrategyReference.test.ts
//
// HELP-0001 — Options Strategy Reference content-model tests. Verifies the
// canonical data model itself: strategy identifiers, required fields, goal
// mapping, and every approved dollar example, independent of any UI.
import { describe, it, expect } from 'vitest';
import {
  STRATEGIES,
  GOALS,
  getStrategy,
  getGoal,
  getStrategiesForGoal,
  getOutlookLabel,
  CONTENT_VERSION,
  LAST_REVIEWED,
  MAX_COMPARISON_STRATEGIES,
  COMPARISON_LIMIT_MESSAGE,
  EDUCATIONAL_DISCLAIMER,
  type StrategyId,
} from '../optionsStrategyReference';

const REQUIRED_STRATEGY_IDS: StrategyId[] = [
  'covered_call',
  'cash_secured_put',
  'poor_mans_covered_call',
  'bull_put_spread',
  'bear_call_spread',
  'bull_call_spread',
  'iron_condor',
  'long_leaps_call',
];

const REQUIRED_FIELDS = [
  'strategyId', 'displayName', 'applicableGoals', 'typicalOutlook', 'plainSummary',
  'scenarioResponses', 'mechanicalLabels', 'positionLegs', 'exampleInputs', 'exampleOutputs',
  'maxProfitExplanation', 'maxLossExplanation', 'expirationBreakeven', 'timeDecay', 'volatility',
  'assignmentExercise', 'useWhen', 'avoidWhen', 'beginnerMisunderstanding', 'caveats',
  'contentVersion', 'lastReviewed',
] as const;

describe('all eight unique strategy identifiers', () => {
  it('exposes exactly the 8 required strategyIds, each exactly once', () => {
    const ids = STRATEGIES.map(s => s.strategyId);
    expect(ids.sort()).toEqual([...REQUIRED_STRATEGY_IDS].sort());
    expect(new Set(ids).size).toBe(8);
  });

  it('every required id resolves via getStrategy()', () => {
    for (const id of REQUIRED_STRATEGY_IDS) {
      expect(getStrategy(id)?.strategyId).toBe(id);
    }
  });
});

describe('complete required fields for every strategy', () => {
  it.each(REQUIRED_STRATEGY_IDS)('%s has every required field, non-empty', (id) => {
    const s = getStrategy(id)!;
    for (const field of REQUIRED_FIELDS) {
      expect(s).toHaveProperty(field);
      const value = (s as any)[field];
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
      if (typeof value === 'string') expect(value.length).toBeGreaterThan(0);
      if (Array.isArray(value)) expect(value.length).toBeGreaterThan(0);
    }
    // mechanicalLabels sub-fields
    expect(s.mechanicalLabels.riskLabel.length).toBeGreaterThan(0);
    expect(s.mechanicalLabels.capitalType.length).toBeGreaterThan(0);
    expect(s.mechanicalLabels.positionShape.length).toBeGreaterThan(0);
    // scenarioResponses: falls sharply / stays near price / rises sharply
    expect(s.scenarioResponses.fallsSharply.length).toBeGreaterThan(0);
    expect(s.scenarioResponses.staysNearPrice.length).toBeGreaterThan(0);
    expect(s.scenarioResponses.risesSharply.length).toBeGreaterThan(0);
    // position-leg diagram data
    expect(s.positionLegs.length).toBeGreaterThan(0);
    for (const leg of s.positionLegs) {
      expect(['Own', 'Buy', 'Sell']).toContain(leg.action);
      expect(['Stock', 'Call', 'Put']).toContain(leg.instrument);
      expect(leg.quantity).toBeGreaterThan(0);
    }
  });

  it('content version and last-reviewed date are consistent across every strategy', () => {
    for (const s of STRATEGIES) {
      expect(s.contentVersion).toBe(CONTENT_VERSION);
      expect(s.lastReviewed).toBe(LAST_REVIEWED);
      expect(s.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('exact goal-to-strategy mappings', () => {
  it('defines exactly the 6 required goals', () => {
    expect(GOALS.length).toBe(6);
  });

  it('Generate income from shares I own -> Covered Call, PMCC', () => {
    const ids = getStrategiesForGoal('income_from_shares').map(s => s.strategyId).sort();
    expect(ids).toEqual(['covered_call', 'poor_mans_covered_call'].sort());
  });

  it('Get paid while waiting to buy shares -> Cash-Secured Put only', () => {
    const ids = getStrategiesForGoal('income_while_waiting').map(s => s.strategyId);
    expect(ids).toEqual(['cash_secured_put']);
  });

  it('Make a bullish trade with limited risk -> Bull Put Spread, Bull Call Spread, PMCC', () => {
    const ids = getStrategiesForGoal('bullish_limited_risk').map(s => s.strategyId).sort();
    expect(ids).toEqual(['bull_call_spread', 'bull_put_spread', 'poor_mans_covered_call'].sort());
  });

  it('Make a bearish trade with limited risk -> Bear Call Spread only', () => {
    const ids = getStrategiesForGoal('bearish_limited_risk').map(s => s.strategyId);
    expect(ids).toEqual(['bear_call_spread']);
  });

  it('Trade a range or neutral outlook -> IC, CC, CSP, BPS (neutral to bullish), BCS (neutral to bearish)', () => {
    const ids = getStrategiesForGoal('neutral_range').map(s => s.strategyId).sort();
    expect(ids).toEqual(['bear_call_spread', 'bull_put_spread', 'cash_secured_put', 'covered_call', 'iron_condor'].sort());
    expect(getOutlookLabel('neutral_range', 'bull_put_spread')).toBe('Neutral to bullish');
    expect(getOutlookLabel('neutral_range', 'bear_call_spread')).toBe('Neutral to bearish');
  });

  it('Invest for long-term upside with less capital than 100 shares -> Long LEAPS Call, PMCC', () => {
    const ids = getStrategiesForGoal('long_term_leverage').map(s => s.strategyId).sort();
    expect(ids).toEqual(['long_leaps_call', 'poor_mans_covered_call'].sort());
  });

  it('outside of the neutral goal context, Bull Put/Bear Call keep their own typicalOutlook (not overridden globally)', () => {
    expect(getStrategy('bull_put_spread')!.typicalOutlook).toBe('Bullish');
    expect(getStrategy('bear_call_spread')!.typicalOutlook).toBe('Bearish');
    expect(getOutlookLabel('bullish_limited_risk', 'bull_put_spread')).toBe('Bullish');
    expect(getOutlookLabel(null, 'bull_put_spread')).toBe('Bullish');
  });

  it('every strategy applicableGoals field matches its actual GOALS membership (no drift)', () => {
    for (const s of STRATEGIES) {
      const expectedGoals = GOALS.filter(g => g.strategies.some(l => l.strategyId === s.strategyId)).map(g => g.id).sort();
      expect([...s.applicableGoals].sort()).toEqual(expectedGoals);
    }
  });
});

describe('all example calculations', () => {
  it('Covered Call: 100sh@$50, sell $55 call for $2 -> max profit $700, breakeven $48, max loss $4,800', () => {
    const s = getStrategy('covered_call')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$700');
    expect(out['Breakeven']).toBe('$48.00 per share');
    expect(out['Maximum theoretical loss']).toMatch(/^\$4,800/);
  });

  it('Cash-Secured Put: sell $50 put for $2 -> max profit $200, breakeven $48, max loss $4,800', () => {
    const s = getStrategy('cash_secured_put')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$200');
    expect(out['Breakeven']).toBe('$48.00 per share');
    expect(out['Maximum theoretical loss']).toMatch(/^\$4,800/);
  });

  it('Bull Put Spread: sell $50p/buy $45p, $1 credit -> max profit $100, max loss $400, breakeven $49', () => {
    const s = getStrategy('bull_put_spread')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$100');
    expect(out['Maximum loss']).toBe('$400');
    expect(out['Breakeven']).toBe('$49.00');
  });

  it('Bear Call Spread: sell $50c/buy $55c, $1 credit -> max profit $100, max loss $400, breakeven $51', () => {
    const s = getStrategy('bear_call_spread')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$100');
    expect(out['Maximum loss']).toBe('$400');
    expect(out['Breakeven']).toBe('$51.00');
  });

  it('Bull Call Spread: buy $50c/sell $55c, $2 debit -> max profit $300, max loss $200, breakeven $52', () => {
    const s = getStrategy('bull_call_spread')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$300');
    expect(out['Maximum loss']).toBe('$200');
    expect(out['Breakeven']).toBe('$52.00');
  });

  it('Iron Condor: 40/45/55/60, $1.50 credit -> max profit $150, max loss $350, breakevens 43.50/56.50, range $45-$55', () => {
    const s = getStrategy('iron_condor')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).toBe('$150');
    expect(out['Maximum loss']).toBe('$350');
    expect(out['Breakevens']).toBe('$43.50 and $56.50');
    expect(out['Preferred expiration range']).toBe('$45–$55');
  });

  it('Long LEAPS Call: buy 12mo $50c for $10 -> max loss $1,000, breakeven $60, $70 -> $1,000 profit, max profit unlimited', () => {
    const s = getStrategy('long_leaps_call')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum loss']).toBe('$1,000');
    expect(out['Breakeven']).toBe('$60.00');
    expect(out['Profit if stock is $70 at expiration']).toBe('$1,000');
    expect(out['Maximum profit']).toMatch(/unlimited/i);
  });

  it('PMCC: buy 12mo $40c for $12, sell 30d $55c for $2 -> initial net debit $1,000', () => {
    const s = getStrategy('poor_mans_covered_call')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Initial net debit']).toMatch(/^\$1,000/);
  });
});

describe('PMCC has no fabricated fixed maximum profit or simple breakeven', () => {
  it('Maximum profit is NOT a single dollar figure', () => {
    const s = getStrategy('poor_mans_covered_call')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Maximum profit']).not.toMatch(/^\$[\d,]+(\.\d{2})?$/);
    expect(out['Maximum profit']).toMatch(/no single fixed maximum/i);
  });

  it('Breakeven is NOT a single dollar figure', () => {
    const s = getStrategy('poor_mans_covered_call')!;
    const out = Object.fromEntries(s.exampleOutputs.map(o => [o.label, o.value]));
    expect(out['Breakeven']).not.toMatch(/^\$[\d,]+(\.\d{2})?$/);
    expect(out['Breakeven']).toMatch(/no single simple breakeven/i);
  });

  it('maxProfitExplanation and expirationBreakeven prose both explicitly disclaim a single fixed answer', () => {
    const s = getStrategy('poor_mans_covered_call')!;
    expect(s.maxProfitExplanation).toMatch(/does not have one fixed maximum profit/i);
    expect(s.expirationBreakeven).toMatch(/no single simple portfolio breakeven/i);
  });

  it('maxLossExplanation and assignmentExercise explain results can differ from the initial net debit', () => {
    const s = getStrategy('poor_mans_covered_call')!;
    expect(s.maxLossExplanation).toMatch(/different (realized )?result than the initial debit/i);
    expect(s.assignmentExercise).toMatch(/different realized result than simply closing/i);
  });
});

describe('Bull Call Spread and Bear Call Spread remain unambiguous', () => {
  it('neither strategy display name nor identifiers use the bare token "BCS"', () => {
    for (const s of STRATEGIES) {
      expect(s.displayName).not.toMatch(/\bBCS\b/);
      expect(s.strategyId).not.toBe('BCS' as any);
    }
  });

  it('Bull Call Spread and Bear Call Spread have distinct, fully-worded display names', () => {
    expect(getStrategy('bull_call_spread')!.displayName).toBe('Bull Call Spread');
    expect(getStrategy('bear_call_spread')!.displayName).toBe('Bear Call Spread');
    expect(getStrategy('bull_call_spread')!.displayName).not.toBe(getStrategy('bear_call_spread')!.displayName);
  });

  it('Bull Call Spread time decay explanation is qualified by stock price relative to strikes and time remaining (accuracy refinement)', () => {
    const s = getStrategy('bull_call_spread')!;
    expect(s.timeDecay).toMatch(/depends on the stock price relative to the strikes and the time remaining/i);
  });

  it('credit-spread and iron condor time-decay descriptions are qualified — theta can change as the underlying moves through the strikes', () => {
    for (const id of ['bull_put_spread', 'bear_call_spread', 'iron_condor'] as StrategyId[]) {
      const s = getStrategy(id)!;
      expect(s.timeDecay).toMatch(/theta behavior can change as the underlying moves through/i);
    }
  });

  it('no strategy guarantees expiration or non-assignment exactly at a strike', () => {
    for (const s of STRATEGIES) {
      const combined = `${s.expirationBreakeven} ${s.assignmentExercise}`;
      expect(combined).not.toMatch(/will (expire|close) exactly at/i);
      expect(combined).not.toMatch(/guaranteed to (expire|close|land) (exactly )?at/i);
    }
  });

  it('"Defined risk does not necessarily mean small risk" is retained on every defined-risk strategy', () => {
    const definedRiskIds: StrategyId[] = ['poor_mans_covered_call', 'bull_put_spread', 'bear_call_spread', 'bull_call_spread', 'iron_condor', 'long_leaps_call'];
    for (const id of definedRiskIds) {
      const s = getStrategy(id)!;
      expect(s.caveats.some(c => c.includes('Defined risk does not necessarily mean small risk'))).toBe(true);
    }
  });

  it('protective long legs require correct exercise/expiration handling is explained for multi-leg defined-risk strategies', () => {
    for (const id of ['bull_put_spread', 'bear_call_spread', 'bull_call_spread', 'iron_condor'] as StrategyId[]) {
      const s = getStrategy(id)!;
      expect(s.caveats.some(c => /exercised, sold, or allowed to expire correctly/i.test(c))).toBe(true);
    }
    // PMCC's long leg gets its own dedicated wording (it's the core stock-substitute leg, not a pure hedge).
    const pmcc = getStrategy('poor_mans_covered_call')!;
    expect(pmcc.caveats.some(c => /long LEAPS call must be exercised, sold, or allowed to expire correctly/i.test(c))).toBe(true);
  });

  it('broker buying-power treatment may differ from simplified capital examples is explained for every strategy', () => {
    for (const s of STRATEGIES) {
      expect(s.caveats.some(c => /buying-power (effect|treatment)/i.test(c) || /margin\/buying-power treatment/i.test(c))).toBe(true);
    }
  });
});

describe('educational disclaimer, content version, and review date (module-level)', () => {
  it('exposes a non-empty educational disclaimer that disclaims personalized advice and suitability', () => {
    expect(EDUCATIONAL_DISCLAIMER.length).toBeGreaterThan(0);
    expect(EDUCATIONAL_DISCLAIMER).toMatch(/educational/i);
    expect(EDUCATIONAL_DISCLAIMER).toMatch(/not.*(personalized|suitability)/i);
  });

  it('exposes a content version and a valid last-reviewed ISO date', () => {
    expect(CONTENT_VERSION.length).toBeGreaterThan(0);
    expect(LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exposes the exact comparison-limit constants used by the UI', () => {
    expect(MAX_COMPARISON_STRATEGIES).toBe(3);
    expect(COMPARISON_LIMIT_MESSAGE).toBe('You can compare up to three strategies at a time. Remove one to add another.');
  });
});

describe('no coupling to recommendation or execution modules', () => {
  it('the content-model source file contains no imports at all (fully standalone)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'optionsStrategyReference.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    expect(importLines).toEqual([]);
  });
});
