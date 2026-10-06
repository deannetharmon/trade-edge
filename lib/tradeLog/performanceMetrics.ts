// lib/tradeLog/performanceMetrics.ts

// PERF-0001 (Ian's design, 2026-10-06): ONE pure computation over ONE record set feeds every Performance panel and the
// Trade Log summary, so every panel shows the same trade count and the same total.
//  * Included = complete, not user-excluded. Incomplete rows are listed separately and never mixed into any total.
//  * Exit categories follow the methodology: target (>= 50% of credit kept), early profit (< 50%), stopped within the
//    2x-credit stop (loss <= credit), beyond the stop (loss > credit -- the leak), expired, assigned.
//  * Rule adherence: entries inside 21 DTE, spreads held past 21 DTE (CSP/CC exempt, DECIDE-0001), beyond-stop excess.
//  * Returns on capital at risk: spreads on max loss (width x 100 x qty - credit), CSP on collateral (strike x 100 x qty).
//  * By strategy, by month, and by ticker (total and per month).

import type { ClosedTrade } from './types';

export type MethodExit = 'TARGET' | 'EARLY_PROFIT' | 'STOPPED' | 'BEYOND_STOP' | 'EXPIRED' | 'ASSIGNED';

export interface GroupStats {
  trades: number;
  pnl: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  capitalAtRisk: number;
  returnOnRiskPct: number | null;
}

export interface PerformanceReport {
  included: ClosedTrade[];
  incomplete: ClosedTrade[];
  excludedByUser: number;
  headline: GroupStats & { fees: number; maxDrawdown: number; openPnlNote: string };
  byStrategy: Record<string, GroupStats>;
  byMonth: { month: string; stats: GroupStats; cumulativePnl: number }[];
  byTicker: { symbol: string; stats: GroupStats; byMonth: Record<string, number> }[];
  exits: Record<MethodExit, { trades: number; pnl: number }>;
  rules: {
    targetHit: number;
    stoppedWithinRule: number;
    beyondStop: { trades: number; pnl: number; excessLoss: number; symbols: string[] };
    enteredInside21Dte: { trades: number; pnl: number };
    spreadsHeldPast21Dte: { trades: number; pnl: number };
    /** Ian: spread credit as a share of width; >= 1/3 is the entry standard. Spreads with parseable strikes only. */
    creditToWidth: { atOrAbove: { trades: number; pnl: number }; below: { trades: number; pnl: number } };
  };
}

const SPREADS = ['BPS', 'BCS', 'IC', 'SPREAD'];

function units(t: ClosedTrade): number {
  return t.closedQuantity > 0 ? t.closedQuantity : 1;
}

/** Max loss for spreads, collateral for CSP; null when unbounded or unknown (short calls, unparsed strikes). */
export function capitalAtRisk(t: ClosedTrade): number | null {
  const strikes = (t.strikes.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (t.strategy === 'CSP' && strikes.length >= 1) return strikes[0] * 100 * units(t);
  if (SPREADS.indexOf(t.strategy) >= 0 && strikes.length >= 2) {
    let width = Math.abs(strikes[0] - strikes[1]);
    if (t.strategy === 'IC' && strikes.length >= 4) width = Math.max(width, Math.abs(strikes[2] - strikes[3]));
    const risk = width * 100 * units(t) - Math.max(0, t.creditReceived);
    return risk > 0 ? risk : null;
  }
  return null;
}

/** Credit / (width x 100 x qty) for spreads; null for non-spreads or unparsed strikes. */
export function creditToWidth(t: ClosedTrade): number | null {
  if (SPREADS.indexOf(t.strategy) < 0) return null;
  const strikes = (t.strikes.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (strikes.length < 2) return null;
  let width = Math.abs(strikes[0] - strikes[1]);
  if (t.strategy === 'IC' && strikes.length >= 4) width = Math.max(width, Math.abs(strikes[2] - strikes[3]));
  return width > 0 ? t.creditReceived / (width * 100 * units(t)) : null;
}

export function methodExit(t: ClosedTrade): MethodExit {
  if (t.closureMechanism === 'ASSIGNED') return 'ASSIGNED';
  if (t.closureMechanism === 'EXPIRED') return 'EXPIRED';
  const credit = Math.abs(t.creditReceived);
  const gross = t.pnl + t.fees; // judge the rule on prices, not fees
  if (gross >= 0.5 * credit) return 'TARGET';
  if (gross >= 0) return 'EARLY_PROFIT';
  return -gross > credit ? 'BEYOND_STOP' : 'STOPPED';
}

export function groupStats(trades: readonly ClosedTrade[]): GroupStats {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const sum = (xs: readonly ClosedTrade[]) => xs.reduce((n, t) => n + t.pnl, 0);
  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  const risked = trades.map(capitalAtRisk);
  const capital = risked.reduce<number>((n, r) => n + (r ?? 0), 0);
  const pnlWithRisk = trades.reduce((n, t, i) => n + (risked[i] != null ? t.pnl : 0), 0);
  return {
    trades: trades.length,
    pnl: sum(trades),
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: trades.length ? sum(trades) / trades.length : null,
    capitalAtRisk: capital,
    returnOnRiskPct: capital > 0 ? (pnlWithRisk / capital) * 100 : null,
  };
}

function maxDrawdown(trades: readonly ClosedTrade[]): number {
  const ordered = trades.slice().sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id));
  let equity = 0, peak = 0, worst = 0;
  for (const t of ordered) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity - peak);
  }
  return worst;
}

