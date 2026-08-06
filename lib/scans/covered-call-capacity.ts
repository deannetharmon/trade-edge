// lib/scans/covered-call-capacity.ts
// TE-0007C — Covered Call as a first-class Screener strategy: holdings /
// capacity normalization. Pure, framework-free, no I/O — callers (the
// covered-call-capacity API route) fetch raw broker data and pass it in.
//
// Deliberately separate from covered-call-finder.ts (candidate selection).
// This module's only job is: given raw equity positions, raw option
// positions, and raw working orders, compute how many NEW covered-call
// contracts a symbol can safely support right now.
//
// TE-0007C corrective round: the original delivery assumed raw broker
// position/order-leg payloads reliably carry an `option-type` field and a
// clean `underlying-symbol` split off the OCC symbol. Neither assumption is
// safe — lib/portfolio-data/acquisition.ts's own position-loading path
// already derives call/put from the OCC symbol for exactly this reason (see
// lib/optionSymbol.ts's module doc). This round fixes three real
// naked-call-risk gaps that idealized test fixtures had hidden:
//   1. An existing short call with no (or unreliable) `option-type` field
//      was silently counted as zero exposure, overstating capacity.
//   2. A working sell-to-open call order with no `option-type` field on its
//      leg was silently not reserved, allowing the same shares to be
//      double-counted as available.
//   3. Cost basis was computed as a weighted average over only the LOTS
//      with known basis, then silently applied as if it covered every
//      share — a partial basis was presented as a complete one.

import { resolveOptionType, resolveUnderlyingSymbol } from '@/lib/optionSymbol';

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
  // TE-0007C corrective round: null unless EVERY contributing lot for this
  // symbol has a valid cost basis. A partial basis (some lots known, some
  // not) must never be silently presented as if it covers the whole
  // holding — see costBasisComplete for the diagnostic reason why.
  costBasis: number | null;
  // True only when sharesOwned > 0 and every contributing lot had a valid,
  // positive average-open-price. False when at least one lot's basis was
  // missing/invalid, OR when there are no shares at all. Callers should
  // treat costBasisComplete === false as "cost basis unavailable/
  // incomplete" — never partially apply the known-lot average in that case.
  costBasisComplete: boolean;
}

// Aggregates raw equity positions into shares-owned + weighted cost basis per
// symbol. Never counts short stock or non-positive quantities as coverage —
// only 'Equity' instrument-type, 'Long' direction, quantity > 0 contributes.
export function normalizeEquityHoldings(rawPositions: RawPositionLike[]): Record<string, EquityHolding> {
  const out: Record<string, { shares: number; costWeightedSum: number; costKnownShares: number; anyLotMissingBasis: boolean }> = {};

  for (const p of rawPositions) {
    if (p['instrument-type'] !== 'Equity') continue;
    if (p['quantity-direction'] !== 'Long') continue; // short stock never creates coverage

    const symbol = p['underlying-symbol'] ?? p.symbol;
    if (!symbol) continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue; // invalid/zero/negative quantities never create coverage

    if (!out[symbol]) out[symbol] = { shares: 0, costWeightedSum: 0, costKnownShares: 0, anyLotMissingBasis: false };
    out[symbol].shares += qty;

    const rawCost = p['average-open-price'];
    const cost = rawCost != null ? Number(rawCost) : NaN;
    if (!isNaN(cost) && cost > 0) {
      out[symbol].costWeightedSum += cost * qty;
      out[symbol].costKnownShares += qty;
    } else {
      // This lot contributes shares but has no usable basis — the aggregate
      // basis for this symbol can no longer be treated as complete, even
      // though other lots do have valid basis values.
      out[symbol].anyLotMissingBasis = true;
    }
  }

  const result: Record<string, EquityHolding> = {};
  for (const [symbol, agg] of Object.entries(out)) {
    const complete = agg.shares > 0 && !agg.anyLotMissingBasis && agg.costKnownShares === agg.shares;
    result[symbol] = {
      sharesOwned: agg.shares,
      // TE-0007C corrective round: previously `agg.costKnownShares > 0 ? avg
      // : null` — a partial basis (e.g. 100sh known + 100sh unknown) was
      // returned as if it applied to all 200 shares. Now null unless
      // `complete` — a partial basis is exactly as unusable for
      // strike-vs-basis qualification as a fully unknown one.
      costBasis: complete ? agg.costWeightedSum / agg.costKnownShares : null,
      costBasisComplete: complete,
    };
  }
  return result;
}

