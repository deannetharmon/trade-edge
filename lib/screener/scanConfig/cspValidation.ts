// lib/screener/scanConfig/cspValidation.ts
//
// SCREENER-CONFIG-0001A -- field-level validation for the CSP configuration, kept
// pure so it can be tested and so the modal can show each message beside its field
// (and announce it) instead of one generic error on Run.
//
// The rules are exactly the ones the modal always enforced; this only names which
// field each rule belongs to.

import type { CspConfigValues } from './cspRegistry';

/** Keyed by rule key (DTE_MIN, DELTA_MAX, ...) or target field (popMin, otmMin, rocMin, capitalLimit). */
export type CspFieldErrors = Partial<Record<string, string>>;

export function cspFieldErrors(v: Pick<CspConfigValues, 'rules' | 'popMin' | 'otmMin' | 'rocMin' | 'capitalLimit'>): CspFieldErrors {
  const r = v.rules;
  const errors: CspFieldErrors = {};
  const set = (key: string, message: string) => { if (errors[key] == null) errors[key] = message; };

  for (const [key, value] of Object.entries(r)) {
    if (!Number.isFinite(value)) set(key, 'Enter a number.');
  }
  if (!(r.IVR_MIN >= 0)) set('IVR_MIN', 'IVR floor must be 0 or more.');
  if (!(r.IVR_MAX <= 100)) set('IVR_MAX', 'IVR cap must be 100 or less.');
  if (!(r.IVR_MAX > r.IVR_MIN)) set('IVR_MAX', 'IVR cap must be above the IVR floor.');
  if (!(r.DTE_MIN >= 0)) set('DTE_MIN', 'Min DTE must be 0 or more.');
  if (!(r.DTE_MAX > r.DTE_MIN)) set('DTE_MAX', 'Max DTE must be above min DTE.');
  if (!(r.DELTA_MIN >= 0)) set('DELTA_MIN', 'Min delta must be 0 or more.');
  if (!(r.DELTA_MAX <= 1)) set('DELTA_MAX', 'Max delta must be 1 or less.');
  if (!(r.DELTA_MAX > r.DELTA_MIN)) set('DELTA_MAX', 'Max delta must be above min delta.');
  if (!(r.OI_MIN >= 0)) set('OI_MIN', 'Open interest must be 0 or more.');
  if (!(r.BID_ASK_MAX >= 0)) set('BID_ASK_MAX', 'Enter a number.');

  const optional: Array<['popMin' | 'otmMin' | 'rocMin', number | null]> = [['popMin', v.popMin], ['otmMin', v.otmMin], ['rocMin', v.rocMin]];
  for (const [key, value] of optional) {
    if (value != null && !Number.isFinite(value)) set(key, 'Enter a number.');
  }
  if (v.popMin != null && Number.isFinite(v.popMin) && !(v.popMin >= 0 && v.popMin <= 100)) set('popMin', 'POP must be between 0 and 100.');
  if (v.otmMin != null && Number.isFinite(v.otmMin) && !(v.otmMin >= 0)) set('otmMin', 'OTM must be 0 or more.');
  if (v.rocMin != null && Number.isFinite(v.rocMin) && !(v.rocMin >= 0)) set('rocMin', 'ROC must be 0 or more.');
  if (v.capitalLimit != null && !(Number.isFinite(v.capitalLimit) && v.capitalLimit >= 0)) set('capitalLimit', 'Cash cap must be 0 or more.');
  return errors;
}

/** Targeted mode needs at least one of POP, OTM, or period ROC to narrow the scan. */
export function hasTargetedGate(v: Pick<CspConfigValues, 'popMin' | 'otmMin' | 'rocMin'>): boolean {
  return v.popMin != null || v.otmMin != null || v.rocMin != null;
}

/** True when the configuration can run in its mode. */
export function isCspConfigValid(v: CspConfigValues): boolean {
  if (Object.keys(cspFieldErrors(v)).length > 0) return false;
  return v.mode !== 'targeted' || hasTargetedGate(v);
}
