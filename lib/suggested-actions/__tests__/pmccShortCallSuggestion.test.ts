// lib/suggested-actions/__tests__/pmccShortCallSuggestion.test.ts

import { describe, expect, it } from 'vitest';
import type { ExistingIncomeOpportunity } from '@/features/portfolio/positions-workspace/model/types';
import {
  buildPmccShortCallSuggestions, pmccGain, pmccShortCallWindowText, PMCC_SHORT_CALL_BADGE, SUGGEST_MAX_CARDS,
  type PmccSuggestionInput,
} from '../pmccShortCallSuggestion';
import { PMCC_SHORT_DELTA_MAX, PMCC_SHORT_DELTA_MIN, PMCC_SHORT_DTE_MAX, PMCC_SHORT_DTE_MIN } from '@/lib/leaps-position-intelligence/policy';

const NOW = new Date('2026-10-02T20:00:00Z');
const FRESH = new Date('2026-10-02T19:59:00Z'); // 1 minute old
const OLD = new Date('2026-10-02T19:57:00Z'); // 3 minutes old

function opp(key: string, o: { entry?: number | null; mark?: number | null; qty?: number; status?: ExistingIncomeOpportunity['status']; symbol?: string } = {}): ExistingIncomeOpportunity {
  return {
    id: `pmcc:${key}`, kind: 'pmcc-short-call', status: o.status ?? 'review-income-call', symbol: o.symbol ?? 'AAPL',
    positionKey: key, title: 'PMCC short call', reason: '', nextStep: '', freshness: 'Current broker evidence',
    exactContract: `${o.symbol ?? 'AAPL'}  270917C00100000`, accountNumber: '5WT1',
    sharesOwned: null, allocatedContracts: null, reservedContracts: null, availableContracts: null,
    heldPmccLong: {
      expiration: '2027-09-17', dte: 350, strike: 100, quantity: o.qty ?? 1,
      entryDebitPerShare: o.entry === undefined ? 10 : o.entry, markPerShare: o.mark === undefined ? 20 : o.mark, stockPrice: 190,
    },
  };
}

function run(over: Partial<PmccSuggestionInput> & Pick<PmccSuggestionInput, 'opportunities'>) {
  return buildPmccShortCallSuggestions({
    intentByKey: {}, armedKeys: {}, evidenceCurrent: true, lastRefresh: FRESH, now: NOW, ...over,
  });
}

describe('pmccGain', () => {
  it('is (mark - entry) / entry, and null when entry or mark is unusable', () => {
    expect(pmccGain(10, 20)).toBe(1);
    expect(pmccGain(0, 20)).toBeNull();
    expect(pmccGain(-1, 20)).toBeNull();
    expect(pmccGain(null, 20)).toBeNull();
    expect(pmccGain(10, null)).toBeNull();
    expect(pmccGain(10, undefined)).toBeNull();
    expect(pmccGain(10, Number.NaN)).toBeNull();
  });
});

describe('arming at +100%', () => {
  it('shows at exactly 100%, not at 99.9%', () => {
    expect(run({ opportunities: [opp('a', { entry: 10, mark: 20 })] }).cards).toHaveLength(1);
    expect(run({ opportunities: [opp('a', { entry: 10, mark: 19.99 })] }).cards).toHaveLength(0);
  });
  it('computes gain and dollars on the mid for 1 and 3 contracts', () => {
    const one = run({ opportunities: [opp('a', { entry: 10, mark: 25, qty: 1 })] }).cards[0];
    expect(one.gain).toBe(1.5);
    expect(one.gainDollars).toBe(1500);
    const three = run({ opportunities: [opp('a', { entry: 10, mark: 25, qty: 3 })] }).cards[0];
    expect(three.gainDollars).toBe(4500);
    expect(three.spot).toBe(190);
  });
  it('never guesses: missing or zero entry, or missing mark, gives no card', () => {
    for (const o of [opp('a', { entry: null }), opp('a', { entry: 0 }), opp('a', { mark: null })]) {
      expect(run({ opportunities: [o] }).cards).toHaveLength(0);
    }
  });
});

