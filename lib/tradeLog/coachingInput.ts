// lib/tradeLog/coachingInput.ts

// PERF-AI-0001 S1 (Ian, Alan, Quinn; Dean 2026-10-06): the ONLY input the period coaching AI receives. Pure: built
// from the same PerformanceReport the tab shows, plus the period's account profit and balance history, so the AI and
// the screen always quote the same numbers. Every dollar figure the AI may want (including what-ifs and differences)
// is computed here; the AI selects and explains, it never calculates. The number checker validates answers against it.

import type { ClosedTrade } from './types';
import { capitalAtRisk, creditToWidth, groupStats, methodExit, type GroupStats, type PerformanceReport } from './performanceMetrics';

export const COACHING_PROMPT_VERSION = 'perf-ai-0001.v1';
export const POSITION_SIZE_LIMIT_PCT = 25; // Dean 2026-10-06: <= 25% of net liq per position; per-trade override
export const MAX_TRADE_LINES = 400;

export type EvidenceTier = 'RULE_BREAK' | 'FINDING' | 'EARLY_SIGNAL' | 'NOT_ENOUGH_DATA' | 'INFORMATION';

/** Alan: >= 10 finding, 5-9 early signal, < 5 not enough data; a rule breach is a fact at any count (> 0). */
export function evidenceTier(trades: number, isRuleBreak = false): EvidenceTier {
  if (isRuleBreak && trades > 0) return 'RULE_BREAK';
  if (trades >= 10) return 'FINDING';
  if (trades >= 5) return 'EARLY_SIGNAL';
  return 'NOT_ENOUGH_DATA';
}

/** A comparison between two groups is a finding only when both have >= 10 trades. */
export function comparisonTier(a: number, b: number): EvidenceTier {
  const smaller = Math.min(a, b);
  return smaller >= 10 ? 'FINDING' : smaller >= 5 ? 'EARLY_SIGNAL' : 'NOT_ENOUGH_DATA';
}

export interface BalancePoint { date: string; netLiquidatingValue: number }

export interface Tally { trades: number; pnl: number }
export interface Habit extends Tally {
  tier: EvidenceTier;
  byMonth: Record<string, number>; // count per YYYY-MM inside the period (Ian: is it fading?)
  symbols: string[];
}

export interface CoachingInput {
  promptVersion: string;
  period: { from: string; to: string; label: string };
  counts: { included: number; incomplete: number; excludedByUser: number; tradeLinesCapped: boolean };
  accountProfit: { status: 'OK'; startDate: string; endDate: string; startValue: number; endValue: number; netMoved: number; profit: number; openAndOther: number } | { status: 'UNAVAILABLE'; reason: string };
  headline: { trades: number; pnl: number; fees: number; winRate: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null; expectancy: number | null; returnOnRiskPct: number | null; maxDrawdown: number };
  habits: {
    beyondStop: Habit & { excessLoss: number; savedClosingAtStop: number };
    insideStop: Tally & { tier: EvidenceTier };
    openedInside21Dte: Habit & { savedBySkipping: number };
    spreadsHeldPast21Dte: Habit;
    target: { atTarget: Tally; early: Tally & { avgCreditKeptPct: number | null }; tier: EvidenceTier };
    creditToWidth: { atOrAbove: Tally; below: Tally; difference: number; tier: EvidenceTier };
    positionSize: Habit & { limitPct: number; overridden: number; notChecked: number; oversize: { id: string; symbol: string; pct: number; capital: number; netLiq: number }[] };
    reentryAfterLoss: Habit & { savedBySkipping: number };
    lossConcentration: { symbol: string; lossShare: number; losses: number; trades: number; tier: EvidenceTier }[];
    firstThirtyMinutes: Tally & { tier: EvidenceTier };
    assigned: Tally & { tier: 'INFORMATION' };
  };
  strategies: { strategy: string; stats: GroupStats; breakEvenWinRate: number | null; tier: EvidenceTier }[];
  tickers: { best: { symbol: string; trades: number; pnl: number }[]; worst: { symbol: string; trades: number; pnl: number }[] };
  tradeLines: string[];
}

const SPREADS = ['BPS', 'BCS', 'IC', 'SPREAD'];
const isSpread = (t: ClosedTrade) => SPREADS.indexOf(t.strategy) >= 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sumPnl = (ts: readonly ClosedTrade[]) => r2(ts.reduce((n, t) => n + t.pnl, 0));
const tally = (ts: readonly ClosedTrade[]): Tally => ({ trades: ts.length, pnl: sumPnl(ts) });
const month = (t: ClosedTrade) => t.closeDate.slice(0, 7);

function byMonth(ts: readonly ClosedTrade[]): Record<string, number> {
  const out: Record<string, number> = {};
  ts.forEach(t => { out[month(t)] = (out[month(t)] ?? 0) + 1; });
  return out;
}

