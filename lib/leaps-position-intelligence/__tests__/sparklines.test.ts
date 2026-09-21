// lib/leaps-position-intelligence/__tests__/sparklines.test.ts
//
// LEAPS-SPARK-0001. Worked example: a 2-contract GOOGL LEAPS recorded over 4 days.

import { describe, expect, it } from 'vitest';
import { buildSparklines, cleanHistory, SPARK_MAX_POINTS, sparkPath, type HistoryRow } from '../sparklines';

const row = (date: string, currentValue: number | null, netDelta: number | null, stockPrice: number | null): HistoryRow => ({ date, currentValue, netDelta, stockPrice });
const HISTORY: HistoryRow[] = [
  row('2026-09-15', 22_500, 1.76, 336.66), row('2026-09-16', 23_100, 1.74, 340.1), row('2026-09-17', 23_800, 1.72, 344.9), row('2026-09-18', 24_090, 1.7, 350.86),
];
const s = (id: string, sp = buildSparklines({ history: HISTORY, quantity: 2 })) => sp!.series.find(x => x.id === id)!;

describe('the worked example', () => {
  const sp = buildSparklines({ history: HISTORY, quantity: 2 })!;

  it('has the days recorded and three series', () => {
    expect(sp).toMatchObject({ days: 4, firstDate: '2026-09-15', lastDate: '2026-09-18' });
    expect(sp.series.map(x => x.id)).toEqual(['value', 'delta', 'stock']);
  });

  it('value and stock rose (green); delta per share fell (amber): 1.76 / 2 = 0.88 -> 1.70 / 2 = 0.85', () => {
    expect(s('value')).toMatchObject({ first: 22_500, last: 24_090, tone: 'good', lastText: '$24,090' });
    expect(s('value').changeText).toBe('▲ +$1,590 (+7.1%)');
    expect(s('delta')).toMatchObject({ first: 0.88, last: 0.85, tone: 'watch', lastText: '0.85' });
    expect(s('delta').changeText).toBe('▼ 0.03');
    expect(s('stock')).toMatchObject({ tone: 'good', lastText: '$350.86' });
    expect(s('stock').changeText).toBe('▲ +$14.20 (+4.2%)');
  });

  it('describes each line for screen readers', () => {
    expect(s('delta').description).toBe('Delta went from 0.88 to 0.85 over 4 recorded days, down.');
  });
});

describe('needs at least two recorded days', () => {
  it('returns null for no history, one day, or malformed rows only', () => {
    expect(buildSparklines({ history: [], quantity: 1 })).toBeNull();
    expect(buildSparklines({ history: [HISTORY[0]], quantity: 1 })).toBeNull();
    expect(buildSparklines({ history: [row('bad', 1, 1, 1), row('2026/09/15', 1, 1, 1)], quantity: 1 })).toBeNull();
  });
  it('a series with fewer than two usable points is left out while the others stay', () => {
    const sp = buildSparklines({ history: [row('2026-09-15', 100, null, 10), row('2026-09-16', 110, null, 11), row('2026-09-17', 120, 0.85, 12)], quantity: 1 })!;
    expect(sp.series.map(x => x.id)).toEqual(['value', 'stock']);
  });
  it('returns null when no series has two usable points', () => {
    expect(buildSparklines({ history: [row('2026-09-15', null, null, null), row('2026-09-16', 5, null, null)], quantity: 1 })).toBeNull();
  });
});

