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
  orderType: string;
  timeInForce: string;
  triggerPrice: number;
  limitPrice: number;
  priceEffect: string;
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
