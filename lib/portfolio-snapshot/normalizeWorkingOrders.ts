// lib/portfolio-snapshot/normalizeWorkingOrders.ts
//
// LCC-0001A PR 2 — working-order reservation normalization. Implements
// docs/design/LCC-0001A-technical-spec.md §7.
//
// Ports lib/scans/covered-call-capacity.ts's normalizeWorkingCallReservations() (lines 250-288 at
// the time this ticket was specified) verbatim, with zero behavior change -- same
// case/whitespace-insensitive status/action matching, same unattributable-exposure fail-closed
// behavior. This function already met every LCC-0001A requirement for working-order reservation
// as written; it becomes a snapshot-layer concern instead of a capacity-report-only concern.
//
// This module also exposes normalizeWorkingOrders(), which produces the WorkingOrder/
// WorkingOrderLeg (types.ts) normalized subset of the raw order/leg shape used by the rest of the
// snapshot layer -- raw broker field names never leak past this normalization boundary.

import { resolveOptionType, resolveUnderlyingSymbol } from '@/lib/optionSymbol';
import type { WorkingOrder, WorkingOrderLeg } from './types';

export interface RawOrderLegLike {
  'underlying-symbol'?: string;
  symbol?: string;
  action?: string; // 'Sell to Open' | 'Buy to Close' | 'Sell to Close' | 'Buy to Open' | ...
  'instrument-type'?: string;
  'option-type'?: string;
  quantity?: string | number;
  multiplier?: string | number;
  deliverable?: unknown;
}

export interface RawOrderLike {
  id?: string | number;
  status?: string; // 'Live' | 'Working' | 'Filled' | 'Cancelled' | 'Rejected' | 'Expired' | ...
  legs?: RawOrderLegLike[];
}

export interface WorkingCallReservationResult {
  bySymbol: Record<string, number>;
  // Same meaning as ShortCallExposureResult.unclassifiedSymbols, but for working sell-to-open
  // legs whose call/put type couldn't be determined.
  unclassifiedSymbols: Set<string>;
  // Same meaning as ShortCallExposureResult.hasUnattributableExposure, but for working
  // sell-to-open legs whose underlying could not be resolved at all. Only relevant, live/working,
  // sell-to-open, option-shaped legs are considered -- a malformed leg on a
  // cancelled/rejected/expired order, a buy-to-close leg, or a non-option leg never sets this.
  hasUnattributableExposure: boolean;
  warnings: string[];
  hasAdjustedOrUnknownDeliverable: boolean;
}

// Broker status/action strings are normalized case/whitespace-insensitively -- a real payload may
// return 'live', 'Live', or 'LIVE' depending on endpoint/account type, and this must not silently
// fail to match. The set of statuses/actions treated as "open"/"opens new exposure" is unchanged
// in meaning from the source module (Live or Working reserves; Sell to Open reserves, Buy to
// Close/anything else does not) -- only the matching itself is robust to formatting variants.
function normalizeToken(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}
const OPEN_ORDER_STATUSES = new Set(['live', 'working']);
const SELL_TO_OPEN_ACTION = 'sell to open';

// Only orders whose status is (case/whitespace-insensitively) 'Live' or 'Working' reserve
// capacity -- filled, cancelled, rejected, and expired orders never do (they're either already
// reflected in positions, or never happened). Only 'Sell to Open' call legs reserve NEW capacity;
// 'Buy to Close' legs (closing an existing short call) and every other action never reserve
// additional capacity. A leg whose call/put type can't be classified is conservatively reserved
// (never silently dropped) -- same rationale as normalizeShortCallExposure.
export function normalizeWorkingCallReservations(rawOrders: RawOrderLike[]): WorkingCallReservationResult {
  const out: Record<string, number> = {};
  const unclassifiedSymbols = new Set<string>();
  const warnings: string[] = [];
  let hasUnattributableExposure = false;
  let hasAdjustedOrUnknownDeliverable = false;

  for (const order of rawOrders) {
    if (!OPEN_ORDER_STATUSES.has(normalizeToken(order.status))) continue;

    for (const leg of order.legs ?? []) {
      if (normalizeToken(leg.action) !== SELL_TO_OPEN_ACTION) continue;
      const instrumentType = leg['instrument-type'];
      if (instrumentType && instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;

      const qty = Number(leg.quantity ?? 0);
      if (!(qty > 0)) continue; // not actually a working reservation -- irrelevant to attribution

      const multiplier = leg.multiplier == null ? 100 : Number(leg.multiplier);
      if (!Number.isFinite(multiplier) || multiplier !== 100 || leg.deliverable != null) {
        hasAdjustedOrUnknownDeliverable = true;
        warnings.push('Adjusted or unresolved working-order deliverable detected — Covered Call capacity cannot be safely verified.');
      }

      const symbol = resolveUnderlyingSymbol(leg['underlying-symbol'], leg.symbol);
      if (!symbol) {
        // A genuinely live/working sell-to-open, option-shaped leg with positive quantity that we
        // cannot attribute to any underlying. Same reasoning as the short-position case -- fail
        // closed rather than silently drop it.
        hasUnattributableExposure = true;
        warnings.push(
          `Working sell-to-open option order (symbol "${leg.symbol ?? 'unknown'}") could not be attributed to an underlying holding — Covered Call capacity cannot be safely verified.`,
        );
        continue;
      }

      const optionType = resolveOptionType(leg['option-type'], leg.symbol);
      if (optionType === 'P') continue; // confirmed put leg -- never reserves call capacity

      if (optionType === null) {
        unclassifiedSymbols.add(symbol);
      }

      out[symbol] = (out[symbol] ?? 0) + qty;
    }
  }
  return { bySymbol: out, unclassifiedSymbols, hasUnattributableExposure, hasAdjustedOrUnknownDeliverable, warnings };
}

/**
 * Normalizes raw broker working orders into the snapshot layer's WorkingOrder/WorkingOrderLeg
 * shape (types.ts) -- a narrow subset of the raw payload, carrying only the fields this module
 * and (in LCC-0001B) the coverage-reservation logic actually need. Raw broker field names never
 * leak past this function.
 */
export function normalizeWorkingOrders(
  rawOrders: RawOrderLike[],
  accountNumber: string,
): WorkingOrder[] {
  return rawOrders.map((order): WorkingOrder => ({
    accountNumber,
    orderId: order.id != null ? String(order.id) : null,
    status: order.status ?? '',
    legs: (order.legs ?? []).map((leg): WorkingOrderLeg => ({
      underlyingSymbol: leg['underlying-symbol'] ?? null,
      symbol: leg.symbol ?? null,
      action: leg.action ?? '',
      instrumentType: leg['instrument-type'] ?? null,
      optionType: resolveOptionType(leg['option-type'], leg.symbol),
      quantity: Number(leg.quantity ?? 0),
    })),
  }));
}
