// features/portfolio/positions-workspace/model/portfolioSummary.ts

// PORTFOLIO-SUMMARY-0001: the P/L summary strip above Portfolio and Position Analysis. Pure: no fetch, no React, no clock
// read (the caller passes `nowMs`). Every figure is built from the same rows the tables show, so tiles add up to the list.
//
//  * Groups partition the portfolio by risk profile (Ian), using the existing strategy classification.
//  * P/L: unrealized at mid (Position.pnl / EquityHolding.unrealizedPnl), the rows' own basis.
//  * Capital: buildCapitalViewModel (CSP cash required, spread max risk, long-option debit) and equity cost basis.
//  * 1D: per leg, the broker's previous close (TastyTrade's P/L Day basis); legs opened today count from their open price.
//  * 1W: against the latest daily snapshot at least 7 calendar days old; a position opened since counts from entry;
//    closed positions drop out (realized, Trade Log).
//  * Missing data never shows as a complete total: each figure carries `included` / `of`.

import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { resolvePositionStrategyFilterKey } from '@/lib/portfolio/positionStrategyFilter';
import { splitOptionLegs } from '@/lib/portfolio/positionLifecycle';
import { toWholePositionThetaDollars } from '@/lib/portfolio/positionMetrics';
import { buildCapitalViewModel } from './presentation';
import { isLeveragedEtf } from '@/lib/leveragedEtfs';

export const DEFAULT_EXPOSURE_LIMIT_PCT = 25;
/** CONCENTRATION-TIERS-0001: muted below this, amber from here, red from the exposure limit. */
export const EXPOSURE_AMBER_PCT = 15;
export type ExposureTier = 'normal' | 'amber' | 'red';
export const exposureTier = (sharePct: number, redPct: number = DEFAULT_EXPOSURE_LIMIT_PCT): ExposureTier =>
  sharePct >= redPct ? 'red' : sharePct >= Math.min(EXPOSURE_AMBER_PCT, redPct) ? 'amber' : 'normal';
const WEEK_DAYS = 7;
const DAY_MS = 86400 * 1000;

export type SummaryGroupKey = 'SHORT_PUTS' | 'SHORT_CALLS' | 'SPREADS' | 'LEAPS' | 'LONG_OPTIONS' | 'PMCC' | 'EQUITY' | 'OTHER';

export const SUMMARY_GROUPS: ReadonlyArray<{ key: SummaryGroupKey; label: string; basis: 'credit' | 'cost' }> = [
  { key: 'SHORT_PUTS', label: 'Short puts', basis: 'credit' },
  { key: 'SHORT_CALLS', label: 'Short calls', basis: 'credit' },
  { key: 'SPREADS', label: 'Credit spreads', basis: 'credit' },
  { key: 'LEAPS', label: 'LEAPS', basis: 'cost' },
  { key: 'LONG_OPTIONS', label: 'Long options', basis: 'cost' },
  { key: 'PMCC', label: 'PMCC', basis: 'cost' },
  { key: 'EQUITY', label: 'Equity', basis: 'cost' },
  { key: 'OTHER', label: 'Other', basis: 'cost' },
];

export function summaryGroupForPosition(position: Position): SummaryGroupKey {
  const key = resolvePositionStrategyFilterKey(position);
  if (key === 'CSP') return 'SHORT_PUTS';
  if (key === 'CC') return 'SHORT_CALLS';
  if (key === 'BPS' || key === 'BCS' || key === 'IC') return 'SPREADS';
  if (key === 'LEAP') return 'LEAPS';
  if (key === 'PMCC') return 'PMCC';
  if (key === 'PUT') return 'LONG_OPTIONS';
  const { shortPuts, shortCalls, longPuts, longCalls } = splitOptionLegs(position.legs);
  if (key === 'NAKED') return shortCalls.length > 0 && shortPuts.length === 0 ? 'SHORT_CALLS' : shortPuts.length > 0 && shortCalls.length === 0 ? 'SHORT_PUTS' : 'OTHER';
  if (shortPuts.length === 0 && shortCalls.length === 0 && longPuts.length + longCalls.length > 0) return 'LONG_OPTIONS';
  return 'OTHER';
}

/** A figure summed over a group, with how many members contributed. */
export interface SummedFigure { value: number | null; included: number; of: number }

const sumOf = (values: Array<number | null | undefined>): SummedFigure => {
  let total = 0, included = 0;
  for (const v of values) if (v != null && Number.isFinite(v)) { total += v; included += 1; }
  return { value: included > 0 ? Math.round(total * 100) / 100 : null, included, of: values.length };
};

const nyDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** PL-DAY-ROW-0001: 1-day change plus, when unavailable, the reason (never a silent zero). */
export interface DayChangeDetail { value: number | null; reason: string | null; sinceOpen: boolean }

export const EQUITY_DAY_UNAVAILABLE_REASON = 'no previous-close data for stock holdings yet';

export function positionDayChangeDetail(position: Pick<Position, 'legs'>, nowMs: number): DayChangeDetail {
  if (!position.legs.length) return { value: null, reason: 'no option legs', sinceOpen: false };
  const today = nyDate(nowMs);
  let total = 0, allToday = true;
  for (const leg of position.legs) {
    const openedToday = leg.openedAt != null && Number.isFinite(Date.parse(leg.openedAt)) && nyDate(Date.parse(leg.openedAt)) === today;
    if (!openedToday) allToday = false;
    const ref = openedToday ? leg.avgOpenPrice : leg.closePrice;
    if (leg.currentPrice == null || !Number.isFinite(leg.currentPrice)) return { value: null, reason: 'current option price unavailable', sinceOpen: false };
    if (ref == null || !Number.isFinite(ref) || (!openedToday && ref <= 0)) return { value: null, reason: openedToday ? 'open price unavailable' : 'previous close unavailable', sinceOpen: false };
    const qty = Math.abs(leg.quantity) * 100;
    total += (leg.direction === 'Short' ? ref - leg.currentPrice : leg.currentPrice - ref) * qty;
  }
  return { value: Math.round(total * 100) / 100, reason: null, sinceOpen: allToday };
}

/** 1-day change for an option position from each leg's previous close; null when any leg lacks the data. */
export function positionDayChange(position: Pick<Position, 'legs'>, nowMs: number): number | null {
  return positionDayChangeDetail(position, nowMs).value;
}

