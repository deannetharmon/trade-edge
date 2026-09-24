// lib/scans/__tests__/pmccHeldBreakeven.test.ts
//
// PMCC-HELD-BREAKEVEN-0001: golden fixtures A1-A36 (Alan, Ian, Quinn), three pure pieces tested
// separately (reader, quantity parser, floor helper), then the same floor once through pairPmccCandidates.
// Row numbers below are the ticket's. A15/A16 are dormant (weighted average is forbidden by the
// permanent quantity rule) and A22 is unused.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import {
  evaluateHeldBreakevenFloor,
  HELD_BREAKEVEN_DETAIL,
  heldLongKey,
  parseHeldQuantity,
  readHeldBasis,
  type HeldBreakevenInput,
} from '../pmccHeldBreakeven';
import { pairPmccCandidates } from '../pmccPairing';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const BASIS = HELD_BREAKEVEN_DETAIL.basisUnavailable;
const UNIT = HELD_BREAKEVEN_DETAIL.unitSuspect;
const MULTI = HELD_BREAKEVEN_DETAIL.multiLot;
const QTY = HELD_BREAKEVEN_DETAIL.quantityInvalid;
const FLOOR = 'SHORT_NOT_ABOVE_HELD_BREAKEVEN';
const UNAVAILABLE = 'COST_BASIS_UNAVAILABLE';

describe('pinned detail strings', () => {
  it('match the ticket exactly', () => {
    expect(BASIS).toBe('cost basis unavailable');
    expect(UNIT).toBe('cost basis unit suspect');
    expect(MULTI).toBe('multi-lot LEAP: cost averaging unverified');
    expect(QTY).toBe('held quantity invalid');
  });
});

describe('readHeldBasis (plain-decimal reader)', () => {
  it.each([
    ['A7 null', null], ['A7 undefined', undefined],
    ['A8 0', 0], ['A8 "0"', '0'], ['A8 "0.00"', '0.00'],
    ['A9 -5', -5], ['A9 "-5"', '-5'],
    ['A10 NaN', Number.NaN],
    ['A11 Infinity', Number.POSITIVE_INFINITY], ['A11 "Infinity"', 'Infinity'],
    ['A12 "abc"', 'abc'], ['A12 ""', ''], ['A12 " "', ' '], ['A12 "26.00x"', '26.00x'],
    ['A12 "1e2" (exponent)', '1e2'], ['A12 "0x10" (hex)', '0x10'],
    ['".5"', '.5'], ['"5."', '5.'], ['"+5"', '+5'],
    ['boolean', true], ['object', {}],
  ])('%s fails closed (null)', (_label, value) => {
    expect(readHeldBasis(value)).toBeNull();
  });

  it('A13: trims and parses plain decimals; the real NFLX payload value reads as 20.85', () => {
    expect(readHeldBasis(' 26.00 ')).toBe(26);
    expect(readHeldBasis('20.85')).toBe(20.85);
    expect(readHeldBasis('26')).toBe(26);
  });

  it('number branch (client path): finite and > 0 only. It accepts 100 and 16, which is why the exponent/hex rows are reader-only', () => {
    expect(readHeldBasis(26)).toBe(26);
    expect(readHeldBasis(0.01)).toBe(0.01);
    expect(readHeldBasis(100)).toBe(100);
    expect(readHeldBasis(16)).toBe(16);
  });
});

