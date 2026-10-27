// lib/pnlCalendar/buildPnlCalendar.ts
//
// PNL-CAL-0001: pure math for the Portfolio "P/L Calendar" sub tab. Realized (locked-in) profit per day, week and month, a monthly
// goal against a baseline, and a trailing 30-day pace. Option trades come from buildPerformanceReport(...).included, the same complete,
// not-excluded trades every Performance panel uses, bucketed by close date. PNL-CAL-0002 adds realized P/L on shares (stocks and ETFs,
// from reconstructEquityRealized), also by close date, so the calendar holds all locked-in profit and loss whatever the instrument.
// Without share lots the month total still equals Performance for the same month. Open (unrealized) P/L is not in any figure here.

import { buildPerformanceReport } from '../tradeLog/performanceMetrics';
import type { EquityRealizedLot } from '../tradeLog/equityRealized';
import type { ClosedTrade } from '../tradeLog/types';

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  /** Locked-in P/L for everything closed that day (options and shares); null when nothing closed. */
  pnl: number | null;
  /** Closed option trades plus share sales (one per symbol per day). */
  trades: number;
  /** The share-sale part of pnl; null when no shares were sold that day. */
  stockPnl: number | null;
}

export interface CalendarWeek {
  days: CalendarDay[]; // Sunday..Saturday
  /** Sum of this week's days inside the month; null when nothing closed in them. */
  total: number | null;
}

export interface MonthCalendar {
  month: string; // YYYY-MM
  label: string; // e.g. "Oct 2026"
  weeks: CalendarWeek[];
  total: number;
  trades: number;
  /** The share-sale part of the month total, and how many symbol-days of share sales it covers. */
  stockPnl: number;
  stockSales: number;
  daysInMonth: number;
  /** Option trades closed in this month that the user excluded from reporting, and ones too incomplete to total (same rules as Performance). */
  excludedByUser: number;
  incomplete: number;
}

export interface MonthlyGoal {
  baseline: number | null;
  targetPct: number;
  targetAmount: number | null;
  realized: number;
  /** Realized as a percent of the baseline; null without a baseline. */
  returnPct: number | null;
  /** Share of the target reached (can exceed 100); null without a target. */
  progressPct: number | null;
  achieved: boolean;
  /** Day of the month today is (past months: the last day; future months: null). */
  dayOfMonth: number | null;
  daysInMonth: number;
}

export interface Pace {
  pnl: number;
  returnPct: number | null;
  from: string;
  to: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = (n: number) => Math.round(n * 100) / 100;

function utcNoon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = utcNoon(date);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The records every figure is built from: complete and not user-excluded, exactly Performance's rule. */
export function pnlCalendarRecords(trades: readonly ClosedTrade[]) {
  const report = buildPerformanceReport(trades);
  return { included: report.included, excludedByUser: report.excludedByUser, incomplete: report.incomplete.length, incompleteTrades: report.incomplete };
}

/** Share lots closed in the month, one entry per symbol per day, so a sale split across several lots counts once. */
function stockByDay(equity: readonly EquityRealizedLot[], inRange: (date: string) => boolean) {
  const byDay = new Map<string, { pnl: number; symbols: Set<string> }>();
  for (const lot of equity) {
    if (!inRange(lot.closeDate)) continue;
    const entry = byDay.get(lot.closeDate) ?? { pnl: 0, symbols: new Set<string>() };
    entry.pnl += lot.pnl;
    entry.symbols.add(lot.symbol);
    byDay.set(lot.closeDate, entry);
  }
  return byDay;
}

export function buildMonthCalendar(trades: readonly ClosedTrade[], month: string, equity: readonly EquityRealizedLot[] = []): MonthCalendar {
  const { included, incompleteTrades } = pnlCalendarRecords(trades);
  // Counts are for the viewed month only, so the footer agrees with the days shown (and with Performance for that period).
  const excludedByUser = trades.filter(t => t.excluded && monthOf(t.closeDate) === month).length;
  const incomplete = incompleteTrades.filter(t => monthOf(t.closeDate) === month).length;

  const byDay = new Map<string, { pnl: number; trades: number; stockPnl: number | null }>();
  for (const t of included) {
    if (monthOf(t.closeDate) !== month) continue;
    const entry = byDay.get(t.closeDate) ?? { pnl: 0, trades: 0, stockPnl: null };
    entry.pnl += t.pnl;
    entry.trades += 1;
    byDay.set(t.closeDate, entry);
  }
  let stockPnl = 0;
  let stockSales = 0;
  stockByDay(equity, d => monthOf(d) === month).forEach((s, date) => {
    const entry = byDay.get(date) ?? { pnl: 0, trades: 0, stockPnl: null };
    entry.pnl += s.pnl;
    entry.trades += s.symbols.size;
    entry.stockPnl = (entry.stockPnl ?? 0) + s.pnl;
    byDay.set(date, entry);
    stockPnl += s.pnl;
    stockSales += s.symbols.size;
  });

  const first = `${month}-01`;
  const total = daysInMonth(month);
  const lead = utcNoon(first).getUTCDay(); // Sunday = 0
  const rows = Math.ceil((lead + total) / 7);
  const gridStart = addDays(first, -lead);

  const weeks: CalendarWeek[] = [];
  for (let w = 0; w < rows; w += 1) {
    const days: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(gridStart, w * 7 + d);
      const inMonth = monthOf(date) === month;
      const hit = inMonth ? byDay.get(date) : undefined;
      days.push({ date, day: Number(date.slice(8, 10)), inMonth, pnl: hit ? round2(hit.pnl) : null, trades: hit?.trades ?? 0, stockPnl: hit?.stockPnl != null ? round2(hit.stockPnl) : null });
    }
    const closed = days.filter(x => x.inMonth && x.pnl != null);
    weeks.push({ days, total: closed.length ? round2(closed.reduce((n, x) => n + (x.pnl as number), 0)) : null });
  }

