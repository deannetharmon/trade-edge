// lib/portfolio/__tests__/stopPromptContext.test.ts

import { describe, expect, it } from 'vitest';
import { existingStopPromptContext, stopProximityWarning } from '../stopPromptContext';

const assessment = (classification: string, actual: number | null, expected: number | null): any => ({
  classification,
  derivedAssessment: { actualTrigger: actual, expectedTrigger: expected },
});

describe('existingStopPromptContext', () => {
  it('is empty with no assessment or no working stop', () => {
    expect(existingStopPromptContext(null)).toBe('');
    expect(existingStopPromptContext(assessment('NO_STOP', null, null))).toBe('');
    expect(existingStopPromptContext(assessment('NOT_EVALUATED', null, null))).toBe('');
    expect(existingStopPromptContext(assessment('UNSUPPORTED', null, null))).toBe('');
  });
  it('describes a too-tight stop with the policy target as reference only', () => {
    const text = existingStopPromptContext(assessment('TOO_TIGHT', 2.82, 3.1));
    expect(text).toContain('$2.82');
    expect(text).toContain('tighter than the standard policy target');
    expect(text).toContain('$3.10');
    expect(text).toContain('not a limit');
  });
  it('handles a missing price and missing target', () => {
    const text = existingStopPromptContext(assessment('INVALID', null, null));
    expect(text).toContain('price unavailable');
    expect(text).not.toContain('Standard policy target');
  });
});

describe('stopProximityWarning', () => {
  it('warns when the stop is within 10% above live value', () => {
    expect(stopProximityWarning(2.51, 2.5)).toContain('0.4%');
    expect(stopProximityWarning(2.75, 2.5)).toContain('10%');
  });
  it('does not warn beyond 10%, at or below live value, or without live data', () => {
    expect(stopProximityWarning(2.76, 2.5)).toBeNull();
    expect(stopProximityWarning(2.5, 2.5)).toBeNull();
    expect(stopProximityWarning(2.0, 2.5)).toBeNull();
    expect(stopProximityWarning(3, null)).toBeNull();
    expect(stopProximityWarning(3, 0)).toBeNull();
    expect(stopProximityWarning(NaN, 2.5)).toBeNull();
  });
});
