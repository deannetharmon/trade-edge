// lib/scans/cspIvrPolicy.ts
//
// SCREENER-CONFIG-0001A -- the CSP IVR check, extracted unchanged from
// app/screener/page.tsx (runCspChecklist) so the scan-configuration registry can
// state, and a test can pin, what the engine really does with IVR.
//
// CSP-IVR-0001 (2026-09-23): an unavailable IVR now fails closed. CSP is undefined-risk, so a cap that cannot be
// verified must not pass. Everything else is exactly what the page did inline:
//   - IVR unavailable   -> 'fail'. Every candidate for the symbol is DISQUALIFIED_IVR_UNAVAILABLE, shown with its reason.
//   - IVR below the min -> 'warn', ranked lower. Guidance only.
//   - IVR above the max -> 'fail', and the symbol is market-disqualified (DISQUALIFIED_IVR).
//   - otherwise         -> 'pass'.

export interface CspIvrEvaluation {
  status: 'pass' | 'warn' | 'fail';
  value: string;
  reason: string;
  /** True only when IVR is known and above the cap. */
  marketDisqualified: boolean;
  /** True when IVR could not be determined, so the cap cannot be verified (fails closed). */
  unavailable: boolean;
}

export function evaluateCspIvr(ivr: number | null | undefined, ivrMin: number, ivrMax: number): CspIvrEvaluation {
  if (ivr == null) {
    return {
      status: 'fail',
      value: 'N/A',
      reason: 'IV rank unavailable — the IVR cap cannot be verified (undefined risk)',
      marketDisqualified: false,
      unavailable: true,
    };
  }
  if (ivr < ivrMin) {
    return {
      status: 'warn',
      value: `${ivr.toFixed(1)}%`,
      reason: `Below the preferred ${ivrMin}% premium environment — ranked lower`,
      marketDisqualified: false,
      unavailable: false,
    };
  }
  if (ivr > ivrMax) {
    return {
      status: 'fail',
      value: `${ivr.toFixed(1)}%`,
      reason: `Above ${ivrMax}% hard cap — undefined risk`,
      marketDisqualified: true,
      unavailable: false,
    };
  }
  return {
    status: 'pass',
    value: `${ivr.toFixed(1)}%`,
    reason: `Within ${ivrMin}-${ivrMax}% CSP range`,
    marketDisqualified: false,
    unavailable: false,
  };
}
