// lib/scans/ccScanOrderInput.ts

// CC-ORDERS-0001E: turns a Covered Call scan result into what the covered-call order dialog takes. Pure.
// The scan already priced the call at the live mid and sized it to the coverage it found, but the dialog does NOT trust
// that: it reads coverage from the broker again at open, before the dry run and inside the submit gate.

import type { CcOrderInput } from '@/features/screener/components/CcTradeModal';
import type { ScreenResult } from './types';

/** The dialog input for this scan result, or null when the result is not an orderable covered call (no symbol, no price). */
export function ccOrderInputFromScanResult(result: ScreenResult): CcOrderInput | null {
  const c = result.bestCandidate;
  if (!c || c.strategy !== 'CC') return null;
  const mid = c.ccPremiumPerShare;
  if (typeof mid !== 'number' || !Number.isFinite(mid) || mid <= 0) return null;
  if (!c.shortOccSymbol || !(c.shortStrike > 0) || !c.expiration) return null;
  // The card showed the premium for N contracts: credit is total dollars, ccPremiumPerShare is per share.
  const contracts = Math.max(1, Math.round(c.credit / (mid * 100)));
  return {
    symbol: result.symbol,
    occSymbol: c.shortOccSymbol,
    strike: c.shortStrike,
    expiration: c.expiration,
    dte: c.dte,
    delta: Number.isFinite(c.shortDelta) ? Math.abs(c.shortDelta) : null,
    midPerShare: parseFloat(mid.toFixed(2)),
    isIndex: result.underlyingType === 'index',
    initialQuantity: contracts,
  };
}