describe('cleaning the history', () => {
  it('keeps one row per date (the last recorded wins) and sorts oldest first', () => {
    const rows = cleanHistory([row('2026-09-17', 3, 1, 1), row('2026-09-15', 1, 1, 1), row('2026-09-17', 4, 1, 1), row('2026-09-16', 2, 1, 1)]);
    expect(rows.map(r => [r.date, r.currentValue])).toEqual([['2026-09-15', 1], ['2026-09-16', 2], ['2026-09-17', 4]]);
  });
  it('keeps only the newest days beyond the cap', () => {
    const many = Array.from({ length: SPARK_MAX_POINTS + 10 }, (_, i) => row(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), i, 1, 1));
    const rows = cleanHistory(many);
    expect(rows).toHaveLength(SPARK_MAX_POINTS);
    expect(rows[rows.length - 1].currentValue).toBe(SPARK_MAX_POINTS + 9);
  });
  it('does not mutate its input', () => {
    const rows = [row('2026-09-17', 3, 1, 1), row('2026-09-15', 1, 1, 1)];
    const before = JSON.stringify(rows);
    cleanHistory(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('flat, falling, and unit handling', () => {
  it('a move under the flat thresholds is neutral and says unchanged (stock 0.05%, delta 0.005)', () => {
    const flatStock = buildSparklines({ history: [row('2026-09-15', 100, 1, 300), row('2026-09-16', 100, 1, 300.1)], quantity: 1 })!;
    expect(flatStock.series.find(x => x.id === 'stock')).toMatchObject({ tone: 'neutral', changeText: 'unchanged' });
    const moving = buildSparklines({ history: [row('2026-09-15', 100, 1, 300), row('2026-09-16', 100, 1, 300.2)], quantity: 1 })!;
    expect(moving.series.find(x => x.id === 'stock')!.tone).toBe('good');
    const flatDelta = buildSparklines({ history: [row('2026-09-15', 1, 0.85, 1), row('2026-09-16', 2, 0.8504, 1)], quantity: 1 })!;
    expect(flatDelta.series.find(x => x.id === 'delta')!.changeText).toBe('unchanged');
  });

  it('a falling value is amber with a down arrow and a negative percent', () => {
    const sp = buildSparklines({ history: [row('2026-09-15', 12_000, 1, 350), row('2026-09-16', 11_400, 1, 340)], quantity: 1 })!;
    expect(sp.series[0]).toMatchObject({ tone: 'watch', changeText: '▼ -$600 (-5.0%)' });
  });

  it('value is taken as an absolute amount so a sign convention cannot flip the chart', () => {
    const sp = buildSparklines({ history: [row('2026-09-15', -12_000, 1, 350), row('2026-09-16', -13_000, 1, 351)], quantity: 1 })!;
    expect(sp.series[0]).toMatchObject({ first: 12_000, last: 13_000, tone: 'good' });
  });

  it('with no contract count the delta series is left out instead of dividing by zero', () => {
    const sp = buildSparklines({ history: HISTORY, quantity: 0 })!;
    expect(sp.series.map(x => x.id)).toEqual(['value', 'stock']);
  });

  it('a zero or negative stock price is not charted', () => {
    const sp = buildSparklines({ history: [row('2026-09-15', 1, 1, 0), row('2026-09-16', 2, 1, -5), row('2026-09-17', 3, 1, 10)], quantity: 1 })!;
    expect(sp.series.some(x => x.id === 'stock')).toBe(false);
  });
});

describe('sparkPath geometry', () => {
  const pts = [{ date: '2026-09-15', v: 10 }, { date: '2026-09-16', v: 20 }, { date: '2026-09-17', v: 15 }];

  it('puts the lowest value at the bottom and the highest at the top, inside the padding', () => {
    // 100 x 30 box, pad 2: x from 2 to 98, y from 28 (min) to 2 (max)
    expect(sparkPath(pts, 100, 30)).toBe('2,28 50,2 98,15');
  });

  it('x follows the calendar, so a gap in the record shows as a gap', () => {
    const gappy = [{ date: '2026-09-01', v: 1 }, { date: '2026-09-02', v: 2 }, { date: '2026-09-11', v: 3 }];
    expect(sparkPath(gappy, 100, 30)).toBe('2,28 11.6,15 98,2');
  });

  it('draws a flat series mid-height, and returns nothing for fewer than two points', () => {
    expect(sparkPath([{ date: '2026-09-15', v: 5 }, { date: '2026-09-16', v: 5 }], 100, 30)).toBe('2,15 98,15');
    expect(sparkPath([{ date: '2026-09-15', v: 5 }], 100, 30)).toBe('');
    expect(sparkPath([], 100, 30)).toBe('');
  });
});
