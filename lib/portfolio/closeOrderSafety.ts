// lib/portfolio/closeOrderSafety.ts
//
// ES-0001: Live Close-Order Identity and Break-Even Safety.
//
// Root cause (confirmed by direct code read of app/portfolio/page.tsx):
//
// 1. Positions were grouped by `${underlying}::${expiration}` alone, with no
//    strike/direction/quantity discriminator. Two independently-opened
//    spreads sharing a symbol and expiration -- but with different strikes
//    and/or different quantities -- were silently merged into one displayed
//    Position, one card, one aggregate `creditReceived`.
//
// 2. `creditReceived` on a merged Position is the SUM of every leg's entry
//    economics with no per-spread breakdown preserved. Every consumer that
//    needed a "per contract" number (Snap-to-Breakeven, live P&L, the stop-
//    loss classifier, GTC/OCO price bounds, roll sizing, audit entries) then
//    independently re-derived a stand-in "quantity" by picking a single
//    arbitrary leg (`pos.legs.find(l => l.direction === 'Short')?.quantity`,
//    or in one case `pos.legs[0]?.quantity`) and dividing the AGGREGATE
//    credit by that ONE leg's quantity. When a group actually contained more
//    than one true spread, this produced a per-contract number with no
//    coherent economic meaning -- and "Snap to breakeven" fed that number
//    straight into the live order's limit price.
//
// `buildCloseOrder` itself (unchanged, see app/portfolio/page.tsx) already
// preserves each leg's own true quantity in the broker payload -- the defect
// is entirely upstream, in grouping and in per-contract economics
// attribution, not in leg/quantity construction of the order itself.
//
// This module is the single canonical source for:
//   - grouping raw broker legs into economically coherent groups
//   - deriving one canonical, safe `quantity` per group
//   - computing per-contract entry economics (credit, break-even) from that
//     canonical quantity
//   - a typed safety gate, with stable rule IDs, that BLOCKS (does not just
//     warn) submission when the canonical invariants don't hold
//
// It intentionally has zero dependencies on React/the portfolio page so it
// can be unit tested directly and is the one place this math is allowed to
// live. Every call site in app/portfolio/page.tsx that used to re-derive its
// own "quantity" must instead consume `Position.quantity` /
// `CanonicalCloseIdentity` produced here.

import type { OptionType, LegDirection } from './positionLifecycle';

export type { OptionType, LegDirection };

// ---------------------------------------------------------------------------
// Raw input types
// ---------------------------------------------------------------------------

/** One already-netted per-OCC-symbol broker leg, as returned by
 *  `/accounts/{account}/positions` (one row per unique option symbol). */
export interface RawEconomicLeg {
  symbol: string;
  optionType: OptionType;
  strikePrice: number;
  direction: LegDirection;
  /** Always an unsigned magnitude -- sign/side is carried by `direction`. */
  quantity: number;
  avgOpenPrice: number;
  /** ISO date string, used only for informational entryDate/entryDte. */
  createdAt?: string | null;
}

// ---------------------------------------------------------------------------
// Canonical grouping
// ---------------------------------------------------------------------------

export interface CanonicalGroup {
  /** Stable identity key. Unchanged (`${underlying}::${expiration}`) for the
   *  common, non-ambiguous case -- so existing persisted state keyed by the
   *  old format (position-intent overrides, profit targets, roll inputs)
   *  keeps working for every position that was never affected by the bug.
   *  Only gets a `::<quantity>` suffix when a symbol+expiration genuinely
   *  contains legs of more than one distinct quantity, which is a NEW split
   *  that could not previously have had persisted state under the old key
   *  (it was always incorrectly merged before). */
  key: string;
  underlying: string;
  expiration: string;
  /** The single quantity shared by every leg in this group. Safe to use as
   *  the position's true contract count precisely because grouping enforces
   *  that every leg in the group shares it -- see `groupEconomicLegs`. */
  quantity: number;
  legs: RawEconomicLeg[];
}