describe('parseHeldQuantity (strict, Number() not parseInt)', () => {
  it('A25b/A25c: "2" is 2 and "1.0" is 1', () => {
    expect(parseHeldQuantity('2')).toBe(2);
    expect(parseHeldQuantity('1.0')).toBe(1);
    expect(parseHeldQuantity('1')).toBe(1);
    expect(parseHeldQuantity(' 1 ')).toBe(1);
  });
  it('A28: "1.5" stays 1.5 (parseInt would truncate it to 1)', () => {
    expect(parseHeldQuantity('1.5')).toBe(1.5);
    expect(parseInt('1.5', 10)).toBe(1); // the trap this parser exists to avoid
  });
  it.each([['"abc"', 'abc'], ['""', ''], ['" "', ' '], ['"0x1"', '0x1'], ['"1e0"', '1e0'], ['null', null], ['undefined', undefined], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['object', {}]])('%s is null', (_label, value) => {
    expect(parseHeldQuantity(value)).toBeNull();
  });
  it('keeps zero and negatives as numbers for the guard to reject', () => {
    expect(parseHeldQuantity('0')).toBe(0);
    expect(parseHeldQuantity('-1')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------------------
// Floor helper. Baseline is the A2 values unless a row says otherwise.
// ---------------------------------------------------------------------------------------------
const base: HeldBreakevenInput = { strikeLong: 80, strikeShort: 105, shortBid: 1.01, spot: 92.5, basis: 26, quantity: 1 };
const f = (overrides: Partial<HeldBreakevenInput>) => evaluateHeldBreakevenFloor({ ...base, ...overrides });
const fail = (code: string, message: string) => ({ code, message });
const floorMiss = expect.objectContaining({ code: FLOOR });

describe('evaluateHeldBreakevenFloor: floor (A1-A6, A21)', () => {
  it('A1 equality rejects (106.00 > 106.00 is false)', () => expect(f({ shortBid: 1.00 })).toEqual(floorMiss));
  it('A2 +0.01 passes', () => expect(f({ shortBid: 1.01 })).toBeNull());
  it('A3 -0.01 rejects', () => expect(f({ shortBid: 0.99 })).toEqual(floorMiss));
  it('A4 real NFLX payload, equality: cents compare required (2085 + 7000 = 9085 = 9000 + 85)', () => {
    const nflx = { strikeLong: 70, strikeShort: 90, spot: 80, basis: readHeldBasis('20.85') };
    expect(f({ ...nflx, shortBid: 0.85 })).toEqual(floorMiss);
  });
  it('A5 NFLX +0.01 passes', () => {
    expect(f({ strikeLong: 70, strikeShort: 90, spot: 80, basis: readHeldBasis('20.85'), shortBid: 0.86 })).toBeNull();
  });
  it('A6 the live ask is not an input: the same result for any ask (proved end to end below)', () => {
    expect(Object.keys(base)).not.toContain('ask');
    expect(f({ shortBid: 1.01 })).toBeNull();
  });
  it('A21 deep loss rejects on the floor, not on data (spot 72 keeps the LEAP ITM; 97.00 > 100.00 is false)', () => {
    expect(f({ strikeLong: 70, strikeShort: 95, shortBid: 2.00, spot: 72, basis: 30 })).toEqual(floorMiss);
  });
  it('the floor message is stable and factual', () => {
    expect(f({ shortBid: 0.99 })).toEqual(fail(FLOOR, 'Short strike plus bid must exceed held LEAP strike plus cost basis'));
  });
  it('a non-finite short bid or strike fails closed instead of passing', () => {
    expect(f({ shortBid: Number.NaN })).toEqual(floorMiss);
    expect(f({ strikeShort: Number.NaN })).toEqual(floorMiss);
  });
});

describe('evaluateHeldBreakevenFloor: fail closed on basis (A7-A13, via the reader)', () => {
  it.each([
    ['A7', [null, undefined]],
    ['A8', [0, '0', '0.00']],
    ['A9', [-5, '-5']],
    ['A10', [Number.NaN]],
    ['A11', [Number.POSITIVE_INFINITY, 'Infinity']],
    ['A12', ['abc', '', ' ', '26.00x', '1e2', '0x10']],
  ])('%s: every value is COST_BASIS_UNAVAILABLE "cost basis unavailable"', (_row, values) => {
    for (const value of values as unknown[]) {
      expect(f({ basis: readHeldBasis(value), shortBid: 3.00 })).toEqual(fail(UNAVAILABLE, BASIS));
    }
  });
  it('the helper itself also rejects a bad number, a string and undefined basis (does not trust its caller)', () => {
    for (const basis of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '26.00' as unknown as number, undefined, null]) {
      expect(f({ basis })).toEqual(fail(UNAVAILABLE, BASIS));
    }
  });
  it('A13: " 26.00 " parses and qualifies at bid 1.01', () => {
    expect(f({ basis: readHeldBasis(' 26.00 '), shortBid: 1.01 })).toBeNull();
  });
});

describe('evaluateHeldBreakevenFloor: unit guard (A14, A20a-c, A35)', () => {
  const u = { strikeLong: 70, spot: 85, strikeShort: 90, shortBid: 0.86 };
  it('A14 x100 error: 2085 > 2 x 85 is unit-suspect, not a plain floor miss', () => {
    expect(f({ ...u, basis: readHeldBasis('2085') })).toEqual(fail(UNAVAILABLE, UNIT));
  });
  it('A20a legitimate loser passes the guard (30.00 > 2 x 72 is false) and misses the floor (9700 > 10000)', () => {
    expect(f({ strikeLong: 70, spot: 72, strikeShort: 95, shortBid: 2.00, basis: readHeldBasis('30.00') })).toEqual(floorMiss);
  });
  it('A20b cost near spot is not blocked: 84.99 passes the guard, misses the floor (9086 > 15499)', () => {
    expect(f({ ...u, basis: readHeldBasis('84.99') })).toEqual(floorMiss);
  });
  it('A20c guard boundary is strict: "170.00" passes the guard (floor rejects); "170.01" is unit-suspect', () => {
    expect(f({ ...u, basis: readHeldBasis('170.00') })).toEqual(floorMiss);
    expect(f({ ...u, basis: readHeldBasis('170.01') })).toEqual(fail(UNAVAILABLE, UNIT));
  });
  it('the bound uses max(spot, Kl): a spot below the long strike still bounds at 2 x Kl', () => {
    // spot 60 < Kl 70: bound is 140, so 140.00 passes the guard and 140.01 is suspect
    expect(f({ ...u, spot: 60, basis: 140 })).toEqual(floorMiss);
    expect(f({ ...u, spot: 60, basis: 140.01 })).toEqual(fail(UNAVAILABLE, UNIT));
  });
  it('A35 NaN spot (helper-level): the bound falls back to 2 x Kl = 140, and the guard still fires', () => {
    const n = { strikeLong: 70, spot: Number.NaN, strikeShort: 90, shortBid: 0.86 };
    expect(f({ ...n, basis: readHeldBasis('20.85') })).toBeNull(); // passes the guard; 9086 > 9085 clears the floor
    expect(f({ ...n, basis: readHeldBasis('140.00') })).toEqual(floorMiss); // equal passes the guard, floor rejects
    expect(f({ ...n, basis: readHeldBasis('140.01') })).toEqual(fail(UNAVAILABLE, UNIT));
    expect(f({ ...n, basis: readHeldBasis('2085') })).toEqual(fail(UNAVAILABLE, UNIT));
    // Infinity and undefined spot behave like NaN
    expect(f({ ...n, spot: Number.POSITIVE_INFINITY, basis: 140.01 })).toEqual(fail(UNAVAILABLE, UNIT));
    expect(f({ ...n, spot: undefined as unknown as number, basis: 140.01 })).toEqual(fail(UNAVAILABLE, UNIT));
  });
  it('the floor itself does not use spot (same floor result for any spot)', () => {
    for (const spot of [Number.NaN, 71, 92.5, 500]) expect(f({ spot, shortBid: 0.99 })).toEqual(floorMiss);
  });
});

describe('evaluateHeldBreakevenFloor: quantity guard (A23-A36)', () => {
  const clears = { shortBid: 1.01 }; // A2 values
  const misses = { shortBid: 0.99 }; // A3 values
  it('A23 quantity 2, valid, short clears: multi-lot', () => expect(f({ ...clears, quantity: 2 })).toEqual(fail(UNAVAILABLE, MULTI)));
  it('A23b quantity 100: multi-lot', () => expect(f({ ...clears, quantity: 100 })).toEqual(fail(UNAVAILABLE, MULTI)));
  it('A24 quantity 1 qualifies via the floor with no quantity detail', () => expect(f({ ...clears, quantity: 1 })).toBeNull());
  it('A24b quantity 1, short misses: the floor code', () => expect(f({ ...misses, quantity: 1 })).toEqual(floorMiss));
  it('A25a the string "1" (out of contract at the candidate boundary) fails closed as invalid', () => {
    expect(f({ quantity: '1' })).toEqual(fail(UNAVAILABLE, QTY));
  });
  it('A25b "2" from the broker: the parser gives 2, the guard reports multi-lot', () => {
    expect(f({ quantity: parseHeldQuantity('2') })).toEqual(fail(UNAVAILABLE, MULTI));
  });
  it('A25c "1.0" from the broker: the parser gives 1, which passes the guard', () => {
    expect(f({ quantity: parseHeldQuantity('1.0') })).toBeNull();
  });
  it.each([['A26 0', 0], ['A27 -1', -1], ['A28 1.5', 1.5], ['A28b 2.5', 2.5]])('%s: held quantity invalid', (_label, quantity) => {
    expect(f({ quantity })).toEqual(fail(UNAVAILABLE, QTY));
  });
  it('A28 through the parser: "1.5" is never treated as 1', () => {
    expect(f({ quantity: parseHeldQuantity('1.5') })).toEqual(fail(UNAVAILABLE, QTY));
  });
  it.each([['NaN', Number.NaN], ['undefined', undefined], ['null', null], ['"abc"', 'abc'], ['Infinity', Number.POSITIVE_INFINITY]])('A29 %s must not pass: held quantity invalid', (_label, quantity) => {
    expect(f({ quantity })).toEqual(fail(UNAVAILABLE, QTY));
  });
  it('A30 quantity 2 with a x100 basis: multi-lot, not unit-suspect (quantity precedes the unit guard)', () => {
    expect(f({ quantity: 2, basis: readHeldBasis('2085') })).toEqual(fail(UNAVAILABLE, MULTI));
  });
  it('A31 quantity 1 with a x100 basis: unit-suspect (confirms A14)', () => {
    expect(f({ quantity: 1, basis: readHeldBasis('2085') })).toEqual(fail(UNAVAILABLE, UNIT));
  });
  it('A32 quantity 2 with null, "0" or "" basis: basis-missing detail (data validity precedes quantity)', () => {
    for (const value of [null, '0', '']) expect(f({ quantity: 2, basis: readHeldBasis(value) })).toEqual(fail(UNAVAILABLE, BASIS));
  });
  it('A33 quantity 2 with a short that misses the floor too: still COST_BASIS_UNAVAILABLE', () => {
    expect(f({ ...misses, quantity: 2 })).toEqual(fail(UNAVAILABLE, MULTI));
  });
  it('A34 held quantity 1 passes the guard whatever the sell quantity is (sell quantity is not an input)', () => {
    expect(f({ quantity: parseHeldQuantity('1') })).toBeNull();
  });
  it('A36 basis invalid and quantity invalid together: basis detail wins', () => {
    expect(f({ quantity: 0, basis: null })).toEqual(fail(UNAVAILABLE, BASIS));
  });
});

// ---------------------------------------------------------------------------------------------
// The same floor once through pairPmccCandidates (held mode), plus new-entry non-regression.
// ---------------------------------------------------------------------------------------------
const asOf = new Date('2026-08-14T20:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
const longLeg = (strike: number, ask: number, overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: '2027-06-18', strike, delta: 0.8, openInterest: 500,
  bid: ask - 0.1, ask, occSymbol: occ('2027-06-18', strike), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false, ...overrides,
});
const shortLeg = (strike: number, bid: number, overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: '2026-09-18', strike, delta: 0.25, openInterest: 500,
  bid, ask: Math.round((bid + Math.max(0.01, bid * 0.02)) * 100) / 100, occSymbol: occ('2026-09-18', strike), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false, ...overrides,
});

interface HeldRow { Kl: number; Ks: number; bid: number; spot: number; ask?: number; avgOpen: unknown; quantity?: unknown }
function pairHeld(row: HeldRow) {
  const long = longLeg(row.Kl, row.ask ?? row.Kl * 0.5 + 100);
  const key = heldLongKey(long.occSymbol!);
  return pairPmccCandidates({
    symbol: 'GS', underlyingPrice: row.spot, longLegs: [long], shortLegs: [shortLeg(row.Ks, row.bid)],
    criteria: { ...criteria, longOiMin: 0 }, asOf, marketSession: 'open',
    heldLongOccSymbols: new Set([key]),
    heldLongBasis: new Map([[key, { avgOpen: readHeldBasis(row.avgOpen), quantity: row.quantity === undefined ? 1 : row.quantity }]]),
  });
}
const outcome = (row: HeldRow) => {
  const result = pairHeld(row);
  return { qualified: result.qualifiedPairs.length, reason: result.nearMissPairs[0]?.primaryFailureReason ?? null, result };
};

describe('pairPmccCandidates in held mode: floor rows end to end', () => {
  // A1-A3: Kl 80, avgOpen "26.00", Ks 105, spot 92.5. Long ask 20.00 is >= intrinsic 12.5, so INVALID_EXTRINSIC does not fire.
  it.each([
    ['A1 equality rejects', 1.00, false],
    ['A2 +0.01 qualifies', 1.01, true],
    ['A3 -0.01 rejects', 0.99, false],
  ])('%s', (_label, bid, qualifies) => {
    const o = outcome({ Kl: 80, Ks: 105, bid, spot: 92.5, ask: 20.00, avgOpen: '26.00' });
    if (qualifies) expect(o.qualified).toBe(1);
    else expect(o.reason).toEqual({ code: FLOOR, message: 'Short strike plus bid must exceed held LEAP strike plus cost basis' });
  });

  it('A4/A5 real NFLX payload: equality rejects, +0.01 qualifies', () => {
    expect(outcome({ Kl: 70, Ks: 90, bid: 0.85, spot: 80, ask: 13.24, avgOpen: '20.85' }).reason?.code).toBe(FLOOR);
    expect(outcome({ Kl: 70, Ks: 90, bid: 0.86, spot: 80, ask: 13.24, avgOpen: '20.85' }).qualified).toBe(1);
  });

  it('A6 the live long ask does not matter (the result is identical at any ask that keeps the LEAP valid)', () => {
    // The ticket names asks 5.00 and 60.00. At spot 92.5 an ask of 5.00 is below the LEAP's 12.50 intrinsic,
    // so INVALID_EXTRINSIC drops the long before pairing (a separate, pre-existing rule that still applies to
    // held longs). 13.00 is the lowest ask that reaches the floor, so it stands in for 5.00 here.
    for (const ask of [13.00, 20.00, 60.00]) {
      expect(outcome({ Kl: 80, Ks: 105, bid: 1.01, spot: 92.5, ask, avgOpen: '26.00' }).qualified).toBe(1);
      expect(outcome({ Kl: 80, Ks: 105, bid: 1.00, spot: 92.5, ask, avgOpen: '26.00' }).reason?.code).toBe(FLOOR);
    }
    const tooLow = pairHeld({ Kl: 80, Ks: 105, bid: 1.01, spot: 92.5, ask: 5.00, avgOpen: '26.00' });
    expect(tooLow.legRejections.flatMap(r => r.reasons.map(x => x.code))).toContain('INVALID_EXTRINSIC');
  });

  it('A21 deep loss rejects on the floor, not on data (spot 72 keeps the LEAP ITM)', () => {
    expect(outcome({ Kl: 70, Ks: 95, bid: 2.00, spot: 72, ask: 30, avgOpen: '30.00' }).reason?.code).toBe(FLOOR);
  });

  it.each([
    ['A7 missing', null], ['A8 zero', '0.00'], ['A9 negative', '-5'], ['A10 NaN', Number.NaN], ['A11 Infinity', 'Infinity'], ['A12 abc', 'abc'],
  ])('%s basis: COST_BASIS_UNAVAILABLE, not qualified', (_label, avgOpen) => {
    const o = outcome({ Kl: 80, Ks: 105, bid: 3.00, spot: 92.5, ask: 20, avgOpen });
    expect(o.qualified).toBe(0);
    expect(o.reason).toEqual({ code: UNAVAILABLE, message: BASIS });
  });

  it('A14 x100 basis is unit-suspect end to end', () => {
    expect(outcome({ Kl: 70, Ks: 90, bid: 0.86, spot: 85, ask: 30, avgOpen: '2085' }).reason).toEqual({ code: UNAVAILABLE, message: UNIT });
  });

  it('A23/A33 multi-lot: no qualified pair even when the short clears the floor, and never the floor code', () => {
    for (const bid of [1.01, 0.99]) {
      const o = outcome({ Kl: 80, Ks: 105, bid, spot: 92.5, ask: 20, avgOpen: '26.00', quantity: 2 });
      expect(o.qualified).toBe(0);
      expect(o.reason).toEqual({ code: UNAVAILABLE, message: MULTI });
    }
  });

  it('A29 an invalid quantity (string, NaN, undefined, null) never passes through pairing either', () => {
    for (const quantity of ['1', Number.NaN, null, 0, 1.5]) {
      const o = outcome({ Kl: 80, Ks: 105, bid: 1.01, spot: 92.5, ask: 20, avgOpen: '26.00', quantity });
      expect(o.qualified).toBe(0);
      expect(o.reason).toEqual({ code: UNAVAILABLE, message: QTY });
    }
  });

  it('a held long with no basis entry at all (map absent) fails closed: unwired callers cannot leak a candidate', () => {
    const long = longLeg(80, 20);
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 92.5, longLegs: [long], shortLegs: [shortLeg(105, 3)],
      criteria: { ...criteria, longOiMin: 0 }, asOf, marketSession: 'open', heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]),
    });
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.nearMissPairs[0].primaryFailureReason).toEqual({ code: UNAVAILABLE, message: BASIS });
  });

  it('a hand-built basis key that does not match fails closed rather than silently qualifying', () => {
    const long = longLeg(80, 20);
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 92.5, longLegs: [long], shortLegs: [shortLeg(105, 3)],
      criteria: { ...criteria, longOiMin: 0 }, asOf, marketSession: 'open', heldLongOccSymbols: new Set([heldLongKey(long.occSymbol!)]),
      heldLongBasis: new Map([[long.occSymbol!, { avgOpen: 26, quantity: 1 }]]), // missing the occ: prefix
    });
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.nearMissPairs[0].primaryFailureReason?.code).toBe(UNAVAILABLE);
  });

  it('A17 analog: each held LEAP is evaluated on its own basis, never blended (one invalid basis does not affect the other)', () => {
    const a = longLeg(70, 30); const b = longLeg(75, 30);
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 85, longLegs: [a, b], shortLegs: [shortLeg(100, 5)],
      criteria: { ...criteria, longOiMin: 0 }, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(a.occSymbol!), heldLongKey(b.occSymbol!)]),
      heldLongBasis: new Map([[heldLongKey(a.occSymbol!), { avgOpen: 20, quantity: 1 }], [heldLongKey(b.occSymbol!), { avgOpen: null, quantity: 1 }]]),
    });
    expect(result.qualifiedPairs.map(p => p.longLeg.strike)).toEqual([70]);
    expect(result.nearMissPairs.map(p => [p.longLeg.strike, p.primaryFailureReason?.code])).toEqual([[75, UNAVAILABLE]]);
  });

  it('floor-failed held pairs stay in nearMissPairs as data but are not counted structurally valid (never a near-miss by the counter)', () => {
    for (const row of [
      { Kl: 80, Ks: 105, bid: 1.00, spot: 92.5, ask: 20, avgOpen: '26.00' },
      { Kl: 80, Ks: 105, bid: 3.00, spot: 92.5, ask: 20, avgOpen: null },
      { Kl: 80, Ks: 105, bid: 3.00, spot: 92.5, ask: 20, avgOpen: '26.00', quantity: 2 },
    ]) {
      const { result } = outcome(row);
      expect(result.qualifiedPairs).toHaveLength(0);
      expect(result.nearMissPairs).toHaveLength(1);
      expect(result.counts.structurallyValidPairs).toBe(0);
      expect(result.counts.nearMissPairsBeforeRetention).toBe(1);
    }
  });

  it('the new held failure codes never combine with the near-miss-only code: primary reason is the floor/basis code', () => {
    const { result } = outcome({ Kl: 80, Ks: 105, bid: 1.00, spot: 92.5, ask: 20, avgOpen: '26.00' });
    expect(result.nearMissPairs[0].failureReasons.map(r => r.code)).toEqual([FLOOR]);
  });
});

