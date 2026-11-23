// features/portfolio/positions-workspace/model/tradeEvolutionModel.ts

// TRADE-EVOLUTION-CARDS-0001: the entry -> now panel on the Cards view ("Show detail"). Pure view model: it reads the same Position fields
// the legacy PositionCard's Trade Evolution block reads, with the same formatters (lib/portfolio/tradeEvolution.ts) and the same
// favourable / unfavourable rules, and decides nothing about scoring, verdicts or orders. Display only.
//
// Strategy-aware colour (Ian, 2026-11-23):
//  * Credit positions: the old rules. Shrinking |delta| / |gamma| / |vega|, falling IV / IVR, rising theta and POP are favourable.
//  * Debit positions (LEAPS, PMCC, bought options): colour is "moved toward profit". Growing |delta|, |gamma|, |vega|, IV, IVR and POP are
//    green; decay getting costlier (theta) is red. Plus a "Hope" line: the move still needed to break even, now vs at open, and the model chance.
//    No OTM tile and no Theta-Gamma strip (those are short-leg measures).
//  * Gamma worsening reads amber only inside 21 DTE, and never on CSP / CC (assignment is an accepted outcome there).
//  * RSI of the underlying is always gray: its direction is not good or bad on its own.

import type { Position } from '@/lib/portfolio-data/types';
import { getCurrentPop, netEdgeDayChangePct, netEdgeDaysTracked, netEdgeLive, netEdgePeak, netEdgeRolledOver, normalizePercentValue } from '@/lib/portfolio-data/acquisition';
import { computeEntryChangeTone } from '@/lib/portfolio/positionMetrics';
import { bufferColor, fmtEntryNowDelta, fmtEntryNowDte, fmtEntryNowGamma, fmtEntryNowIvr, fmtEntryNowMaybePct, fmtEntryNowNetEdge, fmtEntryNowPct, fmtEntryNowTheta, fmtEntryNowVega, netEdgeAtEntry } from '@/lib/portfolio/tradeEvolution';
import { structuralChipOf } from './strategyChips';
import { buildLongOptionPath } from './longOptionPath';

