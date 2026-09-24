// lib/scans/__tests__/pmccEarningsGate.test.ts

// PMCC-EARNINGS-PAST-0001 -- Alan's B1-B28 case table. Host-timezone
// independent by construction; run under TZ=UTC and TZ=America/Los_Angeles
// with identical results.
import { describe, expect, it } from 'vitest';
import { evaluatePmccDecision } from '../pmccDecision';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { newYorkDateFromAsOf, normalizeEarningsDate, parseStrictIsoDate } from '../pmccEarningsDates';
import type { PmccPairResult, PmccPairingCriteria, PmccQuoteQuality } from '../pmccTypes';

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 },
  shortDelta: { min: 0.20, max: 0.35 },
  longOiMin: 100,
  shortOiMin: 100,
  requireDebitBelowWidth: true,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

const quote: PmccQuoteQuality = {
  bid: 10, ask: 10.2, midpoint: 10.1, width: 0.2, spreadPct: 1.98,
  quoteTimestamp: '2026-09-04T19:59:30.000Z', ageSeconds: 30, delayed: false,
  structurallyUsable: true, withinQualifyingWidth: true, readyInput: true, status: 'acceptable',
  reason: 'Quote is actionable and fresh',
};

const pairWithExpiry = (expiration: unknown): PmccPairResult => ({
  pairId: 'occ:LONG::occ:SHORT', symbol: 'NFLX', qualified: true, insufficientData: false,
  failureReasons: [], primaryFailureReason: null, orderingLabel: 'Contract order', entryMode: 'new-pmcc',
  longLeg: { candidateId: 'occ:LONG', role: 'long', underlyingSymbol: 'NFLX', expiration: '2027-09-17', dte: 375, strike: 70, delta: 0.78, openInterest: 500, occSymbol: 'NFLX270917C00070000', quote, executablePrice: 20, intrinsic: 8, extrinsic: 12 },
  shortLeg: { candidateId: 'occ:SHORT', role: 'short', underlyingSymbol: 'NFLX', expiration: expiration as string, dte: 32, strike: 83, delta: 0.31, openInterest: 208, occSymbol: 'NFLX261016C00083000', quote, executablePrice: 1.46, intrinsic: null, extrinsic: null },
  metrics: { netDebitPerShare: 18.54, strikeWidth: 13, widthMinusDebitPerShare: -5.54, widthMinusDebitPctOfDebit: -29.88, longIntrinsicPerShare: 8, longExtrinsicPerShare: 12, shortCreditToNetDebitPct: 7.87, shortCreditToLongExtrinsicPct: 12.17, netDelta: 0.37 },
});

function earningsGate(asOf: unknown, earnings: unknown, ...expiryArg: unknown[]) {
  const expiry = expiryArg.length ? expiryArg[0] : '2026-10-16';
  const decision = evaluatePmccDecision({
    pair: pairWithExpiry(expiry), criteria, marketSession: 'open',
    earningsDate: earnings as string | null | undefined, asOf: asOf as string | null | undefined,
  });
  return decision.gates.find(g => g.code === 'EARNINGS_BEFORE_SHORT_EXPIRY');
}
const fires = (asOf: unknown, earnings: unknown, ...x: unknown[]) => expect(earningsGate(asOf, earnings, ...x)).toBeDefined();
const silent = (asOf: unknown, earnings: unknown, ...x: unknown[]) => expect(earningsGate(asOf, earnings, ...x)).toBeUndefined();

const T0 = '2026-09-24T14:00:00Z';

