// lib/scans/covered-call-capacity.ts
// TE-0007C — Covered Call as a first-class Screener strategy: holdings /
// capacity normalization. Pure, framework-free, no I/O — callers (the
// covered-call-capacity API route) fetch raw broker data and pass it in.
//
// Deliberately separate from covered-call-finder.ts (candidate selection).
// This module's only job is: given raw equity positions, raw option
// positions, and raw working orders, compute how many NEW covered-call
// contracts a symbol can safely support right now.

// ── Input shapes (structural — deliberately narrow, mirrors only the raw
//    broker fields this module reads) ────────────────────────────────────
export interface RawPositionLike {
  'instrument-type'?: string;
  'underlying-symbol'?: string;
  symbol?: string;
  'option-type'?: string;
  quantity?: string | number;
  'quantity-direction'?: string;
  'average-open-price'?: string | number;
}

export interface RawOrderLegLike {
  'underlying-symbol'?: string;
  symbol?: string;
  action?: string; // 'Sell to Open' | 'Buy to Close' | 'Sell to Close' | 'Buy to Open' | ...
  'instrument-type'?: string;
  'option-type'?: string;
  quantity?: string | number;
}

export interface RawOrderLike {
  status?: string; // 'Live' | 'Working' | 'Filled' | 'Cancelled' | 'Rejected' | 'Expired' | ...
  legs?: RawOrderLegLike[];
}

// ── Equity holdings normalization ──────────────────────────────────────────
export interface EquityHolding {
  sharesOwned: number;
  costBasis: number | null; // quantity-weighted average per-share, null if unknown
}

// Aggregates raw equity positions into shares-owned + weighted cost basis per
// symbol. Never counts short stock or non-positive quantities as coverage —
// only 'Equity' instrument-type, 'Long' direction, quantity > 0 contributes.
export function normalizeEquityHoldings(rawPositions: RawPositionLike[]): Record<string, EquityHolding> {
  const out: Record<string, { shares: number; costWeightedSum: number; costKnownShares: number }> = {};

  for (const p of rawPositions) {
    if (p['instrument-type'] !== 'Equity') continue;
    if (p['quantity-direction'] !== 'Long') continue; // short stock never creates coverage

    const symbol = p['underlying-symbol'] ?? p.symbol;
    if (!symbol) continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue; // invalid/zero/negative quantities never create coverage

    if (!out[symbol]) out[symbol] = { shares: 0, costWeightedSum: 0, costKnownShares: 0 };
    out[symbol].shares += qty;

    const rawCost = p['average-open-price'];
    const cost = rawCost != null ? Number(rawCost) : NaN;
    if (!isNaN(cost) && cost > 0) {
      out[symbol].costWeightedSum += cost * qty;
      out[symbol].costKnownShares += qty;
    }
  }

  const result: Record<string, EquityHolding> = {};
  for (const [symbol, agg] of Object.entries(out)) {
    result[symbol] = {
      sharesOwned: agg.shares,
      costBasis: agg.costKnownShares > 0 ? agg.costWeightedSum / agg.costKnownShares : null,
    };
  }
  return result;
}

// ── Existing short-call exposure ───────────────────────────────────────────
// Sums OPEN short equity/index call contracts per underlying symbol. Long
// calls never consume coverage (they don't create it either — that's a
// separate, deliberate omission). Short puts are filtered out by the
// option-type check, so they can never consume call coverage.
export function normalizeShortCallExposure(rawPositions: RawPositionLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of rawPositions) {
    const instrumentType = p['instrument-type'];
    if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
    if (p['option-type'] !== 'C') continue;
    if (p['quantity-direction'] !== 'Short') continue;

    const symbol = p['underlying-symbol'];
    if (!symbol) continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue;

    out[symbol] = (out[symbol] ?? 0) + qty;
  }
  return out;
}

// ── Working sell-to-open call reservations ─────────────────────────────────
// Only orders whose status is 'Live' or 'Working' reserve capacity — filled,
// cancelled, rejected, and expired orders never do (they're either already
// reflected in positions, or never happened). Only 'Sell to Open' call legs
// reserve NEW capacity; 'Buy to Close' legs (closing an existing short call)
// never reserve additional capacity.
export function normalizeWorkingCallReservations(rawOrders: RawOrderLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  const OPEN_STATUSES = new Set(['Live', 'Working']);

  for (const order of rawOrders) {
    if (!order.status || !OPEN_STATUSES.has(order.status)) continue;

    for (const leg of order.legs ?? []) {
      if (leg.action !== 'Sell to Open') continue;
      const instrumentType = leg['instrument-type'];
      if (instrumentType && instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
      if (leg['option-type'] !== 'C') continue;

      const symbol = leg['underlying-symbol'] ?? leg.symbol?.split(' ')[0];
      if (!symbol) continue;

      const qty = Number(leg.quantity ?? 0);
      if (!(qty > 0)) continue;

      out[symbol] = (out[symbol] ?? 0) + qty;
    }
  }
  return out;
}

// ── Capacity calculation ────────────────────────────────────────────────────
export interface CoveredCallCapacity {
  sharesOwned: number;
  costBasis: number | null;
  grossCoveredContracts: number;
  existingShortCallContracts: number;
  workingShortCallContracts: number;
  availableCoveredContracts: number; // clamped to >= 0
  oversubscribed: boolean; // true when existing + working exceeds gross capacity
}

export function computeCoveredCallCapacity(
  sharesOwned: number,
  existingShortCallContracts: number,
  workingShortCallContracts: number,
  costBasis: number | null = null,
): CoveredCallCapacity {
  const grossCoveredContracts = Math.floor(Math.max(0, sharesOwned) / 100);
  const rawAvailable = grossCoveredContracts - existingShortCallContracts - workingShortCallContracts;

  return {
    sharesOwned,
    costBasis,
    grossCoveredContracts,
    existingShortCallContracts,
    workingShortCallContracts,
    availableCoveredContracts: Math.max(0, rawAvailable),
    oversubscribed: rawAvailable < 0,
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────
export type CapacityDataStatus = 'ok' | 'unavailable';

export interface CoveredCallCapacityReport {
  status: CapacityDataStatus;
  bySymbol: Record<string, CoveredCallCapacity>;
}

// Combines the three normalizers into a per-symbol capacity map. Returns
// status:'unavailable' (not a zero-filled map) when either input is null —
// per the ticket: "If holdings or working-order data cannot be loaded
// reliably, return an unavailable/error state. Do not assume coverage."
export function buildCoveredCallCapacityReport(
  rawPositions: RawPositionLike[] | null,
  rawOrders: RawOrderLike[] | null,
): CoveredCallCapacityReport {
  if (rawPositions == null || rawOrders == null) {
    return { status: 'unavailable', bySymbol: {} };
  }

  const holdings = normalizeEquityHoldings(rawPositions);
  const shortCalls = normalizeShortCallExposure(rawPositions);
  const workingCalls = normalizeWorkingCallReservations(rawOrders);

  const symbols = new Set([...Object.keys(holdings), ...Object.keys(shortCalls), ...Object.keys(workingCalls)]);
  const bySymbol: Record<string, CoveredCallCapacity> = {};

  for (const symbol of Array.from(symbols)) {
    const holding = holdings[symbol] ?? { sharesOwned: 0, costBasis: null };
    bySymbol[symbol] = computeCoveredCallCapacity(
      holding.sharesOwned,
      shortCalls[symbol] ?? 0,
      workingCalls[symbol] ?? 0,
      holding.costBasis,
    );
  }

  return { status: 'ok', bySymbol };
}