// ── Existing short-call exposure ───────────────────────────────────────────
export interface ShortCallExposureResult {
  bySymbol: Record<string, number>;
  // TE-0007C corrective round: symbols carrying at least one SHORT option
  // position whose call/put classification could not be determined from
  // either an explicit, valid `option-type` field or the OCC symbol. Its
  // quantity IS still folded into bySymbol above (conservatively treated as
  // a call, so exposure/capacity can never be overstated by an
  // unclassifiable position) — this set exists so callers/UI can flag "some
  // positions could not be verified" rather than silently trusting a number
  // that is safe-by-construction but not a confirmed fact.
  unclassifiedSymbols: Set<string>;
}

// Sums OPEN short equity/index call contracts per underlying symbol. Long
// calls never consume coverage (they don't create it either — that's a
// separate, deliberate omission). A genuinely-classified short PUT is
// filtered out (it can never consume call coverage); a short option whose
// type can't be classified at all is conservatively counted AS a call,
// never silently treated as zero — see resolveOptionType's doc comment for
// why raw broker `option-type` cannot be trusted to always be present.
export function normalizeShortCallExposure(rawPositions: RawPositionLike[]): ShortCallExposureResult {
  const out: Record<string, number> = {};
  const unclassifiedSymbols = new Set<string>();

  for (const p of rawPositions) {
    const instrumentType = p['instrument-type'];
    if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
    if (p['quantity-direction'] !== 'Short') continue;

    const symbol = resolveUnderlyingSymbol(p['underlying-symbol'], p.symbol);
    if (!symbol) continue; // no way to attribute this position to any underlying at all

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue;

    const optionType = resolveOptionType(p['option-type'], p.symbol);
    if (optionType === 'P') continue; // confirmed put — never consumes call coverage

    if (optionType === null) {
      // Neither the broker's option-type field nor the OCC symbol could
      // classify this short option. Reserve it conservatively (as a call)
      // rather than silently ignoring it — an unclassifiable short option
      // must never leave capacity looking available when it might not be.
      unclassifiedSymbols.add(symbol);
    }

    out[symbol] = (out[symbol] ?? 0) + qty;
  }
  return { bySymbol: out, unclassifiedSymbols };
}

// ── Working sell-to-open call reservations ─────────────────────────────────
export interface WorkingCallReservationResult {
  bySymbol: Record<string, number>;
  // Same meaning as ShortCallExposureResult.unclassifiedSymbols, but for
  // working sell-to-open legs whose call/put type couldn't be determined.
  unclassifiedSymbols: Set<string>;
}

// TE-0007C corrective round: broker status/action strings are normalized
// case/whitespace-insensitively — a real payload may return 'live', 'Live',
// or 'LIVE' depending on endpoint/account type, and this must not silently
// fail to match. The set of statuses/actions treated as "open"/"opens new
// exposure" is unchanged in MEANING from the original delivery (Live or
// Working reserves; Sell to Open reserves, Buy to Close/anything else does
// not) — only the matching itself is made robust to formatting variants.
function normalizeToken(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}
const OPEN_ORDER_STATUSES = new Set(['live', 'working']);
const SELL_TO_OPEN_ACTION = 'sell to open';

