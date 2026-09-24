// lib/scans/cspIvrPolicy.ts
//
// SCREENER-CONFIG-0001A -- the CSP IVR check, extracted unchanged from
// app/screener/page.tsx (runCspChecklist) so the scan-configuration registry can
// state, and a test can pin, what the engine really does with IVR.
//
// Behavior is exactly what the page did inline:
//   - IVR unavailable   -> 'warn', "Not available". The symbol is NOT disqualified.
//                          (The cap cannot be checked, and the candidate proceeds.
//                          Failing closed here is CSP-IVR-0001, a separate ticket.)
//   - IVR below the min -> 'warn', ranked lower. Guidance only.
//   - IVR above the max -> 'fail', and the symbol is market-disqualified.
//   - otherwise         -> 'pass'.

export interface CspIvrEvaluation {
  status: 'pass' | 'warn' | 'fail';
  value: string;
  reason: string;
  /** True only when IVR is known and above the cap. */
  marketDisqualified: boolean;
}

export function evaluateCspIvr(ivr: number | null | undefined, ivrMin: number, ivrMax: number): CspIvrEvaluation {
  if (ivr == null) {
    return { status: 'warn', value: 'N/A', reason: 'Not available', marketDisqualified: false };
  }
  if (ivr < ivrMin) {
    return {
      status: 'warn',
      value: `${ivr.toFixed(1)}%`,
      reason: `Below the preferred ${ivrMin}% premium environment — ranked lower`,
      marketDisqualified: false,
    };
  }
  if (ivr > ivrMax) {
    return {
      status: 'fail',
      value: `${ivr.toFixed(1)}%`,
      reason: `Above ${ivrMax}% hard cap — undefined risk`,
      marketDisqualified: true,
    };
  }
  return {
    status: 'pass',
    value: `${ivr.toFixed(1)}%`,
    reason: `Within ${ivrMin}-${ivrMax}% CSP range`,
    marketDisqualified: false,
  };
}