/** 1-week change from the daily snapshot at least 7 days old; from entry when opened since; null when history is missing. */
export function positionWeekChange(position: Pick<Position, 'pnl' | 'entryDate' | 'snapshotHistory'>, nowMs: number): { value: number | null; since: string | null } {
  if (position.pnl == null || !Number.isFinite(position.pnl)) return { value: null, since: null };
  const cutoff = nyDate(nowMs - WEEK_DAYS * DAY_MS);
  const older = (position.snapshotHistory ?? []).filter(s => s.date <= cutoff && s.pnl != null && Number.isFinite(s.pnl)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (older) return { value: Math.round((position.pnl - (older.pnl as number)) * 100) / 100, since: older.date };
  if (position.entryDate != null && position.entryDate > cutoff) return { value: position.pnl, since: position.entryDate };
  return { value: null, since: null };
}

export interface SummaryTile {
  key: SummaryGroupKey | 'TOTAL';
  label: string;
  count: number;
  pnl: SummedFigure;
  /** Return on the group's basis (credit kept or cost), percent; null when the basis is incomplete. */
  returnPct: number | null;
  basis: 'credit' | 'cost' | null;
  capital: SummedFigure;
  capitalSharePct: number | null;
  thetaPerDay: SummedFigure;
  dayChange: SummedFigure;
  /** Positions with no 1D value and why; named in the 1D tooltip. */
  dayMissing: Array<{ symbol: string; reason: string }>;
  weekChange: SummedFigure;
  needsAttention: number;
}

export interface CashToDeploy {
  value: number | null;
  usingMargin: boolean;
  /** Short calls and unrecognised opening orders cannot be cash-secured; they are listed, not guessed. */
  excluded: number;
  reason: string | null;
}

export interface LargestExposure { symbol: string; capital: number; sharePct: number; overLimit: boolean; limitPct: number; tier: ExposureTier }

/** Leveraged and inverse ETF positions taken together (one macro bet across several tickers). */
export interface LeveragedCluster { symbols: string[]; capital: number; sharePct: number; tier: ExposureTier; limitPct: number }

export interface PortfolioSummary {
  total: SummaryTile;
  groups: SummaryTile[];
  weekSince: string | null;
  cashToDeploy: CashToDeploy;
  largest: LargestExposure | null;
  leveragedCluster: LeveragedCluster | null;
}

interface Member {
  key: string;
  kind: 'option' | 'equity';
  strategy: string;
  dte: number | null;
  group: SummaryGroupKey;
  symbol: string;
  pnl: number | null;
  basisAmount: number | null;
  capital: number | null;
  theta: number | null;
  day: number | null;
  dayReason: string | null;
  week: number | null;
  weekSince: string | null;
  attention: boolean;
}

export interface PortfolioSummaryInput {
  rows: ReadonlyArray<{ position: Position; needsAttention: boolean }>;
  equities: ReadonlyArray<EquityHolding>;
  pendingOrders: ReadonlyArray<PendingOrder>;
  cashBalance: number | null | undefined;
  nowMs: number;
  exposureLimitPct?: number;
}

function optionMember(position: Position, attention: boolean, nowMs: number): Member {
  const capital = buildCapitalViewModel(position);
  const week = positionWeekChange(position, nowMs);
  const day = positionDayChangeDetail(position, nowMs);
  const basisAmount = position.entryEconomicsComplete === true && position.entryCredit != null && Number.isFinite(position.entryCredit) ? Math.abs(position.entryCredit) : null;
  return {
    key: position.key,
    kind: 'option',
    strategy: position.strategy,
    dte: Number.isFinite(position.dte) ? position.dte : null,
    group: summaryGroupForPosition(position),
    symbol: position.symbol,
    pnl: position.pnl != null && Number.isFinite(position.pnl) ? position.pnl : null,
    basisAmount,
    // CC capital is shares, not dollars (`suffix`); it is collateral already counted as equity cost.
    capital: capital.suffix ? null : capital.value,
    theta: position.theta != null ? toWholePositionThetaDollars(position.theta) : null,
    day: day.value,
    dayReason: day.reason,
    week: week.value,
    weekSince: week.since,
    attention,
  };
}

function equityMember(holding: EquityHolding): Member {
  const cost = holding.basisComplete && holding.basis != null && Number.isFinite(holding.basis) ? Math.abs(holding.basis * holding.quantity) : null;
  return {
    key: `EQUITY:${holding.symbol}`, kind: 'equity', strategy: 'EQUITY', dte: null,
    group: 'EQUITY', symbol: holding.symbol, pnl: holding.unrealizedPnl, basisAmount: cost, capital: cost,
    theta: null, day: null, dayReason: EQUITY_DAY_UNAVAILABLE_REASON, week: null, weekSince: null, attention: false,
  };
}

function tile(key: SummaryTile['key'], label: string, basis: SummaryTile['basis'], members: Member[], totalCapital: number | null): SummaryTile {
  const pnl = sumOf(members.map(m => m.pnl));
  const basisSum = sumOf(members.map(m => m.basisAmount));
  const complete = pnl.value != null && pnl.included === pnl.of && basisSum.value != null && basisSum.included === basisSum.of && basisSum.value > 0;
  const capital = sumOf(members.map(m => m.capital));
  return {
    key, label, basis, count: members.length, pnl,
    returnPct: basis && complete ? Math.round(((pnl.value as number) / (basisSum.value as number)) * 1000) / 10 : null,
    capital,
    capitalSharePct: capital.value != null && totalCapital != null && totalCapital > 0 ? Math.round((capital.value / totalCapital) * 100) : null,
    thetaPerDay: sumOf(members.filter(m => m.group !== 'EQUITY').map(m => m.theta)),
    dayChange: sumOf(members.map(m => m.day)),
    dayMissing: members.filter(m => m.day == null).map(m => ({ symbol: m.symbol, reason: m.dayReason ?? 'unavailable' })),
    weekChange: sumOf(members.map(m => m.week)),
    needsAttention: members.filter(m => m.attention).length,
  };
}

/** Cash an opening order would hold on a cash-secured basis; null when its shape cannot be cash-secured. */
export function openingOrderCash(order: PendingOrder): number | null {
  const opening = order.legs.filter(l => /to open/i.test(l.action));
  if (opening.length === 0) return 0;
  const qty = Math.abs(opening[0].quantity || 0);
  const shorts = opening.filter(l => /^sell/i.test(l.action));
  const longs = opening.filter(l => /^buy/i.test(l.action));
  const limit = order.limitPrice != null && Number.isFinite(order.limitPrice) ? Math.abs(order.limitPrice) : null;
  if (shorts.length === 1 && longs.length === 0 && shorts[0].optionType === 'P') return shorts[0].strikePrice * 100 * qty;
  if (shorts.length === 0 && longs.length > 0) return limit != null ? limit * 100 * qty : null;
  if (shorts.length === longs.length && shorts.length > 0 && limit != null && /credit/i.test(order.priceEffect ?? '')) {
    const width = Math.max(...shorts.map((s, i) => Math.abs(s.strikePrice - (longs[i]?.strikePrice ?? s.strikePrice))));
    return Math.max(0, (width - limit) * 100 * qty);
  }
  return null;
}

function buildMembers(input: Pick<PortfolioSummaryInput, 'rows' | 'equities' | 'nowMs'>): Member[] {
  return [
    ...input.rows.map(r => optionMember(r.position, r.needsAttention, input.nowMs)),
    ...input.equities.map(equityMember),
  ];
}

/** ANALYTICS-0001: one line per held position, on the same members and the same capital basis the summary tiles are built from. */
export interface SummaryMemberLine {
  key: string;
  symbol: string;
  kind: 'option' | 'equity';
  group: SummaryGroupKey;
  strategy: string;
  pnl: number | null;
  capital: number | null;
  dte: number | null;
  attention: boolean;
}

export function summaryMemberLines(input: Pick<PortfolioSummaryInput, 'rows' | 'equities' | 'nowMs'>): SummaryMemberLine[] {
  return buildMembers(input).map(m => ({ key: m.key, symbol: m.symbol, kind: m.kind, group: m.group, strategy: m.strategy, pnl: m.pnl, capital: m.capital, dte: m.dte, attention: m.attention }));
}

export function buildPortfolioSummary(input: PortfolioSummaryInput): PortfolioSummary {
  const members = buildMembers(input);
  const totalCapital = sumOf(members.map(m => m.capital)).value;
  const groups = SUMMARY_GROUPS
    .map(g => ({ g, ms: members.filter(m => m.group === g.key) }))
    .filter(({ ms }) => ms.length > 0)
    .map(({ g, ms }) => tile(g.key, g.label, g.basis, ms, totalCapital));
  const total = tile('TOTAL', 'Total', null, members, totalCapital);
  const weekSinceDates = members.map(m => m.weekSince).filter((d): d is string => d != null).sort();

  // Cash to deploy (no margin): cash minus what cash-secured positions and opening orders already hold.
  let held = 0, excluded = 0;
  for (const m of members) {
    if (m.group === 'SHORT_PUTS' || m.group === 'SPREADS') {
      if (m.capital == null) excluded += 1; else held += m.capital;
    }
    if (m.group === 'SHORT_CALLS' && m.capital != null) excluded += 1; // naked short calls: not cash-securable
  }
  for (const order of input.pendingOrders) {
    const cash = openingOrderCash(order);
    if (cash == null) excluded += 1; else held += cash;
  }
  const cash = input.cashBalance != null && Number.isFinite(input.cashBalance) ? input.cashBalance : null;
  const deploy = cash == null ? null : Math.round((cash - held) * 100) / 100;
  const cashToDeploy: CashToDeploy = {
    value: deploy,
    usingMargin: deploy != null && deploy < 0,
    excluded,
    reason: cash == null ? 'Cash balance unavailable' : null,
  };

  // Largest single-underlying exposure.
  const bySymbol = new Map<string, number>();
  for (const m of members) if (m.capital != null) bySymbol.set(m.symbol, (bySymbol.get(m.symbol) ?? 0) + m.capital);
  const limitPct = input.exposureLimitPct ?? DEFAULT_EXPOSURE_LIMIT_PCT;
  let largest: LargestExposure | null = null;
  if (totalCapital != null && totalCapital > 0) {
    for (const [symbol, capital] of Array.from(bySymbol.entries())) {
      if (!largest || capital > largest.capital) {
        const sharePct = Math.round((capital / totalCapital) * 100);
        largest = { symbol, capital, sharePct, overLimit: sharePct >= limitPct, limitPct, tier: exposureTier(sharePct, limitPct) };
      }
    }
  }

  let leveragedCluster: LeveragedCluster | null = null;
  if (totalCapital != null && totalCapital > 0) {
    const clusterSymbols = Array.from(bySymbol.keys()).filter(isLeveragedEtf).sort();
    if (clusterSymbols.length > 0) {
      const capital = clusterSymbols.reduce((sum, sym) => sum + (bySymbol.get(sym) ?? 0), 0);
      const sharePct = Math.round((capital / totalCapital) * 100);
      leveragedCluster = { symbols: clusterSymbols, capital, sharePct, tier: exposureTier(sharePct, limitPct), limitPct };
    }
  }

  return { total, groups, weekSince: weekSinceDates[0] ?? null, cashToDeploy, largest, leveragedCluster };
}

/** Rows and symbol groups narrowed to one summary group (the tile filter). */
export function positionInSummaryGroup(position: Position, group: SummaryGroupKey | null): boolean {
  return group == null || summaryGroupForPosition(position) === group;
}
