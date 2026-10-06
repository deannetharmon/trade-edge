// lib/portfolio/existingGtcReplacement.ts

import type { StopAssessment, StopLossPolicy } from '@/lib/portfolio/stopLossPolicy';

export interface ReconstructableOrderLeg {
  symbol: string;
  action: string;
  quantity?: number | null;
  ratio?: number | null;
}

// The paired leg of a complex/OCO order (almost always the stop leg sitting
// opposite the GTC profit-target leg), captured from TradeEdge's own broker
// evidence (see StopAssessment.rawEvidence.orders in stopLossPolicy.ts) --
// never fabricated. Every field here mirrors what TastyTrade returned for
// that leg, so replaying it back is a faithful reconstruction, not a guess.
export interface ReconstructablePairedLeg {
  // Broker order id of the stop leg, used to re-read it live before cancelling.
  orderId?: string | null;
  orderType: string;
  timeInForce: string;
  triggerPrice: number;
  // GTC-REPLACE-0001: present only for 'Stop Limit'. A 'Stop' (stop-market)
  // order has no limit price and no price effect; it is rebuilt without them.
  limitPrice?: number | null;
  priceEffect?: string | null;
  legs: ReconstructableOrderLeg[];
}

export interface ExistingGtcReplacementInput {
  hasGtc: boolean;
  confirmed: boolean;
  orderId?: string | null;
  complexOrderId?: string | null;
  originalPrice?: number | null;
  // Required to cancel a complex/OCO order. Must come from a COMPLETE,
  // matched broker record of the paired leg (caller's responsibility --
  // see resolveReconstructablePairedLeg in app/portfolio/page.tsx). Pass
  // null/undefined when no complete match exists; cancellation is then
  // refused for complex orders rather than risking an unrestorable bracket.
  pairedLeg?: ReconstructablePairedLeg | null;
  // GTC-REPLACE-0001: the named reason the paired leg could not be resolved
  // (from resolvePairedLeg); shown instead of the generic refusal.
  pairedLegRefusal?: string | null;
}

export interface CancelledGtcContext {
  cancelled: boolean;
  originalPrice: number | null;
  // Non-null only when the cancelled order was complex/OCO -- carries the
  // paired leg forward so restoreOriginalGtcIfNeeded can rebuild the FULL
  // bracket on failure, not just the single GTC leg.
  pairedLeg: ReconstructablePairedLeg | null;
}

/**
 * Cancels an existing GTC -- simple or complex/OCO -- only when TradeEdge has
 * enough information to restore it if the replacement fails. A complex order
 * is cancelled only when the caller supplies a complete, matched
 * reconstruction of its paired leg (pairedLeg); otherwise cancellation is
 * refused and the broker order is left untouched. Any rejection is
 * propagated, so callers cannot continue to a replacement while broker
 * cancellation status is uncertain.
 */
export async function cancelExistingGtcForReplacement(
  input: ExistingGtcReplacementInput,
  cancel: (orderId: string) => Promise<unknown>,
): Promise<CancelledGtcContext> {
  if (!input.hasGtc || !input.confirmed) {
    return { cancelled: false, originalPrice: null, pairedLeg: null };
  }
  if (!input.orderId) {
    throw new Error(
      'Existing GTC order ID is unavailable. No replacement was submitted. Verify working orders in TastyTrade.',
    );
  }
  if (input.complexOrderId && !input.pairedLeg && input.pairedLegRefusal) {
    throw new Error(input.pairedLegRefusal);
  }
  if (input.complexOrderId && !input.pairedLeg) {
    throw new Error(
      'The existing close is part of a complex/OCO order and TradeEdge does not have a complete, matched broker record of the paired leg, so the full bracket cannot be guaranteed restorable if replacement fails. Manage that order in TastyTrade rather than replacing it here.',
    );
  }
  if (
    input.originalPrice == null ||
    !Number.isFinite(input.originalPrice) ||
    input.originalPrice <= 0
  ) {
    throw new Error(
      'The existing GTC price is unavailable, so TradeEdge cannot guarantee restoration if replacement fails. No order was cancelled.',
    );
  }

  await cancel(input.orderId);
  return {
    cancelled: true,
    originalPrice: input.originalPrice,
    pairedLeg: input.complexOrderId ? input.pairedLeg ?? null : null,
  };
}