describe('PMCC earnings gate (T <= E <= X)', () => {
  it('B1/B2 past dates do not gate; B3-B5 today..expiry gate; B6 after expiry does not', () => {
    silent(T0, '2026-08-01');
    silent(T0, '2026-09-23');
    fires(T0, '2026-09-24');
    fires(T0, '2026-09-25');
    fires(T0, '2026-10-16');
    silent(T0, '2026-10-17');
  });

  it('B7 missing earnings and B8 malformed earnings are no date', () => {
    for (const e of [null, undefined, '']) silent(T0, e);
    for (const e of ['2026-9-24', '10/16/2026', 'garbage', '2026-02-30']) silent(T0, e);
  });

  it('B9/B10 timestamp earnings use the leading date; observed value carries the normalized date', () => {
    fires(T0, '2026-10-16T20:00');
    expect(earningsGate(T0, '2026-10-16T20:00')?.observedValue).toBe('2026-10-16');
    silent(T0, '2026-09-23T20:00');
    fires(T0, '2026-10-16T00:00:00Z');
    fires(T0, '2026-10-16T20:00:00-04:00');
    fires(T0, '2026-10-16T23:30:00-05:00');
    silent(T0, '2026-10-17T00:00:00Z');
    silent(T0, '2026-09-23T23:59:59Z');
    fires(T0, '2026-09-24T00:00:00Z');
    silent(T0, '2026-02-30T20:00');
    silent(T0, '2026-10-16Tgarbage');
    silent(T0, ' 2026-10-16 ');
    silent(T0, 20261016);
    silent(T0, new Date('2026-10-16T00:00:00Z'));
  });

  it('B11/B12 23:30 EDT is still 09-24 in New York', () => {
    fires('2026-09-25T03:30:00Z', '2026-10-16');
    fires('2026-09-25T03:30:00Z', '2026-09-24');
    silent('2026-09-25T03:30:00Z', '2026-09-23');
  });

  it('B13/B14/B19 21:00 EDT on 10-01 (already 10-02 UTC)', () => {
    fires('2026-10-02T01:00:00Z', '2026-10-01');
    silent('2026-10-02T01:00:00Z', '2026-09-30');
    fires('2026-10-01T21:00:00-04:00', '2026-10-01');
  });

  it('B15-B18 DST boundary (X 2026-11-20)', () => {
    fires('2026-11-02T04:30:00Z', '2026-11-01', '2026-11-20');
    fires('2026-11-01T03:59:00Z', '2026-10-31', '2026-11-20');
    silent('2026-11-01T04:00:00Z', '2026-10-31', '2026-11-20');
    fires('2026-11-01T05:30:00Z', '2026-11-01', '2026-11-20');
    fires('2026-11-01T06:30:00Z', '2026-11-01', '2026-11-20');
    silent('2026-11-01T05:30:00Z', '2026-10-31', '2026-11-20');
    silent('2026-11-01T06:30:00Z', '2026-10-31', '2026-11-20');
  });

  it('B20a-d missing/unparseable asOf skips the lower bound only', () => {
    for (const a of [null, undefined, '']) fires(a, '2026-08-01');
    fires('garbage', '2026-08-01');
    for (const a of [null, undefined, '', 'garbage']) silent(a, '2026-10-17');
    for (const a of [null, undefined, '', 'garbage']) { silent(a, null); silent(a, 'garbage'); }
  });

  it('B21 date-only asOf is a NY calendar date with no conversion', () => {
    silent('2026-09-24', '2026-09-23');
    fires('2026-09-24', '2026-09-24');
  });

  it('B22 offset-form asOf', () => {
    fires('2026-09-24T23:30:00-04:00', '2026-09-24');
    silent('2026-09-24T23:30:00-04:00', '2026-09-23');
  });

  it('B23 non-ISO asOf is unparseable (lower bound skipped)', () => {
    for (const a of ['Sept 24 2026', '09/24/2026', '2026-09-24T23:30 EDT']) fires(a, '2026-08-01');
  });

  it('B25/B26 zoneless or impossible-date asOf datetime is unparseable', () => {
    fires('2026-09-24T14:00', '2026-08-01');
    fires('2026-02-30T14:00Z', '2026-08-01');
    fires('2026-09-24 14:00:00Z', '2026-08-01');
    fires('2026-09-24t14:00:00z', '2026-08-01');
  });

  it('B27 missing or malformed short expiry is no gate', () => {
    for (const x of [null, undefined, '', '2026-02-30', 'garbage']) silent(T0, '2026-10-01', x);
  });

  it('B28 validator boundaries', () => {
    fires('2028-02-01', '2028-02-29', '2028-03-15');
    for (const e of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10']) silent(T0, e);
  });
});

describe('pmccEarningsDates validators', () => {
  it('parseStrictIsoDate rejects impossible calendar dates', () => {
    expect(parseStrictIsoDate('2028-02-29')).toBe('2028-02-29');
    for (const v of ['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-16T20:00', ' 2026-10-16', null, 5]) {
      expect(parseStrictIsoDate(v)).toBeNull();
    }
  });

  it('normalizeEarningsDate implements the earnings grammar', () => {
    expect(normalizeEarningsDate('2026-10-16')).toBe('2026-10-16');
    expect(normalizeEarningsDate('2026-10-16T20:00')).toBe('2026-10-16');
    expect(normalizeEarningsDate('2026-10-16T20:00:15.123456Z')).toBe('2026-10-16');
    expect(normalizeEarningsDate('2026-10-16T20:00:15+05:30')).toBe('2026-10-16');
    for (const v of ['2026-10-16 20:00', '2026-10-16t20:00', '2026-10-16T24:00', '2026-10-16T20:60', '2026-10-16T20:00:60', '2026-10-16T20:00.5', '2026-10-16T20:00+24:00', '2026-10-16T20:00z', '2026-10-16T']) {
      expect(normalizeEarningsDate(v)).toBeNull();
    }
  });

  it('newYorkDateFromAsOf requires a zone for datetimes and uses New York time', () => {
    expect(newYorkDateFromAsOf('2026-09-25T03:30:00Z')).toBe('2026-09-24');
    expect(newYorkDateFromAsOf('2026-11-01T04:00:00Z')).toBe('2026-11-01');
    expect(newYorkDateFromAsOf('2026-11-01T03:59:59.999Z')).toBe('2026-10-31');
    expect(newYorkDateFromAsOf('2026-09-24T14:00')).toBeNull();
    expect(newYorkDateFromAsOf('2026-09-24')).toBe('2026-09-24');
    expect(newYorkDateFromAsOf(new Date())).toBeNull();
  });
});
