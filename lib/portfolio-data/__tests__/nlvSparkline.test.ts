// lib/portfolio-data/__tests__/nlvSparkline.test.ts

// SPARKLINES-0001A: day-over-day rule and window for the Portfolio Value sparkline. Alan's fixtures: normal weekday, gap day,
// weekend, thin history, bad values, stale rows. 2026-11-24 is a Tuesday; 2026-11-28 is a Saturday.

import { describe, expect, it } from 'vitest';
import { addDays, buildNlvSpark, daysBetween, fmtCompact, fmtShortDate, isWeekend } from '../nlvSparkline';

const d = (date: string, netLiquidatingValue: number) => ({ date, netLiquidatingValue });

describe('buildNlvSpark', () => {
  it('weekday: today is the live value, prior close is the last completed day', () => {
    const s = buildNlvSpark([d('2026-11-20', 26000), d('2026-11-23', 26290)], '2026-11-24', 26452);
    expect(s.latest).toBe(26452);
    expect(s.priorClose).toBe(26290);
    expect(s.change).toBe(162);
    expect(s.changePct).toBeCloseTo(0.616, 2);
    expect(s.points.map(p => p.date)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24']);
  });

  it('gap day: prior close is the last completed day even when days are missing (no invented points)', () => {
    const s = buildNlvSpark([d('2026-11-10', 25000), d('2026-11-23', 26290)], '2026-11-24', 26200);
    expect(s.priorClose).toBe(26290);
    expect(s.change).toBe(-90);
    expect(s.points).toHaveLength(3);
  });

  it('weekend: no live session, so the arrow compares the last two completed days (Friday against Thursday)', () => {
    const s = buildNlvSpark([d('2026-11-26', 26000), d('2026-11-27', 26300)], '2026-11-28', 26310);
    expect(isWeekend('2026-11-28')).toBe(true);
    expect(s.latest).toBe(26300);
    expect(s.priorClose).toBe(26000);
    expect(s.change).toBe(300);
    expect(s.points.map(p => p.date)).toEqual(['2026-11-26', '2026-11-27']);
  });

  it('a stored row for today is replaced by the live value, never used as the prior close', () => {
    const s = buildNlvSpark([d('2026-11-23', 26290), d('2026-11-24', 11111)], '2026-11-24', 26452);
    expect(s.priorClose).toBe(26290);
    expect(s.latest).toBe(26452);
  });

  it('no live value (unavailable): falls back to completed days only', () => {
    const s = buildNlvSpark([d('2026-11-20', 26000), d('2026-11-23', 26290)], '2026-11-24', null);
    expect(s.latest).toBe(26290);
    expect(s.priorClose).toBe(26000);
  });

  it('thin history: one completed day plus live gives one change; nothing at all gives none', () => {
    expect(buildNlvSpark([d('2026-11-23', 26290)], '2026-11-24', 26452).change).toBe(162);
    const none = buildNlvSpark([], '2026-11-24', 26452);
    expect(none.change).toBeNull();
    expect(none.points).toHaveLength(1);
    expect(buildNlvSpark([], '2026-11-24', null).latest).toBeNull();
  });

  it('stale history: a prior close weeks old is never used (no fake day change, no baseline)', () => {
    const s = buildNlvSpark([d('2026-10-06', 44713)], '2026-11-24', 26387);
    expect(s.change).toBeNull();
    expect(s.priorClose).toBeNull();
    expect(s.points.map(p => p.date)).toEqual(['2026-11-24']);
  });

  it('a 4-day stretch (weekend plus a Monday holiday) is still a valid prior close; 6 days is not', () => {
    expect(buildNlvSpark([d('2026-11-20', 26000)], '2026-11-24', 26100).change).toBe(100);
    expect(buildNlvSpark([d('2026-11-18', 26000)], '2026-11-24', 26100).change).toBeNull();
  });

  it('ignores zero, negative, non-finite and malformed rows', () => {
    const s = buildNlvSpark([d('2026-11-20', 0), d('2026-11-21', -5), d('2026-11-22', NaN), d('bad', 100), d('2026-11-23', 26290)], '2026-11-24', 26452);
    expect(s.points.map(p => p.date)).toEqual(['2026-11-23', '2026-11-24']);
  });

  it('keeps only the window and sorts unsorted input', () => {
    const s = buildNlvSpark([d('2026-11-23', 2), d('2026-10-01', 1), d('2026-10-25', 3), d('2026-10-26', 5)], '2026-11-24', 4, 30);
    expect(s.points.map(p => p.date)).toEqual(['2026-10-26', '2026-11-23', '2026-11-24']);
  });
});

describe('formatting and date math', () => {
  it('fmtCompact', () => {
    expect(fmtCompact(28000)).toBe('$28k');
    expect(fmtCompact(25700)).toBe('$25.7k');
    expect(fmtCompact(1_250_000)).toBe('$1.3M');
    expect(fmtCompact(950)).toBe('$950');
  });
  it('fmtShortDate, addDays, daysBetween', () => {
    expect(fmtShortDate('2026-10-26')).toBe('Oct 26');
    expect(addDays('2026-11-24', -29)).toBe('2026-10-26');
    expect(daysBetween('2026-10-26', '2026-11-24')).toBe(29);
  });
});