function habit(ts: readonly ClosedTrade[], isRuleBreak: boolean): Habit {
  return { ...tally(ts), tier: evidenceTier(ts.length, isRuleBreak), byMonth: byMonth(ts), symbols: ts.map(t => t.symbol) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** Net liq at the last stored close on or before `date`, within 5 days; null otherwise (fail closed). */
export function netLiqAtOpen(history: readonly BalancePoint[], date: string): number | null {
  let best: BalancePoint | null = null;
  history.forEach(p => { if (p.netLiquidatingValue > 0 && p.date <= date && (!best || p.date > best.date)) best = p; });
  const b = best as BalancePoint | null;
  return b && daysBetween(b.date, date) <= 5 ? b.netLiquidatingValue : null;
}

/** Break-even win rate (%) = avg loss / (avg win + avg loss), magnitudes, after fees. */
export function breakEvenWinRate(s: GroupStats): number | null {
  if (s.avgWin == null || s.avgLoss == null) return null;
  const w = Math.abs(s.avgWin), l = Math.abs(s.avgLoss);
  return w + l > 0 ? r2((l / (w + l)) * 100) : null;
}

function tradeLine(t: ClosedTrade): string {
  const ctw = creditToWidth(t);
  return [t.closeDate, t.symbol, t.strategy, t.strikes, `x${t.closedQuantity || 1}`, `dte ${t.dteAtEntry}->${t.dteAtClose}`, `credit ${r2(t.creditReceived)}`, `pnl ${r2(t.pnl)}`, methodExit(t), ctw == null ? '' : `ctw ${r2(ctw)}`].filter(Boolean).join(' | ');
}

export interface CoachingInputArgs {
  report: PerformanceReport;
  from: string;
  to: string;
  label: string;
  accountProfit: { status: 'OK'; startDate: string; endDate: string; startValue: number; endValue: number; netMoved: number; profit: number } | { status: 'UNAVAILABLE'; reason: string };
  balanceHistory: readonly BalancePoint[];
  sizeOverrides: ReadonlySet<string>;
}

export function buildCoachingInput(args: CoachingInputArgs): CoachingInput {
  const { report, balanceHistory, sizeOverrides } = args;
  const inc = report.included;
  const h = report.headline;

  const exitOf = new Map(inc.map(t => [t.id, methodExit(t)] as const));
  const beyond = inc.filter(t => exitOf.get(t.id) === 'BEYOND_STOP');
  const inside = inc.filter(t => exitOf.get(t.id) === 'STOPPED');
  const atTarget = inc.filter(t => exitOf.get(t.id) === 'TARGET');
  const early = inc.filter(t => exitOf.get(t.id) === 'EARLY_PROFIT');
  const inside21 = inc.filter(t => isSpread(t) && t.dteAtEntry < 21);
  const held21 = inc.filter(t => isSpread(t) && t.dteAtEntry >= 21 && t.dteAtClose < 21);
  const excessLoss = r2(beyond.reduce((n, t) => n + (-(t.pnl + t.fees) - Math.abs(t.creditReceived)), 0));

  const keptPcts = early.filter(t => Math.abs(t.creditReceived) > 0).map(t => ((t.pnl + t.fees) / Math.abs(t.creditReceived)) * 100);
  // Alan: no dollar what-if for early closes; without the price path we cannot know they would have reached 50%.

  const ratioed = inc.map(t => ({ t, ratio: creditToWidth(t) })).filter(x => x.ratio != null);
  const ctwAbove = ratioed.filter(x => (x.ratio as number) >= 1 / 3).map(x => x.t);
  const ctwBelow = ratioed.filter(x => (x.ratio as number) < 1 / 3).map(x => x.t);

  // Position size: capital at risk vs net liq at open; Dean's override marks a trade deliberate (within the rule).
  const oversizeTrades: ClosedTrade[] = [];
  const oversize: CoachingInput['habits']['positionSize']['oversize'] = [];
  let overridden = 0, notChecked = 0;
  inc.forEach(t => {
    const capital = capitalAtRisk(t);
    if (capital == null) return;
    const nlv = netLiqAtOpen(balanceHistory, t.openDate);
    if (nlv == null) { notChecked += 1; return; }
    const pct = (capital / nlv) * 100;
    if (pct <= POSITION_SIZE_LIMIT_PCT) return;
    if (sizeOverrides.has(t.id)) { overridden += 1; return; }
    oversizeTrades.push(t);
    oversize.push({ id: t.id, symbol: t.symbol, pct: r2(pct), capital: r2(capital), netLiq: r2(nlv) });
  });

  // Re-entry: same ticker opened within 2 days after a losing close.
  const losers = inc.filter(t => t.pnl < 0);
  const reentries = inc.filter(t => losers.some(l => l.id !== t.id && l.symbol === t.symbol && t.openDate >= l.closeDate && daysBetween(l.closeDate, t.openDate) <= 2));

  const totalLosses = -losers.reduce((n, t) => n + t.pnl, 0);
  const lossBySymbol: Record<string, { losses: number; trades: number }> = {};
  losers.forEach(t => { const e = (lossBySymbol[t.symbol] ??= { losses: 0, trades: 0 }); e.losses += -t.pnl; e.trades += 1; });
  const lossConcentration = Object.keys(lossBySymbol)
    .map(symbol => ({ symbol, losses: r2(lossBySymbol[symbol].losses), trades: lossBySymbol[symbol].trades, lossShare: totalLosses > 0 ? r2((lossBySymbol[symbol].losses / totalLosses) * 100) : 0 }))
    .filter(x => x.lossShare >= 25)
    .sort((a, b) => b.lossShare - a.lossShare)
    .map(x => ({ ...x, tier: evidenceTier(x.trades) }));

  const firstThirty = inc.filter(t => { const [hh, mm] = (t.openTime || '').split(':').map(Number); return Number.isFinite(hh) && Number.isFinite(mm) && hh * 60 + mm >= 570 && hh * 60 + mm < 600; });
  const firstTier = evidenceTier(firstThirty.length);
  const assigned = inc.filter(t => t.closureMechanism === 'ASSIGNED');

  const strategies = Object.keys(report.byStrategy).map(strategy => {
    const stats = report.byStrategy[strategy];
    return { strategy, stats, breakEvenWinRate: breakEvenWinRate(stats), tier: evidenceTier(stats.trades) };
  }).sort((a, b) => b.stats.trades - a.stats.trades);

  const tickerRows = report.byTicker.map(x => ({ symbol: x.symbol, trades: x.stats.trades, pnl: r2(x.stats.pnl) }));
  const ordered = inc.slice().sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id));

  return {
    promptVersion: COACHING_PROMPT_VERSION,
    period: { from: args.from, to: args.to, label: args.label },
    counts: { included: inc.length, incomplete: report.incomplete.length, excludedByUser: report.excludedByUser, tradeLinesCapped: ordered.length > MAX_TRADE_LINES },
    accountProfit: args.accountProfit.status === 'OK'
      ? { ...args.accountProfit, openAndOther: r2(args.accountProfit.profit - h.pnl) }
      : args.accountProfit,
    headline: { trades: h.trades, pnl: r2(h.pnl), fees: r2(h.fees), winRate: h.winRate == null ? null : r2(h.winRate), avgWin: h.avgWin == null ? null : r2(h.avgWin), avgLoss: h.avgLoss == null ? null : r2(h.avgLoss), profitFactor: h.profitFactor == null ? null : r2(h.profitFactor), expectancy: h.expectancy == null ? null : r2(h.expectancy), returnOnRiskPct: h.returnOnRiskPct == null ? null : r2(h.returnOnRiskPct), maxDrawdown: r2(h.maxDrawdown) },
    habits: {
      beyondStop: { ...habit(beyond, true), excessLoss, savedClosingAtStop: excessLoss },
      insideStop: { ...tally(inside), tier: 'INFORMATION' },
      openedInside21Dte: { ...habit(inside21, true), savedBySkipping: r2(-sumPnl(inside21)) },
      spreadsHeldPast21Dte: habit(held21, true),
      target: {
        atTarget: tally(atTarget),
        early: { ...tally(early), avgCreditKeptPct: keptPcts.length ? r2(keptPcts.reduce((a, b) => a + b, 0) / keptPcts.length) : null },
        tier: evidenceTier(atTarget.length + early.length),
      },
      creditToWidth: { atOrAbove: tally(ctwAbove), below: tally(ctwBelow), difference: r2(sumPnl(ctwBelow) - sumPnl(ctwAbove)), tier: comparisonTier(ctwAbove.length, ctwBelow.length) },
      positionSize: { ...habit(oversizeTrades, true), limitPct: POSITION_SIZE_LIMIT_PCT, overridden, notChecked, oversize },
      reentryAfterLoss: { ...habit(reentries, false), savedBySkipping: r2(-sumPnl(reentries)) },
      lossConcentration,
      firstThirtyMinutes: { ...tally(firstThirty), tier: firstTier === 'FINDING' ? 'EARLY_SIGNAL' : firstTier }, // Ian: never a finding
      assigned: { ...tally(assigned), tier: 'INFORMATION' },
    },
    strategies,
    tickers: { best: tickerRows.filter(x => x.pnl > 0).slice(0, 5), worst: tickerRows.filter(x => x.pnl < 0).slice(-5).reverse() },
    tradeLines: ordered.slice(-MAX_TRADE_LINES).map(tradeLine),
  };
}
