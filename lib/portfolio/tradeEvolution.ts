// lib/portfolio/tradeEvolution.ts

// TRADE-EVOLUTION-CARDS-0001: the Trade Evolution entry -> now formatters and colour rules, moved VERBATIM out of
// app/portfolio/page.tsx so the legacy PositionCard and the Cards view share one definition (page.tsx may only export page names).
// Behaviour is unchanged; display only.

import type { Position } from '@/lib/portfolio-data/types';
import { computeEntryChangeTone } from '@/lib/portfolio/positionMetrics';
import { netEdgeFrom, normalizePercentValue } from '@/lib/portfolio-data/acquisition';

export function fmtEntryNowPct(entry: number | null | undefined, current: number | null | undefined, digits = 0): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${entry.toFixed(digits)}→${current.toFixed(digits)}%`;
}

export function fmtEntryNowDelta(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${(entry * 100).toFixed(0)}→${(current * 100).toFixed(0)} sh-eq`;
}

export function fmtEntryNowTheta(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${(entry * 100).toFixed(0)}→${(current * 100).toFixed(0)}/d`;
}

export function fmtEntryNowDte(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${entry.toFixed(0)}→${current.toFixed(0)}d`;
}

export function fmtEntryNowGamma(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${Math.abs(entry).toFixed(3)}→${Math.abs(current).toFixed(3)}`;
}

export function fmtEntryNowVega(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  const sign = (v: number) => (v >= 0 ? '+' : '-');
  return `${sign(entry)}${Math.abs(entry).toFixed(2)}→${sign(current)}${Math.abs(current).toFixed(2)}`;
}

export function fmtEntryNowNetEdge(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  const sign = (v: number) => (v >= 0 ? '+' : '-');
  return `${sign(entry)}$${Math.abs(entry).toFixed(0)}→${sign(current)}$${Math.abs(current).toFixed(0)}/d`;
}

export function fmtEntryNowMaybePct(entry: number | null | undefined, current: number | null | undefined, digits = 0): string {
  const e = normalizePercentValue(entry);
  const c = normalizePercentValue(current);
  if (e == null || c == null) return '—';
  return `${e.toFixed(digits)}→${c.toFixed(digits)}%`;
}

export function fmtEntryNowIvr(entry: number | null | undefined, current: number | null | undefined): string {
  if (entry == null || current == null || !Number.isFinite(entry) || !Number.isFinite(current)) return '—';
  return `${entry.toFixed(0)}→${current.toFixed(0)}`;
}

// PM-0001: the favorable/unfavorable direction judgment itself lives in
// lib/portfolio/positionMetrics.ts's computeEntryChangeTone (pure,
// unit-tested); this wrapper only maps that tone to a CSS class.
export function entryChangeColor(entry: number | null | undefined, current: number | null | undefined, goodWhenDown = true, fallback = 'text-slate-500'): string {
  const tone = computeEntryChangeTone(entry, current, goodWhenDown);
  if (tone === 'neutral') return fallback;
  return tone === 'good' ? 'text-emerald-400' : 'text-red-400';
}

// ── Buffer Color Helpers ──
export function bufferColor(buffer: number | null, dte: number): string {
  if (buffer == null) return 'text-[#808080]';

  // Breached or effectively at the short strike is the only true red condition.
  if (buffer <= 0) return 'text-red-400';

  // DTE-aware coloring: the same buffer is less dangerous with fewer days remaining.
  // Short-dated positions should warn, not panic, unless the strike is breached.
  if (dte <= 7) {
    if (buffer < 1) return 'text-orange-400';
    if (buffer < 2) return 'text-yellow-400';
    return 'text-emerald-400';
  }
  if (dte <= 21) {
    if (buffer < 1) return 'text-orange-400';
    if (buffer < 2) return 'text-yellow-400';
    if (buffer < 3) return 'text-yellow-400';
    return 'text-emerald-400';
  }
  if (dte <= 30) {
    if (buffer < 1) return 'text-red-400';
    if (buffer < 2) return 'text-orange-400';
    if (buffer < 3) return 'text-yellow-400';
    if (buffer < 5) return 'text-yellow-400';
    return 'text-emerald-400';
  }

  // Longer-dated positions need a wider cushion because there is more time to move.
  if (buffer < 1) return 'text-red-400';
  if (buffer < 2) return 'text-orange-400';
  if (buffer < 5) return 'text-yellow-400';
  return 'text-emerald-400';
}

// Requires all four at-entry values (theta/gamma/iv/stockPrice) — older
// snapshots captured before this fix won't have gamma/stockPrice at entry,
// so this correctly returns null rather than a partial/misleading figure.
export function netEdgeAtEntry(pos: Position): number | null {
  return netEdgeFrom(pos.thetaAtEntry ?? null, pos.gammaAtEntry ?? null, pos.ivAtEntry ?? null, pos.stockPriceAtEntry ?? null);
}
