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
//
// TE-0007C final corrective pass: the round above still had one open gap —
// when an existing short option or working sell-to-open leg could not be
// attributed to ANY underlying at all (no usable underlying-symbol field AND
// an absent/malformed/unparseable OCC symbol), the position/leg was silently
// `continue`d out of the aggregation entirely. That is categorically
// different from "underlying known, option type unknown" (which is safe to
// handle by conservative per-symbol reservation, see unclassifiedSymbols
// below): if we don't even know WHICH holding a short option belongs to, no
// amount of per-symbol conservatism helps — the capacity number for every
// OTHER symbol in the account could still be wrong if this exposure secretly
// belongs to one of them. The only safe response is to fail the entire
// report closed (status: 'unavailable') and block CC scanning account-wide
// until the exposure is resolved, rather than silently reporting some
// symbols as scannable while an unattributed short option lurks unseen.

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
  // TE-0007C final corrective pass: true when at least one OPEN short option
  // position (instrument-type option, quantity-direction Short, quantity >
  // 0) could not be attributed to ANY underlying symbol at all — neither a
  // usable underlying-symbol field nor a parseable OCC symbol. Unlike
  // unclassifiedSymbols (underlying known, type unknown — safe to reserve
  // conservatively), this case means we don't know WHICH symbol's capacity
  // is affected, so no per-symbol fix is safe. bySymbol deliberately does
  // NOT include this position's quantity anywhere — the caller must fail
  // the whole report closed instead.
  hasUnattributableExposure: boolean;
  // Human-readable diagnostics for the unattributable case, suitable for
  // logs and (via the report-level unavailableReason) the UI.
  warnings: string[];
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
  const warnings: string[] = [];
  let hasUnattributableExposure = false;

  for (const p of rawPositions) {
    const instrumentType = p['instrument-type'];
    if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
    if (p['quantity-direction'] !== 'Short') continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue; // not actually open exposure — irrelevant to attribution

    const symbol = resolveUnderlyingSymbol(p['underlying-symbol'], p.symbol);
    if (!symbol) {
      // TE-0007C final corrective pass: this is a genuinely OPEN short
      // option (confirmed instrument type, Short direction, positive
      // quantity) with no usable underlying-symbol field AND an
      // unparseable/absent OCC symbol. We cannot know which holding's
      // capacity this affects, so it must never be silently dropped —
      // fail the whole report closed instead of continuing past it.
      hasUnattributableExposure = true;
      warnings.push(
        `Existing short option position (symbol "${p.symbol ?? 'unknown'}") could not be attributed to an underlying holding — Covered Call capacity cannot be safely verified.`,
      );
      continue; // still never fold an unattributable qty into any symbol's bySymbol
    }

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
  return { bySymbol: out, unclassifiedSymbols, hasUnattributableExposure, warnings };
}

// ── Working sell-to-open call reservations ─────────────────────────────────
export interface WorkingCallReservationResult {
  bySymbol: Record<string, number>;
  // Same meaning as ShortCallExposureResult.unclassifiedSymbols, but for
  // working sell-to-open legs whose call/put type couldn't be determined.
  unclassifiedSymbols: Set<string>;
  // Same meaning as ShortCallExposureResult.hasUnattributableExposure, but
  // for working sell-to-open legs whose underlying could not be resolved at
  // all. Only relevant, live/working, sell-to-open, option-shaped legs are
  // considered — a malformed leg on a cancelled/rejected/expired order, a
  // buy-to-close leg, or a non-option leg never sets this.
  hasUnattributableExposure: boolean;
  warnings: string[];
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
  const warnings: string[] = [];
  let hasUnattributableExposure = false;

  for (const order of rawOrders) {
    if (!OPEN_ORDER_STATUSES.has(normalizeToken(order.status))) continue;

    for (const leg of order.legs ?? []) {
      if (normalizeToken(leg.action) !== SELL_TO_OPEN_ACTION) continue;
      const instrumentType = leg['instrument-type'];
      if (instrumentType && instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;

      const qty = Number(leg.quantity ?? 0);
      if (!(qty > 0)) continue; // not actually a working reservation — irrelevant to attribution

      const symbol = resolveUnderlyingSymbol(leg['underlying-symbol'], leg.symbol);
      if (!symbol) {
        // TE-0007C final corrective pass: a genuinely live/working
        // sell-to-open, option-shaped leg with positive quantity that we
        // cannot attribute to any underlying. Same reasoning as the short-
        // position case above — fail closed rather than silently drop it.
        hasUnattributableExposure = true;
        warnings.push(
          `Working sell-to-open option order (symbol "${leg.symbol ?? 'unknown'}") could not be attributed to an underlying holding — Covered Call capacity cannot be safely verified.`,
        );
        continue;
      }

      const optionType = resolveOptionType(leg['option-type'], leg.symbol);
      if (optionType === 'P') continue; // confirmed put leg — never reserves call capacity

      if (optionType === null) {
        unclassifiedSymbols.add(symbol);
      }

      out[symbol] = (out[symbol] ?? 0) + qty;
    }
  }
  return { bySymbol: out, unclassifiedSymbols, hasUnattributableExposure, warnings };
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
  // TE-0007C final corrective pass: account-level diagnostics. warnings is
  // always present (possibly empty); unavailableReason is set only when
  // status === 'unavailable' and carries a message suitable for direct UI
  // display (see app/screener/page.tsx's blocking-message rendering) — not
  // just logs.
  warnings: string[];
  unavailableReason?: string;
}

// TE-0007C final corrective pass: the exact, UI-facing reason shown when
// open option exposure exists that cannot be matched to any underlying
// holding. Kept as a single exported constant so the capacity module and
// the UI never risk drifting out of sync on this specific wording.
export const UNATTRIBUTABLE_EXPOSURE_REASON =
  'Covered Call scan unavailable: open option exposure could not be matched to an underlying holding.';

// Combines the three normalizers into a per-symbol capacity map. Returns
// status:'unavailable' (not a zero-filled map) when either input is null —
// per the ticket: "If holdings or working-order data cannot be loaded
// reliably, return an unavailable/error state. Do not assume coverage." Also
// returns status:'unavailable' when any existing short option or working
// sell-to-open leg could not be attributed to ANY underlying at all — see
// the module doc's "final corrective pass" note for why this must fail the
// ENTIRE report closed rather than only the affected symbol: an
// unattributed short option might secretly belong to any holding in the
// account, so no other symbol's capacity can be trusted either until it's
// resolved. No holding is scanned in this state.
export function buildCoveredCallCapacityReport(
  rawPositions: RawPositionLike[] | null,
  rawOrders: RawOrderLike[] | null,
): CoveredCallCapacityReport {
  if (rawPositions == null || rawOrders == null) {
    return { status: 'unavailable', bySymbol: {}, warnings: [] };
  }

  const holdings = normalizeEquityHoldings(rawPositions);
  const shortCallResult = normalizeShortCallExposure(rawPositions);
  const workingCallResult = normalizeWorkingCallReservations(rawOrders);

  if (shortCallResult.hasUnattributableExposure || workingCallResult.hasUnattributableExposure) {
    return {
      status: 'unavailable',
      bySymbol: {},
      warnings: [...shortCallResult.warnings, ...workingCallResult.warnings],
      unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON,
    };
  }

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

  return { status: 'ok', bySymbol, warnings: [] };
}
