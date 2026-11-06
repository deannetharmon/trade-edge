// lib/scans/cspIntent.ts

// CSP-INTENT-0001 — "Premium only" (avoid assignment) vs "Wheel" (happy to own the stock).
// Team decision (Ian/Alan): intent changes the delta band shown by default and the floors used by Best by DTE.
// Wheel floors are looser on POP/distance because ownership is acceptable; the "OK to own" trend gate
// (EMA clouds / Bollinger / RSI) is a later slice and is NOT applied yet.
export type CspIntent = 'premium' | 'wheel';
export const CSP_INTENT_KEY = 'hunter-csp-intent';
export const DEFAULT_CSP_INTENT: CspIntent = 'premium';

export const INTENT_FLOORS: Record<CspIntent, { yieldPct: number; pop: number; beDistPct: number }> = {
  premium: { yieldPct: 10, pop: 70, beDistPct: 4 },
  wheel: { yieldPct: 15, pop: 40, beDistPct: 1 },
};

/** Wheel overrides the preset's delta band; premium keeps the preset's own band. */
export const WHEEL_DELTA_BAND: [number, number] = [0.30, 0.55];

export function parseCspIntent(v: unknown): CspIntent {
  return v === 'wheel' ? 'wheel' : 'premium';
}

/** INTENT-VIEW-0001 (Ian): Wheel grades on its own delta band and does not hide on the IVR cap (high IV is the premium
 * for owning the stock; the flag is shown, not a gate). Premium only keeps the preset exactly, incl. the 70 risk cap.
 * The All preset and a hand-edited view are never touched. */
export function applyIntentToView<T extends { preset: string; deltaMin: number; deltaMax: number; ivrMax: number }>(view: T, intent: CspIntent, handEdited: boolean): T {
  if (intent !== 'wheel' || handEdited || view.preset === 'all') return view;
  return { ...view, deltaMin: WHEEL_DELTA_BAND[0], deltaMax: WHEEL_DELTA_BAND[1], ivrMax: 100 };
}

/** IVR-FLAG-0001 (Guac): IVR below 50 is "low" (less premium, score only); above 70 is high risk (size down, no Premium pick). Never a hide. */
export const CSP_LOW_IVR = 50;
export const CSP_HIGH_IVR = 70;
