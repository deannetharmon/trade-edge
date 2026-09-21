// lib/ai-policy/__tests__/freshness.test.ts
import { describe, expect, it } from 'vitest';
import { FRESHNESS_MAX_AGE_SECONDS } from '../config';
import { evaluateFreshness, evaluateSource } from '../freshness';
import { NOW } from '../fixtures/testRoute';

const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

describe('source-specific freshness', () => {
  it('uses each source\'s own maximum age (D7)', () => {
    expect(FRESHNESS_MAX_AGE_SECONDS).toEqual({ quoteGreeks: 300, brokerPositionCapacity: 900, earningsCalendar: 86_400, scanCalculation: 28_800 });
    expect(evaluateSource('quoteGreeks', ago(299), NOW).state).toBe('fresh');
    expect(evaluateSource('quoteGreeks', ago(301), NOW).state).toBe('stale');
    expect(evaluateSource('brokerPositionCapacity', ago(600), NOW).state).toBe('fresh');
    expect(evaluateSource('earningsCalendar', ago(80_000), NOW).state).toBe('fresh');
    expect(evaluateSource('scanCalculation', ago(28_801), NOW).state).toBe('stale');
  });

  it('missing, empty, and unparsable timestamps are missing', () => {
    for (const bad of [null, undefined, '', 'not a date']) expect(evaluateSource('quoteGreeks', bad, NOW).state).toBe('missing');
  });

  it('a timestamp in the future beyond clock skew is stale', () => {
    expect(evaluateSource('quoteGreeks', ago(-30), NOW).state).toBe('fresh');
    expect(evaluateSource('quoteGreeks', ago(-600), NOW).state).toBe('stale');
  });

  it('a source with no maximum age is never fresh', () => {
    expect(evaluateSource('quoteGreeks', ago(1), NOW, () => null).state).toBe('stale');
  });

  it('reports which required sources are not fresh', () => {
    const report = evaluateFreshness({ quoteGreeks: ago(10), earningsCalendar: null, scanCalculation: ago(999_999) }, ['quoteGreeks', 'earningsCalendar', 'scanCalculation'], NOW);
    expect(report.allFresh).toBe(false);
    expect(report.notFresh.map((s) => s.source)).toEqual(['earningsCalendar', 'scanCalculation']);
  });
});
