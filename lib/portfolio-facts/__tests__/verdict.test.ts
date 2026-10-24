// lib/portfolio-facts/__tests__/verdict.test.ts
//
// RECO-UNIFY-0001B: golden fixtures for the one verdict. These PIN what the live engine does today at each hard-rule boundary (no threshold
// changes in this ticket): exactly 50% captured, 21 and 22 DTE, a loss just under and at the 2x-credit stop, and earnings before expiry.
// Plus: the verdict is exactly what the app shows (same label as the live recommendation), is deterministic, and never mutates its input.

import { describe, expect, it } from 'vitest';
import { scorePortfolioPositionObjective } from '@/lib/portfolio-data/acquisition';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildPositionFacts } from '../positionFacts';
import { computeConfidence, computeVerdict, HARD_RULE_BUCKET, INTENT_BUCKET, type VerdictIntent } from '../verdict';
import PRE_REFACTOR from './pre-refactor-golden.json';

const NOW = new Date('2026-08-10T18:00:00.000Z');
const shortPut: PositionLeg = { symbol: 'NVDA 260918P00190000', optionType: 'P', strikePrice: 190, direction: 'Short', quantity: 1, avgOpenPrice: 2.0, currentPrice: null } as PositionLeg;

function csp(overrides: Partial<Position> = {}): Position {
  return {
    key: 'NVDA::2026-09-18', symbol: 'NVDA', expDate: '2026-09-18', dte: 40, strategy: 'PUT', legs: [shortPut],
    quantity: 1, identity: null, structureAmbiguous: false, structureBlockMessage: null,
    entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 200, creditReceived: 200,
    currentValue: 190, closeValue: 190, closeNowPnl: null, pnl: 10, pnlPct: 5, pnlReliable: true,
    intent: 'acquisition', plOpen: null, targetPrice: 100, profitTarget: 0.5, hitTarget: false, needsClose: false,
    maxRisk: 18800, maxRiskReliable: true, entryDte: 45, entryDate: '2026-08-01', accountNumber: 'ACCT-1',
    ivr: 50, iv: 40, hv30: 35, beta: 1.1, netDelta: 0.2, netVega: -0.2, pop: 75, hasGtc: true,
    gtcOrderId: 'gtc-1', gtcOrderPrice: 1.0, stopLossStatus: 'none', stopLossPrice: null,
    stopLossPolicy: null, stopLossDisplayPolicy: null, stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null, quoteWidthEvidence: null, quoteCapturedAt: null, stockPrice: 210,
    buffer: 9.5, putBufferPct: 9.5, callBufferPct: null, theta: 0.5, gamma: -0.02, earningsDate: null,
    ...overrides,
  } as Position;
}


const verdictOf = (p: Position, ctx: Parameters<typeof buildPositionFacts>[1] = {}) => computeVerdict(buildPositionFacts(p, { now: NOW, ...ctx }, 'snap'))!;

const income = (o: Partial<Position> = {}) => csp({ intent: 'income', ...o });
const longPut: PositionLeg = { ...shortPut, symbol: 'NVDA 260918P00185000', strikePrice: 185, direction: 'Long', avgOpenPrice: 1.0 } as PositionLeg;
// The 21-DTE window applies to spreads, iron condors and PMCC short legs, not to CSP and CC (Dean, 2026-10-17, DECIDE-0001): boundary fixtures use a spread.
const spread = (o: Partial<Position> = {}) => csp({ strategy: 'BPS', intent: 'income', legs: [shortPut, longPut], ...o });