describe('hysteresis at 90%', () => {
  it('an armed card stays at 90% and 95%, is released at 89.9%, and an unarmed one at 95% never shows', () => {
    const armed = { a: '2026-10-01T15:00:00Z' };
    expect(run({ opportunities: [opp('a', { entry: 10, mark: 19 })], armedKeys: armed }).cards).toHaveLength(1);
    expect(run({ opportunities: [opp('a', { entry: 10, mark: 19.5 })], armedKeys: armed }).cards).toHaveLength(1);
    const released = run({ opportunities: [opp('a', { entry: 10, mark: 18.99 })], armedKeys: armed });
    expect(released.cards).toHaveLength(0);
    expect(released.armedKeys).toEqual({});
    expect(run({ opportunities: [opp('a', { entry: 10, mark: 19.5 })] }).cards).toHaveLength(0);
  });
  it('keeps the original armed time and stamps new cards with now', () => {
    const r = run({ opportunities: [opp('a'), opp('b')], armedKeys: { a: '2026-10-01T15:00:00Z' } });
    expect(r.armedKeys).toEqual({ a: '2026-10-01T15:00:00Z', b: NOW.toISOString() });
  });
  it('a released LEAP must reach 100% again, and a short call opening releases it', () => {
    expect(run({ opportunities: [opp('a', { status: 'monitor' })], armedKeys: { a: 'x' } }).armedKeys).toEqual({});
  });
});

describe('exclusions', () => {
  it('only review-income-call opportunities qualify (paired, working short, not-ready, ambiguous, DTE all arrive as other statuses)', () => {
    for (const status of ['monitor', 'not-ready', 'eligible', 'no-capacity', 'not-eligible', 'unavailable'] as const) {
      expect(run({ opportunities: [opp('a', { status })] }).cards).toHaveLength(0);
    }
  });
  it('ignores covered-call opportunities', () => {
    const cc = { ...opp('a'), kind: 'covered-call' as const };
    expect(run({ opportunities: [cc] }).cards).toHaveLength(0);
  });
  it('intent: pmcc and undecided show; hold and anything outside the LEAP vocabulary read as undecided or hide', () => {
    expect(run({ opportunities: [opp('a')], intentByKey: { a: 'pmcc' } }).cards).toHaveLength(1);
    expect(run({ opportunities: [opp('a')], intentByKey: { a: 'undecided' } }).cards).toHaveLength(1);
    expect(run({ opportunities: [opp('a')], intentByKey: { a: 'hold' } }).cards).toHaveLength(0);
    // the default intent for a long call is 'income', which is not a LEAP value: it reads as undecided, so it shows
    expect(run({ opportunities: [opp('a')], intentByKey: { a: 'income' } }).cards).toHaveLength(1);
    expect(run({ opportunities: [opp('a')] }).cards).toHaveLength(1);
  });
  it('a hold intent also releases an armed card', () => {
    expect(run({ opportunities: [opp('a')], intentByKey: { a: 'hold' }, armedKeys: { a: 'x' } }).armedKeys).toEqual({});
  });
});

describe('order and cap', () => {
  it('sorts by gain, highest first, and caps at 3 with an overflow count', () => {
    const r = run({ opportunities: [
      opp('a', { symbol: 'AAA', mark: 21 }), opp('b', { symbol: 'BBB', mark: 40 }), opp('c', { symbol: 'CCC', mark: 30 }),
      opp('d', { symbol: 'DDD', mark: 25 }), opp('e', { symbol: 'EEE', mark: 22 }),
    ] });
    expect(SUGGEST_MAX_CARDS).toBe(3);
    expect(r.cards.map(c => c.symbol)).toEqual(['BBB', 'CCC', 'DDD']);
    expect(r.overflow).toBe(2);
  });
});

describe('freshness', () => {
  it('quotes older than 2 minutes, or never refreshed, are stale; cards still show but saved state does not change', () => {
    const oldRun = run({ opportunities: [opp('a')], lastRefresh: OLD, armedKeys: { z: 'x' } });
    expect(oldRun.stale).toBe(true);
    expect(oldRun.asOf).toBe(OLD);
    expect(oldRun.cards).toHaveLength(1);
    expect(oldRun.armedKeys).toEqual({ z: 'x' });
    expect(run({ opportunities: [opp('a')], lastRefresh: null }).stale).toBe(true);
    expect(run({ opportunities: [opp('a')], lastRefresh: FRESH }).stale).toBe(false);
  });
  it('without current broker evidence there are no cards and saved state is untouched', () => {
    const r = run({ opportunities: [opp('a')], evidenceCurrent: false, armedKeys: { a: 'x' } });
    expect(r.cards).toHaveLength(0);
    expect(r.armedKeys).toEqual({ a: 'x' });
  });
});

describe('badge text', () => {
  it('is generated from the policy constants', () => {
    const card = run({ opportunities: [opp('a')] }).cards[0];
    expect(card.badge).toBe(PMCC_SHORT_CALL_BADGE);
    expect(card.windowText).toBe(pmccShortCallWindowText());
    expect(card.windowText).toContain(`${PMCC_SHORT_DTE_MIN}–${PMCC_SHORT_DTE_MAX} DTE`);
    expect(card.windowText).toContain(`${PMCC_SHORT_DELTA_MIN.toFixed(2)}–${PMCC_SHORT_DELTA_MAX.toFixed(2)}`);
  });
});
