// lib/scans/__tests__/pmccHeldOutcomeDisplay.test.ts
//
// PMCC-HELD-BREAKEVEN-0001B-1: selector unit tests for every reason code and detail string, the
// fixable-read-failure split, per-symbol header counts, card ordering and the pre-modal message.

import { describe, expect, it } from 'vitest';
import { HELD_BREAKEVEN_DETAIL, HELD_BREAKEVEN_FLOOR_MESSAGE } from '../pmccHeldBreakeven';
import {
  buildPreModalReadFailure, classifyHeldReadFailure, formatHeldLeapSummary, heldOutcomeForPair, orderHeldGroup,
  planHeldPmccDisplay, selectHeldOutcome,
} from '../pmccHeldOutcomeDisplay';
import type { PmccPairResult } from '../pmccTypes';

const NEVER = /no short calls found/i;

describe('selectHeldOutcome', () => {
  it('cost basis unavailable: caption, banner, action, reason, detail, fixable, not rejected', () => {
    const out = selectHeldOutcome({ symbol: 'UBER', code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.basisUnavailable })!;
    expect(out).toEqual({
      kind: 'not-checked', code: 'COST_BASIS_UNAVAILABLE', caption: 'Cost basis unavailable',
      banner: 'Short calls were not checked. Cost basis for UBER could not be read from your broker.',
      action: 'refresh-portfolio', reasonLine: 'Reason: COST_BASIS_UNAVAILABLE',
      detailLine: 'Detail: cost basis unavailable. Avg open price missing or unusable.',
      notChecked: true, isFixableReadFailure: true, rejected: false,
    });
  });

  it('held quantity invalid: State 1 copy, fixable, not rejected, own detail line', () => {
    const out = selectHeldOutcome({ symbol: 'NFLX', code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.quantityInvalid })!;
    expect(out.caption).toBe('Cost basis unavailable');
    expect(out.banner).toBe('Short calls were not checked. Cost basis for NFLX could not be read from your broker.');
    expect(out.detailLine).toBe('Detail: held quantity invalid.');
    expect(out).toMatchObject({ notChecked: true, isFixableReadFailure: true, rejected: false, action: 'refresh-portfolio' });
  });

  it('unit suspect: in-results copy, Refresh action, rejected, NOT fixable pre-modal', () => {
    const out = selectHeldOutcome({ symbol: 'UBER', code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.unitSuspect })!;
    expect(out.caption).toBe('Cost basis unavailable');
    expect(out.banner).toBe('Short calls were not checked. Cost basis for UBER looks wrong or could not be read from your broker.');
    expect(out.detailLine).toBe('Detail: cost basis unit suspect. Avg open price looks mis-scaled.');
    expect(out).toMatchObject({ notChecked: true, isFixableReadFailure: false, rejected: true, action: 'refresh-portfolio', reasonLine: 'Reason: COST_BASIS_UNAVAILABLE' });
  });

  it('multi-lot: engine integer in the banner, no action, rejected, not fixable', () => {
    const out = selectHeldOutcome({ symbol: 'NFLX', code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.multiLot, quantity: 3 })!;
    expect(out.caption).toBe('Multi-lot LEAP: cost unverified');
    expect(out.banner).toBe('Short calls were not checked. This LEAP has 3 contracts, and cost averaging across lots is unverified.');
    expect(out.detailLine).toBe('Detail: multi-lot LEAP: cost averaging unverified.');
    expect(out).toMatchObject({ action: null, notChecked: true, isFixableReadFailure: false, rejected: true, reasonLine: 'Reason: COST_BASIS_UNAVAILABLE' });
  });

  it('multi-lot without a usable quantity never prints a bogus number', () => {
    const out = selectHeldOutcome({ symbol: 'NFLX', code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.multiLot, quantity: undefined })!;
    expect(out.banner).toContain('more than one contract');
    expect(out.banner).not.toMatch(/undefined|NaN/);
  });

  it('unknown cost-basis detail fails closed: not-checked, but never fixable pre-modal', () => {
    const out = selectHeldOutcome({ symbol: 'X', code: 'COST_BASIS_UNAVAILABLE', detail: 'something new' })!;
    expect(out).toMatchObject({ notChecked: true, isFixableReadFailure: false });
    expect(out.detailLine).toBe('Detail: something new.');
  });

  it('floor not met with avgOpen: floor caption and banner with the arithmetic', () => {
    const out = selectHeldOutcome({ symbol: 'UBER', code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: HELD_BREAKEVEN_FLOOR_MESSAGE, longStrike: 60, avgOpen: 2.35 })!;
    expect(out.caption).toBe('Floor 62.35 (LEAP strike + cost)');
    expect(out.banner).toBe('No short calls cleared the floor. A short must satisfy strike + bid > LEAP strike + your cost: 60 + 2.35 = $62.35.');
    expect(out.reasonLine).toBe('Reason: SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    expect(out).toMatchObject({ kind: 'floor-not-met', notChecked: false, isFixableReadFailure: false, rejected: true, action: null });
  });

  it('floor detail uses the safe wording, never the "every short that reached" claim', () => {
    const out = selectHeldOutcome({ symbol: 'UBER', code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: HELD_BREAKEVEN_FLOOR_MESSAGE, longStrike: 60, avgOpen: 2.35 })!;
    expect(out.detailLine).toBe('Detail: no short cleared the floor.');
    expect(out.detailLine).not.toMatch(/every short/i);
  });

  it('floor arithmetic is exact in cents (no float drift) and fractional strikes print sensibly', () => {
    const out = selectHeldOutcome({ symbol: 'X', code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: null, longStrike: 57.5, avgOpen: 0.1 + 0.2 })!;
    expect(out.caption).toBe('Floor 57.80 (LEAP strike + cost)');
    expect(out.banner).toContain('57.5 + 0.30 = $57.80.');
  });

  it('floor fallback copy when avgOpen was not carried (older restored session)', () => {
    for (const avgOpen of [undefined, null, 0, Number.NaN]) {
      const out = selectHeldOutcome({ symbol: 'UBER', code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: HELD_BREAKEVEN_FLOOR_MESSAGE, longStrike: 60, avgOpen })!;
      expect(out.caption).toBe('Floor not met');
      expect(out.banner).toBe('No short calls cleared the floor. Floor not met (strike + bid at or below LEAP strike + your cost).');
      expect(out.reasonLine).toBe('Reason: SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    }
  });

  it('a floor-failed pair whose LEAP has a passing sibling never claims "no short calls cleared"', () => {
    const out = selectHeldOutcome({ symbol: 'UBER', code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: null, longStrike: 60, avgOpen: 2.35, leapHasNoResults: false })!;
    expect(out.banner).toBeNull();
    expect(out).toMatchObject({ rejected: true, caption: 'Floor not met' });
  });

  it('never says "no short calls found" in any state', () => {
    const inputs = [
      { code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.basisUnavailable },
      { code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.quantityInvalid },
      { code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.unitSuspect },
      { code: 'COST_BASIS_UNAVAILABLE', detail: HELD_BREAKEVEN_DETAIL.multiLot },
      { code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', detail: HELD_BREAKEVEN_FLOOR_MESSAGE },
    ];
    for (const input of inputs) {
      const out = selectHeldOutcome({ symbol: 'UBER', quantity: 2, longStrike: 60, avgOpen: 2.35, ...input })!;
      for (const text of [out.caption, out.banner ?? '', out.detailLine, out.reasonLine]) expect(text).not.toMatch(NEVER);
    }
  });

  it('other codes are not held outcomes', () => {
    expect(selectHeldOutcome({ symbol: 'X', code: 'DELTA_OUT_OF_RANGE', detail: null })).toBeNull();
  });
});

function pair(over: Partial<PmccPairResult> & { codes?: Array<[string, string]>; occ?: string }): PmccPairResult {
  const failureReasons = (over.codes ?? []).map(([code, message]) => ({ code, message })) as PmccPairResult['failureReasons'];
  return {
    pairId: 'p', symbol: 'GS', longLeg: { strike: 720, occSymbol: over.occ ?? 'GS270618C00720000' }, shortLeg: {},
    metrics: null, qualified: failureReasons.length === 0, insufficientData: false, failureReasons, primaryFailureReason: failureReasons[0] ?? null,
    orderingLabel: 'Contract order', entryMode: 'covered-short-call-against-held-leaps',
    heldLongLeg: { accountNumber: 'a', positionKey: 'k', quantity: 1, occSymbol: over.occ ?? 'GS270618C00720000', avgOpenPrice: 400 },
    ...over,
  } as unknown as PmccPairResult;
}

describe('heldOutcomeForPair', () => {
  it('reads the reason code and detail off the pair and carries qty, strike and avgOpen', () => {
    const floor = heldOutcomeForPair(pair({ codes: [['SHORT_NOT_ABOVE_HELD_BREAKEVEN', HELD_BREAKEVEN_FLOOR_MESSAGE]] }), 'GS')!;
    expect(floor.banner).toContain('720 + 400.00 = $1120.00');
    const multi = heldOutcomeForPair(pair({ codes: [['COST_BASIS_UNAVAILABLE', HELD_BREAKEVEN_DETAIL.multiLot]], heldLongLeg: { accountNumber: 'a', positionKey: 'k', quantity: 4, occSymbol: 'x' } }), 'GS')!;
    expect(multi.banner).toContain('4 contracts');
  });

  it('cost-basis wins over the floor code if both are ever present', () => {
    const both = heldOutcomeForPair(pair({ codes: [['SHORT_NOT_ABOVE_HELD_BREAKEVEN', 'm'], ['COST_BASIS_UNAVAILABLE', HELD_BREAKEVEN_DETAIL.basisUnavailable]] }), 'GS')!;
    expect(both.code).toBe('COST_BASIS_UNAVAILABLE');
  });

  it('returns null for qualified pairs, non-held pairs, and pairs with other failures only', () => {
    expect(heldOutcomeForPair(pair({}), 'GS')).toBeNull();
    expect(heldOutcomeForPair(pair({ entryMode: 'new-pmcc', codes: [['COST_BASIS_UNAVAILABLE', 'x']] }), 'GS')).toBeNull();
    expect(heldOutcomeForPair(pair({ codes: [['DELTA_OUT_OF_RANGE', 'x']] }), 'GS')).toBeNull();
    expect(heldOutcomeForPair(null, 'GS')).toBeNull();
  });
});

describe('classifyHeldReadFailure / buildPreModalReadFailure', () => {
  it('classifies only basis null/zero/unparseable and invalid quantity; multi-lot is not a read failure', () => {
    for (const avgOpenPrice of [null, undefined, 0, -1, Number.NaN, '', 'abc', '1e2']) {
      expect(classifyHeldReadFailure({ underlyingSymbol: 'X', avgOpenPrice, quantity: 1 })).toBe('basis');
    }
    for (const quantity of [0, -1, 1.5, Number.NaN, '1', null]) {
      expect(classifyHeldReadFailure({ underlyingSymbol: 'X', avgOpenPrice: 5, quantity })).toBe('quantity');
    }
    expect(classifyHeldReadFailure({ underlyingSymbol: 'X', avgOpenPrice: 5, quantity: 2 })).toBeNull();
    expect(classifyHeldReadFailure({ underlyingSymbol: 'X', avgOpenPrice: 5, quantity: 1 })).toBeNull();
    // unit-suspect needs spot, so a huge basis is NOT a pre-modal read failure
    expect(classifyHeldReadFailure({ underlyingSymbol: 'X', avgOpenPrice: 99999, quantity: 1 })).toBeNull();
  });

  it('single LEAP: exact copy', () => {
    expect(buildPreModalReadFailure([{ underlyingSymbol: 'UBER', avgOpenPrice: null, quantity: 1 }])).toEqual({
      message: 'Could not read cost basis. Cost basis for UBER could not be read from your broker. Refresh Portfolio and try again.',
      details: null,
    });
  });

  it('several LEAPs: count, symbols capped at 3, then +k more', () => {
    const c = (underlyingSymbol: string) => ({ underlyingSymbol, avgOpenPrice: null, quantity: 1 });
    expect(buildPreModalReadFailure([c('UBER'), c('NFLX')])!.message)
      .toBe('Could not read cost basis. Cost basis for 2 held LEAPs could not be read from your broker: UBER, NFLX. Refresh Portfolio and try again.');
    expect(buildPreModalReadFailure([c('A'), c('B'), c('C')])!.message).toContain('3 held LEAPs could not be read from your broker: A, B, C.');
    expect(buildPreModalReadFailure([c('A'), c('B'), c('C'), c('D'), c('E')])!.message)
      .toBe('Could not read cost basis. Cost basis for 5 held LEAPs could not be read from your broker: A, B, C +2 more. Refresh Portfolio and try again.');
  });

  it('two LEAPs on one symbol list the symbol once', () => {
    const c = { underlyingSymbol: 'UBER', avgOpenPrice: null, quantity: 1 };
    expect(buildPreModalReadFailure([c, c])!.message).toContain('2 held LEAPs could not be read from your broker: UBER.');
  });

  it('quantity invalid adds the collapsed Details line', () => {
    const out = buildPreModalReadFailure([{ underlyingSymbol: 'UBER', avgOpenPrice: 5, quantity: 0 }])!;
    expect(out.details).toBe('Details: COST_BASIS_UNAVAILABLE, held quantity invalid');
  });

  it('does not block unless EVERY selected LEAP fails (one good LEAP, multi-lot, or unit-suspect lets the scan open)', () => {
    const bad = { underlyingSymbol: 'UBER', avgOpenPrice: null, quantity: 1 };
    expect(buildPreModalReadFailure([bad, { underlyingSymbol: 'NFLX', avgOpenPrice: 5, quantity: 1 }])).toBeNull();
    expect(buildPreModalReadFailure([bad, { underlyingSymbol: 'NFLX', avgOpenPrice: 5, quantity: 3 }])).toBeNull();
    expect(buildPreModalReadFailure([bad, { underlyingSymbol: 'NFLX', avgOpenPrice: 99999, quantity: 1 }])).toBeNull();
    expect(buildPreModalReadFailure([])).toBeNull();
  });
});

describe('planHeldPmccDisplay / orderHeldGroup / summary', () => {
  const res = (id: string, symbol: string, p: PmccPairResult) => ({ candidateId: id, symbol, pmccPair: p });
  const floor = (occ: string) => pair({ occ, codes: [['SHORT_NOT_ABOVE_HELD_BREAKEVEN', HELD_BREAKEVEN_FLOOR_MESSAGE]] });
  const noBasis = (occ: string) => pair({ occ, codes: [['COST_BASIS_UNAVAILABLE', HELD_BREAKEVEN_DETAIL.basisUnavailable]] });
  const ok = (occ: string) => pair({ occ });
  const nearMissOther = (occ: string) => pair({ occ, codes: [['DELTA_OUT_OF_RANGE', 'x']] });

  it('orders results, then floor-not-met, then not-checked; stable within a state', () => {
    const results = [
      res('nc1', 'GS', noBasis('B')), res('fl1', 'GS', floor('C')), res('ok1', 'GS', ok('A')), res('fl2', 'GS', floor('C')),
      res('ok2', 'GS', nearMissOther('A')), res('nc2', 'GS', noBasis('B')),
    ];
    const plan = planHeldPmccDisplay(results);
    // one card per LEAP that has no results
    expect(orderHeldGroup(results, plan).map(r => r.candidateId)).toEqual(['ok1', 'ok2', 'fl1', 'nc1']);
  });

  it('a rejected LEAP never sorts above a valid result, regardless of input order', () => {
    const results = [res('nc', 'GS', noBasis('B')), res('fl', 'GS', floor('C')), res('ok', 'GS', ok('A'))];
    const ordered = orderHeldGroup(results, planHeldPmccDisplay(results));
    expect(ordered[0].candidateId).toBe('ok');
  });

  it('is stable across a re-plan of the same data (Refresh Portfolio does not reshuffle)', () => {
    const results = [res('a', 'GS', noBasis('B')), res('b', 'GS', ok('A')), res('c', 'GS', floor('C'))];
    const first = orderHeldGroup(results, planHeldPmccDisplay(results)).map(r => r.candidateId);
    const second = orderHeldGroup([...results], planHeldPmccDisplay([...results])).map(r => r.candidateId);
    expect(second).toEqual(first);
  });

  it('a floor-failed pair inside a LEAP that has a passing sibling is kept and flagged as a LEAP with results', () => {
    const results = [res('ok', 'GS', ok('A')), res('flSibling', 'GS', floor('A'))];
    const plan = planHeldPmccDisplay(results);
    expect(plan.hiddenIds.size).toBe(0);
    expect(plan.leapHasResultsIds.has('flSibling')).toBe(true);
  });

  it('summary counts sum to n, omit zero segments, and appear only for 2+ LEAPs', () => {
    const results = [res('1', 'GS', ok('A')), res('2', 'GS', floor('C')), res('3', 'GS', noBasis('B')), res('4', 'UBER', noBasis('U'))];
    const plan = planHeldPmccDisplay(results);
    expect(plan.summaryBySymbol.get('GS')).toBe('GS · 3 held LEAPs · 1 with results · 1 no shorts cleared · 1 not checked');
    expect(plan.summaryBySymbol.has('UBER')).toBe(false);
  });

  it('formatHeldLeapSummary omits zero segments', () => {
    expect(formatHeldLeapSummary('GS', { leaps: 2, results: 0, floor: 0, notChecked: 2 })).toBe('GS · 2 held LEAPs · 2 not checked');
    expect(formatHeldLeapSummary('GS', { leaps: 2, results: 2, floor: 0, notChecked: 0 })).toBe('GS · 2 held LEAPs · 2 with results');
  });

  it('ignores non-held results and results without a candidateId', () => {
    const plan = planHeldPmccDisplay([{ symbol: 'X', candidateId: 'n', pmccPair: pair({ entryMode: 'new-pmcc' }) }, { symbol: 'X' }]);
    expect(plan.summaryBySymbol.size).toBe(0);
    expect(plan.rankById.size).toBe(0);
  });
});
