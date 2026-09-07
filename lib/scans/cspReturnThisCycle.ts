/**
 * Bid-based, cash-secured CSP return view. This deliberately does not use or
 * modify the established midpoint-based ROC / annualizedRoc fields.
 */
export type CspReturnStatus = 'LOW' | 'MODERATE' | 'TARGET_RANGE' | 'HIGH_RATE_REVIEW';
export type CspReturnThisCycle = {
  available: boolean;
  securedCash: number | null;
  bidPremiumPerContract: number | null;
  cycleReturnPct: number | null;
  thirtyDayEquivalentPct: number | null;
  bidBasedAnnualizedReturnPct: number | null;
  status: CspReturnStatus | null;
};

// Candidate transport fields are optional. Missing is deliberately treated as
// unavailable by calculateCspReturnThisCycle; optionality does not imply a
// fallback quote/strike/DTE.
export type CspReturnInput = { shortBid?: number | null; shortStrike?: number | null; dte?: number | null; contractMultiplier?: number | null };

export function calculateCspReturnThisCycle(input: CspReturnInput): CspReturnThisCycle {
  const multiplier = input.contractMultiplier === undefined || input.contractMultiplier === null ? 100 : input.contractMultiplier;
  const unavailable: CspReturnThisCycle = { available: false, securedCash: null, bidPremiumPerContract: null, cycleReturnPct: null, thirtyDayEquivalentPct: null, bidBasedAnnualizedReturnPct: null, status: null };
  if (!Number.isFinite(input.shortBid) || (input.shortBid as number) < 0 || !Number.isFinite(input.shortStrike) || (input.shortStrike as number) <= 0 || !Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(input.dte) || !Number.isInteger(input.dte) || (input.dte as number) <= 0) return unavailable;
  const securedCash = (input.shortStrike as number) * multiplier;
  const bidPremiumPerContract = (input.shortBid as number) * multiplier;
  const cycleReturnPct = bidPremiumPerContract / securedCash * 100;
  const thirtyDayEquivalentPct = cycleReturnPct * 30 / (input.dte as number);
  const bidBasedAnnualizedReturnPct = cycleReturnPct * 365 / (input.dte as number);
  // Preserve full precision for the result, but absorb only binary floating
  // point noise at the stated inclusive 1.75% boundary.
  const status: CspReturnStatus = thirtyDayEquivalentPct < 0.75 ? 'LOW' : thirtyDayEquivalentPct < 1 ? 'MODERATE' : thirtyDayEquivalentPct <= 1.75 + Number.EPSILON * 16 ? 'TARGET_RANGE' : 'HIGH_RATE_REVIEW';
  return { available: true, securedCash, bidPremiumPerContract, cycleReturnPct, thirtyDayEquivalentPct, bidBasedAnnualizedReturnPct, status };
}

export const CSP_RETURN_STATUS_META: Record<CspReturnStatus, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'text-red-400' },
  MODERATE: { label: 'Moderate', className: 'text-yellow-400' },
  TARGET_RANGE: { label: 'Target range', className: 'text-emerald-400' },
  HIGH_RATE_REVIEW: { label: 'High rate — review risk, DTE, and liquidity', className: 'text-amber-400' },
};

export function sortCspByThirtyDayEquivalent<T extends CspReturnInput>(items: readonly T[], direction: 'asc' | 'desc'): T[] {
  return [...items].sort((a, b) => {
    const left = calculateCspReturnThisCycle(a).thirtyDayEquivalentPct;
    const right = calculateCspReturnThisCycle(b).thirtyDayEquivalentPct;
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return direction === 'desc' ? right - left : left - right;
  });
}
