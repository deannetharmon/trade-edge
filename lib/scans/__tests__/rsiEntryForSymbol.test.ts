// lib/scans/__tests__/rsiEntryForSymbol.test.ts

// RSI-ENTRY-0001 slice A1b: the per-symbol gate reads the shared memo, drops the forming bar, never throws.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDailyBarsMemo } from '../dailyBarsMemo';
import { attachRsiEntry, getRsiEntryGate } from '../rsiEntryForSymbol';
import { getTrend } from '../trend';

// Same closes as the indicator golden "CSP pass" (31 closes, RSI tail ends 48.8, a turn up from 29.37).
const CLOSES = [
  ...Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101)),
  99, 98, 97, 96, 95, 94, 93, 94, 95.5, 97.5,
];
// 31 consecutive weekdays ending Wed 2026-09-30 (UTC session-open stamps, 13:30Z).
function makeBars(closes: number[], lastDate = '2026-09-30') {
  const out: { t: number; c: number }[] = [];
  let d = new Date(`${lastDate}T13:30:00Z`);
  for (let i = closes.length - 1; i >= 0; i--) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86_400_000);
    out[i] = { t: d.getTime() / 1000, c: closes[i] };
    d = new Date(d.getTime() - 86_400_000);
  }
  return out;
}
const respond = (bars: unknown) => ({ ok: true, status: 200, json: async () => ({ bars }) });

beforeEach(() => { clearDailyBarsMemo(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('getRsiEntryGate', () => {
  const afterClose = new Date('2026-10-01T21:00:00Z'); // Thu 17:00 ET: last bar (09-30) is complete

  it('passes the CSP turn-up fixture and fails the CC side of it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(makeBars(CLOSES))));
    expect((await getRsiEntryGate('AAPL', 'CSP', afterClose)).verdict).toBe('PASS');
    expect((await getRsiEntryGate('AAPL', 'CC', afterClose)).verdict).toBe('WAIT');
  });
  it('one request serves both strategies and getTrend (zero extra requests)', async () => {
    const bars = makeBars(Array.from({ length: 130 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 3) * 2));
    const fn = vi.fn(async () => respond(bars));
    vi.stubGlobal('fetch', fn);
    await getTrend('AAPL', false);
    await getRsiEntryGate('AAPL', 'CSP', afterClose);
    await getRsiEntryGate('AAPL', 'CC', afterClose);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('drops the still-forming bar: the same data at 11:00 ET uses one fewer close', async () => {
    const bars = makeBars(CLOSES, '2026-10-01'); // last bar is today's
    vi.stubGlobal('fetch', vi.fn(async () => respond(bars)));
    const open = await getRsiEntryGate('AAPL', 'CSP', new Date('2026-10-01T15:00:00Z')); // 11:00 ET, bar dropped
    clearDailyBarsMemo();
    const closed = await getRsiEntryGate('AAPL', 'CSP', new Date('2026-10-01T21:00:00Z')); // 17:00 ET, bar kept
    expect(closed.verdict).toBe('PASS');
    expect(open.latest).not.toBe(closed.latest);
  });
  it('maps index symbols to the chart symbol', async () => {
    const fn = vi.fn(async () => respond(makeBars(CLOSES)));
    vi.stubGlobal('fetch', fn);
    await getRsiEntryGate('SPX', 'CSP', afterClose);
    expect(fn).toHaveBeenCalledWith('/api/chart?symbol=%5EGSPC', { cache: 'no-store' });
  });
  it('never throws: fetch failure, non-OK, bad bars, too few closes are all "RSI n/a"', async () => {
    const cases: Array<() => unknown> = [
      () => { throw new Error('offline'); },
      () => ({ ok: false, status: 502, json: async () => ({}) }),
      () => respond('nope'),
      () => respond([{ t: 1, c: null }]),
      () => respond(makeBars(CLOSES.slice(0, 10))),
      () => respond([]),
    ];
    for (const c of cases) {
      clearDailyBarsMemo();
      vi.stubGlobal('fetch', vi.fn(async () => c()));
      const r = await getRsiEntryGate('AAPL', 'CSP', afterClose);
      expect(r).toMatchObject({ verdict: 'UNAVAILABLE', label: 'RSI n/a' });
    }
  });
  it('an invalid symbol or clock still returns n/a rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(makeBars(CLOSES))));
    expect((await getRsiEntryGate('', 'CSP', afterClose)).verdict).toBe('UNAVAILABLE');
    expect((await getRsiEntryGate('AAPL', 'CSP', new Date('x'))).verdict).toBe('UNAVAILABLE');
  });
  it('a getTrend failure does not stop the gate from making its own single retry', async () => {
    const fn = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce(respond(makeBars(CLOSES)));
    vi.stubGlobal('fetch', fn);
    await expect(getTrend('AAPL')).rejects.toThrow('Yahoo chart fetch failed for AAPL (500)');
    expect((await getRsiEntryGate('AAPL', 'CSP', afterClose)).verdict).toBe('PASS');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('attachRsiEntry', () => {
  const entry = { verdict: 'WAIT', reason: 'NO_DIP', label: 'Wait · no dip (RSI 58)', latest: 58, extreme: 55, extremeBarsAgo: 2 } as const;
  it('with no verdict (gate Off) returns the very same array, untouched', () => {
    const rows = [{ symbol: 'AAPL' }, { symbol: 'AAPL' }];
    expect(attachRsiEntry(rows, undefined)).toBe(rows);
    expect(rows[0]).toEqual({ symbol: 'AAPL' });
  });
  it('with a verdict adds it to every row of the symbol without mutating the originals', () => {
    const rows = [{ symbol: 'AAPL', a: 1 }, { symbol: 'AAPL', a: 2 }];
    const out = attachRsiEntry(rows, entry);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.rsiEntry === entry)).toBe(true);
    expect(out[1]).toMatchObject({ symbol: 'AAPL', a: 2 });
    expect('rsiEntry' in rows[0]).toBe(false);
  });
  it('an empty list stays empty', () => {
    expect(attachRsiEntry([], entry)).toEqual([]);
  });
});
