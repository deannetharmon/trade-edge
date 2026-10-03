// lib/discovery/__tests__/metrics.test.ts

import { describe, expect, it } from 'vitest';
import {
  METRIC_VALIDITIES,
  countMetricValidity,
  evaluateCriterion,
  getMetric,
  invalidMetric,
  normalizeNumberMetric,
  staleMetric,
  summarizeDataCompleteness,
  unavailableMetric,
  validMetric,
} from '..';
import type { MetricSet, NormalizedMetric } from '..';
import { T0 } from './fixtures';

const ctx = (overrides: Record<string, unknown> = {}) => ({ asOf: T0, now: T0, ...overrides });

describe('metric validity semantics', () => {
  it('has exactly the four validities', () => {
    expect(METRIC_VALIDITIES).toEqual(['VALID', 'UNAVAILABLE', 'STALE', 'INVALID']);
  });

  it('missing values become UNAVAILABLE -- never zero', () => {
    [null, undefined, ''].forEach((raw) => {
      const metric = normalizeNumberMetric('p_e', raw, ctx());
      expect(metric.validity).toBe('UNAVAILABLE');
      expect(metric).not.toHaveProperty('value');
    });
  });

  it('a real zero is a VALID zero (distinct from missing)', () => {
    const metric = normalizeNumberMetric('fcf', 0, ctx());
    expect(metric).toMatchObject({ validity: 'VALID', value: 0 });
  });

  it('non-finite and non-number values are INVALID, with the rejected text kept for audit', () => {
    expect(normalizeNumberMetric('p_e', NaN, ctx())).toMatchObject({ validity: 'INVALID', reason: 'NON_FINITE_NUMBER' });
    expect(normalizeNumberMetric('p_e', Infinity, ctx())).toMatchObject({ validity: 'INVALID', reason: 'NON_FINITE_NUMBER' });
    expect(normalizeNumberMetric('p_e', '12.5', ctx())).toMatchObject({
      validity: 'INVALID',
      reason: 'NOT_A_NUMBER_TYPE',
      rejectedValue: '12.5',
    });
  });

  it('applies a provider-domain rejection hook', () => {
    const metric = normalizeNumberMetric('share_price', -3, ctx({ rejectIf: (n: number) => (n <= 0 ? 'NON_POSITIVE' : null) }));
    expect(metric).toMatchObject({ validity: 'INVALID', reason: 'NON_POSITIVE' });
  });

  it('a value with no usable asOf, or an asOf in the future, is INVALID', () => {
    expect(normalizeNumberMetric('p_e', 10, ctx({ asOf: null }))).toMatchObject({ validity: 'INVALID', reason: 'MISSING_OR_INVALID_AS_OF' });
    expect(normalizeNumberMetric('p_e', 10, ctx({ asOf: 'yesterday' }))).toMatchObject({ validity: 'INVALID' });
    expect(normalizeNumberMetric('p_e', 10, ctx({ asOf: '2026-10-03T15:00:00.000Z' }))).toMatchObject({
      validity: 'INVALID',
      reason: 'AS_OF_IN_FUTURE',
    });
  });

  it('flags old data as STALE and keeps the number out of `value`', () => {
    const metric = normalizeNumberMetric('p_e', 21, ctx({ asOf: '2026-10-01T14:00:00.000Z', maxAgeMs: 24 * 3600 * 1000 }));
    expect(metric.validity).toBe('STALE');
    expect(metric).toMatchObject({ staleValue: 21, ageMs: 48 * 3600 * 1000, maxAgeMs: 24 * 3600 * 1000 });
    expect(metric).not.toHaveProperty('value');
  });

  it('data exactly at the maximum age is still VALID', () => {
    const metric = normalizeNumberMetric('p_e', 21, ctx({ asOf: '2026-10-02T14:00:00.000Z', maxAgeMs: 24 * 3600 * 1000 }));
    expect(metric.validity).toBe('VALID');
  });

  it('without maxAgeMs there is no freshness requirement', () => {
    expect(normalizeNumberMetric('p_e', 21, ctx({ asOf: '2020-01-01T00:00:00.000Z' })).validity).toBe('VALID');
  });

  it('rejects malformed metric ids and fabricated VALID metrics', () => {
    expect(() => unavailableMetric('P/E')).toThrow(/Invalid metric id/);
    expect(() => validMetric('p_e', Number.NaN, T0)).toThrow(/not VALID/);
    expect(() => validMetric('p_e', 1, 'not-a-date')).toThrow(/ISO-8601/);
    expect(() => staleMetric('p_e', 1, T0, 5, 10)).toThrow(/older than/);
  });

  it('getMetric treats an absent key as UNAVAILABLE, not as a default', () => {
    const set: MetricSet = { p_e: validMetric('p_e', 15, T0) };
    expect(getMetric(set, 'p_e').validity).toBe('VALID');
    expect(getMetric(set, 'fcf_yield')).toMatchObject({ id: 'fcf_yield', validity: 'UNAVAILABLE' });
  });
});

describe('criterion evaluation: failing vs. unable to evaluate', () => {
  const valid = (id: string, value: number) => validMetric(id, value, T0);

  it('PASS and FAIL only when every input is VALID', () => {
    expect(evaluateCriterion('c', [valid('a', 5)], ([a]) => (a.value as number) > 1).result).toBe('PASS');
    expect(evaluateCriterion('c', [valid('a', 0)], ([a]) => (a.value as number) > 1).result).toBe('FAIL');
  });

  it('is NOT_EVALUABLE for each non-VALID input and never runs the test', () => {
    const blockers: NormalizedMetric[] = [
      unavailableMetric('a'),
      staleMetric('a', 5, '2026-01-01T00:00:00.000Z', 100, 10),
      invalidMetric('a', 'x', 'BAD'),
    ];
    blockers.forEach((blocker) => {
      let called = false;
      const result = evaluateCriterion('c', [valid('b', 1), blocker], () => {
        called = true;
        return true;
      });
      expect(result.result).toBe('NOT_EVALUABLE');
      expect(called).toBe(false);
      expect(result.blockingMetrics).toEqual([{ id: 'a', validity: blocker.validity }]);
    });
  });

  it('a criterion with no inputs cannot be evaluated', () => {
    expect(evaluateCriterion('c', [], () => true).result).toBe('NOT_EVALUABLE');
  });
});

describe('data completeness (separate from investment quality)', () => {
  const set: MetricSet = {
    a: validMetric('a', 1, T0),
    b: unavailableMetric('b'),
    c: staleMetric('c', 1, '2026-01-01T00:00:00.000Z', 100, 10),
    d: invalidMetric('d', 'x', 'BAD'),
    e: validMetric('e', 2, T0),
  };

  it('counts each validity and lists the critical metrics that are not VALID', () => {
    const summary = summarizeDataCompleteness(set, ['a', 'b', 'c', 'd'], ['e', 'b', 'missing_key']);
    expect(summary).toMatchObject({
      requiredCount: 6,
      validCount: 2,
      unavailableCount: 2,
      staleCount: 1,
      invalidCount: 1,
      complete: false,
      criticalComplete: false,
    });
    expect(summary.criticalMissing).toEqual(['b', 'missing_key']);
  });

  it('is complete only when every required metric is VALID', () => {
    const summary = summarizeDataCompleteness(set, ['a', 'e'], ['a']);
    expect(summary).toMatchObject({ complete: true, criticalComplete: true, criticalMissing: [] });
  });

  it('counts validity across a whole metric set', () => {
    expect(countMetricValidity(set)).toEqual({ VALID: 2, UNAVAILABLE: 1, STALE: 1, INVALID: 1 });
  });
});
