// lib/portfolio-facts/__tests__/secondLook.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildPositionFacts } from '../positionFacts';
import { computeVerdict } from '../verdict';
import { aiBucketOf, buildSecondLook, DATA_POINTS, SECOND_LOOK_PROMPT_SUFFIX } from '../secondLook';

const NOW = new Date('2026-08-10T18:00:00.000Z');
const shortPut = { symbol: 'NVDA 260918P00190000', optionType: 'P', strikePrice: 190, direction: 'Short', quantity: 1, avgOpenPrice: 2.0, currentPrice: null } as PositionLeg;
const pos = (o: Partial<Position> = {}) => ({
  key: 'NVDA::2026-09-18', symbol: 'NVDA', expDate: '2026-09-18', dte: 40, strategy: 'PUT', legs: [shortPut], quantity: 1, identity: null, structureAmbiguous: false, structureBlockMessage: null,
  entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 200, creditReceived: 200, currentValue: 190, closeValue: 190, closeNowPnl: null, pnl: 10, pnlPct: 5, pnlReliable: true,
  intent: 'income', plOpen: null, targetPrice: 100, profitTarget: 0.5, hitTarget: false, needsClose: false, maxRisk: 18800, maxRiskReliable: true, entryDte: 45, entryDate: '2026-08-01', accountNumber: 'ACCT-1',
  ivr: 50, iv: 40, hv30: 35, beta: 1.1, netDelta: 0.2, netVega: -0.2, pop: 75, hasGtc: true, gtcOrderId: 'g', gtcOrderPrice: 1, stopLossStatus: 'none', stopLossPrice: null, stopLossPolicy: null,
  stopLossDisplayPolicy: null, stopLossClassification: 'NO_STOP', stopLossOrderStatus: null, quoteWidthEvidence: null, quoteCapturedAt: null, stockPrice: 210, buffer: 9.5, putBufferPct: 9.5, callBufferPct: null,
  theta: 0.5, gamma: -0.02, earningsDate: null, ...o,
}) as Position;

const facts = buildPositionFacts(pos(), { now: NOW }, 'snap');
const verdict = computeVerdict(facts)!; // calm position: Hold

describe('buildSecondLook', () => {
  it('agreement (same bucket) shows no chip and no difference', () => {
    const look = buildSecondLook({ recommendation: 'WATCH', differsFromVerdict: true, differenceDataPoint: 'rsi' }, verdict, facts);
    expect(look.aiBucket).toBe('Hold');
    expect(look.differs).toBe(false);
    expect(look.chip).toBeNull();
    expect(look.dataPoint).toBeNull();
  });

  it('the app decides whether the AI differs, not the AI: a "false" claim with a different bucket still differs', () => {
    const look = buildSecondLook({ recommendation: 'CLOSE', differsFromVerdict: false, differenceDataPoint: 'ivr', deviationNote: 'IVR 50 is rich enough to take now.' }, verdict, facts);
    expect(look.differs).toBe(true);
    expect(look.chip).toBe('AI differs: ivr');
    expect(look.dataPoint).toBe('ivr');
    expect(look.dataPointValue).toBe(50);
    expect(look.note).toBe('IVR 50 is rich enough to take now.');
  });

  it('a disagreement that names no valid data point says so', () => {
    for (const named of [undefined, null, '', 'vibes', 'verdict']) {
      const look = buildSecondLook({ recommendation: 'ROLL', differenceDataPoint: named }, verdict, facts);
      expect(look.differs).toBe(true);
      expect(look.dataPoint).toBeNull();
      expect(look.chip).toBe('AI differs: no data point named');
    }
  });

  it('matches a data point case-insensitively and reads its value from the facts', () => {
    const look = buildSecondLook({ recommendation: 'MANAGE', differenceDataPoint: 'BUFFER' }, verdict, facts);
    expect(look.dataPoint).toBe('buffer');
    expect(look.dataPointValue).toBe(9.5);
  });

  it('an unreadable reply or a missing verdict is never a disagreement', () => {
    expect(buildSecondLook(null, verdict, facts).differs).toBe(false);
    expect(buildSecondLook({ recommendation: 'CLOSE' }, null, facts).differs).toBe(false);
    expect(buildSecondLook({ recommendation: 'NOPE' }, verdict, facts).differs).toBe(false);
  });

  it('can never change the verdict or the facts (both are frozen and untouched)', () => {
    const v = Object.freeze(structuredClone(verdict)) as typeof verdict;
    const f = structuredClone(facts);
    const before = JSON.stringify({ v, f });
    buildSecondLook({ recommendation: 'CUT_LOSSES', differenceDataPoint: 'pnlPct', deviationNote: 'x' }, v, f);
    expect(JSON.stringify({ v, f })).toBe(before);
  });

  it('every AI recommendation word maps to a bucket', () => {
    expect(['HOLD', 'WATCH', 'MANAGE', 'TAKE_PROFIT', 'CLOSE', 'CUT_LOSSES', 'ROLL'].map(aiBucketOf)).toEqual(['Hold', 'Hold', 'Manage', 'Close', 'Close', 'Close', 'Roll']);
    expect(aiBucketOf('take profit')).toBe('Close');
    expect(aiBucketOf(5)).toBeNull();
  });

  it('the prompt suffix lists every allowed data point', () => {
    for (const d of DATA_POINTS) expect(SECOND_LOOK_PROMPT_SUFFIX).toContain(d);
  });
});
