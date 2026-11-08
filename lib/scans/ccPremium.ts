// lib/scans/ccPremium.ts

// CC-SIMPLIFY-0001 Phase 2 (Ian): a covered-call premium is the mid rounded DOWN to the cent. A seller is never shown
// more than the mid, and the header, grid, sentence and order limit all use this one number.

/** Mid rounded down to a whole cent. The epsilon keeps 0.29 (stored as 0.28999...) from falling to 0.28. */
export function ccPremiumPerShare(mid: number): number {
  if (!Number.isFinite(mid) || mid <= 0) return 0;
  return Math.floor(mid * 100 + 1e-6) / 100;
}
