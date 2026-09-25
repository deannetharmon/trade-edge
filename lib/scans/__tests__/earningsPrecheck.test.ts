// lib/scans/__tests__/earningsPrecheck.test.ts

import { describe, expect, it } from 'vitest';
import { earningsOnOrBeforeExpiration, evaluateEarningsPrecheck } from '../earningsPrecheck';
import { newYorkDateFromAsOf } from '../pmccEarningsDates';
import { currentNewYorkDate } from '../earningsPrecheck';
import { findBestCoveredCall } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import { earningsWithinCspExpiration, findAllCsp } from '../csp-finder';
import { DEFAULT_CC_RULES, DEFAULT_CSP_RULES } from '../constants';

describe('EARNINGS-PRECHECK-0001', () => {
  const asOfDate = '2026-09-24';

  it('keeps an earlier expiry available when earnings is inside the scan window', () => {
    const result = evaluateEarningsPrecheck({
      earningsInput: '2026-10-24',
      expirations: ['2026-10-16', '2026-10-30'],
      dteMin: 7,
      dteMax: 45,
      asOfDate,
    });
    expect(result).toMatchObject({ kind: 'advisory', earningsDate: '2026-10-24', daysUntil: 30 });
    expect(earningsOnOrBeforeExpiration('2026-10-24', '2026-10-16', asOfDate)).toBe(false);
    expect(earningsOnOrBeforeExpiration('2026-10-24', '2026-10-30', asOfDate)).toBe(true);
  });

  it('blocks earnings on the contract expiry date', () => {
    expect(earningsOnOrBeforeExpiration('2026-10-16', '2026-10-16', asOfDate)).toBe(true);
  });

  it('keeps an event beyond the scan window clear', () => {
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-11-15', expirations: ['2026-10-16'], dteMin: 7, dteMax: 45, asOfDate,
    })).toMatchObject({ kind: 'outside-window', daysUntil: 52 });
  });

  it('reports when every in-window expiry would pass through earnings', () => {
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-10-10', expirations: ['2026-10-16', '2026-10-30'], dteMin: 7, dteMax: 45, asOfDate,
    })).toMatchObject({ kind: 'no-eligible-expiration', daysUntil: 16 });
  });

  it('uses the supplied New York date rather than a host-local clock', () => {
    // 03:30Z is still the prior New York calendar day in late September.
    const newYorkAsOf = newYorkDateFromAsOf('2026-09-25T03:30:00Z');
    expect(newYorkAsOf).toBe('2026-09-24');
    expect(earningsOnOrBeforeExpiration('2026-09-25', '2026-09-24', newYorkAsOf!)).toBe(false);
    expect(earningsOnOrBeforeExpiration('2026-09-24', '2026-09-24', '2026-09-24')).toBe(true);
  });

  it('New York date boundary: 2026-10-02T01:00Z is 2026-10-01, so earnings on 10-01 is today and not past', () => {
    const newYorkAsOf = newYorkDateFromAsOf('2026-10-02T01:00:00Z');
    expect(newYorkAsOf).toBe('2026-10-01');
    expect(earningsOnOrBeforeExpiration('2026-10-01', '2026-10-05', newYorkAsOf!)).toBe(true);
    expect(earningsOnOrBeforeExpiration('2026-09-30', '2026-10-05', newYorkAsOf!)).toBe(false);
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-10-01', expirations: [], dteMin: 21, dteMax: 45, asOfDate: newYorkAsOf!,
    })).toMatchObject({ kind: 'advisory', daysUntil: 0 });
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-10-11', expirations: [], dteMin: 21, dteMax: 45, asOfDate: newYorkAsOf!,
    })).toMatchObject({ daysUntil: 10 });
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-09-30', expirations: [], dteMin: 21, dteMax: 45, asOfDate: newYorkAsOf!,
    })).toMatchObject({ kind: 'past', daysUntil: -1 });
  });

  it('classifies the remaining outcome kinds', () => {
    const base = { expirations: ['2026-10-16'], dteMin: 7, dteMax: 45, asOfDate };
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: null })).toMatchObject({ kind: 'none' });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '' })).toMatchObject({ kind: 'none' });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-09-01' })).toMatchObject({ kind: 'past', daysUntil: -23 });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-11-08' })).toMatchObject({ kind: 'advisory', daysUntil: 45 });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-11-09' })).toMatchObject({ kind: 'outside-window', daysUntil: 46 });
  });

  it('earnings after every in-window expiry but inside the window stays advisory (candidates remain)', () => {
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-11-01', expirations: ['2026-10-16', '2026-10-23'], dteMin: 7, dteMax: 45, asOfDate,
    })).toMatchObject({ kind: 'advisory' });
  });

  it('earnings ON the only in-window expiry is no-eligible-expiration', () => {
    expect(evaluateEarningsPrecheck({
      earningsInput: '2026-10-16', expirations: ['2026-10-16'], dteMin: 7, dteMax: 45, asOfDate,
    })).toMatchObject({ kind: 'no-eligible-expiration', daysUntil: 22 });
  });

  it('fails closed on unparseable dates', () => {
    expect(earningsOnOrBeforeExpiration('not-a-date', '2026-10-16', asOfDate)).toBeNull();
    expect(earningsOnOrBeforeExpiration('2026-02-30', '2026-10-16', asOfDate)).toBeNull();
    expect(earningsOnOrBeforeExpiration('2026-10-10', 'garbage', asOfDate)).toBeNull();
    expect(earningsOnOrBeforeExpiration('2026-10-10', '2026-10-16', 'garbage')).toBeNull();
    expect(evaluateEarningsPrecheck({
      earningsInput: 'not-a-date', expirations: ['2026-10-16'], dteMin: 7, dteMax: 45, asOfDate,
    })).toMatchObject({ kind: 'unavailable', earningsDate: null, daysUntil: null });
  });
});

