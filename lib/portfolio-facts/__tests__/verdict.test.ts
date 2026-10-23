// lib/portfolio-facts/__tests__/verdict.test.ts
//
// RECO-UNIFY-0001B: golden fixtures for the one verdict. These PIN what the live engine does today at each hard-rule boundary (no threshold
// changes in this ticket): exactly 50% captured, 21 and 22 DTE, a loss just under and at the 2x-credit stop, and earnings before expiry.
// Plus: the verdict is exactly what the app shows (same label as the live recommendation), is deterministic, and never mutates its input.

import { describe, expect, it } from 'vitest';
import { scorePortfolioPositionObjective } from '@/lib/portfolio-data/acquisition';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildPositionFacts } from '../positionFacts';
import { computeVerdict, INTENT_BUCKET, type VerdictIntent } from '../verdict';

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

type Golden = { name: string; pos: Position; intent: VerdictIntent; bucket: string; hardRule: string | null; rule?: string };
const GOLDEN: Golden[] = [
  { name: 'calm position', pos: income(), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: '49% of credit captured', pos: income({ pnl: 98, pnlPct: 49, currentValue: 102, closeValue: 102 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'exactly 50% captured', pos: income({ pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true }), intent: 'TAKE_PROFIT', bucket: 'Close', hardRule: null, rule: 'profit-target-reached' },
  { name: '50% captured, no GTC working', pos: income({ pnl: 100, pnlPct: 50, currentValue: 100, closeValue: 100, hitTarget: true, hasGtc: false }), intent: 'TAKE_PROFIT', bucket: 'Close', hardRule: null, rule: 'profit-target-reached' },
  { name: '22 DTE', pos: income({ dte: 22 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'exactly 21 DTE', pos: income({ dte: 21 }), intent: 'HOLD_POSITION', bucket: 'Roll', hardRule: 'roll-soon' },
  { name: '20 DTE', pos: income({ dte: 20 }), intent: 'HOLD_POSITION', bucket: 'Roll', hardRule: 'roll-soon' },
  { name: 'loss just under the 2x-credit stop', pos: income({ pnl: -198, pnlPct: -99, currentValue: 398, closeValue: 398 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
  { name: 'loss exactly at the 2x-credit stop', pos: income({ pnl: -200, pnlPct: -100, currentValue: 400, closeValue: 400 }), intent: 'CUT_LOSSES', bucket: 'Close', hardRule: null, rule: 'material-loss' },
  { name: 'loss past the stop', pos: income({ pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 }), intent: 'CUT_LOSSES', bucket: 'Close', hardRule: null, rule: 'material-loss' },
  { name: 'earnings before expiry', pos: income({ earningsDate: '2026-09-01' }), intent: 'HOLD_POSITION', bucket: 'Manage', hardRule: 'earnings-risk' },
  { name: 'acquire put in a deep paper loss is never a loss exit', pos: csp({ intent: 'acquisition', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 }), intent: 'HOLD_POSITION', bucket: 'Hold', hardRule: null },
];

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

describe('confidence is computed by the app from completeness and intent source', () => {
  it('incomplete economics lowers it one level and says why', () => {
    const full = verdictOf(GOLDEN[2].pos, { intentWasSet: true });
    const noClose = verdictOf({ ...GOLDEN[2].pos, closeValue: null, closeNowPnl: null } as Position, { intentWasSet: true });
    const order = ['LOW', 'MEDIUM', 'HIGH'];
    expect(order.indexOf(noClose.confidence.level)).toBeLessThanOrEqual(order.indexOf(full.confidence.level));
    expect(noClose.confidence.basis.join(' ')).toMatch(/economics incomplete/);
  });
  it('a defaulted intent lowers it and says so; an unknown source only notes it', () => {
    const set = verdictOf(GOLDEN[2].pos, { intentWasSet: true });
    const defaulted = verdictOf(GOLDEN[2].pos, { intentWasSet: false });
    const unknown = verdictOf(GOLDEN[2].pos);
    expect(defaulted.confidence.basis.join(' ')).toMatch(/intent defaulted/);
    expect(unknown.confidence.basis.join(' ')).toMatch(/intent source unknown/);
    expect(unknown.confidence.level).toBe(set.confidence.level);
    expect(['LOW', 'MEDIUM', 'HIGH'].indexOf(defaulted.confidence.level)).toBeLessThan(['LOW', 'MEDIUM', 'HIGH'].indexOf(set.confidence.level));
  });
});