/**
 * Restores an original GTC only after a confirmed cancellation and only when
 * no replacement was accepted. When the cancelled order was complex/OCO,
 * `pairedLeg` is passed through so the caller's `restore` callback can
 * rebuild the FULL bracket (both legs) rather than a lone simple order --
 * callers branch on whether `pairedLeg` is null. Restoration failures
 * intentionally propagate so the UI can issue its critical
 * broker-verification warning.
 */
export async function restoreOriginalGtcIfNeeded<T>(
  context: {
    cancelled: boolean;
    replacementSubmitted: boolean;
    originalPrice: number | null;
    pairedLeg?: ReconstructablePairedLeg | null;
  },
  restore: (originalPrice: number, pairedLeg: ReconstructablePairedLeg | null) => Promise<T>,
): Promise<T | null> {
  if (
    !context.cancelled ||
    context.replacementSubmitted ||
    context.originalPrice == null
  ) {
    return null;
  }
  return restore(context.originalPrice, context.pairedLeg ?? null);
}

export function criticalGtcRestorationWarning(error: unknown): string {
  const detail = error instanceof Error ? error.message : 'unknown restoration failure';
  return ` CRITICAL: replacement failed after the original GTC was cancelled, and automatic restoration also failed (${detail}). Verify working orders in TastyTrade immediately.`;
}

// ---------------------------------------------------------------------------
// GTC-REPLACE-0001: keep the bracket's stop, exactly, when a close replaces it.
// ---------------------------------------------------------------------------

export const PAIRED_LEG_REFUSAL_PREFIX = 'The existing close is part of a bracket whose stop';

export type PairedLegResolution =
  | { ok: true; leg: ReconstructablePairedLeg }
  | { ok: false; reason: string };

function refusal(detail: string): PairedLegResolution {
  return { ok: false, reason: `${PAIRED_LEG_REFUSAL_PREFIX} ${detail} No order was cancelled. Manage that bracket in TastyTrade.` };
}

/**
 * Resolves the bracket's stop leg from TradeEdge's own broker evidence, or a
 * named reason it cannot be rebuilt exactly. Stop-market ('Stop') resolves
 * without a limit price; 'Stop Limit' requires one. Multi-leg stop-market is
 * not supported by TastyTrade and is refused (ES-0003 owns multi-leg stops).
 */
export function resolvePairedLeg(assessment: StopAssessment | null | undefined, complexOrderId?: string | null): PairedLegResolution {
  if (!assessment?.evidenceComplete || !assessment.matchedOrderId) {
    return refusal('has no complete, matched broker record in TradeEdge.');
  }
  const order = assessment.rawEvidence.orders.find(o => o.orderId === assessment.matchedOrderId);
  if (!order) return refusal('has no complete, matched broker record in TradeEdge.');
  if (complexOrderId && String(order.complexOrderId ?? '') !== String(complexOrderId)) return refusal('is not part of this bracket in TradeEdge\'s broker record.');
  const type = order.orderType;
  if (type !== 'Stop' && type !== 'Stop Limit') return refusal(`is an unsupported order type (${type || 'unknown'}).`);
  if (order.triggerPrice == null || !Number.isFinite(order.triggerPrice) || order.triggerPrice <= 0) return refusal('is missing its trigger price.');
  if (!order.legs.length || order.legs.some(l => !l.symbol || !l.action || l.quantity == null)) return refusal('is missing its legs or leg quantities.');
  if (!order.timeInForce) return refusal('is missing its time in force.');
  if (type === 'Stop' && order.legs.length > 1) return refusal('is a multi-leg stop-market, which TastyTrade does not support.');
  if (type === 'Stop Limit' && (order.limitPrice == null || !Number.isFinite(order.limitPrice) || order.limitPrice <= 0)) return refusal('is a Stop Limit with no limit price.');
  if (type === 'Stop Limit' && !order.priceEffect) return refusal('is missing its price effect.');
  return {
    ok: true,
    leg: {
      orderId: order.orderId,
      orderType: type,
      timeInForce: order.timeInForce,
      triggerPrice: order.triggerPrice,
      limitPrice: type === 'Stop Limit' ? order.limitPrice : null,
      priceEffect: type === 'Stop Limit' ? order.priceEffect : null,
      legs: order.legs.map(l => ({ symbol: l.symbol, action: l.action, quantity: l.quantity, ratio: l.ratio })),
    },
  };
}

