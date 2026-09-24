// lib/scans/pmccHeldBreakeven.ts
//
// PMCC-HELD-BREAKEVEN-0001: held-LEAP short-call breakeven floor.
// This file holds the shared key helper and the basis input type used by
// pairPmccCandidates for held long calls.

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