type Golden = { name: string; pos: Position; intent: VerdictIntent; bucket: string; hardRule: string | null; rule?: string };
const GOLDEN: Golden[] = [
  { name: 'calm position', pos: income(), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: '49% of credit captured', pos: income({ pnl: 98, pnlPct: 49, currentValue: 102, closeValue: 102 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'exactly 50% captured', pos: income({ pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true }), intent: 'TAKE_PROFIT', bucket: 'Close', hardRule: null, rule: 'profit-target-reached' },
  { name: '50% captured, no GTC working', pos: income({ pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true, hasGtc: false }), intent: 'TAKE_PROFIT', bucket: 'Close', hardRule: null, rule: 'profit-target-reached' },
  { name: 'spread: 49% captured', pos: spread({ pnl: 98, pnlPct: 49, currentValue: 102, closeValue: 102 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'spread: exactly 50% captured', pos: spread({ pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true }), intent: 'TAKE_PROFIT', bucket: 'Close', hardRule: null, rule: 'profit-target-reached' },
  { name: 'spread: 22 DTE', pos: spread({ dte: 22 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'spread: exactly 21 DTE', pos: spread({ dte: 21 }), intent: 'HOLD_POSITION', bucket: 'Roll', hardRule: 'roll-soon' },
  { name: 'spread: 8 DTE (last day of the window)', pos: spread({ dte: 8 }), intent: 'HOLD_POSITION', bucket: 'Roll', hardRule: 'roll-soon' },
  { name: 'spread: 7 DTE (window over, scoring takes it)', pos: spread({ dte: 7 }), intent: 'REDUCE_RISK', bucket: 'Manage', hardRule: null },
  { name: 'loss just under the 2x-credit stop', pos: income({ pnl: -198, pnlPct: -99, currentValue: 398, closeValue: 398 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'loss exactly at the 2x-credit stop', pos: income({ pnl: -200, pnlPct: -100, currentValue: 400, closeValue: 400 }), intent: 'CUT_LOSSES', bucket: 'Close', hardRule: null, rule: 'material-loss' },
  { name: 'loss past the stop', pos: income({ pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 }), intent: 'CUT_LOSSES', bucket: 'Close', hardRule: null, rule: 'material-loss' },
  { name: 'spread: loss just under the stop', pos: spread({ pnl: -198, pnlPct: -99, currentValue: 398, closeValue: 398 }), intent: 'REDUCE_RISK', bucket: 'Manage', hardRule: null },
  { name: 'spread: loss exactly at the stop', pos: spread({ pnl: -200, pnlPct: -100, currentValue: 400, closeValue: 400 }), intent: 'CUT_LOSSES', bucket: 'Close', hardRule: null, rule: 'material-loss' },
  { name: 'spread: earnings on the expiry date', pos: spread({ earningsDate: '2026-09-18' }), intent: 'HOLD_POSITION', bucket: 'Manage', hardRule: 'earnings-risk' },
  { name: 'spread: earnings the day after expiry', pos: spread({ earningsDate: '2026-09-19' }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'spread: earnings already past', pos: spread({ earningsDate: '2026-08-01' }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'earnings before expiry (CSP)', pos: income({ earningsDate: '2026-09-01' }), intent: 'HOLD_POSITION', bucket: 'Manage', hardRule: 'earnings-risk' },
  { name: 'acquire put in a deep paper loss is never a loss exit', pos: csp({ intent: 'acquisition', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'wheel put at 21 DTE gets no roll suggestion', pos: csp({ intent: 'wheel', dte: 21 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
];

// DTE-CSP-CC-0001 (Dean, DECIDE-0001 2026-10-17): no 21-DTE roll for a CSP or covered call; spreads and PMCC short legs keep it.
const shortCall: PositionLeg = { ...shortPut, symbol: 'NVDA 260918C00230000', optionType: 'C', strikePrice: 230 } as PositionLeg;
const cc = (o: Partial<Position> = {}) => csp({ strategy: 'CALL', intent: 'income', legs: [shortCall], ...o });
describe('DTE-CSP-CC-0001: no 21-DTE roll for CSP and covered call', () => {
  it.each([22, 21, 8, 7])('Income CSP at %i DTE is never roll-soon', dte => {
    const v = verdictOf(income({ dte }));
    expect(v.hardRule?.kind).not.toBe('roll-soon');
    if (dte >= 8) expect(v.bucket).toBe('Hold');
  });
  it.each([22, 21, 8])('covered call at %i DTE is never roll-soon', dte => {
    const v = verdictOf(cc({ dte }));
    expect(v.hardRule?.kind).not.toBe('roll-soon');
    expect(v.bucket).toBe('Hold');
  });
  it('a PMCC short call at 21 DTE still gets roll-soon', () => {
    const v = verdictOf(cc({ dte: 21, isPmccShortLeg: true }));
    expect(v.hardRule?.kind).toBe('roll-soon');
    expect(v.bucket).toBe('Roll');
  });
  it('hard rules still apply to CSP and CC at 21 DTE', () => {
    expect(verdictOf(income({ dte: 21, pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true })).bucket).toBe('Close');
    expect(verdictOf(income({ dte: 21, pnl: -200, pnlPct: -100, currentValue: 400, closeValue: 400 })).bucket).toBe('Close');
    const ccLoss = { pnl: -200, pnlPct: -100, currentValue: 400, closeValue: 400 };
    expect(verdictOf(cc({ dte: 21, ...ccLoss })).bucket).toBe(verdictOf(cc({ dte: 40, ...ccLoss })).bucket);
  });
});

describe('golden verdicts at the hard-rule boundaries', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const v = verdictOf(g.pos);
      expect(v.intent).toBe(g.intent);
      expect(v.bucket).toBe(g.bucket);
      expect(v.hardRule?.kind ?? null).toBe(g.hardRule);
      if (g.rule) expect(v.reasons.map(r => r.ruleId)).toContain(g.rule);
    });
  }
});

describe('the verdict is what the app shows', () => {
  for (const g of GOLDEN) {
    for (const trend of [undefined, 'uptrend', 'downtrend'] as const) {
      it(`${g.name} / trend ${trend ?? 'none'}: same label and intent as the live recommendation`, () => {
        const live = scorePortfolioPositionObjective(g.pos, NOW, false, trend).recommendation;
        const v = verdictOf(g.pos, { trendDirection: trend });
        expect(v.label).toBe(live.label);
        expect(v.intent).toBe(live.managementIntent?.intent);
        expect(v.legacyKind).toBe(live.kind);
      });
    }
  }
});

// The snapshot in pre-refactor-golden.json was produced by running these same fixtures through scorePortfolioPositionObjective at the commit
// BEFORE the builder was extracted (8f2f947). It is what proves the extraction changed nothing; the live-vs-verdict parity above cannot.
describe('the live recommendation is unchanged from before the refactor', () => {
  for (const g of GOLDEN) {
    for (const trend of [undefined, 'uptrend', 'downtrend'] as const) {
      const key = `${g.name}|${trend ?? 'none'}`;
      it(key, () => {
        const r = scorePortfolioPositionObjective(g.pos, NOW, false, trend).recommendation;
        expect({ kind: r.kind, label: r.label, urgency: r.urgency, primary: r.primaryReason, intent: r.managementIntent?.intent ?? null }).toEqual((PRE_REFACTOR as Record<string, unknown>)[key]);
      });
    }
  }
});

describe('LABEL-CONSISTENCY-0001: the label never contradicts the bucket', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const r = scorePortfolioPositionObjective(g.pos, NOW, false, undefined).recommendation;
      const intent = r.managementIntent?.intent;
      if (intent && intent !== 'HOLD_POSITION' && intent !== 'DEPLOY_IDLE_CASH') expect(r.label).toBe(r.managementIntent!.label);
    });
  }
});

describe('verdict structure', () => {
  it('every reason names its rule id and the fact it reacted to', () => {
    const v = verdictOf(GOLDEN[2].pos);
    const r = v.reasons.find(x => x.ruleId === 'profit-target-reached')!;
    expect(r.dataPoint).toBe('profitTargetReached');
    expect(r.value).toBe(50);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('maps every position intent to a bucket (idle cash is portfolio-level and has none)', () => {
    expect(Object.keys(INTENT_BUCKET).sort()).toEqual(['ACCEPT_ASSIGNMENT', 'CUT_LOSSES', 'HOLD_POSITION', 'REDUCE_RISK', 'REPLACE_WORKING_ORDER', 'ROLL_POSITION', 'SET_PROFIT_TARGET', 'TAKE_PROFIT']);
    expect(INTENT_BUCKET.HOLD_POSITION).toBe('Hold');
    expect(INTENT_BUCKET.ACCEPT_ASSIGNMENT).toBe('Hold');
    expect(INTENT_BUCKET.SET_PROFIT_TARGET).toBe('Manage');
    expect(INTENT_BUCKET.TAKE_PROFIT).toBe('Close');
    expect(INTENT_BUCKET.CUT_LOSSES).toBe('Close');
    expect(INTENT_BUCKET.ROLL_POSITION).toBe('Roll');
  });

  it('carries the snapshot id from the facts', () => {
    expect(verdictOf(GOLDEN[0].pos).snapshotId).toBe('snap');
  });

  it('is deterministic and never mutates the facts', () => {
    const facts = buildPositionFacts(GOLDEN[2].pos, { now: NOW }, 's');
    const before = JSON.stringify(facts);
    const a = computeVerdict(facts);
    const b = computeVerdict(facts);
    expect(a).toEqual(b);
    expect(JSON.stringify(facts)).toBe(before);
  });
});

describe('hard rules can never be shown as Hold', () => {
  it('a profit exit or a loss stop that the rule layer keeps for display is Close, not Hold', () => {
    expect(HARD_RULE_BUCKET['close-winner']).toBe('Close');
    expect(HARD_RULE_BUCKET['close-loser']).toBe('Close');
    expect(HARD_RULE_BUCKET['roll-soon']).toBe('Roll');
    for (const kind of ['earnings-risk', 'assignment-risk', 'verify-pricing', 'place-gtc']) expect(HARD_RULE_BUCKET[kind]).toBe('Manage');
  });
});

describe('confidence is computed by the app from the engine margin, completeness and intent source', () => {
  const facts = (over: { credit?: number | null; pnlPct?: number | null; intentWasSet?: boolean | null } = {}) => ({
    engineInput: { symbol: 'X', creditReceived: over.credit === undefined ? 200 : over.credit, pnlPct: over.pnlPct === undefined ? 10 : over.pnlPct },
    identity: { intentWasSet: over.intentWasSet === undefined ? true : over.intentWasSet },
  }) as unknown as Parameters<typeof computeConfidence>[0];

  it('maps the engine tier straight through when the data is complete and the intent was chosen', () => {
    expect(computeConfidence(facts(), 'High').level).toBe('HIGH');
    expect(computeConfidence(facts(), 'Medium').level).toBe('MEDIUM');
    expect(computeConfidence(facts(), 'Low').level).toBe('LOW');
  });
  it('a missing credit or P/L lowers it exactly one level and says why', () => {
    const c = computeConfidence(facts({ credit: null }), 'High');
    expect(c.level).toBe('MEDIUM');
    expect(c.basis.join(' ')).toMatch(/economics incomplete/);
    expect(computeConfidence(facts({ pnlPct: null }), 'High').level).toBe('MEDIUM');
  });
  it('a defaulted intent lowers it exactly one level; an unknown source only notes it', () => {
    const d = computeConfidence(facts({ intentWasSet: false }), 'High');
    expect(d.level).toBe('MEDIUM');
    expect(d.basis.join(' ')).toMatch(/intent defaulted/);
    const u = computeConfidence(facts({ intentWasSet: null }), 'High');
    expect(u.level).toBe('HIGH');
    expect(u.basis.join(' ')).toMatch(/intent source unknown/);
  });
  it('both gaps lower it two levels and it never goes below LOW', () => {
    expect(computeConfidence(facts({ credit: null, intentWasSet: false }), 'High').level).toBe('LOW');
    expect(computeConfidence(facts({ credit: null, intentWasSet: false }), 'Low').level).toBe('LOW');
  });
  it('a calm hold reads MEDIUM, not LOW, and a defaulted intent does not lower it (never HIGH)', () => {
    const c = computeConfidence(facts({ intentWasSet: false }), 'Low', true);
    expect(c.level).toBe('MEDIUM');
    expect(c.basis.join(' ')).toMatch(/calm hold/);
    expect(computeConfidence(facts(), 'High', true).level).toBe('HIGH');
    expect(computeConfidence(facts({ credit: null }), 'Low', true).level).toBe('LOW');
  });
});
describe('a calm CSP hold shows MEDIUM; a firing rule keeps the engine margin', () => {
  it('calm Income put: Hold, MEDIUM', () => { const v = verdictOf(income()); expect(v.bucket).toBe('Hold'); expect(v.confidence.level).toBe('MEDIUM'); });
  it('a hard rule is not calm', () => { expect(verdictOf(income({ earningsDate: '2026-09-01' })).confidence.basis.join(' ')).not.toMatch(/calm hold/); });
});
