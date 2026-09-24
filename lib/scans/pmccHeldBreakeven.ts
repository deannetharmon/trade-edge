// lib/scans/pmccHeldBreakeven.ts
//
// PMCC-HELD-BREAKEVEN-0001: held-LEAP short-call breakeven floor.
//
// Three pure pieces, tested separately (ticket open item 4):
//   (a) readHeldBasis              plain-decimal basis reader
//   (b) parseHeldQuantity          strict server-path quantity parser
//   (c) evaluateHeldBreakevenFloor the floor itself
// plus the shared heldLongKey helper and the basis input type used by
// pairPmccCandidates for held long calls.

import type { PmccFailureCode } from './pmccTypes';

/** The one place a held long's map/set key is built. A hand-built key that
 * does not match silently turns held mode off, so every held entry point
 * (production scan, server trade review, readiness client) uses this. Must
 * stay identical to the identity pairing derives from a chain leg. */
export function heldLongKey(occSymbol: string): string {
  return `occ:${occSymbol.replace(/\s+/g, '').toUpperCase()}`;
}

/** Per-held-long cost input to pairing. avgOpen is per share (already read
 * through readHeldBasis); quantity is whatever the caller has (the floor
 * helper fails closed on anything but the number 1). */
export interface HeldLongBasis {
  avgOpen: number | null;
  quantity: unknown;
}

export type HeldLongBasisMap = ReadonlyMap<string, HeldLongBasis>;

/** Pinned detail strings (asserted exactly in tests; the UI may key off them). */
export const HELD_BREAKEVEN_DETAIL = {
  basisUnavailable: 'cost basis unavailable',
  unitSuspect: 'cost basis unit suspect',
  multiLot: 'multi-lot LEAP: cost averaging unverified',
  quantityInvalid: 'held quantity invalid',
} as const;

export const HELD_BREAKEVEN_FLOOR_MESSAGE = 'Short strike plus bid must exceed held LEAP strike plus cost basis';

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const SIGNED_PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Reads a broker average-open-price into a positive finite per-share number,
 * or null. Strings must be plain decimals after trim (so exponent and hex
 * forms, which Number() would accept, fail closed; so do "", ".5", "5.", "+5").
 * Numbers (client path, where parseBrokerEntryPremium has already run) must be
 * finite and > 0. Zero and negative fail closed on both branches.
 * Do not use parseBrokerEntryPremium here: it accepts 0, "1e2" and "0x10".
 */
export function readHeldBasis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!PLAIN_DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Strict quantity parser for the server path (broker strings). Uses Number(),
 * never parseInt: parseInt("1.5") is 1 and parseInt("abc") is NaN. Returns a
 * finite number (possibly 0, negative or fractional, which the floor helper
 * rejects) or null when unparseable. Non-decimal spellings (hex, exponent,
 * empty) are null.
 */
export function parseHeldQuantity(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!SIGNED_PLAIN_DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface HeldBreakevenInput {
  strikeLong: number;
  strikeShort: number;
  /** Short call bid, per share. */
  shortBid: number;
  /** Underlying price; only used by the unit guard. A non-finite spot falls back to the long strike. */
  spot: number;
  /** Per-share cost, already read through readHeldBasis (null when unusable). */
  basis: number | null | undefined;
  /** Typed unknown on purpose: only the number 1 passes; strings, NaN, null etc. fail closed. */
  quantity: unknown;
}

export interface HeldBreakevenFailure {
  code: Extract<PmccFailureCode, 'COST_BASIS_UNAVAILABLE' | 'SHORT_NOT_ABOVE_HELD_BREAKEVEN'>;
  message: string;
}

const cents = (value: number): number => Math.round(value * 100);

/**
 * Held-mode floor, per share: Ks + shortBid > Kl + avgOpen, strict, compared in
 * integer cents (both sides rounded). Returns null when the pair clears it.
 *
 * Check order is pinned (Alan, Ian): data validity, then quantity guard, then
 * unit guard, then floor. A short that would clear the floor never rescues a
 * multi-lot row, and a multi-lot row with a x100 basis reports multi-lot.
 * Anything that cannot be evaluated fails closed.
 */
export function evaluateHeldBreakevenFloor(input: HeldBreakevenInput): HeldBreakevenFailure | null {
  const { strikeLong, strikeShort, shortBid, spot, basis, quantity } = input;
  const unavailable = (message: string): HeldBreakevenFailure => ({ code: 'COST_BASIS_UNAVAILABLE', message });

  // 1. Data validity.
  if (typeof basis !== 'number' || !Number.isFinite(basis) || basis <= 0) return unavailable(HELD_BREAKEVEN_DETAIL.basisUnavailable);

  // 2. Quantity guard, written on the positive side (NaN > 1 is false, so a naive q > 1 would pass NaN).
  if (!(typeof quantity === 'number' && Number.isInteger(quantity) && quantity === 1)) {
    return unavailable(typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 1
      ? HELD_BREAKEVEN_DETAIL.multiLot
      : HELD_BREAKEVEN_DETAIL.quantityInvalid);
  }

  // 3. Unit guard: catches a gross x100 error only (not /100). Math.max(NaN, Kl) is NaN and
  // x > NaN is false, which would silently disable the guard, hence the explicit fallback.
  const bound = 2 * (Number.isFinite(spot) ? Math.max(spot, strikeLong) : strikeLong);
  if (basis > bound) return unavailable(HELD_BREAKEVEN_DETAIL.unitSuspect);

  // 4. Floor. Written so a NaN on either side fails closed instead of passing.
  if (!(cents(strikeShort + shortBid) > cents(strikeLong + basis))) {
    return { code: 'SHORT_NOT_ABOVE_HELD_BREAKEVEN', message: HELD_BREAKEVEN_FLOOR_MESSAGE };
  }
  return null;
}
