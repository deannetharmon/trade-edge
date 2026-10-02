// lib/screener/candidateOtm.ts

// CSP-STRIKE-RANGE-0001 -- one OTM% definition for the post-scan OTM filter
// and the OTM sort. The filter previously had no CSP or CC branch, so any
// "OTM ≥" setting hid every CSP and CC result.
import type { SpreadCandidate } from '@/lib/scans/types';

type OtmCandidate = Pick<SpreadCandidate, 'strategy' | 'shortStrike' | 'shortCallStrike'>;

/** Percent the short strike sits out of the money; null when it cannot be computed. */
export function candidateOtmPct(c: OtmCandidate | null | undefined, price: number | null | undefined): number | null {
  if (!c || price == null || !Number.isFinite(price) || price <= 0) return null;
  const putOtm = ((price - c.shortStrike) / price) * 100;
  const callOtm = (strike: number) => ((strike - price) / price) * 100;
  switch (c.strategy) {
    case 'BPS':
    case 'CSP':
      return putOtm;
    case 'BCS':
    case 'CC':
      return callOtm(c.shortStrike);
    case 'IC':
      return c.shortCallStrike != null ? Math.min(putOtm, callOtm(c.shortCallStrike)) : null;
    default:
      return null;
  }
}
