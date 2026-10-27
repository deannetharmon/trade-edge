// features/portfolio/pnl-calendar/PnlCalendarTab.tsx
//
// PNL-CAL-0001: the Portfolio "P/L Calendar" sub tab. A monthly goal card (locked-in profit against a target percent of the month's
// starting net liquidating value) over a Sunday-first calendar of locked-in profit per day, with week totals and month navigation.
// Locked-in = realized: closed option trades from the Trade Log (same complete, not-excluded records as Performance) plus realized P/L on
// shares (PNL-CAL-0002), by close date, so every instrument is counted. Open (unrealized) P/L is not in any figure here. Reads the stored
// daily balance history for the baseline; nothing is written.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadClosedTrades, type LoadedClosedTrades } from '../positions-workspace/cycleTradesLoader';
import { todayNewYork } from '@/lib/portfolio-data/balancePerformance';
import type { EquityRealizedLot } from '@/lib/tradeLog/equityRealized';
import {
  buildMonthCalendar, buildMonthlyGoal, buildPace, formatCellMoney, formatSignedMoney, formatSignedPct, monthBaseline, monthOf, shiftMonth,
} from '@/lib/pnlCalendar/buildPnlCalendar';

const TARGET_KEY = 'tradeedge-pnl-calendar-target-pct';
const DEFAULT_TARGET_PCT = 5;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const tone = (n: number | null) => (n == null ? 'text-white/40' : n >= 0 ? 'text-emerald-400' : 'text-red-400');
const NO_LOTS: EquityRealizedLot[] = [];

function readTarget(): number {
  try {
    const v = Number(localStorage.getItem(TARGET_KEY));
    return Number.isFinite(v) && v > 0 && v <= 50 ? v : DEFAULT_TARGET_PCT;
  } catch { return DEFAULT_TARGET_PCT; }
}

