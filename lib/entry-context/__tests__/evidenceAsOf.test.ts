// lib/entry-context/__tests__/evidenceAsOf.test.ts

import { describe, expect, it } from 'vitest';
import { entryEvidenceAsOf } from '../evidenceAsOf';

describe('entryEvidenceAsOf', () => {
  const quote = Date.parse('2026-09-25T15:00:00Z');
  const scan = Date.parse('2026-09-25T14:30:00Z');

  it("uses the candidate's own quote time when it has one", () => {
    expect(entryEvidenceAsOf(quote, scan)).toBe('2026-09-25T15:00:00.000Z');
  });
  it('falls back to when the scan completed, so Ranked and Targeted entries are not recorded as blank', () => {
    expect(entryEvidenceAsOf(undefined, scan)).toBe('2026-09-25T14:30:00.000Z');
    expect(entryEvidenceAsOf(null, scan)).toBe('2026-09-25T14:30:00.000Z');
  });
  it('treats a zero, negative, non-finite or non-numeric quote time as missing (never the 1970 epoch)', () => {
    for (const bad of [0, -5, NaN, Infinity, '2026-09-25', {}]) expect(entryEvidenceAsOf(bad, scan)).toBe('2026-09-25T14:30:00.000Z');
  });
  it('returns null when neither time exists, so the evidence is honestly unavailable', () => {
    expect(entryEvidenceAsOf(undefined, null)).toBeNull();
    expect(entryEvidenceAsOf(0, undefined)).toBeNull();
  });
});