export interface OrderBodyLeg {
  'instrument-type': string;
  symbol: string;
  quantity: number;
  action: string;
}

export interface LimitOrderBody {
  'order-type': string;
  'time-in-force': string;
  price?: string | number;
  'price-effect'?: string;
  legs: OrderBodyLeg[];
}

function exactLegs(pairedLeg: ReconstructablePairedLeg, closeLegs: OrderBodyLeg[]): OrderBodyLeg[] {
  return pairedLeg.legs.map(l => ({
    'instrument-type': closeLegs.find(c => c.symbol === l.symbol)?.['instrument-type'] ?? 'Equity Option',
    symbol: l.symbol,
    quantity: Number(l.quantity),
    action: l.action,
  }));
}

/** The original stop, rebuilt exactly: same type, trigger, limit (Stop Limit only), TIF and legs. Never converted. */
export function buildExactStopBody(pairedLeg: ReconstructablePairedLeg, closeLegs: OrderBodyLeg[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    'order-type': pairedLeg.orderType,
    'time-in-force': pairedLeg.timeInForce,
    'stop-trigger': pairedLeg.triggerPrice.toFixed(2),
    legs: exactLegs(pairedLeg, closeLegs),
  };
  if (pairedLeg.orderType === 'Stop Limit' && pairedLeg.limitPrice != null) {
    body.price = pairedLeg.limitPrice.toFixed(2);
    body['price-effect'] = pairedLeg.priceEffect;
  }
  return body;
}

/** OCO of the trader's close (Day or GTC, as given) and the original stop, exact. */
export function buildExactOcoBody(target: LimitOrderBody, pairedLeg: ReconstructablePairedLeg) {
  return {
    type: 'OCO',
    orders: [
      {
        'order-type': target['order-type'],
        'time-in-force': target['time-in-force'],
        price: target.price,
        'price-effect': target['price-effect'],
        legs: target.legs,
      },
      buildExactStopBody(pairedLeg, target.legs),
    ],
  };
}

/** Stop quantity must equal close quantity, leg by leg; otherwise contracts would be left without (or over-covered by) a stop. */
export function stopCoverageRefusal(pairedLeg: ReconstructablePairedLeg, closeLegs: OrderBodyLeg[]): string | null {
  const sameCount = pairedLeg.legs.length === closeLegs.length;
  const allMatch = sameCount && closeLegs.every(c => pairedLeg.legs.some(l => l.symbol === c.symbol && Number(l.quantity) === Number(c.quantity) && l.action === c.action));
  return allMatch ? null : 'The bracket\'s stop does not cover exactly the contracts being closed, so the stop could not be kept. No order was cancelled.';
}

const WORKING_STATUSES = new Set(['Received', 'Routed', 'In Flight', 'Live', 'Contingent']);

function sameMoney(a: unknown, b: number | null | undefined): boolean {
  const n = Number(a);
  return b != null && Number.isFinite(n) && Math.abs(n - b) < 0.005;
}

/**
 * Ian (GTC-REPLACE-0001): re-read the live complex order immediately before
 * cancelling. Refuse if the stop changed since the page loaded, or if it is no
 * longer working (triggered, filled, cancelled): never rebuild a dead stop.
 * `liveComplexOrder` is the broker's `data` object for the complex order.
 */
