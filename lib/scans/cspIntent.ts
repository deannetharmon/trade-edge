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
