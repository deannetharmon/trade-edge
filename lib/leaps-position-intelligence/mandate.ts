// lib/leaps-position-intelligence/mandate.ts
//
// LEAPS-MANDATE-0001 -- validation and sanitising of the trader's income rules ("mandate") for one held LEAPS. Pure. The API route
// calls this before anything is stored; nothing else may write a mandate. Unknown fields are dropped, numbers must be finite and
// positive, and text is trimmed and bounded. Nothing is inferred: an empty field is null.

import type { LeapsMandate } from './types';

export const MANDATE_TEXT_MAX = 240;
const POSTURES: ReadonlyArray<LeapsMandate['posture']> = ['upside-first', 'balanced', 'income-first'];

export interface MandateValidation { ok: true; mandate: LeapsMandate }
export interface MandateRejection { ok: false; errors: string[] }

function text(value: unknown, field: string, errors: string[]): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') { errors.push(`${field} must be text.`); return ''; }
  const trimmed = value.trim();
  if (trimmed.length > MANDATE_TEXT_MAX) { errors.push(`${field} is limited to ${MANDATE_TEXT_MAX} characters.`); return ''; }
  return trimmed;
}

function positive(value: unknown, field: string, errors: string[], allowZero = false): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) { errors.push(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} number.`); return null; }
  return n;
}

export function validateMandateInput(raw: unknown): MandateValidation | MandateRejection {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['A mandate object is required.'] };
  const input = raw as Record<string, unknown>;
  const errors: string[] = [];
  const posture = input.posture == null || input.posture === '' ? 'balanced' : input.posture;
  if (typeof posture !== 'string' || !POSTURES.includes(posture as LeapsMandate['posture'])) errors.push('Posture must be upside-first, balanced, or income-first.');
  if (input.allowKnownEarningsCycle != null && typeof input.allowKnownEarningsCycle !== 'boolean') errors.push('Allow earnings must be yes or no.');
  const mandate: LeapsMandate = {
    version: 'LEAPS-PI-1.1',
    thesis: text(input.thesis, 'Thesis', errors),
    invalidation: text(input.invalidation, 'Invalidation note', errors),
    thesisTargetHigh: positive(input.thesisTargetHigh, 'Target price', errors),
    invalidationPrice: positive(input.invalidationPrice, 'Invalidation price', errors),
    posture: posture as LeapsMandate['posture'],
    incomeCapStrike: positive(input.incomeCapStrike, 'Income floor strike', errors),
    minimumCycleCredit: positive(input.minimumCycleCredit, 'Minimum credit', errors, true),
    allowKnownEarningsCycle: input.allowKnownEarningsCycle === true,
  };
  if (mandate.thesisTargetHigh != null && mandate.invalidationPrice != null && mandate.invalidationPrice >= mandate.thesisTargetHigh) {
    errors.push('Invalidation price must be below the target price.');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, mandate };
}
