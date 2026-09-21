// lib/leaps-position-intelligence/sparklines.ts
//
// LEAPS-SPARK-0001 -- the History strip on a held LEAPS: value, delta and stock price over the days the app has recorded the position
// (the daily position-snapshot store). Pure: the series, the change, the colour, and the SVG geometry are all computed here.
// Whatever cannot be computed (fewer than two recorded days, missing numbers) is left out, never filled in.
//
// Units: the store keeps the position's net delta (per-share delta x contracts), so delta is divided by the contract count; the value of
// a held long is taken as an absolute amount so a sign convention in the store cannot flip the chart.

import type { DashboardTone } from '@/lib/leaps-analysis/dashboard';
import { money, pct } from '@/lib/leaps-analysis/dashboard';
import { SINCE_OPEN_POLICY } from './sinceOpen';

export const SPARK_MAX_POINTS = 90;

export interface HistoryRow { date: string; currentValue: number | null; netDelta: number | null; stockPrice: number | null }
export interface SparkPoint { date: string; v: number }

export interface SparkSeries {
  id: 'value' | 'delta' | 'stock';
  label: string;
  points: SparkPoint[];
  first: number;
  last: number;
  tone: DashboardTone;
  lastText: string;
  changeText: string;
  /** Screen-reader description of the whole line. */
  description: string;
}

export interface Sparklines { series: SparkSeries[]; days: number; firstDate: string; lastDate: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const arrow = (change: number) => (change > 0 ? '▲' : '▼');
const dollars = (v: number) => money(Math.round(v * 100) / 100);

/** One row per date (the last one recorded wins), oldest first, only the newest `max` days. */
export function cleanHistory(rows: HistoryRow[], max = SPARK_MAX_POINTS): HistoryRow[] {
  const byDate = new Map<string, HistoryRow>();
  for (const row of rows) if (row && typeof row.date === 'string' && ISO_DATE.test(row.date)) byDate.set(row.date, row);
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-max);
}

function series(id: SparkSeries['id'], label: string, points: SparkPoint[], kind: 'money' | 'delta'): SparkSeries | null {
  if (points.length < 2) return null;
  const first = points[0].v; const last = points[points.length - 1].v;
  const change = last - first;
  const isFlat = kind === 'delta'
    ? Math.abs(change) < SINCE_OPEN_POLICY.flatDelta
    : first !== 0 ? Math.abs((change / Math.abs(first)) * 100) < SINCE_OPEN_POLICY.flatStockPct : change === 0;
  const tone: DashboardTone = isFlat ? 'neutral' : change > 0 ? 'good' : 'watch';
  const fmt = (v: number) => (kind === 'delta' ? v.toFixed(2) : dollars(v));
  const changeText = isFlat ? 'unchanged'
    : kind === 'delta' ? `${arrow(change)} ${Math.abs(change).toFixed(2)}`
    : `${arrow(change)} ${change > 0 ? '+' : '-'}${dollars(Math.abs(change))}${first !== 0 ? ` (${change > 0 ? '+' : '-'}${pct(Math.abs((change / Math.abs(first)) * 100))})` : ''}`;
  const days = points.length;
  return {
    id, label, points, first, last, tone, lastText: fmt(last), changeText,
    description: `${label} went from ${fmt(first)} to ${fmt(last)} over ${days} recorded days${isFlat ? '' : `, ${change > 0 ? 'up' : 'down'}`}.`,
  };
}

/** The three series for a held long, or null when no series has at least two recorded days. */
export function buildSparklines(input: { history: HistoryRow[]; quantity: number; max?: number }): Sparklines | null {
  const rows = cleanHistory(input.history ?? [], input.max ?? SPARK_MAX_POINTS);
  if (rows.length < 2) return null;
  const contracts = Math.abs(input.quantity);
  const value = rows.filter(r => finite(r.currentValue)).map(r => ({ date: r.date, v: Math.abs(r.currentValue as number) }));
  const delta = contracts > 0 ? rows.filter(r => finite(r.netDelta)).map(r => ({ date: r.date, v: Math.abs(r.netDelta as number) / contracts })) : [];
  const stock = rows.filter(r => finite(r.stockPrice) && (r.stockPrice as number) > 0).map(r => ({ date: r.date, v: r.stockPrice as number }));
  const built = [series('value', 'Value', value, 'money'), series('delta', 'Delta', delta, 'delta'), series('stock', 'Stock', stock, 'money')].filter((s): s is SparkSeries => s != null);
  if (built.length === 0) return null;
  return { series: built, days: rows.length, firstDate: rows[0].date, lastDate: rows[rows.length - 1].date };
}

/**
 * SVG polyline points for a series in a width x height box with `pad` on every side. x is proportional to the calendar date (so a gap in
 * the record looks like a gap); y runs from the lowest value at the bottom to the highest at the top; a flat series is drawn mid-height.
 */
export function sparkPath(points: SparkPoint[], width: number, height: number, pad = 2): string {
  if (points.length < 2) return '';
  const t0 = Date.parse(points[0].date); const t1 = Date.parse(points[points.length - 1].date);
  const min = Math.min(...points.map(p => p.v)); const max = Math.max(...points.map(p => p.v));
  const innerW = width - 2 * pad; const innerH = height - 2 * pad;
  const x = (date: string) => pad + (t1 === t0 ? 0 : ((Date.parse(date) - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * innerH);
  const r = (n: number) => Math.round(n * 100) / 100;
  return points.map(p => `${r(x(p.date))},${r(y(p.v))}`).join(' ');
}
