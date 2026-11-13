// lib/pnlCalendar/goalMonths.ts
//
// GOAL-0001: each month's locked-in profit against the monthly return goal, for the Performance report. Pure. A month's baseline is
// the stored account value at its start; when none is stored near the 1st the month shows no percent rather than a guessed one.

import { resolveMonthBaseline } from './buildPnlCalendar';

export interface GoalMonthRow {
  month: string;
  realized: number;
  baseline: number | null;
  /** 'live' = sized on today's account value because no month-start balance is stored (current month only). */
  baselineSource: 'stored' | 'live' | null;
  returnPct: number | null;
  targetAmount: number | null;
  /** True when the month's realized profit reached the target; null when there is no baseline to judge against. */
  hit: boolean | null;
}

export interface GoalMonthsSummary {
  rows: GoalMonthRow[];
  judged: number;
  hit: number;
  /** Months with no stored start-of-month balance, left unjudged. */
  unjudged: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildGoalMonths(
  byMonth: ReadonlyArray<{ month: string; stats: { pnl: number } }>,
  history: ReadonlyArray<{ date: string; netLiquidatingValue: number }>,
  targetPct: number,
  ctx: { today: string; liveNetLiq?: number | null } = { today: '' },
): GoalMonthsSummary {
  const rows: GoalMonthRow[] = byMonth.map(({ month, stats }) => {
    const { value: baseline, source: baselineSource } = resolveMonthBaseline(history, month, ctx.today, ctx.liveNetLiq);
    const targetAmount = baseline != null && targetPct > 0 ? round2((baseline * targetPct) / 100) : null;
    return {
      month,
      realized: round2(stats.pnl),
      baseline,
      baselineSource,
      returnPct: baseline != null ? round2((stats.pnl / baseline) * 100) : null,
      targetAmount,
      hit: targetAmount != null ? stats.pnl >= targetAmount : null,
    };
  });
  const judged = rows.filter(r => r.hit != null).length;
  return { rows, judged, hit: rows.filter(r => r.hit === true).length, unjudged: rows.length - judged };
}
