// lib/discovery/__tests__/reasonCodes.test.ts

import { describe, expect, it } from 'vitest';
import {
  REASON_CATEGORIES,
  categoryOfReasonCode,
  createReason,
  dataLimitationReason,
  dedupeReasons,
  explainReason,
  invalidMetric,
  isReasonCode,
  normalizeReasons,
  staleMetric,
  unavailableMetric,
  validMetric,
} from '..';
import { T0 } from './fixtures';

describe('reason code model', () => {
  it('accepts <CATEGORY>_<UPPER_SNAKE> codes and derives the category', () => {
    expect(categoryOfReasonCode('QUALITY_FCF_POSITIVE')).toBe('QUALITY');
    expect(categoryOfReasonCode('DATA_ANALYST_REVISIONS_UNAVAILABLE')).toBe('DATA');
    expect(REASON_CATEGORIES).toContain('LEAPS');
  });

  it('rejects codes that are unprefixed, lower-case or in an unknown category', () => {
    ['FCF_POSITIVE', 'quality_fcf_positive', 'QUALITY', 'QUALITY_', 'MOMENTUM_UP', 'QUALITY__X', 'QUALITY_fcf'].forEach((bad) => {
      expect(isReasonCode(bad)).toBe(false);
      expect(() => createReason({ code: bad, polarity: 'SUPPORTS' })).toThrow();
    });
  });

  it('carries structured evidence taken from the metric, with values only for VALID metrics', () => {
    const reason = createReason({
      code: 'QUALITY_FCF_POSITIVE',
      polarity: 'SUPPORTS',
      evidence: [
        validMetric('fcf', 12.5, T0),
        unavailableMetric('roic'),
        invalidMetric('margin', 'x', 'BAD'),
        staleMetric('growth', 3, '2026-01-01T00:00:00.000Z', 100, 10),
      ],
    });
    expect(reason.category).toBe('QUALITY');
    expect(reason.evidence).toEqual([
      { metricId: 'fcf', validity: 'VALID', value: 12.5, asOf: T0 },
      { metricId: 'roic', validity: 'UNAVAILABLE' },
      { metricId: 'margin', validity: 'INVALID' },
      { metricId: 'growth', validity: 'STALE', asOf: '2026-01-01T00:00:00.000Z' },
    ]);
    // A stale/invalid number is never offered as an evidence value.
    expect(JSON.stringify(reason)).not.toContain('"value":3');
    expect(Object.isFrozen(reason)).toBe(true);
  });

  it('emits DATA_<METRIC>_<VALIDITY> for any metric that is not VALID', () => {
    expect(dataLimitationReason(unavailableMetric('analyst_revisions')).code).toBe('DATA_ANALYST_REVISIONS_UNAVAILABLE');
    expect(dataLimitationReason(invalidMetric('p_e', NaN, 'NON_FINITE_NUMBER')).code).toBe('DATA_P_E_INVALID');
    expect(dataLimitationReason(staleMetric('p_e', 1, T0, 5, 1)).code).toBe('DATA_P_E_STALE');
    expect(dataLimitationReason(unavailableMetric('analyst_revisions')).polarity).toBe('CONCERN');
    expect(() => dataLimitationReason(validMetric('p_e', 1, T0))).toThrow(/VALID/);
  });
});

describe('reason ordering', () => {
  const a = createReason({ code: 'DATA_X_UNAVAILABLE', polarity: 'CONCERN' });
  const b = createReason({ code: 'QUALITY_B', polarity: 'SUPPORTS' });
  const c = createReason({ code: 'QUALITY_A', polarity: 'SUPPORTS' });
  const d = createReason({ code: 'RISK_E', polarity: 'CONCERN' });

  it('orders by category then code regardless of input order, and drops exact duplicates', () => {
    const forward = normalizeReasons([a, b, c, d, b]);
    const reverse = normalizeReasons([b, d, c, a, a]);
    expect(forward.map((r) => r.code)).toEqual(['QUALITY_A', 'QUALITY_B', 'RISK_E', 'DATA_X_UNAVAILABLE']);
    expect(reverse).toEqual(forward);
  });

  it('keeps the same code with a different polarity', () => {
    const support = createReason({ code: 'QUALITY_A', polarity: 'SUPPORTS' });
    const concern = createReason({ code: 'QUALITY_A', polarity: 'CONCERN' });
    expect(dedupeReasons([support, concern, support])).toHaveLength(2);
  });
});

describe('explanations derive from the structured evidence', () => {
  it('renders code, polarity and evidence from the reason itself', () => {
    const reason = createReason({
      code: 'VALUATION_FCF_YIELD_ATTRACTIVE',
      polarity: 'SUPPORTS',
      evidence: [validMetric('fcf_yield', 0.07, T0)],
    });
    expect(explainReason(reason)).toBe('Valuation: fcf yield attractive [supports] (fcf_yield=0.07)');
  });

  it('describes a missing input by validity, never by a number', () => {
    const text = explainReason(dataLimitationReason(unavailableMetric('analyst_revisions')));
    expect(text).toBe('Data: analyst revisions unavailable [concern] (analyst_revisions UNAVAILABLE)');
  });

  it('templates receive the very same reason object', () => {
    const reason = createReason({ code: 'RISK_EARNINGS_APPROACHING', polarity: 'CONCERN', params: { days: 6 } });
    const text = explainReason(reason, { RISK_EARNINGS_APPROACHING: (r) => `Earnings in ${String(r.params?.days)} days` });
    expect(text).toBe('Earnings in 6 days');
  });
});