export function buildPerformanceReport(all: readonly ClosedTrade[]): PerformanceReport {
  const excludedByUser = all.filter(t => t.excluded).length;
  const candidates = all.filter(t => !t.excluded);
  const included = candidates.filter(t => t.reconstructionStatus === 'COMPLETE');
  const incomplete = candidates.filter(t => t.reconstructionStatus !== 'COMPLETE');

  const byKey = <K extends string>(key: (t: ClosedTrade) => K) => {
    const out: Record<string, ClosedTrade[]> = {};
    included.forEach(t => { (out[key(t)] ??= []).push(t); });
    return out;
  };

  const strategies = byKey(t => t.strategy);
  const byStrategy: Record<string, GroupStats> = {};
  Object.keys(strategies).sort().forEach(k => { byStrategy[k] = groupStats(strategies[k]); });

  const months = byKey(t => t.closeDate.slice(0, 7));
  let running = 0;
  const byMonth = Object.keys(months).sort().map(month => {
    const stats = groupStats(months[month]);
    running += stats.pnl;
    return { month, stats, cumulativePnl: running };
  });

  const tickers = byKey(t => t.symbol);
  const byTicker = Object.keys(tickers).map(symbol => {
    const perMonth: Record<string, number> = {};
    tickers[symbol].forEach(t => { const m = t.closeDate.slice(0, 7); perMonth[m] = (perMonth[m] ?? 0) + t.pnl; });
    return { symbol, stats: groupStats(tickers[symbol]), byMonth: perMonth };
  }).sort((a, b) => b.stats.pnl - a.stats.pnl || a.symbol.localeCompare(b.symbol));

  const exits = { TARGET: { trades: 0, pnl: 0 }, EARLY_PROFIT: { trades: 0, pnl: 0 }, STOPPED: { trades: 0, pnl: 0 }, BEYOND_STOP: { trades: 0, pnl: 0 }, EXPIRED: { trades: 0, pnl: 0 }, ASSIGNED: { trades: 0, pnl: 0 } } as PerformanceReport['exits'];
  const beyond: ClosedTrade[] = [];
  included.forEach(t => {
    const e = methodExit(t);
    exits[e].trades += 1;
    exits[e].pnl += t.pnl;
    if (e === 'BEYOND_STOP') beyond.push(t);
  });
  const isSpread = (t: ClosedTrade) => SPREADS.indexOf(t.strategy) >= 0;
  const inside21 = included.filter(t => isSpread(t) && t.dteAtEntry < 21);
  const heldPast21 = included.filter(t => isSpread(t) && t.dteAtEntry >= 21 && t.dteAtClose < 21);

  const ratioed = included.map(t => ({ t, ratio: creditToWidth(t) })).filter(x => x.ratio != null);
  const tally = (xs: { t: ClosedTrade }[]) => ({ trades: xs.length, pnl: xs.reduce((n, x) => n + x.t.pnl, 0) });

  const head = groupStats(included);
  return {
    included,
    incomplete,
    excludedByUser,
    headline: { ...head, fees: included.reduce((n, t) => n + t.fees, 0), maxDrawdown: maxDrawdown(included), openPnlNote: 'Open positions are not included (realized P/L only).' },
    byStrategy,
    byMonth,
    byTicker,
    exits,
    rules: {
      targetHit: exits.TARGET.trades,
      stoppedWithinRule: exits.STOPPED.trades,
      beyondStop: {
        trades: beyond.length,
        pnl: beyond.reduce((n, t) => n + t.pnl, 0),
        excessLoss: beyond.reduce((n, t) => n + (-(t.pnl + t.fees) - Math.abs(t.creditReceived)), 0),
        symbols: beyond.map(t => t.symbol),
      },
      enteredInside21Dte: { trades: inside21.length, pnl: inside21.reduce((n, t) => n + t.pnl, 0) },
      spreadsHeldPast21Dte: { trades: heldPast21.length, pnl: heldPast21.reduce((n, t) => n + t.pnl, 0) },
      creditToWidth: { atOrAbove: tally(ratioed.filter(x => (x.ratio as number) >= 1 / 3)), below: tally(ratioed.filter(x => (x.ratio as number) < 1 / 3)) },
    },
  };
}