// Only orders whose status is (case/whitespace-insensitively) 'Live' or
// 'Working' reserve capacity — filled, cancelled, rejected, and expired
// orders never do (they're either already reflected in positions, or never
// happened). Only 'Sell to Open' call legs reserve NEW capacity; 'Buy to
// Close' legs (closing an existing short call) and every other action never
// reserve additional capacity. A leg whose call/put type can't be
// classified is conservatively reserved (never silently dropped) — see
// normalizeShortCallExposure's identical rationale above.
export function normalizeWorkingCallReservations(rawOrders: RawOrderLike[]): WorkingCallReservationResult {
  const out: Record<string, number> = {};
  const unclassifiedSymbols = new Set<string>();

  for (const order of rawOrders) {
    if (!OPEN_ORDER_STATUSES.has(normalizeToken(order.status))) continue;

    for (const leg of order.legs ?? []) {
      if (normalizeToken(leg.action) !== SELL_TO_OPEN_ACTION) continue;
      const instrumentType = leg['instrument-type'];
      if (instrumentType && instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;

      const symbol = resolveUnderlyingSymbol(leg['underlying-symbol'], leg.symbol);
      if (!symbol) continue;

      const qty = Number(leg.quantity ?? 0);
      if (!(qty > 0)) continue;

      const optionType = resolveOptionType(leg['option-type'], leg.symbol);
      if (optionType === 'P') continue; // confirmed put leg — never reserves call capacity

      if (optionType === null) {
        unclassifiedSymbols.add(symbol);
      }

      out[symbol] = (out[symbol] ?? 0) + qty;
    }
  }
  return { bySymbol: out, unclassifiedSymbols };
}

// ── Capacity calculation ────────────────────────────────────────────────────
export interface CoveredCallCapacity {
  sharesOwned: number;
  costBasis: number | null;
  // TE-0007C corrective round: surfaces the completeness gate from
  // EquityHolding.costBasisComplete so callers (covered-call-finder.ts, the
  // UI) never have to re-derive "is this basis trustworthy" themselves —
  // costBasis is already null whenever this is false, but the explicit flag
  // makes the reason legible rather than implicit.
  costBasisComplete: boolean;
  grossCoveredContracts: number;
  existingShortCallContracts: number;
  workingShortCallContracts: number;
  availableCoveredContracts: number; // clamped to >= 0
  oversubscribed: boolean; // true when existing + working exceeds gross capacity
  // TE-0007C corrective round: true when at least one existing short option
  // position or working sell-to-open leg for this symbol could not be
  // classified as call/put (see ShortCallExposureResult/
  // WorkingCallReservationResult.unclassifiedSymbols). The exposure IS
  // already conservatively folded into existingShortCallContracts/
  // workingShortCallContracts above — this flag is diagnostic, so callers
  // can warn "some positions could not be fully verified" rather than
  // silently presenting availableCoveredContracts as a fully-confirmed
  // number.
  hasUnclassifiedExposure: boolean;
}

export function computeCoveredCallCapacity(
  sharesOwned: number,
  existingShortCallContracts: number,
  workingShortCallContracts: number,
  costBasis: number | null = null,
  costBasisComplete: boolean = costBasis != null,
  hasUnclassifiedExposure: boolean = false,
): CoveredCallCapacity {
  const grossCoveredContracts = Math.floor(Math.max(0, sharesOwned) / 100);
  const rawAvailable = grossCoveredContracts - existingShortCallContracts - workingShortCallContracts;

  return {
    sharesOwned,
    costBasis,
    costBasisComplete,
    grossCoveredContracts,
    existingShortCallContracts,
    workingShortCallContracts,
    availableCoveredContracts: Math.max(0, rawAvailable),
    oversubscribed: rawAvailable < 0,
    hasUnclassifiedExposure,
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
  const shortCallResult = normalizeShortCallExposure(rawPositions);
  const workingCallResult = normalizeWorkingCallReservations(rawOrders);
  const shortCalls = shortCallResult.bySymbol;
  const workingCalls = workingCallResult.bySymbol;

  const symbols = new Set([...Object.keys(holdings), ...Object.keys(shortCalls), ...Object.keys(workingCalls)]);
  const bySymbol: Record<string, CoveredCallCapacity> = {};

  for (const symbol of Array.from(symbols)) {
    const holding = holdings[symbol] ?? { sharesOwned: 0, costBasis: null, costBasisComplete: false };
    const hasUnclassifiedExposure =
      shortCallResult.unclassifiedSymbols.has(symbol) || workingCallResult.unclassifiedSymbols.has(symbol);
    bySymbol[symbol] = computeCoveredCallCapacity(
      holding.sharesOwned,
      shortCalls[symbol] ?? 0,
      workingCalls[symbol] ?? 0,
      holding.costBasis,
      holding.costBasisComplete,
      hasUnclassifiedExposure,
    );
  }

  return { status: 'ok', bySymbol };
}