export default function PnlCalendarTab() {
  const today = todayNewYork(Date.now());
  const [loaded, setLoaded] = useState<LoadedClosedTrades | null>(null);
  const [history, setHistory] = useState<{ date: string; netLiquidatingValue: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(monthOf(today));
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET_PCT);

  useEffect(() => { setTargetPct(readTarget()); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [trades, hist] = await Promise.all([
          loadClosedTrades(),
          fetch('/api/balance-history').then(r => (r.ok ? r.json() : null)).then(d => (Array.isArray(d?.history) ? d.history : [])).catch(() => []),
        ]);
        if (cancelled) return;
        setLoaded(trades);
        setHistory(hist);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load closed trades.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const trades = loaded?.trades ?? [];
  const equityLots = loaded?.equityLots ?? NO_LOTS;
  const calendar = useMemo(() => buildMonthCalendar(trades, month, equityLots), [trades, month, equityLots]);
  const baseline = useMemo(() => monthBaseline(history, month), [history, month]);
  const goal = useMemo(() => buildMonthlyGoal({ realized: calendar.total, baseline, targetPct, month, today }), [calendar.total, baseline, targetPct, month, today]);
  const pace = useMemo(() => buildPace(trades, today, monthBaseline(history, monthOf(today)), equityLots), [trades, history, today, equityLots]);

  const earliest = loaded ? monthOf(loaded.windowFrom) : month;
  const partialStart = loaded != null && month === earliest && loaded.windowFrom.slice(8, 10) !== '01';
  const unmatched = (loaded?.unmatchedClosures ?? []).filter(u => String(u.executedAt).slice(0, 7) === month).length;
  const shareUnmatched = (loaded?.equityUnmatched ?? []).filter(u => String(u.executedAt).slice(0, 7) === month);
  const shareUnmatchedSymbols = Array.from(new Set(shareUnmatched.map(u => u.symbol))).join(', ');
  const barPct = goal.progressPct == null ? 0 : Math.max(0, Math.min(100, goal.progressPct));

  const changeTarget = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0 || v > 50) return;
    setTargetPct(v);
    try { localStorage.setItem(TARGET_KEY, String(v)); } catch { /* per-viewer convenience only */ }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6" data-testid="pnl-calendar-tab">
      {!loaded && !error && <p className="text-sm text-white/40">Loading closed trades…</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {loaded && (
        <>
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5" aria-label="Monthly goal">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-white">Monthly Goal</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/50">
                  <span>Target:</span>
                  <input aria-label="Target percent" type="number" min={0.5} max={50} step={0.5} value={targetPct} onChange={e => changeTarget(e.target.value)}
                    className="w-14 rounded border border-white/15 bg-transparent px-1.5 py-0.5 text-xs text-white" />
                  <span>%{goal.targetAmount != null ? ` · ${formatSignedMoney(goal.targetAmount).slice(1)}` : ''}</span>
                </p>
              </div>
              <div className="text-right">
                <p className={`text-3xl font-bold ${tone(calendar.total)}`} data-testid="month-total">{formatSignedMoney(calendar.total)}</p>
                {goal.returnPct != null
                  ? <p className={`text-sm ${tone(goal.returnPct)}`}>{formatSignedPct(goal.returnPct, 2)} locked in</p>
                  : <p className="text-xs text-white/40">No stored month-start balance, so no goal amount</p>}
                {goal.achieved && <p className="text-xs text-white/50">Goal achieved! 🎉</p>}
                {!goal.achieved && goal.progressPct != null && <p className="text-xs text-white/50">{Math.max(0, Math.round(goal.progressPct))}% of target</p>}
              </div>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(barPct)}>
              <div className="h-full rounded-full bg-teal-400" style={{ width: `${barPct}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-[11px] uppercase tracking-wider text-white/40">
              {goal.dayOfMonth != null && <span>Day <span className="text-white/80">{goal.dayOfMonth}/{goal.daysInMonth}</span></span>}
              <span title={`Locked-in profit ${pace.from} to ${pace.to}`}>
                Pace (30d) <span className={`font-semibold ${tone(pace.pnl)}`}>{formatSignedMoney(pace.pnl)}</span>
                {pace.returnPct != null && <span className={tone(pace.returnPct)}> ({formatSignedPct(pace.returnPct)})</span>}
              </span>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5" aria-label="P/L calendar">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-white">P/L Calendar</p>
                <p className="text-[10px] uppercase tracking-widest text-white/40">Locked-in profit per day</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${tone(calendar.total)}`}>{formatSignedMoney(calendar.total)}</span>
                <button type="button" aria-label="Previous month" disabled={month <= earliest} onClick={() => setMonth(m => shiftMonth(m, -1))}
                  className="min-h-9 rounded-lg border border-white/15 px-3 text-white/70 disabled:opacity-30">‹</button>
                <span className="w-20 text-center text-xs text-white/80">{calendar.label}</span>
                <button type="button" aria-label="Next month" disabled={month >= monthOf(today)} onClick={() => setMonth(m => shiftMonth(m, 1))}
                  className="min-h-9 rounded-lg border border-white/15 px-3 text-white/70 disabled:opacity-30">›</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="grid min-w-[620px] grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-2">
                {[...WEEKDAYS, 'WEEK'].map(d => <div key={d} className="pb-1 text-center text-[10px] tracking-widest text-white/40">{d}</div>)}
                {calendar.weeks.map(week => (
                  <WeekRow key={week.days[0].date} week={week} today={today} />
                ))}
              </div>
            </div>

            <div className="mt-3 space-y-1 text-[11px] text-white/40">
              {partialStart && <p>History starts {loaded.windowFrom}; earlier days of this month are not included.</p>}
              {unmatched > 0 && <p className="text-amber-300/80">{unmatched} closing {unmatched === 1 ? 'transaction' : 'transactions'} this month could not be matched to an opening trade, so this month may be understated.</p>}
              {shareUnmatched.length > 0 && (
                <p className="text-amber-300/80" data-testid="share-unmatched">
                  {shareUnmatched.length} share {shareUnmatched.length === 1 ? 'transaction' : 'transactions'} this month ({shareUnmatchedSymbols}) could not be matched to a purchase in the last 12 months, so the cost basis is unknown and {shareUnmatched.length === 1 ? 'it is' : 'they are'} not in this month.
                </p>
              )}
              {calendar.stockSales > 0 && (
                <p data-testid="share-note">Includes {calendar.stockSales} share {calendar.stockSales === 1 ? 'sale' : 'sales'} (stocks and ETFs, first-in first-out cost, net of fees): {formatSignedMoney(calendar.stockPnl)}.</p>
              )}
              {(calendar.excludedByUser > 0 || calendar.incomplete > 0) && (
                <p>Left out, as on Performance: {calendar.excludedByUser} excluded by you, {calendar.incomplete} incomplete.</p>
              )}
              {calendar.trades === 0 && <p>No trades closed this month.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function WeekRow({ week, today }: { week: ReturnType<typeof buildMonthCalendar>['weeks'][number]; today: string }) {
  return (
    <>
      {week.days.map(d => {
        const has = d.inMonth && d.pnl != null;
        const cls = !d.inMonth
          ? 'border-white/5 bg-transparent text-white/20'
          : !has ? 'border-white/10 bg-white/[0.02] text-white/40'
            : (d.pnl as number) >= 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300';
        return (
          <div key={d.date} data-testid={`day-${d.date}`}
            aria-label={has ? `${d.date}: ${formatSignedMoney(d.pnl as number)} from ${d.trades} ${d.trades === 1 ? 'trade' : 'trades'}${d.stockPnl != null ? `, including ${formatSignedMoney(d.stockPnl)} from shares` : ''}` : d.date}
            className={`flex min-h-[68px] flex-col justify-between rounded-lg border p-2 ${cls} ${d.date === today ? 'ring-1 ring-teal-400' : ''}`}>
            <span className="text-[11px] text-white/50">{d.day}</span>
            {has && <span className="text-sm font-semibold">{formatCellMoney(d.pnl as number)}</span>}
          </div>
        );
      })}
      <div data-testid={`week-${week.days[0].date}`} className={`flex min-h-[68px] flex-col items-center justify-center rounded-lg border p-2 ${week.total == null ? 'border-white/10 bg-white/[0.02] text-white/40' : week.total >= 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
        <span className="text-[10px] tracking-widest text-white/50">WK</span>
        <span className="text-sm font-semibold">{week.total == null ? '–' : formatCellMoney(week.total)}</span>
      </div>
    </>
  );
}
