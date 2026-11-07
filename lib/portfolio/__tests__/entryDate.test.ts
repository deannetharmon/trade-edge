// lib/portfolio/__tests__/entryDate.test.ts

import { describe, expect, it } from 'vitest';
import { validateEntryDate } from '../entryDate';
import { rsiAtEntry, stockRsiFromBars } from '../stockRsi';

const NOW = new Date('2026-11-07T18:00:00Z');

describe('validateEntryDate', () => {
  it('accepts a past real date and today', () => {
    expect(validateEntryDate('2026-08-03', NOW)).toBeNull();
    expect(validateEntryDate('2026-11-07', NOW)).toBeNull();
  });
  it('rejects bad shapes, impossible dates, the future and ancient dates', () => {
    expect(validateEntryDate('08/03/2026', NOW)).not.toBeNull();
    expect(validateEntryDate(20260803, NOW)).not.toBeNull();
    expect(validateEntryDate('2026-02-30', NOW)).not.toBeNull();
    expect(validateEntryDate('2027-01-01', NOW)).not.toBeNull();
    expect(validateEntryDate('1980-01-01', NOW)).not.toBeNull();
  });
});

function bars(n: number) {
  // n weekday-ish daily bars ending 2026-11-05 (UTC noon so the New York date is stable), rising then falling.
  const out: Array<{ t: number; c: number }> = [];
  const end = Date.UTC(2026, 10, 5, 14, 30) / 1000;
  for (let i = 0; i < n; i += 1) out.push({ t: end - (n - 1 - i) * 86400, c: 100 + Math.sin(i / 3) * 5 + i * 0.2 });
  return out;
}

describe('stockRsiFromBars points and rsiAtEntry', () => {
  const rsi = stockRsiFromBars(bars(60), NOW)!;
  it('returns one dated point per RSI value, last point equals the headline RSI', () => {
    expect(rsi.points).toBeDefined();
    expect(rsi.points!.length).toBe(60 - 14);
    expect(rsi.points![rsi.points!.length - 1].rsi).toBe(rsi.rsi);
    expect(rsi.points![rsi.points!.length - 1].date).toBe('2026-11-05');
  });
  it('finds the last bar on or before the entry date', () => {
    const p = rsi.points!;
    const target = p[10];
    expect(rsiAtEntry(p, target.date)).toEqual(target);
    expect(rsiAtEntry(p, '2026-11-05')).toEqual(p[p.length - 1]);
  });
  it('is null before the window, after the last bar, with no date, or with no points', () => {
    const p = rsi.points!;
    expect(rsiAtEntry(p, '2020-01-01')).toBeNull();
    expect(rsiAtEntry(p, '2026-11-07')).toBeNull();
    expect(rsiAtEntry(p, null)).toBeNull();
    expect(rsiAtEntry(undefined, '2026-10-01')).toBeNull();
    expect(rsiAtEntry(p, 'garbage')).toBeNull();
  });
});
