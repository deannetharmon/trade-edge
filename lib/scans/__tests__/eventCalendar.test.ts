import { describe, expect, it } from 'vitest';
import { normalizeFmpEventCalendar } from '../eventCalendar';

describe('normalizeFmpEventCalendar', () => {
  it('uses the earliest valid event for the requested symbol', () => {
    expect(normalizeFmpEventCalendar({
      symbol: 'MSFT', fetchedAt: '2026-09-05T12:00:00.000Z',
      earnings: [{ symbol: 'MSFT', date: '2026-10-30' }, { symbol: 'MSFT', date: '2026-10-20' }],
      dividends: [{ symbol: 'MSFT', date: '2026-09-15' }],
      splits: [],
    })).toEqual({ checkedAt: '2026-09-05T12:00:00.000Z', earningsDate: '2026-10-20', exDividendDate: '2026-09-15', splitOrSymbolChangeDate: null, complete: true });
  });

  it('fails closed for a non-array provider response', () => {
    expect(normalizeFmpEventCalendar({ symbol: 'MSFT', fetchedAt: '2026-09-05T12:00:00.000Z', earnings: { error: 'plan' }, dividends: [], splits: [] }).complete).toBe(false);
  });
});
