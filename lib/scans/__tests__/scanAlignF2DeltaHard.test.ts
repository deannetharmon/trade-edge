// lib/scans/__tests__/scanAlignF2DeltaHard.test.ts

// SCAN-ALIGN-0001F (F2): PMCC short delta is a hard filter. Fixtures are the Alan-approved list
// (short leg, window 0.20-0.35), the held zero-shorts outcome, and the never-"no short calls found" rule.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { pairPmccCandidates } from '../pmccPairing';
import { runPmccProduction } from '../pmccProduction';
import { heldLongKey } from '../pmccHeldBreakeven';
import { computePmccDeltaRemoval, deltaRemovedBanner, selectDeltaRemovedNotice } from '../pmccHeldOutcomeDisplay';
import { PMCC_DECISION_POLICY_VERSION } from '../pmccDecision';
import type { HeldPmccLongCandidate } from '../pmccHeldLeaps';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const ASOF = '2026-09-24T15:00:00.000Z';
const asOf = new Date(ASOF);
const X1 = '2026-10-16';
const LONG_EXP = '2027-09-17';
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 15, shortMax: 90, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.35 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
const longLeg = (overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: LONG_EXP, strike: 720, delta: 0.8, openInterest: 500, bid: 320, ask: 322,
  occSymbol: occ(LONG_EXP, 720), quoteTimestamp: '2026-09-24T14:59:30.000Z', delayed: false, ...overrides,
});
const shortLeg = (delta: number | null | undefined, strike = 1060): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: X1, strike, delta: delta as number, openInterest: 500, bid: 8, ask: 8.2,
  occSymbol: occ(X1, strike), quoteTimestamp: '2026-09-24T14:59:30.000Z', delayed: false,
});
const pair = (longs: PmccChainLeg[], shorts: PmccChainLeg[], crit = criteria) =>
  pairPmccCandidates({ symbol: 'GS', underlyingPrice: 1037.55, longLegs: longs, shortLegs: shorts, criteria: crit, asOf, marketSession: 'open' });
const shortOutcome = (delta: number | null | undefined, crit = criteria) => {
  const result = pair([longLeg()], [shortLeg(delta)], crit);
  return { eligible: result.counts.eligibleShortLegs, reasons: result.legRejections.filter(r => r.role === 'short').flatMap(r => r.reasons) };
};

describe('short delta boundaries (window 0.20-0.35, inclusive, abs)', () => {
  it.each([[0.20], [0.35], [-0.30], [0.3500000001], [0.2 + 0.15]])('%s is eligible', delta => {
    expect(shortOutcome(delta).eligible).toBe(1);
  });

  it.each([[0.199], [0.351], [-0.36], [0.3500001]])('%s rejects DELTA_OUT_OF_RANGE with observed value and window', delta => {
    const out = shortOutcome(delta);
    expect(out.eligible).toBe(0);
    expect(out.reasons.map(r => r.code)).toEqual(['DELTA_OUT_OF_RANGE']);
    expect(out.reasons[0].message).toBe(`Short delta ${Math.abs(delta).toFixed(2)} outside 0.20-0.35`);
  });

  it('0.35 against a max built as 0.2 + 0.15 (float noise) is eligible', () => {
    expect(shortOutcome(0.35, { ...criteria, shortDelta: { min: 0.2, max: 0.2 + 0.15 } }).eligible).toBe(1);
  });

  it.each([[null], [undefined], [Number.NaN], [Number.POSITIVE_INFINITY]])('%s rejects INSUFFICIENT_DATA with a non-empty reason', delta => {
    const out = shortOutcome(delta);
    expect(out.eligible).toBe(0);
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(out.reasons.map(r => r.code)).toContain('INSUFFICIENT_DATA');
    expect(out.reasons.map(r => r.code)).not.toContain('DELTA_OUT_OF_RANGE');
  });
});

describe('long leg delta is unchanged', () => {
  it.each([[0.95], [0.5]])('a new-entry LEAP long at %s still rejects DELTA_OUT_OF_RANGE', delta => {
    const result = pair([longLeg({ delta })], [shortLeg(0.25)]);
    expect(result.counts.eligibleLongLegs).toBe(0);
    expect(result.legRejections.find(r => r.role === 'long')?.reasons.map(r => r.code)).toContain('DELTA_OUT_OF_RANGE');
  });

  it('a held long at 0.95 stays eligible; a 0.45 short is rejected and a 0.25 short retained', () => {
    const held = longLeg({ delta: 0.95 });
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [held], shortLegs: [shortLeg(0.45, 1070), shortLeg(0.25, 1080)], criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(held.occSymbol!)]),
      heldLongBasis: new Map([[heldLongKey(held.occSymbol!), { avgOpen: 345, quantity: 1 }]]),
    });
    expect(result.counts.eligibleLongLegs).toBe(1);
    expect(result.qualifiedPairs.map(p => p.shortLeg.strike)).toEqual([1080]);
    expect(result.legRejections.find(r => r.strike === 1070)?.reasons.map(r => r.code)).toEqual(['DELTA_OUT_OF_RANGE']);
  });
});

