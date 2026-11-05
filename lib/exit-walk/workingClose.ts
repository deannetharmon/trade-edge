// lib/exit-walk/workingClose.ts
//
// EXIT-WALK-CANCEL-0001: let "Walk the price" cancel a position's working GTC close order (after the trader starts the walk),
// then put it back if the walk ends with nothing working.
// Scope, on purpose: a PLAIN working close (the usual 50% profit target). A live bracket whose stop TradeEdge can match is
// refused with a pointer to Close Position, which keeps the stop. Nothing here retries, and any doubt refuses before cancelling.
// Reuses the GTC-REPLACE-0001 cancel helper and the GTC-STALE-COMPLEX-0001 envelope check; no second implementation.

import { cancelExistingGtcForReplacement } from '@/lib/portfolio/existingGtcReplacement';
import { staleEnvelopeVerdict } from '@/lib/portfolio/complexEnvelope';
import type { StopAssessment } from '@/lib/portfolio/stopLossPolicy';

export interface WorkingCloseInput {
  orderId: string | null | undefined;
  complexOrderId?: string | null;
  /** The working GTC's limit in option-price points (the position's gtcOrderPrice). Needed to put the order back. */
  originalPrice: number | null | undefined;
  stopAssessment?: StopAssessment | null;
  legSymbols: string[];
}

export interface WorkingCloseDeps {
  /** GET /accounts/{acct}/complex-orders/{id}: the broker's `data` object, or null when the read failed. */
  readComplexOrder(complexOrderId: string): Promise<any | null>;
  /** DELETE the order: through its complex-order endpoint when a complex id is given, else /orders/{id}. */
  cancel(orderId: string, complexOrderId?: string): Promise<unknown>;
}

export interface WorkingCloseCancellation {
  originalPrice: number;
}

export const LIVE_BRACKET_WALK_REFUSAL =
  'This close order is part of a live bracket with a stop. The walk will not cancel it: use Close Position (it keeps the stop) or manage it in TastyTrade. Nothing was cancelled.';

/**
 * Cancels the working GTC close so the walk can place its own orders. Throws, with nothing cancelled, unless it can prove the
 * order is a plain order. Returns the original price so the caller can put the order back.
 */
export async function cancelWorkingCloseForWalk(input: WorkingCloseInput, deps: WorkingCloseDeps): Promise<WorkingCloseCancellation> {
  const { orderId, originalPrice } = input;
  if (!orderId) throw new Error('The working order ID is unavailable. Nothing was cancelled. Verify working orders in TastyTrade.');
  if (originalPrice == null || !Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new Error('The working order\'s price is unavailable, so it could not be put back if the walk ends. Nothing was cancelled.');
  }

  let envelopeId: string | undefined;
  if (input.complexOrderId) {
    // One live re-read decides it: a stop that can still work (matched by TradeEdge or not) keeps it a bracket.
    const verdict = staleEnvelopeVerdict({
      liveEnvelope: await deps.readComplexOrder(input.complexOrderId).catch(() => null),
      targetOrderId: orderId,
      positionSymbols: input.legSymbols,
      knownOrders: input.stopAssessment?.rawEvidence.orders ?? [],
    });
    if (!verdict.ok) {
      throw new Error(`${LIVE_BRACKET_WALK_REFUSAL} (${verdict.reason})`);
    }
    envelopeId = input.complexOrderId;
  }

  await cancelExistingGtcForReplacement(
    { hasGtc: true, confirmed: true, orderId, complexOrderId: undefined, originalPrice },
    async id => {
      try {
        return await deps.cancel(id);
      } catch (plainCancelErr) {
        // A plain order that TastyTrade still files under a leftover envelope may only cancel through it. Safe: the live
        // re-read above found no other order in that envelope that can work.
        if (!envelopeId) throw plainCancelErr;
        return deps.cancel(id, envelopeId);
      }
    },
  );
  return { originalPrice };
}