export function liveStopRefusal(liveComplexOrder: any, expected: ReconstructablePairedLeg): string | null {
  const orders: any[] = [
    ...(Array.isArray(liveComplexOrder?.orders) ? liveComplexOrder.orders : []),
    ...(liveComplexOrder?.['trigger-order'] ? [liveComplexOrder['trigger-order']] : []),
  ];
  const stop = orders.find(o => (expected.orderId && String(o?.id) === String(expected.orderId)))
    ?? orders.find(o => o?.['order-type'] === 'Stop' || o?.['order-type'] === 'Stop Limit');
  if (!stop) return 'The bracket\'s stop was not found in TastyTrade\'s live orders. Refresh positions and try again. No order was cancelled.';
  const status = String(stop.status ?? '');
  if (!WORKING_STATUSES.has(status)) {
    return `The bracket's stop is no longer working in TastyTrade (status: ${status || 'unknown'}). Refresh positions; nothing was cancelled or rebuilt.`;
  }
  const legs: any[] = Array.isArray(stop.legs) ? stop.legs : [];
  const legsMatch = legs.length === expected.legs.length && expected.legs.every(e => legs.some(l => String(l?.symbol ?? '').replace(/\s+/g, '') === e.symbol.replace(/\s+/g, '') && Number(l?.quantity) === Number(e.quantity) && String(l?.action) === e.action));
  const changed =
    String(stop['order-type']) !== expected.orderType ||
    !sameMoney(stop['stop-trigger'], expected.triggerPrice) ||
    (expected.orderType === 'Stop Limit' && !sameMoney(stop.price, expected.limitPrice)) ||
    !legsMatch;
  return changed
    ? 'The bracket\'s stop changed in TastyTrade since this page loaded (type, trigger, limit, quantity or legs). Refresh positions and try again. No order was cancelled.'
    : null;
}

/**
 * Step 4-5 of the approved sequence, after the original is cancelled (TastyTrade
 * rejects a dry run while the original closing order is still working; dry-run
 * proof 2026-10-06): broker dry-run the replacement, then submit. A rejection
 * throws before anything is submitted, so the caller's restore path rebuilds the
 * original bracket exactly.
 */
export async function submitAfterBrokerDryRun<T>(
  body: unknown,
  deps: {
    dryRun: (body: unknown) => Promise<{ valid: boolean; errors: string[] }>;
    submit: (body: unknown) => Promise<T>;
  },
): Promise<T> {
  const check = await deps.dryRun(body);
  if (!check.valid) {
    throw new Error(`TastyTrade rejected the replacement in its dry run: ${check.errors.join('; ') || 'no reason given'}.`);
  }
  return deps.submit(body);
}

/**
 * After a replacement OCO carries the original stop, the stop has new broker
 * ids. Re-point the recorded policy at them so classification stays MATCHED.
 * A stop with no recorded policy stays unrecorded (UNKNOWN), never fabricated.
 */
export function keptStopPolicy(
  existing: StopLossPolicy | null | undefined,
  ids: { complexOrderId: string | null; stopOrderId: string | null },
): StopLossPolicy | null {
  if (!existing) return null;
  return { ...existing, brokerOrderId: ids.stopOrderId, complexOrderId: ids.complexOrderId };
}

/**
 * Ian (2026-10-06): a Day close inside a replacement bracket may take the GTC
 * stop with it when the Day leg expires unfilled (OCO), leaving the position
 * unprotected overnight. Until that is proven safe, a close that replaces a
 * bracket goes in as GTC and the trader is told.
 */
export function bracketCloseTimeInForce(requested: string): { timeInForce: string; promotedFromDay: boolean } {
  return requested === 'Day'
    ? { timeInForce: 'GTC', promotedFromDay: true }
    : { timeInForce: requested, promotedFromDay: false };
}

export const DAY_PROMOTED_NOTE = 'sent as GTC so the stop stays working; cancel the close in TastyTrade if you do not want it resting';