/**
 * Groups raw per-symbol broker legs sharing one underlying+expiration into
 * economically coherent groups.
 *
 * No single coherent multi-leg option strategy (vertical spread, iron
 * condor, etc.) legitimately has mismatched leg quantities -- a true 4-leg
 * iron condor has all four legs at the same contract count. A quantity
 * mismatch within the same symbol+expiration is therefore proof that the
 * legs belong to two (or more) independently-opened trades, not one
 * position, and must NEVER be merged.
 *
 * This does not (and, from broker position data alone, cannot) separate two
 * independently-opened spreads that happen to share both symbol+expiration
 * AND quantity -- that residual ambiguity is inherent to broker position
 * data (TastyTrade does not tag positions with an originating "ticket").
 * That residual case is addressed by the enhanced confirmation-modal
 * disclosure (exact legs/strikes shown), not by grouping.
 */
export function groupEconomicLegs(
  underlying: string,
  expiration: string,
  legs: RawEconomicLeg[]
): CanonicalGroup[] {
  const byQty = new Map<number, RawEconomicLeg[]>();
  for (const leg of legs) {
    const q = Math.abs(Number(leg.quantity) || 0);
    if (!byQty.has(q)) byQty.set(q, []);
    byQty.get(q)!.push(leg);
  }

  const sortedQtys = Array.from(byQty.keys()).sort((a, b) => a - b);
  const multiple = sortedQtys.length > 1;

  return sortedQtys.map(q => ({
    key: multiple ? `${underlying}::${expiration}::${q}` : `${underlying}::${expiration}`,
    underlying,
    expiration,
    quantity: q,
    legs: byQty.get(q)!,
  }));
}

// ---------------------------------------------------------------------------
// Canonical close-order identity
// ---------------------------------------------------------------------------

export interface CanonicalCloseIdentity {
  key: string;
  underlying: string;
  expiration: string;
  /** The single canonical, safe quantity for this position -- the ONLY
   *  quantity any close/roll/stop-loss/GTC/P&L computation should use. */
  quantity: number;
  legs: RawEconomicLeg[];
  /** Total entry credit across the whole group, in dollars (positive). */
  creditReceived: number;
  /** Entry credit per contract, in dollars. Safe to compute this way
   *  ONLY because `quantity` is now provably shared by every leg --
   *  see `groupEconomicLegs`. */
  creditPerContract: number;
}

/**
 * Builds the one canonical identity object for a (already-grouped) position.
 * `creditReceived` is the pre-computed total entry credit for the group
 * (e.g. from the existing `calculateSpreadCredit`) -- this function does not
 * recompute it, so it stays byte-identical to today's entry-credit math; it
 * only fixes what quantity that credit gets divided by.
 */
export function buildCanonicalCloseIdentity(
  group: Pick<CanonicalGroup, 'key' | 'underlying' | 'expiration' | 'quantity' | 'legs'>,
  creditReceived: number
): CanonicalCloseIdentity {
  const quantity = group.quantity > 0 ? group.quantity : 1;
  return {
    key: group.key,
    underlying: group.underlying,
    expiration: group.expiration,
    quantity,
    legs: group.legs,
    creditReceived,
    creditPerContract: creditReceived / (quantity * 100),
  };
}

/** Break-even limit price for "Snap to breakeven" -- the per-contract entry
 *  credit, floored at $0.01 (never a zero/sub-penny price). Same formula the
 *  UI used before; the fix is that `creditPerContract` is now always safe. */
export function computeBreakEvenLimitPrice(identity: CanonicalCloseIdentity): number {
  return Math.max(identity.creditPerContract, 0.01);
}

// ---------------------------------------------------------------------------
// Safety validation gate
// ---------------------------------------------------------------------------

export type SafetyRuleId =
  | 'ZERO_OR_NEGATIVE_QUANTITY'
  | 'LEG_QUANTITY_MISMATCH'
  | 'REQUESTED_QTY_MISMATCH'
  | 'LIMIT_PRICE_NON_POSITIVE'
  | 'EMPTY_LEG_SET'
  | 'ONE_SIDED_QUOTE'
  | 'STALE_QUOTE';

export interface SafetyCheckIssue {
  ruleId: SafetyRuleId;
  /** 'block' issues must prevent order submission. 'warn' issues are
   *  disclosed but do not by themselves stop submission. */
  severity: 'block' | 'warn';
  message: string;
}