  let monthTotal = 0;
  let monthTrades = 0;
  byDay.forEach(v => { monthTotal += v.pnl; monthTrades += v.trades; });

  return { month, label: monthLabel(month), weeks, total: round2(monthTotal), trades: monthTrades, stockPnl: round2(stockPnl), stockSales, daysInMonth: total, excludedByUser, incomplete };
}

export function buildMonthlyGoal(input: { realized: number; baseline: number | null; targetPct: number; month: string; today: string }): MonthlyGoal {
  const { realized, baseline, targetPct, month, today } = input;
  const total = daysInMonth(month);
  const hasBaseline = baseline != null && Number.isFinite(baseline) && baseline > 0;
  const targetAmount = hasBaseline && targetPct > 0 ? round2((baseline as number) * targetPct / 100) : null;
  const todayMonth = monthOf(today);
  const dayOfMonth = month < todayMonth ? total : month === todayMonth ? Number(today.slice(8, 10)) : null;
  return {
    baseline: hasBaseline ? (baseline as number) : null,
    targetPct,
    targetAmount,
    realized: round2(realized),
    returnPct: hasBaseline ? round2((realized / (baseline as number)) * 100) : null,
    progressPct: targetAmount ? (realized / targetAmount) * 100 : null,
    achieved: targetAmount != null && realized >= targetAmount,
    dayOfMonth,
    daysInMonth: total,
  };
}

/** Locked-in P/L over the trailing 30 days ending today (inclusive), as a percent of the same baseline. */
export function buildPace(trades: readonly ClosedTrade[], today: string, baseline: number | null, equity: readonly EquityRealizedLot[] = []): Pace {
  const { included } = pnlCalendarRecords(trades);
  const from = addDays(today, -29);
  const optionsPnl = included.filter(t => t.closeDate >= from && t.closeDate <= today).reduce((n, t) => n + t.pnl, 0);
  const sharesPnl = equity.filter(l => l.closeDate >= from && l.closeDate <= today).reduce((n, l) => n + l.pnl, 0);
  const pnl = round2(optionsPnl + sharesPnl);
  const hasBaseline = baseline != null && Number.isFinite(baseline) && baseline > 0;
  return { pnl, returnPct: hasBaseline ? round2((pnl / (baseline as number)) * 100) : null, from, to: today };
}

/**
 * The month's starting net liquidating value from the stored daily history: the last stored day before the 1st; failing that,
 * the first stored day inside the month; failing that, null (no goal amount is shown rather than a guessed one).
 */
export function monthBaseline(history: readonly { date: string; netLiquidatingValue: number }[], month: string): number | null {
  const first = `${month}-01`;
  const usable = history.filter(d => d.date && Number.isFinite(d.netLiquidatingValue) && d.netLiquidatingValue > 0).sort((a, b) => a.date.localeCompare(b.date));
  const before = usable.filter(d => d.date < first);
  if (before.length) return before[before.length - 1].netLiquidatingValue;
  const inside = usable.find(d => monthOf(d.date) === month);
  return inside ? inside.netLiquidatingValue : null;
}

const money0 = (n: number) => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Short signed label for a calendar cell: +$50, -$155, +$1.8k. */
export function formatCellMoney(n: number): string {
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(1)}k` : `${sign}$${money0(abs)}`;
}

export function formatSignedMoney(n: number): string {
  return `${n < 0 ? '-' : '+'}$${money0(n)}`;
}

export function formatSignedPct(n: number, digits = 1): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(digits)}%`;
}
