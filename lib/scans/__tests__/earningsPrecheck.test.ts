import { describe, expect, it } from 'vitest';
import { earningsOnOrBeforeExpiration, evaluateEarningsPrecheck } from '../earningsPrecheck';
import { newYorkDateFromAsOf } from '../pmccEarningsDates';

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
});