describe('new-entry pairing is unchanged (A18, A19): junk basis and quantity in the input change nothing', () => {
  const junk = new Map([
    [heldLongKey(occ('2027-06-18', 80)), { avgOpen: null, quantity: Number.NaN }],
    ['occ:anything', { avgOpen: -5, quantity: 99 }],
  ]);
  const newEntry = (Ks: number, withJunk: boolean) => pairPmccCandidates({
    symbol: 'GS', underlyingPrice: 92.5, longLegs: [longLeg(80, 24.10, { bid: 24.0 })], shortLegs: [shortLeg(Ks, 1.60, { ask: 1.65 })],
    criteria, asOf, marketSession: 'open', ...(withJunk ? { heldLongBasis: junk } : {}),
  });
  it('A18 F4a: debit 22.50 < width 25 qualifies, byte-identical with or without the junk input', () => {
    expect(newEntry(105, false).qualifiedPairs).toHaveLength(1);
    expect(JSON.stringify(newEntry(105, true))).toBe(JSON.stringify(newEntry(105, false)));
  });
  it('A19 equality (22.50 = 22.50) is a hard reject (SCAN-ALIGN-0001E), not a near-miss, byte-identical with junk', () => {
    const plain = newEntry(102.5, false);
    expect(plain.qualifiedPairs).toHaveLength(0);
    expect(plain.nearMissPairs).toHaveLength(0);
    expect(plain.counts.structurallyValidPairs).toBe(0);
    expect(plain.counts.debitRejectedPairs).toBe(1);
    expect(JSON.stringify(newEntry(102.5, true))).toBe(JSON.stringify(plain));
  });
});
