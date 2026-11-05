// lib/portfolio/complexEnvelope.ts
//
// GTC-STALE-COMPLEX-0001: decide whether a TastyTrade complex-order envelope is still a live bracket.
//
// TastyTrade keeps an envelope listed after one of its legs is cancelled. A profit-target GTC whose stop was cancelled
// at the broker is then a plain working order, but its old envelope id still points at it. TradeEdge must not call
// that a bracket (it refuses to cancel brackets it cannot rebuild exactly). The rule is fail-closed:
//   - a sibling counts as dead ONLY when its status is a known terminal status;
//   - a missing or unknown status counts as alive, so the envelope stays a bracket and the existing refusal stands.
// Pure functions, no imports, so lib/portfolio-data and the order dialog can share one definition.

/** Statuses after which an order can never work again. Anything else (including a missing status) is treated as alive. */
const DEAD_STATUSES = new Set(['Cancelled', 'Filled', 'Expired', 'Rejected', 'Removed', 'Partially Removed']);

export function isDeadOrderStatus(status: unknown): boolean {
  return DEAD_STATUSES.has(String(status ?? '').trim());
}

function envelopeOrders(envelope: any): any[] {
  if (!envelope || typeof envelope !== 'object') return [];
  return [
    ...(Array.isArray(envelope.orders) ? envelope.orders : []),
    ...(envelope['trigger-order'] && typeof envelope['trigger-order'] === 'object' ? [envelope['trigger-order']] : []),
  ];
}

/** Every order in the envelope (nested orders and the trigger order) that is not known to be dead. */
export function aliveOrdersInEnvelope(envelope: any): any[] {
  return envelopeOrders(envelope).filter(o => !isDeadOrderStatus(o?.status));
}

/**
 * True when the envelope still joins two or more orders that can work. One alive order is a plain working order, not a
 * bracket. An envelope that lists no orders at all is unreadable, so it also counts as live (fail closed).
 */
export function envelopeIsLiveBracket(envelope: any): boolean {
  if (envelopeOrders(envelope).length === 0) return true;
  return aliveOrdersInEnvelope(envelope).length >= 2;
}

export interface StaleEnvelopeInput {
  /** The broker's `data` object from GET /complex-orders/{id}, or null/undefined when the read failed. */
  liveEnvelope: any;
  /** The broker id of the profit-target GTC that TradeEdge wants to replace. */
  targetOrderId: string | null | undefined;
  /** OCC symbols of the position's legs. */
  positionSymbols: string[];
  /** Every working-or-recent order TradeEdge already holds as stop evidence (StopAssessment.rawEvidence.orders). */
  knownOrders: Array<{
    orderId: string;
    status: string | null;
    orderType: string;
    legs: Array<{ symbol: string }>;
  }>;
}

/** ok: the target is a plain order. `alreadyGone`: it is also no longer working at the broker, so there is nothing to cancel. */
export type StaleEnvelopeVerdict = { ok: true; alreadyGone?: boolean } | { ok: false; reason: string };

const compact = (s: unknown) => String(s ?? '').replace(/\s+/g, '');

/**
 * Positive proof that the envelope around the target GTC is a leftover and the GTC is a plain order. Returns ok only when
 * the live re-read succeeded, the target is still working, no other order in the envelope can work, and no standalone
 * stop on the same contracts is working. Any doubt returns a reason and the caller keeps its refusal.
 */
export function staleEnvelopeVerdict(input: StaleEnvelopeInput): StaleEnvelopeVerdict {
  const { liveEnvelope, targetOrderId, positionSymbols, knownOrders } = input;
  if (!liveEnvelope || typeof liveEnvelope !== 'object') {
    return { ok: false, reason: 'The bracket could not be re-read from TastyTrade.' };
  }
  if (!targetOrderId) return { ok: false, reason: 'The existing GTC order ID is unavailable.' };
  const target = envelopeOrders(liveEnvelope).find(o => String(o?.id) === String(targetOrderId));
  if (!target) return { ok: false, reason: 'The existing GTC was not found in its envelope at TastyTrade.' };
  const aliveSiblings = aliveOrdersInEnvelope(liveEnvelope).filter(o => String(o?.id) !== String(targetOrderId));
  if (aliveSiblings.length > 0) return { ok: false, reason: 'Another order in the envelope can still work.' };
  const symbols = new Set(positionSymbols.map(compact));
  const standaloneStop = knownOrders.find(o =>
    String(o.orderId) !== String(targetOrderId) &&
    !isDeadOrderStatus(o.status) &&
    /stop/i.test(o.orderType) &&
    o.legs.some(l => symbols.has(compact(l.symbol))),
  );
  if (standaloneStop) return { ok: false, reason: 'A stop order is still working on the same contract.' };
  return isDeadOrderStatus(target.status) ? { ok: true, alreadyGone: true } : { ok: true };
}
