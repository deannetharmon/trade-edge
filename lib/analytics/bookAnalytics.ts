// lib/analytics/bookAnalytics.ts

// ANALYTICS-0001 A1: the "book" view. Pure: no fetch, no React, no clock read (the caller passes `today`, `nowMs` and the period).
// It COMPOSES existing modules and re-implements no metric:
//  * realized results: buildPerformanceReport / groupStats (PERF-0001), over the trades closed inside the period;
//  * open P/L, capital, groups, needs-attention: buildPortfolioSummary and its member lines (PORTFOLIO-SUMMARY-0001);
//  * leverage tags and economic underlying: the issuer catalog only (LEV-0001). An uncatalogued symbol is never tagged or guessed.
// Realized panels follow the period. Open P/L, capital, concentration, position size and risk are as of now.

import type { ClosedTrade } from '@/lib/tradeLog/types';
import { buildPerformanceReport, groupStats, type GroupStats, type PerformanceReport } from '@/lib/tradeLog/performanceMetrics';
import {
  buildPortfolioSummary, DEFAULT_EXPOSURE_LIMIT_PCT, SUMMARY_GROUPS, summaryMemberLines,
  type PortfolioSummary, type PortfolioSummaryInput, type SummaryGroupKey, type SummaryMemberLine, type SummedFigure,
} from '@/features/portfolio/positions-workspace/model/portfolioSummary';
import { DIREXION_GATE1_BOOTSTRAP, resolveCatalogInstrumentMetadata } from '@/lib/instrument-metadata';

/** Proposed warning level (Ian, ANALYTICS-0001 section 4); display only. The limit itself is DEFAULT_EXPOSURE_LIMIT_PCT. */
export const WATCH_EXPOSURE_PCT = 15;
/** Prosper rule set: max 5-10% of the portfolio per position. */
export const POSITION_SIZE_WITHIN_PCT = 5;
export const POSITION_SIZE_MAX_PCT = 10;
/** A position is "expiring" at or below this many days: the existing critical-expiration rule (positionObjective, dte <= 7). */
export const EXPIRING_DAYS = 7;
const DEFAULT_TOP_OPEN = 8;

export interface BookPeriod { from: string; to: string }

export interface BookAnalyticsInput extends Pick<PortfolioSummaryInput, 'rows' | 'equities' | 'pendingOrders' | 'cashBalance' | 'nowMs' | 'exposureLimitPct'> {
  /** The full trade load (12 months) with the user's exclusions already marked, exactly as Performance receives it. */
  trades: readonly ClosedTrade[];
  /** Inclusive, by close date (YYYY-MM-DD). */
  period: BookPeriod;
  /** New York date, YYYY-MM-DD. */
  today: string;
  /** Account net liquidation value; the denominator for position size. Never replaced by deployed capital. */
  netLiquidity: number | null | undefined;
  watchExposurePct?: number;
  topOpenPositions?: number;
}

export interface MonthRow {
  month: string;
  stats: GroupStats;
  /** The period does not cover the whole calendar month. */
  partial: boolean;
  /** The month containing today, with the period ending today. */
  inProgress: boolean;
}

export type ExposureStatus = 'OVER_LIMIT' | 'WATCH' | 'OK';

export interface ConcentrationRow {
  underlying: string;
  capital: number;
  /** Exact share of total capital, percent. The status uses the whole-percent figure so it agrees with the Positions page. */
  sharePct: number;
  status: ExposureStatus;
  hasLeveraged: boolean;
  members: { symbol: string; capital: number; leveraged: boolean; signedLeverageMultiplier: number | null }[];
}

export type PositionSizeBand = 'WITHIN_RULE' | 'UPPER_RANGE' | 'OVER_MAX';

export interface DteBandRow { key: string; label: string; inTarget: boolean; stats: GroupStats }