export type EvoTone = 'good' | 'bad' | 'warn' | 'neutral';
export type EvoTileId = 'pop' | 'delta' | 'theta' | 'gamma' | 'vega' | 'otm' | 'iv' | 'ivr' | 'dte' | 'rsi';
export interface EvoTile { id: EvoTileId; label: string; value: string; tone: EvoTone }
export interface EvoStrip {
  /** Entry -> now, e.g. "+$4→+$6/d". */
  value: string;
  /** Day-over-day change vs yesterday, or null on a new baseline. */
  change: { pct: number; up: boolean } | null;
  rolledOver: boolean;
  /** Peak net edge in whole dollars, or null. */
  peak: number | null;
  daysTracked: number;
}
export interface EvoHope {
  /** Percent the stock still has to move to reach the expiration breakeven (negative = already past it). */
  neededNow: number;
  /** Same move measured from the stock price at open, or null when that price was not captured. */
  neededAtOpen: number | null;
  /** Model chance (0..1) of finishing past breakeven, or null. */
  chance: number | null;
  pastBreakeven: boolean;
}
export interface TradeEvolution {
  /** Debit positions only: is there still a path to profit. */
  hope: EvoHope | null;
  /** YYYY-MM-DD the baseline was first tracked, or null. */
  since: string | null;
  tiles: EvoTile[];
  strip: EvoStrip | null;
}
export interface EvoRsi {
  /** Daily RSI of the underlying on the last completed bar, or null. */
  now: number | null;
  /** Daily RSI on the position's open date, or null when outside the loaded window. */
  atOpen: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const abs = (v: number | null | undefined): number | null => (finite(v) ? Math.abs(v) : null);

/** The open date (YYYY-MM-DD) RSI is read at: the first leg's broker open time (the same date the LEAP chips use), else the position's entry date. */
export function openDateOf(p: Position): string | null {
  const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return isoDay(p.legs?.[0]?.openedAt) ?? isoDay(p.entryDate);
}

function bufferTone(buffer: number | null | undefined, dte: number): EvoTone {
  const cls = bufferColor(finite(buffer) ? buffer : null, dte);
  if (cls.includes('emerald')) return 'good';
  if (cls.includes('red')) return 'bad';
  if (cls.includes('orange') || cls.includes('yellow')) return 'warn';
  return 'neutral';
}

export function buildTradeEvolution(p: Position, rsi: EvoRsi): TradeEvolution {
  const credit = p.entryPriceEffect === 'Credit';
  const structure = structuralChipOf(p);
  const quietGamma = structure === 'csp' || structure === 'cc' || !(finite(p.dte) && p.dte <= 21);
  const tone = (entry: number | null | undefined, now: number | null | undefined, goodWhenDown: boolean): EvoTone => computeEntryChangeTone(entry, now, goodWhenDown);
  // Credit: shrinking exposure is favourable. Debit (you own the option): growing exposure and richer IV move toward profit, so the rule flips.
  const greek = (entry: number | null | undefined, now: number | null | undefined, abs_: boolean): EvoTone =>
    tone(abs_ ? abs(entry) : entry, abs_ ? abs(now) : now, credit);
  const ivTone = (entry: number | null | undefined, now: number | null | undefined): EvoTone => tone(entry, now, credit);

  const popNow = getCurrentPop(p);
  const gammaTone = greek(p.gammaAtEntry, p.gamma, true);
  const rsiValue = rsi.now == null ? '—' : `${rsi.atOpen == null ? '—' : Math.round(rsi.atOpen)}→${Math.round(rsi.now)}`;

  const tiles: EvoTile[] = [
    { id: 'pop', label: 'POP', value: fmtEntryNowMaybePct(p.popAtEntry, popNow, 0), tone: tone(normalizePercentValue(p.popAtEntry), popNow, false) },
    { id: 'delta', label: 'Delta', value: fmtEntryNowDelta(p.deltaAtEntry, p.netDelta), tone: greek(p.deltaAtEntry, p.netDelta, true) },
    { id: 'theta', label: 'Theta', value: fmtEntryNowTheta(p.thetaAtEntry, p.theta), tone: greek(p.thetaAtEntry, p.theta, false) },
    { id: 'gamma', label: 'Gamma', value: fmtEntryNowGamma(p.gammaAtEntry, p.gamma), tone: credit && gammaTone === 'bad' ? (quietGamma ? 'neutral' : 'warn') : gammaTone },
    { id: 'vega', label: 'Vega', value: fmtEntryNowVega(p.vegaAtEntry, p.netVega), tone: greek(p.vegaAtEntry, p.netVega, true) },
  ];
  if (credit) tiles.push({ id: 'otm', label: 'OTM', value: fmtEntryNowPct(p.otmAtEntry, p.buffer, 1), tone: bufferTone(p.buffer, p.dte) });
  tiles.push(
    { id: 'iv', label: 'IV', value: fmtEntryNowPct(p.ivAtEntry, p.iv, 0), tone: ivTone(p.ivAtEntry, p.iv) },
    { id: 'ivr', label: 'IVR', value: fmtEntryNowIvr(p.ivrAtEntry, p.ivr), tone: ivTone(p.ivrAtEntry, p.ivr) },
    { id: 'dte', label: 'DTE', value: fmtEntryNowDte(p.dteAtEntry ?? p.entryDte, p.dte), tone: 'neutral' },
    { id: 'rsi', label: 'RSI (daily)', value: rsiValue, tone: 'neutral' },
  );

  let strip: EvoStrip | null = null;
  if (credit) {
    const live = netEdgeLive(p);
    if (live != null) {
      const chg = netEdgeDayChangePct(p);
      strip = {
        value: fmtEntryNowNetEdge(netEdgeAtEntry(p), live),
        change: chg == null ? null : { pct: Math.abs(chg), up: chg >= 0 },
        rolledOver: netEdgeRolledOver(p),
        peak: netEdgePeak(p),
        daysTracked: netEdgeDaysTracked(p),
      };
    }
  }

  let hope: EvoHope | null = null;
  if (!credit) {
    const path = buildLongOptionPath(p);
    if (path) {
      const open = p.stockPriceAtEntry;
      hope = {
        neededNow: path.neededMovePct,
        neededAtOpen: finite(open) && open > 0 ? ((path.breakeven / open) - 1) * 100 * (path.kind === 'P' ? -1 : 1) : null,
        chance: path.probability ?? null,
        pastBreakeven: path.pastBreakeven,
      };
    }
  }

  const since = typeof p.entrySnapshotCreatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.entrySnapshotCreatedAt) ? p.entrySnapshotCreatedAt.slice(0, 10) : null;
  return { since, tiles, strip, hope };
}
