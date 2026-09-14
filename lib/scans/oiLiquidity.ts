// lib/scans/oiLiquidity.ts
//
// OI-LIQUIDITY-CHOICE-0001, Phase 1 -- the single OI check for the
// checklist path (lib/scans/checklist.ts) and Targeted mode
// (app/screener/page.tsx). Previously two separate, disagreeing
// implementations: checklist.ts never hard-failed on low OI, while
// Targeted mode's inline copy did (though nothing actually read that
// 'fail' status -- the TRADE THIS button ignored it entirely).
//
// Team's resolved position (Ian/Paul/Quinn): OI is a real, meaningful
// signal -- thin open interest genuinely predicts wide spreads and fill
// trouble -- but it should never silently block or silently exclude a
// trader's own choice. This is why 'fail' is deliberately absent from
// this function's return type: low OI is always disclosed, never a
// hard status the way a missing candidate or invalid input would be.
// The disclosure becomes an actual choice at the UI layer (a
// confirmation step naming the real numbers), not a status this
// function itself enforces.
//
// Phase 2 (not started) will look at whether CSP, Covered Call, and
// PMCC's own OI logic should also route through this function -- each
// has real, possibly legitimate differences (PMCC waives the check on
// held positions) that need individual review, not a blanket merge.

import type { CheckResult } from './types';

export interface OiLiquidityInput {
  shortOI: number;
  longOI: number;
  oiMin: number;
}

export function assessOiLiquidity(input: OiLiquidityInput): CheckResult {
  const shortLegOi = input.shortOI;
  const value = `${input.shortOI}/${input.longOI}`;

  if (shortLegOi >= input.oiMin) {
    return { status: 'pass', value, reason: `Short leg ≥ ${input.oiMin}` };
  }
  return {
    status: 'warn',
    value,
    reason: `Short leg OI is ${shortLegOi}, below the ${input.oiMin} target — fills may be slower or require a wider price`,
  };
}
