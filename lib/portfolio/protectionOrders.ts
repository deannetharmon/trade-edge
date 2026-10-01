// lib/portfolio/protectionOrders.ts
//
// STOP-TARGET-DIALOG-0001: pure order planning and broker-body builders for the
// Set Stop / Profit Target dialog on credit positions. Everything here is a
// pure function so every order the dialog can place is unit-tested without the
// 12k-line page. The dialog still runs every order through
// submitCloseOrderIfSafe; nothing here talks to the broker.

export type ProtectionKind =
  | 'STOP_ONLY'     // no GTC exists; place a Stop Limit
  | 'TARGET_ONLY'   // no GTC exists; place a GTC limit profit target
  | 'OCO_NEW'       // no GTC exists; place target + stop as one OCO
  | 'OCO_REPLACE';  // a GTC exists; cancel it and place target + stop as one OCO

export interface ProtectionPlanInput {
  hasExistingGtc: boolean;
  includeTarget: boolean;
  includeStop: boolean;
}

/**
 * With an existing GTC the dialog always replaces it with an OCO (both rows are
 * locked on), exactly as before. Without one, the two checkboxes pick the order.
 * Null means nothing is selected.
 */
export function resolveProtectionKind(input: ProtectionPlanInput): ProtectionKind | null {
  if (input.hasExistingGtc) return 'OCO_REPLACE';
  if (input.includeTarget && input.includeStop) return 'OCO_NEW';
  if (input.includeStop) return 'STOP_ONLY';
  if (input.includeTarget) return 'TARGET_ONLY';
  return null;
}

export function protectionKindIncludesStop(kind: ProtectionKind): boolean { return kind !== 'TARGET_ONLY'; }
export function protectionKindIncludesTarget(kind: ProtectionKind): boolean { return kind !== 'STOP_ONLY'; }

/** Plain-language action line for the confirm panel and the action bar. */
export function protectionActionLabel(kind: ProtectionKind | null): string {
  switch (kind) {
    case 'OCO_REPLACE': return 'Replace GTC with OCO';
    case 'OCO_NEW': return 'Place OCO';
    case 'STOP_ONLY': return 'Place stop only';
    case 'TARGET_ONLY': return 'Place target only';
    default: return 'Nothing selected';
  }
}

export interface CloseLegBody {
  symbol: string;
  quantity: number;
  action: 'Buy to Close' | 'Sell to Close';
  'instrument-type': string;
}

const cents = (value: number) => Math.max(value, 0.01).toFixed(2);

/** Stop Limit limit-price sits 10% above the trigger so the order has fill room. */
export function stopLimitPrice(trigger: number): string {
  return cents(parseFloat((trigger * 1.10).toFixed(2)));
}

export function buildStopLimitBody(legs: CloseLegBody[], trigger: number) {
  return {
    'order-type': 'Stop Limit',
    'time-in-force': 'GTC',
    'stop-trigger': cents(trigger),
    price: stopLimitPrice(trigger),
    'price-effect': 'Debit',
    legs,
  };
}

export function buildTargetLimitBody(legs: CloseLegBody[], limit: number) {
  return {
    'order-type': 'Limit',
    'time-in-force': 'GTC',
    price: cents(limit),
    'price-effect': 'Debit',
    legs,
  };
}

export function buildOcoBody(legs: CloseLegBody[], limit: number, trigger: number) {
  return {
    type: 'OCO',
    orders: [buildTargetLimitBody(legs, limit), buildStopLimitBody(legs, trigger)],
  };
}

export interface ProtectionPriceInput {
  kind: ProtectionKind;
  liveValue: number | null;
  stopTrigger: number;
  targetLimit: number;
}

/**
 * Direction check against the live value, per order kind. A stop must be above
 * live and a target below it or the order would fill the moment it is placed.
 * Returns the first problem, or null.
 */
export function validateProtectionDirection(input: ProtectionPriceInput): string | null {
  const { kind, liveValue, stopTrigger, targetLimit } = input;
  if (protectionKindIncludesTarget(kind)) {
    if (!Number.isFinite(targetLimit) || targetLimit <= 0) return 'Enter a valid profit target price.';
    if (liveValue != null && targetLimit >= liveValue) {
      return `Profit target $${targetLimit.toFixed(2)} is not below the live value $${liveValue.toFixed(2)} — it would fill immediately.`;
    }
  }
  if (protectionKindIncludesStop(kind)) {
    if (!Number.isFinite(stopTrigger) || stopTrigger <= 0) return 'Enter a valid stop price.';
    if (liveValue != null && stopTrigger <= liveValue) {
      return `Stop $${stopTrigger.toFixed(2)} is not above the live value $${liveValue.toFixed(2)} — it would trigger immediately.`;
    }
  }
  return null;
}
