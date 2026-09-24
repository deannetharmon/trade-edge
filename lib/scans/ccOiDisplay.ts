// lib/scans/ccOiDisplay.ts
//
// SCAN-ALIGN-0001C1 -- covered-call OI check row for the Targeted-mode
// checklist. Extracted from app/screener/page.tsx (page.tsx may only export
// route names). Missing/non-finite OI must never render "NaN"/"null".

import type { CheckResult } from './types';

export function buildCcOiCheck(shortOI: number | null | undefined, oiMin: number): CheckResult {
  if (typeof shortOI !== 'number' || !Number.isFinite(shortOI)) {
    return { status: 'warn', value: '—', reason: 'Open interest unavailable' };
  }
  return shortOI >= oiMin
    ? { status: 'pass', value: `${shortOI}`, reason: `≥ ${oiMin} minimum` }
    : { status: 'warn', value: `${shortOI}`, reason: `Below ${oiMin} — fills may be difficult` };
}
