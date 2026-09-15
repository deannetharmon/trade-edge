import { describe, it, expect } from 'vitest';
import { getMetricVerdict, VERDICT_COLOR_CLASS } from '../metricDirectionRules';

describe('getMetricVerdict', () => {
  describe('P/L — universal, higher is better', () => {
    it('improving when P/L rises', () => {
      expect(getMetricVerdict('plNow', -238, -837)).toBe('worsening'); // more negative
      expect(getMetricVerdict('plNow', -837, -238)).toBe('improving'); // less negative
      expect(getMetricVerdict('plNow', 150, 420)).toBe('improving');
      expect(getMetricVerdict('plNow', 420, 150)).toBe('worsening');
    });
  });

  describe('Theta — universal, no strategy classification, higher is better', () => {
    it('a credit position (positive theta) shrinking toward zero is worsening', () => {
      // CspHealthy fixture: 0.12 -> 0.04
      expect(getMetricVerdict('thetaNow', 0.12, 0.04)).toBe('worsening');
    });

    it('a credit position (positive theta) growing is improving', () => {
      // IronCondor-style: 0.25 -> would need to grow to improve
      expect(getMetricVerdict('thetaNow', 0.18, 0.25)).toBe('improving');
    });

    it('a debit position (negative theta) getting more negative is worsening', () => {
      // LongCall fixture: -0.10 -> -0.22
      expect(getMetricVerdict('thetaNow', -0.10, -0.22)).toBe('worsening');
    });

    it('a debit position (negative theta) moving toward zero is improving', () => {
      // LongPut fixture: -0.15 -> -0.08
      expect(getMetricVerdict('thetaNow', -0.15, -0.08)).toBe('improving');
    });

    // Quinn's required test: the exact sign-crossing case from the real
    // PMCC mock fixture (0.05 -> -0.02) -- exactly the kind of edge a
    // naive implementation could get subtly wrong even under the
    // simplified universal rule.
    it("PMCC's real sign-crossing case (0.05 -> -0.02) correctly reads as worsening", () => {
      expect(getMetricVerdict('thetaNow', 0.05, -0.02)).toBe('worsening');
    });

    it('crossing from negative to positive correctly reads as improving', () => {
      expect(getMetricVerdict('thetaNow', -0.02, 0.05)).toBe('improving');
    });

    it("PinRisk0DTE's large positive growth (0.45 -> 1.20) reads as improving, not flagged as risky by this rule", () => {
      // This rule only judges "is decay helping more or less" -- it does
      // NOT judge pin-risk/acceleration danger. That's a different
      // concern (gamma, or the isThetaExtreme magnitude flag) and
      // deliberately out of scope for this simple directional rule.
      expect(getMetricVerdict('thetaNow', 0.45, 1.20)).toBe('improving');
    });
  });

  describe('Gamma — universal risk metric, lower is better (inverted from P/L and theta)', () => {
    it('rising gamma is worsening', () => {
      expect(getMetricVerdict('gammaNow', 0.006, 0.012)).toBe('worsening');
    });

    it('falling gamma is improving', () => {
      expect(getMetricVerdict('gammaNow', 0.012, 0.006)).toBe('improving');
    });

    it('gamma is never affected by sign the way theta is -- it\u2019s always positive in practice, but the rule itself is a plain magnitude comparison', () => {
      expect(getMetricVerdict('gammaNow', 0.085, 0.012)).toBe('improving');
    });
  });

  describe('unchanged values', () => {
    it('returns neutral when the value did not move at all, for any universal metric', () => {
      expect(getMetricVerdict('plNow', 100, 100)).toBe('neutral');
      expect(getMetricVerdict('thetaNow', 0.05, 0.05)).toBe('neutral');
      expect(getMetricVerdict('gammaNow', 0.01, 0.01)).toBe('neutral');
    });
  });
});

describe('VERDICT_COLOR_CLASS', () => {
  it('maps each verdict to the correct, distinct color', () => {
    expect(VERDICT_COLOR_CLASS.improving).toBe('text-emerald-400');
    expect(VERDICT_COLOR_CLASS.worsening).toBe('text-rose-400');
    expect(VERDICT_COLOR_CLASS.neutral).toBe('text-sky-400');
  });
});
