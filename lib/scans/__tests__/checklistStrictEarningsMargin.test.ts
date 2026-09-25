// lib/scans/__tests__/checklistStrictEarningsMargin.test.ts

// SCAN-EARNINGS-TARGETED-0001: in strict (Targeted) mode the earnings check is decided
// against the expirations actually evaluated, and earnings must fall at least
// EARNINGS_MIN_DAYS_AFTER_EXPIRY (10) calendar days after the expiration to clear it.
// Fixed "today" is 2026-09-25 (New York), DTE range 21-45, so the generic buffer is 50 days.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runChecklist } from '../checklist';
import { DEFAULT_RULES } from '../constants';
import { earningsOnOrBeforeExpiration, EARNINGS_MIN_DAYS_AFTER_EXPIRY } from '../earningsPrecheck';

const RULES = { ...DEFAULT_RULES, DTE_MIN: 21, DTE_MAX: 45 };
const TODAY = '2026-09-25';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function run(earnings: string | null, expirations: string[], strictOnly = true, isEtfOrIndex = false) {
  return runChecklist(
    'TEST', 'BPS',
    { ivRank: 50, earningsExpectedDate: earnings },
    { expirations, chains: {}, isEtfOrIndex }, 100, RULES, undefined, undefined, undefined, undefined, strictOnly,
  );
}

describe('strict-mode earnings margin (Targeted)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses a 10-day margin', () => {
    expect(EARNINGS_MIN_DAYS_AFTER_EXPIRY).toBe(10);
  });

  describe('single expiry 2026-10-23', () => {
    const EXP = '2026-10-23';
    const cases: Array<[string, number, 'pass' | 'fail']> = [
      ['2026-10-22', -1, 'fail'],
      ['2026-10-23', 0, 'fail'],
      ['2026-10-24', 1, 'fail'],
      ['2026-10-29', 6, 'fail'],
      ['2026-11-01', 9, 'fail'],
      ['2026-11-02', 10, 'pass'],
      ['2026-11-03', 11, 'pass'],
      ['2026-11-20', 28, 'pass'],
    ];
    it.each(cases)('earnings %s (margin %i days) -> %s', (earnings, margin, expected) => {
      const r = run(earnings, [EXP]);
      expect(r.checks.earnings.status).toBe(expected);
      if (expected === 'pass') expect(r.checks.earnings.reason).toBe(`Earnings ${margin}d after expiry`);
      else expect(r.failReasons.some(x => x.startsWith('Earnings in '))).toBe(true);
    });
  });

  it('the AMD example: expiry 27 days out, earnings 12 days after it, passes', () => {
    const r = run('2026-11-03', ['2026-10-23']);
    expect(r.checks.earnings.status).toBe('pass');
    expect(r.failReasons.some(x => x.startsWith('Earnings in '))).toBe(false);
  });

  it('calendar rollovers use whole calendar days (month and year)', () => {
    expect(earningsOnOrBeforeExpiration('2026-11-07', '2026-10-28', '2026-09-25', 10)).toBe(false);
    expect(earningsOnOrBeforeExpiration('2026-11-06', '2026-10-28', '2026-09-25', 10)).toBe(true);
    expect(earningsOnOrBeforeExpiration('2027-01-03', '2026-12-24', '2026-12-01', 10)).toBe(false);
    expect(earningsOnOrBeforeExpiration('2027-01-02', '2026-12-24', '2026-12-01', 10)).toBe(true);
  });

  it('several expirations: passes when any clears earnings by the margin, shows the smallest clearing margin', () => {
    const r = run('2026-11-03', ['2026-10-19', '2026-10-23', '2026-10-30']);
    expect(r.checks.earnings.status).toBe('pass');
    expect(r.checks.earnings.reason).toBe('Earnings 11d after expiry');
  });

  it('a lone expiry that does not clear earnings fails', () => {
    const r = run('2026-11-03', ['2026-10-30']);
    expect(r.checks.earnings.status).toBe('fail');
    expect(r.checks.earnings.reason).toContain('10+ days before earnings');
  });

  it('with no in-range expiration the previous generic result is kept (no candidate either way)', () => {
    const r = run('2026-10-05', ['2026-12-31']);
    expect(r.checks.earnings.status).toBe('fail');
    expect(r.checks.earnings.reason).toContain('no qualifying 21-45d expiration clears it');
    expect(r.bestCandidate).toBeNull();
  });

  it('unchanged: past, missing, unparseable earnings dates and ETF/index', () => {
    expect(run('2026-09-10', ['2026-10-23']).checks.earnings.status).toBe('pass');
    expect(run(null, ['2026-10-23']).checks.earnings.status).toBe('pass');
    expect(run('not-a-date', ['2026-10-23']).checks.earnings.status).toBe('pass');
    expect(run('2026-10-24', ['2026-10-23'], true, true).checks.earnings.status).toBe('pass');
  });

  it('the one band that tightens: earnings 50+ days out but only 7 days after a 45-day expiry now fails', () => {
    const near = run('2026-11-16', ['2026-11-09']);
    expect(near.checks.earnings.status).toBe('fail');
    expect(run('2026-11-20', ['2026-11-09']).checks.earnings.status).toBe('pass');
  });

  it('Rank mode is unchanged: earnings inside the buffer warns, beyond it passes, regardless of margin', () => {
    expect(run('2026-11-03', ['2026-10-23'], false).checks.earnings.status).toBe('warn');
    expect(run('2026-11-20', ['2026-10-23'], false).checks.earnings.status).toBe('pass');
  });

  it('grid: nothing at or before expiry ever passes; a pass always has a margin of 10+; a newly failing row was passing only through the generic buffer', () => {
    for (let expDay = 23; expDay <= 43; expDay += 1) {
      const exp = addDays(TODAY, expDay);
      for (let earnDay = 0; earnDay <= 80; earnDay += 1) {
        const earnings = addDays(TODAY, earnDay);
        const r = run(earnings, [exp]);
        const status = r.checks.earnings.status;
        const margin = earnDay - expDay;
        const oldStatus = earnDay < 50 ? 'fail' : 'pass'; // previous strict behavior for an upcoming date
        if (margin <= 0) expect(status, `exp ${expDay} earn ${earnDay}`).toBe('fail');
        if (status === 'pass') expect(margin, `exp ${expDay} earn ${earnDay}`).toBeGreaterThanOrEqual(10);
        if (oldStatus === 'pass' && status === 'fail') {
          expect(earnDay, `exp ${expDay} earn ${earnDay}`).toBeGreaterThanOrEqual(50);
          expect(margin, `exp ${expDay} earn ${earnDay}`).toBeLessThan(10);
        }
      }
    }
  });
});
