export interface ExistingGtcReplacementInput {
  hasGtc: boolean;
  confirmed: boolean;
  orderId?: string | null;
  complexOrderId?: string | null;
  originalPrice?: number | null;
}

export interface CancelledGtcContext {
  cancelled: boolean;
  originalPrice: number | null;
}

/**
 * Cancels a simple existing GTC only when TradeEdge has enough information to
 * restore it. Any rejection is propagated, so callers cannot continue to a
 * replacement while broker cancellation status is uncertain.
 */
export async function cancelExistingGtcForReplacement(
  input: ExistingGtcReplacementInput,
  cancel: (orderId: string) => Promise<unknown>,
): Promise<CancelledGtcContext> {
  if (!input.hasGtc || !input.confirmed || !input.orderId) {
    return { cancelled: false, originalPrice: null };
  }
  if (input.complexOrderId) {
    throw new Error(
      'The existing close is part of a complex/OCO order and cannot be reconstructed exactly from position data. Manage that order in TastyTrade rather than replacing it here.',
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
  return { cancelled: true, originalPrice: input.originalPrice };
}

/**
 * Restores an original simple GTC only after a confirmed cancellation and only
 * when no replacement was accepted. Restoration failures intentionally
 * propagate so the UI can issue its critical broker-verification warning.
 */
export async function restoreOriginalGtcIfNeeded<T>(
  context: {
    cancelled: boolean;
    replacementSubmitted: boolean;
    originalPrice: number | null;
  },
  restore: (originalPrice: number) => Promise<T>,
): Promise<T | null> {
  if (
    !context.cancelled ||
    context.replacementSubmitted ||
    context.originalPrice == null
  ) {
    return null;
  }
  return restore(context.originalPrice);
}
