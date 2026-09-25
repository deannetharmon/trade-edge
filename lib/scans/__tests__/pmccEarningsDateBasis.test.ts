// lib/scans/__tests__/pmccEarningsDateBasis.test.ts
// EARNINGS-DATEBASIS-0001 commit 3: PMCC score, readiness, lifecycle and stop/GTC prompt on the NY basis.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePmccScore } from '../pmccScore';
import { evaluatePmccReadiness } from '../pmccReadiness';
import { evaluatePmccLifecycle } from '../pmccLifecycle';
import { buildStopGtcFlags } from '../../portfolio/pmccStopGtcPrompt';

const T = '2026-09-24';
const X = '2026-10-16';
// 09:00, 17:00, 23:30 ET on T (EDT).
const NOWS: Array<[string, string]> = [
  ['09:00 ET', '2026-09-24T13:00:00Z'],
  ['17:00 ET', '2026-09-24T21:00:00Z'],
  ['23:30 ET', '2026-09-25T03:30:00Z'],
];

const scoreInputs = (earningsDate: string | null) => ({
  annualizedRoiPct: 30, longLegSpreadPct: 1, longLegOpenInterest: 500, shortLegSpreadPct: 1, shortLegOpenInterest: 500,
  earningsDate, shortLegExpiration: X, earningsDeductionEnabled: true,
});

describe('computePmccScore earnings flag (injectable clock)', () => {
  it.each(NOWS)('%s', (_n, iso) => {
    const now = new Date(iso);
    const flag = (e: string | null) => computePmccScore(scoreInputs(e), now).earningsFlagged;
    expect(flag(T)).toBe(true);
    expect(flag('2026-09-23')).toBe(false);
    expect(flag(X)).toBe(true);
    expect(flag('2026-10-17')).toBe(false);
    expect(flag('2026-10-01T16:00:00Z')).toBe(true); // leading date (was an invalid Date -> false)
    expect(flag('2026-02-30')).toBe(false);
    expect(flag(null)).toBe(false);
  });
  it('next NY day the same earnings date is past', () => {
    expect(computePmccScore(scoreInputs(T), new Date('2026-09-25T04:00:00Z')).earningsFlagged).toBe(false);
  });
});

describe('evaluatePmccReadiness earnings gate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const pair: any = {
    qualified: true, failureReasons: [], primaryFailureReason: null,
    shortLeg: { expiration: X, quote: { readyInput: true } }, longLeg: { quote: { readyInput: true } },
  };
  const gate = (e: string, earnings: 'block' | 'warn') =>
    evaluatePmccReadiness({ pair, longContractQualified: true, earningsDate: e, policy: { version: 't', earnings } }).gates.find(g => g.id === 'earnings')!;

  it.each(NOWS)('%s', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    expect(gate(T, 'block').status).toBe('fail');
    expect(gate(T, 'warn')).toMatchObject({ status: 'pass', message: 'Earnings caution acknowledged by policy' });
    expect(gate('2026-09-23', 'block').status).toBe('pass');
    expect(gate(X, 'block').status).toBe('fail');
    expect(gate('2026-10-17', 'block').status).toBe('pass');
  });
});

describe('evaluatePmccLifecycle on the NY day', () => {
  const base = { shortExpiration: X, shortStrike: 500, underlyingPrice: 400, quoteAgeSeconds: 5, earningsDate: '2026-09-24' as string | null, exDividendDate: null as string | null };
  const ids = (now: string, over: object = {}) => evaluatePmccLifecycle({ ...base, now, ...over }).alerts.map(a => a.id);

  it('earnings alert holds through the NY day and drops at NY midnight', () => {
    expect(evaluatePmccLifecycle({ ...base, now: '2026-09-24T23:59:59Z' }).status).toBe('ACTION_REQUIRED');
    expect(ids('2026-09-25T00:00:00Z')).toContain('earnings'); // old UTC basis dropped it here
    expect(ids('2026-09-25T03:59:00Z')).toContain('earnings');
    expect(ids('2026-09-25T04:00:00Z')).not.toContain('earnings');
  });
  it('ex-dividend uses the same NY today', () => {
    const over = { earningsDate: null, exDividendDate: '2026-09-24' };
    expect(ids('2026-09-25T00:00:00Z', over)).toContain('exDividend');
    expect(ids('2026-09-25T04:00:00Z', over)).not.toContain('exDividend');
  });
  it('EST rollover: X and E 12-15 at 12-16T00:00Z', () => {
    const over = { shortExpiration: '2026-12-15', earningsDate: '2026-12-15' };
    const r = evaluatePmccLifecycle({ ...base, ...over, now: '2026-12-16T00:00:00Z' });
    expect(r.alerts.map(a => a.id)).toEqual(expect.arrayContaining(['earnings', 'shortExpiry']));
    expect(r.alerts.find(a => a.id === 'shortExpiry')!.severity).toBe('critical');
  });
  it("short expiry (Ian): X 09-25 at 09-25T00:00Z is warning at dte 1 with '1 day'; NY date 09-25 is critical", () => {
    const warn = evaluatePmccLifecycle({ ...base, earningsDate: null, shortExpiration: '2026-09-25', now: '2026-09-25T00:00:00Z' });
    const a = warn.alerts.find(x => x.id === 'shortExpiry')!;
    expect(a.severity).toBe('warning');
    expect(a.message).toContain('1 day;');
    const crit = evaluatePmccLifecycle({ ...base, earningsDate: null, shortExpiration: '2026-09-25', now: '2026-09-25' });
    expect(crit.alerts.find(x => x.id === 'shortExpiry')!.severity).toBe('critical');
    const two = evaluatePmccLifecycle({ ...base, earningsDate: null, shortExpiration: '2026-09-26', now: '2026-09-25T00:00:00Z' });
    expect(two.alerts.find(x => x.id === 'shortExpiry')!.message).toContain('2 days;');
  });
  it('zoneless now or an impossible expiration is DATA_UNAVAILABLE', () => {
    expect(evaluatePmccLifecycle({ ...base, now: '2026-09-24T12:00:00' }).status).toBe('DATA_UNAVAILABLE');
    expect(evaluatePmccLifecycle({ ...base, now: '2026-09-24T12:00:00Z', shortExpiration: '2026-02-30' }).status).toBe('DATA_UNAVAILABLE');
  });
  it('an impossible earnings date is ignored', () => {
    expect(ids('2026-09-24T13:00:00Z', { earningsDate: '2026-02-30' })).not.toContain('earnings');
  });
});

describe('buildStopGtcFlags earnings on the NY basis', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flags = (e: string | null) => buildStopGtcFlags({ needsClose: false, entryDte: 30, dte: 22, buffer: 10, earningsDate: e, expDate: X, ivr: 40, profitCaptured: null });
  it.each(NOWS)('%s', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    expect(flags(T)).toContain('EARNINGS 2026-09-24');
    expect(flags('2026-09-23')).toBe('None');
    expect(flags(X)).toContain('EARNINGS');
    expect(flags('2026-10-17')).toBe('None');
    expect(flags('2026-02-30')).toBe('None');
  });
});