// The finders pick their DTE window from the real clock, so these chains are
// anchored to the current New York date. Only the earnings compare is under test.
function dayOut(n: number): string {
  const [y, m, d] = currentNewYorkDate().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe('EARNINGS-MARGIN-0001: 10-day buffer after expiry in the symbol-level precheck', () => {
  const asOfDate = '2026-09-24';
  const base = { dteMin: 7, dteMax: 45, asOfDate, minDaysAfterExpiry: 10 };

  it('an expiry only 1 to 9 days before earnings does not keep the window eligible', () => {
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-10-24', expirations: ['2026-10-20'] }))
      .toMatchObject({ kind: 'no-eligible-expiration' });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-10-29', expirations: ['2026-10-20'] }))
      .toMatchObject({ kind: 'no-eligible-expiration' });
  });
  it('an expiry 10 or more days before earnings stays eligible (advisory)', () => {
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-10-30', expirations: ['2026-10-20'] }))
      .toMatchObject({ kind: 'advisory' });
  });
  it('earnings beyond dteMax + 9 days is outside the window; up to that it is still inside', () => {
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-11-15', expirations: ['2026-10-16'] })).toMatchObject({ kind: 'advisory', daysUntil: 52 });
    expect(evaluateEarningsPrecheck({ ...base, earningsInput: '2026-11-25', expirations: ['2026-10-16'] })).toMatchObject({ kind: 'outside-window', daysUntil: 62 });
  });
  it('the default of 1 day keeps the previous behavior', () => {
    expect(evaluateEarningsPrecheck({ earningsInput: '2026-10-24', expirations: ['2026-10-20'], dteMin: 7, dteMax: 45, asOfDate }))
      .toMatchObject({ kind: 'advisory' });
  });
});

describe('EARNINGS-PRECHECK-0001: covered-call finder uses each candidate\'s own expiry', () => {
  const capacity = computeCoveredCallCapacity(500, 0, 0, 90);
  function ccChain(days: number[]) {
    const expirations = days.map(dayOut);
    const chains: Record<string, unknown[]> = {};
    expirations.forEach((e) => {
      chains[e] = [{ strikePrice: 105, expirationDate: e, optionType: 'C', delta: 0.28, openInterest: 500, bid: 1.2, ask: 1.3, mid: 1.25, occSymbol: `C${e}` }];
    });
    return { expirations, chains } as never;
  }
  const find = (days: number[], earningsDate: string | null) =>
    findBestCoveredCall(ccChain(days), { rules: DEFAULT_CC_RULES, capacity, stockPrice: 100, earningsDate });

  it('earnings inside the window and 10+ days after an expiry keeps that earlier contract', () => {
    expect(find([25, 40], dayOut(37))?.expiration).toBe(dayOut(25));
  });
  it('earnings on the expiry date excludes the contract', () => {
    expect(find([30], dayOut(30))).toBeNull();
  });
  it('earnings 10 or more days after expiry, and beyond the window, pass', () => {
    expect(find([30], dayOut(40))?.expiration).toBe(dayOut(30));
    expect(find([30], dayOut(90))?.expiration).toBe(dayOut(30));
  });
  it('earnings 1 to 9 days after expiry is inside the 10-day buffer and excludes the contract', () => {
    expect(find([30], dayOut(31))).toBeNull();
    expect(find([30], dayOut(39))).toBeNull();
  });
  it('every expiry on or after earnings yields no candidate', () => {
    expect(find([25, 40], dayOut(22))).toBeNull();
  });
  it('unparseable earnings fails closed: no candidate', () => {
    expect(find([30], 'garbage')).toBeNull();
  });
});

describe('EARNINGS-PRECHECK-0001: CSP classification uses each candidate\'s own expiry, never DTE_MAX', () => {
  const put = (e: string) => [{ strikePrice: 90, expirationDate: e, optionType: 'P' as const, delta: -0.2, bid: 1.0, ask: 1.1, mid: 1.05, openInterest: 1000, occSymbol: `P${e}` }];
  const classify = (days: number[], earnings: string) => {
    const exps = days.map(dayOut);
    const chains: Record<string, ReturnType<typeof put>> = {};
    exps.forEach((e) => { chains[e] = put(e); });
    const res = findAllCsp({ expirations: exps, chains } as never, 100, { rules: DEFAULT_CSP_RULES, underlyingSymbol: 'T', earningsDate: earnings });
    const byExp: Record<string, string> = {};
    res.results.forEach((r) => { byExp[r.candidate.expiration] = r.marketQualification; });
    return byExp;
  };

  it('earnings between two expiries inside DTE_MAX: earlier (10+ days clear) qualifies, later is DISQUALIFIED_EARNINGS', () => {
    const byExp = classify([31, 44], dayOut(42));
    expect(byExp[dayOut(31)]).toBe('QUALIFIED');
    expect(byExp[dayOut(44)]).toBe('DISQUALIFIED_EARNINGS');
  });
  it('earnings on the candidate expiry date disqualifies it', () => {
    expect(classify([35], dayOut(35))[dayOut(35)]).toBe('DISQUALIFIED_EARNINGS');
  });
  it('earnings 1 to 9 days after expiry is inside the 10-day buffer and disqualifies', () => {
    expect(classify([35], dayOut(36))[dayOut(35)]).toBe('DISQUALIFIED_EARNINGS');
    expect(classify([35], dayOut(44))[dayOut(35)]).toBe('DISQUALIFIED_EARNINGS');
  });
  it('earnings 10 or more days after expiry is clear', () => {
    expect(classify([35], dayOut(45))[dayOut(35)]).toBe('QUALIFIED');
    expect(classify([35], dayOut(80))[dayOut(35)]).toBe('QUALIFIED');
  });
  it('earningsWithinCspExpiration honors an explicit New York as-of date and fails closed on garbage', () => {
    const asOf = newYorkDateFromAsOf('2026-10-02T01:00:00Z')!;
    expect(earningsWithinCspExpiration('2026-10-01', '2026-10-05', asOf)).toBe(true);
    expect(earningsWithinCspExpiration('2026-09-30', '2026-10-05', asOf)).toBe(false);
    expect(earningsWithinCspExpiration('garbage', '2026-10-05', asOf)).toBeNull();
  });
});
