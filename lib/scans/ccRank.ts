// lib/scans/ccRank.ts

// CC-WHEEL-0001: how covered-call results are ordered. Pure. A covered call is not a spread, so it does not use the
// 0-100 spread score. Within the calls that already passed the safety gates, results are ordered by annualized yield on the
// shares, and a call with a wide bid/ask spread sorts below a tight one (a premium you cannot fill is not a premium).

/** Order value for a covered-call result. Higher sorts first. Null when the yield is unknown. */
export function ccRankValue(candidate: { ccAnnualizedYieldOnShares?: number | null }, wideSpread: boolean): number | null {
  const y = candidate.ccAnnualizedYieldOnShares;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return (wideSpread ? 0 : 1000) + y;
}
