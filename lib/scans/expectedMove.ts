// lib/scans/expectedMove.ts
//
// EXPECTED-MOVE-CALC-0001 -- until now, expectedMove was hardcoded to
// null in both scan modes; no real calculation existed anywhere in this
// codebase. Standard formula (Ian): underlyingPrice * IV * sqrt(DTE/365),
// using the expiration's IVx specifically -- already captured on every
// candidate as expirationIvx, just never fed into a calculation before.
//
// Honest limitation, not a bug: TastyTrade doesn't always provide IVx for
// every expiration (visible today in the checklist's own "IVx unavailable
// for this expiration" EM CLEARANCE state). This function correctly
// returns null in that case -- "Unavailable" will still legitimately
// appear sometimes even after this ships.

export function computeExpectedMove(underlyingPrice: number | null, expirationIvxPct: number | null, dte: number): number | null {
  if (underlyingPrice == null || underlyingPrice <= 0) return null;
  if (expirationIvxPct == null || expirationIvxPct <= 0) return null;
  if (!Number.isFinite(dte) || dte <= 0) return null;

  const ivDecimal = expirationIvxPct / 100;
  return underlyingPrice * ivDecimal * Math.sqrt(dte / 365);
}
