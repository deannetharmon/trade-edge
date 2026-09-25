// lib/scans/__tests__/checklistEarningsBasis.test.ts
// EARNINGS-DATEBASIS-0001: checklist earnings status and strict expiry filter on the NY basis.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../spread-finder', () => {
  const cand = (_items: unknown, strategyOrExp: string, maybeExp?: string) => {
    const exp = maybeExp ?? strategyOrExp;
    return {
      strategy: 'BPS', expiration: exp,
      dte: Math.round((new Date(exp).getTime() - Date.now()) / 86_400_000),
      shortStrike: 90, longStrike: 85, shortDelta: 0.25, credit: 1.8, creditRatio: 0.36, roc: 55, pop: 75,
      shortOI: 1000, longOI: 1000, spreadWidth: 5,
    };
  };
  return {
    findBestIC: cand, findBestSpread: (i: unknown, s: string, e: string) => cand(i, s, e),
    findBestICUnfiltered: cand, findBestSpreadUnfiltered: (i: unknown, s: string, e: string) => cand(i, s, e),
  };
});

import { runChecklist } from '../checklist';
import { DEFAULT_RULES } from '../constants';
import { earningsOnOrBeforeExpiration } from '../earningsPrecheck';

const EXP = '2026-10-26';
// 09:00, 17:00 and 23:30 ET on 2026-09-24 (EDT).
const NOWS: Array<[string, string]> = [
  ['09:00 ET', '2026-09-24T13:00:00Z'],
  ['17:00 ET', '2026-09-24T21:00:00Z'],
  ['23:30 ET', '2026-09-25T03:30:00Z'],
];

function run(earnings: string | null, strictOnly: boolean, expirations = [EXP]) {
  return runChecklist(
    'TEST', 'BPS',
    { ivRank: 50, earningsExpectedDate: earnings },
    { expirations, chains: {} }, 100, DEFAULT_RULES, undefined, undefined, undefined, undefined, strictOnly,
  );
}

describe('checklist earnings on the New York basis', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('golden: earnings day at 17:00 ET (old: "Already reported", not filtered; new: fails, ticker filtered)', () => {
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    const r = run('2026-09-24', true);
    expect(r.checks.earnings.status).toBe('fail');
    expect(r.checks.earnings.value).toBe('0d (2026-09-24)');
    expect(r.checks.earnings.reason).not.toContain('Already reported');
    expect(r.failReasons.join('|')).toContain('Earnings in 0d');
    expect(r.bestCandidate).toBeNull();
    expect(r.qualified).toBe(false);
  });

  it.each(NOWS)('earnings day %s: strict fails, rank warns, never "Already reported"', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    const strict = run('2026-09-24', true);
    expect(strict.checks.earnings.status).toBe('fail');
    expect(strict.qualified).toBe(false);
    const rank = run('2026-09-24', false);
    expect(rank.checks.earnings.status).toBe('warn');
    expect(rank.checks.earnings.reason).not.toContain('Already reported');
  });

  it.each(NOWS)('day after earnings (%s, next NY day) is past', (_n, iso) => {
    vi.setSystemTime(new Date(new Date(iso).getTime() + 24 * 3_600_000));
    const r = run('2026-09-24', true);
    expect(r.checks.earnings.status).toBe('pass');
    expect(r.checks.earnings.reason).toContain('Already reported');
  });

  it('23:30 ET the day before: earnings is 1d out and fails in strict mode', () => {
    vi.setSystemTime(new Date('2026-09-24T03:30:00Z')); // 23:30 ET on 09-23
    const r = run('2026-09-24', true);
    expect(r.checks.earnings.status).toBe('fail');
    expect(r.checks.earnings.value).toBe('1d (2026-09-24)');
  });

  // In strict mode runChecklist never selects a candidate itself (callers supply the
  // strike), so the strict expiry filter is asserted through the shared inclusion predicate it
  // now uses, plus its one observable effect on failReasons (past earnings keeps the expiry).
  it.each(NOWS)('strict expiry inclusion is inclusive on the expiration date at %s', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    expect(earningsOnOrBeforeExpiration(EXP, EXP)).toBe(true); // E = expiry excluded
    expect(earningsOnOrBeforeExpiration('2026-10-25', EXP)).toBe(true); // E = expiry-1 excluded
    expect(earningsOnOrBeforeExpiration('2026-10-27', EXP)).toBe(false); // E = expiry+1 kept
    expect(earningsOnOrBeforeExpiration('2026-09-23', EXP)).toBe(false); // E past kept
    expect(earningsOnOrBeforeExpiration('2026-11-01', '2026-11-01')).toBe(true); // DST day
    expect(run('2026-09-23', true).failReasons).toContain('No qualifying strikes found');
  });

  it.each(NOWS)('rank mode post-candidate inclusion uses the expiration date, not the old-basis dte (%s)', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    const onExpiry = run(EXP, false); // E = expiry: at 17:00 ET old dte is 31 but NY earnings days is 32
    expect(onExpiry.bestCandidate).not.toBeNull();
    expect(onExpiry.checks.earnings.status).toBe('warn');
    expect(onExpiry.checks.earnings.reason).toContain("this trade's");
    // EARNINGS-MARGIN-0001 phase 2: 1 to 9 days after expiry is inside the 10-day buffer (warn); 10+ is clear.
    const dayAfter = run('2026-10-27', false);
    expect(dayAfter.checks.earnings.status).toBe('warn');
    expect(dayAfter.checks.earnings.reason).toContain('1d after this trade');
    expect(run('2026-11-04', false).checks.earnings.status).toBe('warn');
    const after = run('2026-11-05', false);
    expect(after.checks.earnings.status).toBe('pass');
    expect(after.checks.earnings.reason).toContain('Outside');
    const past = run('2026-09-23', false);
    expect(past.checks.earnings.status).toBe('pass');
    expect(past.checks.earnings.reason).toContain('Already reported');
  });

  it('unparseable earnings date does not throw and does not filter', () => {
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    const r = run('N/A', true);
    expect(r.checks.earnings.status).toBe('pass');
    expect(r.failReasons).toContain('No qualifying strikes found');
  });
});