export interface SafetyCheckResult {
  /** True iff there are zero 'block'-severity issues. */
  ok: boolean;
  issues: SafetyCheckIssue[];
}

export interface SafetyCheckInput {
  identity: CanonicalCloseIdentity;
  /** The quantity the order-under-construction is actually going to close
   *  (e.g. the leg quantities about to be sent to buildCloseOrder). Must
   *  equal `identity.quantity` -- any divergence means the order being built
   *  no longer matches the economics it was priced against. */
  requestedClosingQuantity: number;
  requestedLimitPrice: number;
  /** Milliseconds since the quote used to price this order was fetched. */
  quoteAgeMs?: number | null;
  /** Whether the close-value quote was missing a bid or ask on any leg. */
  quoteIsOneSided?: boolean;
  /** Overrides the default 5-minute staleness threshold. */
  maxQuoteAgeMs?: number;
}

const DEFAULT_MAX_QUOTE_AGE_MS = 5 * 60 * 1000;

/**
 * Validates a close/roll/stop order's identity and pricing before it is
 * allowed to be submitted. Structural mismatches (leg quantities that don't
 * agree with the canonical position quantity, a requested closing quantity
 * that disagrees with the position, a non-positive limit price, an empty
 * leg set) are HARD BLOCKS, not warnings -- these are exactly the failure
 * shape that let a real close order submit against the wrong economics.
 * Stale/one-sided quote conditions are surfaced as warnings for disclosure
 * (consistent with the existing PI-0014 policy of never silently falling
 * back to mid for a "closeValue" quote) but do not themselves block.
 */
export function runCloseOrderSafetyGate(input: SafetyCheckInput): SafetyCheckResult {
  const issues: SafetyCheckIssue[] = [];
  const { identity, requestedClosingQuantity, requestedLimitPrice } = input;

  if (!(identity.quantity > 0)) {
    issues.push({
      ruleId: 'ZERO_OR_NEGATIVE_QUANTITY',
      severity: 'block',
      message: `Position quantity is ${identity.quantity} -- cannot compute a valid close order.`,
    });
  }

  if (identity.legs.length === 0) {
    issues.push({
      ruleId: 'EMPTY_LEG_SET',
      severity: 'block',
      message: 'Position has no legs -- nothing to close.',
    });
  }

  const mismatchedLegs = identity.legs.filter(l => Math.abs(Number(l.quantity) || 0) !== identity.quantity);
  if (mismatchedLegs.length > 0) {
    issues.push({
      ruleId: 'LEG_QUANTITY_MISMATCH',
      severity: 'block',
      message:
        `${mismatchedLegs.length} leg(s) (${mismatchedLegs.map(l => l.symbol).join(', ')}) ` +
        `do not match this position's canonical quantity (${identity.quantity}). This position ` +
        `may contain more than one economically distinct spread merged together. Refusing to ` +
        `submit until the legs are re-grouped correctly.`,
    });
  }

  if (requestedClosingQuantity !== identity.quantity) {
    issues.push({
      ruleId: 'REQUESTED_QTY_MISMATCH',
      severity: 'block',
      message:
        `Requested closing quantity (${requestedClosingQuantity}) does not match this position's ` +
        `true quantity (${identity.quantity}).`,
    });
  }

  if (!(requestedLimitPrice > 0)) {
    issues.push({
      ruleId: 'LIMIT_PRICE_NON_POSITIVE',
      severity: 'block',
      message: `Limit price ${requestedLimitPrice} must be a positive number.`,
    });
  }

  if (input.quoteIsOneSided) {
    issues.push({
      ruleId: 'ONE_SIDED_QUOTE',
      severity: 'warn',
      message: 'Quote is one-sided (missing a bid or ask on at least one leg) -- the displayed close value may not be truly marketable.',
    });
  }

  const maxAge = input.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS;
  if (input.quoteAgeMs != null && input.quoteAgeMs > maxAge) {
    issues.push({
      ruleId: 'STALE_QUOTE',
      severity: 'warn',
      message: `Quote is ${Math.round(input.quoteAgeMs / 1000)}s old (staleness limit ${Math.round(maxAge / 1000)}s).`,
    });
  }

  return { ok: !issues.some(i => i.severity === 'block'), issues };
}