export interface BookAnalytics {
  period: BookPeriod & { endsToday: boolean };
  report: PerformanceReport;
  realized: PerformanceReport['headline'] & { needsReview: number; excludedByUser: number };
  open: SummedFigure;
  total: { value: number | null; reason: string | null; openComplete: boolean };
  capitalDeployed: SummedFigure;
  summary: PortfolioSummary;
  monthly: { months: MonthRow[]; openPnl: SummedFigure };
  capitalByType: {
    groups: { key: SummaryGroupKey; label: string; count: number; capital: SummedFigure; sharePct: number | null }[];
    notHeld: { key: SummaryGroupKey; label: string }[];
  };
  concentration: { available: boolean; reason: string | null; limitPct: number; watchPct: number; rows: ConcentrationRow[] };
  positionSize: {
    available: boolean;
    reason: string | null;
    bands: { key: PositionSizeBand; label: string; count: number }[];
    positions: { key: string; symbol: string; capital: number; sharePct: number; band: PositionSizeBand }[];
    /** Held positions with no capital basis (e.g. covered calls, whose capital is the shares already counted as equity). */
    noCapitalBasis: number;
  };
  risk: { needsAttention: number; expiringWithinDays: number; expiringDays: number; overLimit: number; watch: number };
  dteAtEntry: { bands: DteBandRow[]; unknown: number };
  shortPutMonthly: { month: string; stats: GroupStats }[];
  openByPosition: { rows: { key: string; symbol: string; kind: 'option' | 'equity'; strategy: string; pnl: number }[]; of: number; unpriced: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const lastDayOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const DTE_BANDS: { key: string; label: string; min: number; inTarget: boolean }[] = [
  { key: '0-14', label: '0-14 DTE', min: 0, inTarget: false },
  { key: '15-29', label: '15-29 DTE', min: 15, inTarget: false },
  { key: '30-45', label: '30-45 DTE', min: 30, inTarget: true },
  { key: '46+', label: '46+ DTE', min: 46, inTarget: false },
];

export function positionSizeBand(sharePct: number): PositionSizeBand {
  if (sharePct <= POSITION_SIZE_WITHIN_PCT) return 'WITHIN_RULE';
  if (sharePct <= POSITION_SIZE_MAX_PCT) return 'UPPER_RANGE';
  return 'OVER_MAX';
}

export function tradesInPeriod<T extends Pick<ClosedTrade, 'closeDate'>>(trades: readonly T[], period: BookPeriod): T[] {
  return trades.filter(t => t.closeDate >= period.from && t.closeDate <= period.to);
}

export function buildBookAnalytics(input: BookAnalyticsInput): BookAnalytics {
  const { period, today } = input;
  const endsToday = period.to === today;

  // Realized: the PERF-0001 report over the trades closed inside the period.
  const report = buildPerformanceReport(tradesInPeriod(input.trades, period));
  const realized = { ...report.headline, needsReview: report.incomplete.length, excludedByUser: report.excludedByUser };

  // Open and capital: the portfolio summary, unchanged.
  const summary = buildPortfolioSummary(input);
  const open = summary.total.pnl;
  const openComplete = open.value != null && open.included === open.of;
  let totalValue: number | null = null;
  let totalReason: string | null = null;
  if (!endsToday) totalReason = 'The period does not end today: realized for a past period plus open now would mix two moments.';
  else if (open.value == null) totalReason = 'Open P&L is unavailable.';
  else totalValue = round2(realized.pnl + open.value);

  const months: MonthRow[] = report.byMonth.map(m => ({
    month: m.month,
    stats: m.stats,
    partial: period.from > `${m.month}-01` || period.to < lastDayOfMonth(m.month),
    inProgress: endsToday && m.month === today.slice(0, 7),
  }));

  const capitalByType = {
    groups: summary.groups.map(g => ({ key: g.key as SummaryGroupKey, label: g.label, count: g.count, capital: g.capital, sharePct: g.capitalSharePct })),
    notHeld: SUMMARY_GROUPS.filter(g => !summary.groups.some(s => s.key === g.key)).map(g => ({ key: g.key, label: g.label })),
  };

  const lines = summaryMemberLines(input);
  const totalCapital = summary.total.capital.value;
  const limitPct = input.exposureLimitPct ?? DEFAULT_EXPOSURE_LIMIT_PCT;
  const watchPct = input.watchExposurePct ?? WATCH_EXPOSURE_PCT;

  // Concentration by economic underlying. Leverage comes from the issuer catalog only.
  const concentration: BookAnalytics['concentration'] = { available: false, reason: null, limitPct, watchPct, rows: [] };
  if (totalCapital == null || totalCapital <= 0) {
    concentration.reason = 'Total capital is unavailable.';
  } else {
    const byUnderlying = new Map<string, ConcentrationRow>();
    for (const line of lines) {
      if (line.capital == null) continue;
      const meta = resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, line.symbol);
      const underlying = (meta?.economicUnderlyingSymbol ?? line.symbol).toUpperCase();
      const row = byUnderlying.get(underlying) ?? { underlying, capital: 0, sharePct: 0, status: 'OK' as ExposureStatus, hasLeveraged: false, members: [] };
      row.capital += line.capital;
      const member = row.members.find(x => x.symbol === line.symbol);
      if (member) member.capital += line.capital;
      else row.members.push({ symbol: line.symbol, capital: line.capital, leveraged: meta != null, signedLeverageMultiplier: meta?.signedLeverageMultiplier ?? null });
      if (meta != null) row.hasLeveraged = true;
      byUnderlying.set(underlying, row);
    }
    const rows = Array.from(byUnderlying.values()).map(r => {
      const sharePct = (r.capital / totalCapital) * 100;
      const whole = Math.round(sharePct);
      const status: ExposureStatus = whole > limitPct ? 'OVER_LIMIT' : whole >= watchPct ? 'WATCH' : 'OK';
      return { ...r, sharePct, status, members: r.members.sort((a, b) => b.capital - a.capital || a.symbol.localeCompare(b.symbol)) };
    }).sort((a, b) => b.capital - a.capital || a.underlying.localeCompare(b.underlying));
    concentration.available = true;
    concentration.rows = rows;
  }

  // Position size against net liquidation value. Unavailable, never a fallback to deployed capital.
  const noCapitalBasis = lines.filter(l => l.capital == null).length;
  const netLiq = input.netLiquidity;
  const positionSize: BookAnalytics['positionSize'] = {
    available: false, reason: null, noCapitalBasis,
    bands: [], positions: [],
  };
  if (netLiq == null || !Number.isFinite(netLiq) || netLiq <= 0) {
    positionSize.reason = 'Account value (net liquidation) is unavailable.';
  } else {
    const positions = lines.filter(l => l.capital != null).map(l => {
      const sharePct = ((l.capital as number) / netLiq) * 100;
      return { key: l.key, symbol: l.symbol, capital: l.capital as number, sharePct, band: positionSizeBand(sharePct) };
    }).sort((a, b) => b.sharePct - a.sharePct || a.key.localeCompare(b.key));
    positionSize.available = true;
    positionSize.positions = positions;
    positionSize.bands = ([['WITHIN_RULE', 'Within rule (up to 5%)'], ['UPPER_RANGE', 'Upper range (5-10%)'], ['OVER_MAX', 'Over max (above 10%)']] as [PositionSizeBand, string][])
      .map(([key, label]) => ({ key, label, count: positions.filter(p => p.band === key).length }));
  }

  const risk = {
    needsAttention: summary.total.needsAttention,
    expiringWithinDays: lines.filter(l => l.kind === 'option' && l.dte != null && l.dte <= EXPIRING_DAYS).length,
    expiringDays: EXPIRING_DAYS,
    overLimit: concentration.rows.filter(r => r.status === 'OVER_LIMIT').length,
    watch: concentration.rows.filter(r => r.status === 'WATCH').length,
  };

  // DTE at entry, over the included trades of the period.
  const known = report.included.filter(t => Number.isFinite(t.dteAtEntry) && t.dteAtEntry >= 0);
  const dteBands: DteBandRow[] = DTE_BANDS.map((b, i) => {
    const next = DTE_BANDS[i + 1]?.min ?? Infinity;
    return { key: b.key, label: b.label, inTarget: b.inTarget, stats: groupStats(known.filter(t => t.dteAtEntry >= b.min && t.dteAtEntry < next)) };
  });

  // Monthly short-put P&L: the included CSP trades by close month.
  const cspByMonth = new Map<string, ClosedTrade[]>();
  report.included.filter(t => t.strategy === 'CSP').forEach(t => {
    const m = t.closeDate.slice(0, 7);
    cspByMonth.set(m, [...(cspByMonth.get(m) ?? []), t]);
  });
  const shortPutMonthly = Array.from(cspByMonth.keys()).sort().map(month => ({ month, stats: groupStats(cspByMonth.get(month) as ClosedTrade[]) }));

  // Open P&L by position: largest absolute contributors first.
  const priced = lines.filter((l): l is SummaryMemberLine & { pnl: number } => l.pnl != null && Number.isFinite(l.pnl));
  const openRows = priced
    .slice().sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || a.key.localeCompare(b.key))
    .slice(0, input.topOpenPositions ?? DEFAULT_TOP_OPEN)
    .map(l => ({ key: l.key, symbol: l.symbol, kind: l.kind, strategy: l.strategy, pnl: l.pnl }));

  return {
    period: { ...period, endsToday },
    report,
    realized,
    open,
    total: { value: totalValue, reason: totalReason, openComplete },
    capitalDeployed: summary.total.capital,
    summary,
    monthly: { months, openPnl: open },
    capitalByType,
    concentration,
    positionSize,
    risk,
    dteAtEntry: { bands: dteBands, unknown: report.included.length - known.length },
    shortPutMonthly,
    openByPosition: { rows: openRows, of: lines.length, unpriced: lines.length - priced.length },
  };
}