describe('held zero-shorts outcome through production', () => {
  const held: HeldPmccLongCandidate = {
    accountNumber: '5WT00001', positionKey: 'held-gs', underlyingSymbol: 'GS',
    occSymbol: occ(LONG_EXP, 720), expiration: LONG_EXP, dte: 358, strike: 720, quantity: 1, avgOpenPrice: 345,
  };
  const snapshot = { asOf: ASOF, marketSession: 'open' as const, criteria, decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION };
  const context = (earningsDate: string | null = null) => ({ symbol: 'GS', price: 1037.55, ivr: 35, underlyingType: 'stock' as const, earningsDate });
  const run = (shorts: PmccChainLeg[], heldList: HeldPmccLongCandidate[] = [held], earningsDate: string | null = null) =>
    runPmccProduction({ shortExpirations: [], longExpirations: [], chains: {} }, context(earningsDate), snapshot,
      { adapt: vi.fn(() => ({ longLegs: [longLeg()], shortLegs: shorts })), pair: pairPmccCandidates }, heldList);
  const NEVER = /no short calls found/i;

  it('every short out of window: no eligible short, delta line with the snapshot window and a real reason', () => {
    const results = run([shortLeg(0.45, 1070), shortLeg(0.5, 1080)]);
    expect(results).toHaveLength(1);
    const [card] = results;
    expect(card.pmccPair).toBeUndefined();
    expect(card.pmccPairingCounts?.eligibleShortLegs).toBe(0);
    expect(card.pmccDeltaRemoval).toMatchObject({ min: 0.2, max: 0.35, removedCount: 2, deltaOnlyCount: 2, consideredCount: 2 });
    const notice = selectDeltaRemovedNotice(card.pmccDeltaRemoval)!;
    expect(notice.banner).toBe('No short calls within your delta window (0.20 to 0.35). Adjust Min/Max delta.');
    expect(notice.reasonLine).toBe('2 shorts fell outside the window');
    expect(card.failReasons).toEqual([notice.banner, notice.reasonLine]);
    expect(card.failReasons.join(' ')).not.toMatch(NEVER);
  });

  it('a single short prints the singular reason line', () => {
    const [card] = run([shortLeg(0.45)]);
    expect(selectDeltaRemovedNotice(card.pmccDeltaRemoval)?.reasonLine).toBe('1 short fell outside the window');
  });

  it('a new-entry scan (no held LEAP) gets no delta line but the audit still records DELTA_OUT_OF_RANGE', () => {
    const [card] = run([shortLeg(0.45)], []);
    expect(card.pmccDeltaRemoval).toBeUndefined();
    expect(card.failReasons.join(' ')).toContain('Short delta 0.45 outside 0.20-0.35');
    expect(card.pmccLegRejections?.some(r => r.reasons.some(x => x.code === 'DELTA_OUT_OF_RANGE'))).toBe(true);
  });

  it('a short in the window keeps the held symbol out of the delta outcome', () => {
    const results = run([shortLeg(0.45, 1070), shortLeg(0.25, 1080)]);
    expect(results.every(r => r.pmccDeltaRemoval === undefined)).toBe(true);
    expect(results.some(r => r.pmccPair?.shortLeg.strike === 1080)).toBe(true);
  });

  it('an empty chain does not blame delta', () => {
    const [card] = run([]);
    expect(card.pmccDeltaRemoval).toBeUndefined();
    expect(card.failReasons.join(' ')).not.toContain('delta window');
  });

  it('a short that failed delta AND another filter does not make delta binding', () => {
    const bad = { ...shortLeg(0.45), openInterest: null } as PmccChainLeg;
    const [card] = run([bad]);
    expect(card.pmccDeltaRemoval).toBeUndefined();
  });

  it('a short emptied by DTE alone does not blame delta', () => {
    const outOfDte: PmccChainLeg = { ...shortLeg(0.25), expiration: '2026-09-25', occSymbol: occ('2026-09-25', 1060) };
    const [card] = run([outOfDte]);
    expect(card.pmccDeltaRemoval).toBeUndefined();
  });

  it('earnings-removed wins over delta (the shorts never reach pairing, so delta is not binding)', () => {
    const [card] = run([shortLeg(0.45)], [held], '2026-10-16');
    expect(card.pmccDeltaRemoval).toBeUndefined();
    expect(card.pmccEarningsRemoval?.allShortsRemoved).toBe(true);
  });

  it('cost-basis unavailable wins over delta', () => {
    const results = run([shortLeg(0.45)], [{ ...held, avgOpenPrice: null }]);
    results.forEach(r => expect(r.pmccDeltaRemoval).toBeUndefined());
  });
});

describe('delta notice helpers', () => {
  const removal = { min: 0.2, max: 0.35, removedCount: 3, deltaOnlyCount: 1, consideredCount: 5 };
  it('prints two decimals from the supplied window and never says "no short calls found"', () => {
    expect(deltaRemovedBanner(0.1, 0.4)).toBe('No short calls within your delta window (0.10 to 0.40). Adjust Min/Max delta.');
    const notice = selectDeltaRemovedNotice(removal)!;
    expect(notice.reasonLine).toBe('3 shorts fell outside the window');
    expect(`${notice.banner} ${notice.reasonLine}`).not.toMatch(/no short calls found/i);
  });
  it('precedence: cost-basis and earnings win; absent or non-binding removal returns null', () => {
    expect(selectDeltaRemovedNotice(removal, true)).toBeNull();
    expect(selectDeltaRemovedNotice(removal, false, true)).toBeNull();
    expect(selectDeltaRemovedNotice(undefined)).toBeNull();
    expect(selectDeltaRemovedNotice({ ...removal, deltaOnlyCount: 0 })).toBeNull();
  });
  it('computePmccDeltaRemoval is undefined for new-entry mode and when a short survived', () => {
    const empty = pair([longLeg()], [shortLeg(0.45)]);
    expect(computePmccDeltaRemoval(empty, false)).toBeUndefined();
    expect(computePmccDeltaRemoval(empty, true)).toMatchObject({ min: 0.2, max: 0.35, removedCount: 1, deltaOnlyCount: 1 });
    const survived = pair([longLeg()], [shortLeg(0.45, 1070), shortLeg(0.25, 1080)]);
    expect(computePmccDeltaRemoval(survived, true)).toBeUndefined();
  });
});
