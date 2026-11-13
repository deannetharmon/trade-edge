import { describe, expect, it } from 'vitest';
import { monthBaseline, resolveMonthBaseline } from '../buildPnlCalendar';
import { buildGoalMonths } from '../goalMonths';
import { DEFAULT_GOAL_TARGET_PCT, GOAL_TARGET_KEY, parseGoalTargetPct, readGoalTargetPct, writeGoalTargetPct } from '../goalSetting';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('GOAL-0001 goal setting', () => {
  it('defaults to 5, accepts 0.5 to 50, rejects the rest', () => {
    expect(readGoalTargetPct(mem())).toBe(DEFAULT_GOAL_TARGET_PCT);
    expect(parseGoalTargetPct('7.5')).toBe(7.5);
    for (const bad of ['0', '0.4', '51', 'abc', '', null, undefined]) expect(parseGoalTargetPct(bad)).toBeNull();
  });
  it('writes a valid value, keeps the old on invalid, and shares the calendar key', () => {
    const s = mem();
    expect(writeGoalTargetPct(8, s)).toBe(8);
    expect(s.getItem(GOAL_TARGET_KEY)).toBe('8');
    expect(writeGoalTargetPct('nope', s)).toBe(8);
    expect(readGoalTargetPct(s)).toBe(8);
  });
});

describe('GOAL-0001 month baseline staleness', () => {
  const hist = [{ date: '2026-10-05', netLiquidatingValue: 40000 }, { date: '2026-10-06', netLiquidatingValue: 41000 }];
  it('does not use a 10-06 value for November', () => {
    expect(monthBaseline(hist, '2026-11')).toBeNull();
  });
  it('still uses a day within 4 days of the 1st', () => {
    expect(monthBaseline([{ date: '2026-10-29', netLiquidatingValue: 45000 }], '2026-11')).toBe(45000);
    expect(monthBaseline([{ date: '2026-11-03', netLiquidatingValue: 46000 }], '2026-11')).toBe(46000);
    expect(monthBaseline([{ date: '2026-11-09', netLiquidatingValue: 46000 }], '2026-11')).toBeNull();
  });
  it('falls back to live value for the current month only, labelled', () => {
    expect(resolveMonthBaseline(hist, '2026-11', '2026-11-13', 47600)).toEqual({ value: 47600, source: 'live' });
    expect(resolveMonthBaseline(hist, '2026-09', '2026-11-13', 47600)).toEqual({ value: null, source: null });
    expect(resolveMonthBaseline(hist, '2026-11', '2026-11-13', null)).toEqual({ value: null, source: null });
  });
});

describe('GOAL-0001 goal months', () => {
  const hist = [{ date: '2026-09-30', netLiquidatingValue: 40000 }, { date: '2026-10-31', netLiquidatingValue: 42000 }];
  const byMonth = [{ month: '2026-10', stats: { pnl: 2500 } }, { month: '2026-11', stats: { pnl: 1000 } }, { month: '2026-08', stats: { pnl: 300 } }];
  it('judges against the target and counts hits', () => {
    const s = buildGoalMonths(byMonth, hist, 5, { today: '2026-11-13', liveNetLiq: 47600 });
    const oct = s.rows[0]; const nov = s.rows[1]; const aug = s.rows[2];
    expect(oct).toMatchObject({ baseline: 40000, targetAmount: 2000, returnPct: 6.25, hit: true });
    expect(nov).toMatchObject({ baseline: 42000, baselineSource: 'stored', targetAmount: 2100, hit: false });
    expect(aug).toMatchObject({ baseline: null, hit: null, returnPct: null });
    expect(s).toMatchObject({ judged: 2, hit: 1, unjudged: 1 });
  });
  it('a higher target flips a hit to a miss', () => {
    expect(buildGoalMonths(byMonth, hist, 10, { today: '2026-11-13' }).rows[0].hit).toBe(false);
  });
});
