// lib/portfolio/__tests__/stopSlider.test.ts

import { describe, expect, it } from 'vitest';
import {
  CREDIT_STOP_PCT_DEFAULT, CREDIT_STOP_PCT_MAX, CREDIT_STOP_PCT_MIN,
  DEBIT_STOP_LOSS_PCT_DEFAULT, DEBIT_STOP_LOSS_PCT_MAX, DEBIT_STOP_LOSS_PCT_MIN,
  clampSliderValue, creditStopPctFromTrigger, creditStopTriggerFromPct,
  describeCreditStopPct, describeDebitStopLossPct, isCreditStopPctInSliderRange, isDebitStopLossPctValid,
} from '../stopSlider';
import { classifyStopLossPolicy, buildOriginalCreditDefaultPolicy } from '../stopLossPolicy';

describe('stop slider constants', () => {
  it('credit range is 1.5x-3x of credit with a 2x default', () => {
    expect(CREDIT_STOP_PCT_MIN).toBe(150);
    expect(CREDIT_STOP_PCT_MAX).toBe(300);
    expect(CREDIT_STOP_PCT_DEFAULT).toBe(200);
  });
  it('debit range stays below 100% with a 50% default', () => {
    expect(DEBIT_STOP_LOSS_PCT_MIN).toBe(5);
    expect(DEBIT_STOP_LOSS_PCT_MAX).toBe(95);
    expect(DEBIT_STOP_LOSS_PCT_DEFAULT).toBe(50);
  });
});

describe('credit stop conversions', () => {
  it.each([[150, 1.5], [200, 2], [300, 3]] as const)('%s%% of a $1.00 credit is $%s', (pct, trigger) => {
    expect(creditStopTriggerFromPct(1, pct)).toBe(trigger);
  });
  it('rounds to cents', () => expect(creditStopTriggerFromPct(1.33, 200)).toBe(2.66));
  it('round-trips price to percent', () => expect(creditStopPctFromTrigger(1.5, 3)).toBe(200));
  it('returns null when it cannot compute a percent', () => {
    expect(creditStopPctFromTrigger(0, 3)).toBeNull();
    expect(creditStopPctFromTrigger(1, 0)).toBeNull();
  });
  it('throws on a non-positive credit or percent', () => {
    expect(() => creditStopTriggerFromPct(0, 200)).toThrow();
    expect(() => creditStopTriggerFromPct(1, 0)).toThrow();
  });
  it('every slider value is classified ALIGNED by the stop policy', () => {
    const credit = 1.2;
    for (let pct = CREDIT_STOP_PCT_MIN; pct <= CREDIT_STOP_PCT_MAX; pct += 5) {
      const trigger = creditStopTriggerFromPct(credit, pct);
      const policy = buildOriginalCreditDefaultPolicy(credit, { source: 'MANUAL', multiple: trigger / credit });
      expect(classifyStopLossPolicy({ hasStopOrder: true, orderTriggerPrice: trigger, policy, creditPerContract: credit })).toBe('ALIGNED');
    }
  });
  it('knows which percents the slider can show', () => {
    expect(isCreditStopPctInSliderRange(149)).toBe(false);
    expect(isCreditStopPctInSliderRange(150)).toBe(true);
    expect(isCreditStopPctInSliderRange(300)).toBe(true);
    expect(isCreditStopPctInSliderRange(301)).toBe(false);
  });
  it('describes the stop in plain language', () => {
    expect(describeCreditStopPct(200)).toBe('Stop at 200% of credit (2.0×) · loss = 100% of credit');
    expect(describeCreditStopPct(150)).toBe('Stop at 150% of credit (1.5×) · loss = 50% of credit');
    expect(describeCreditStopPct(300)).toBe('Stop at 300% of credit (3.0×) · loss = 200% of credit');
  });
});

describe('debit stop validation', () => {
  it('accepts values inside 5-95 and rejects the rest', () => {
    expect(isDebitStopLossPctValid(5)).toBe(true);
    expect(isDebitStopLossPctValid(95)).toBe(true);
    expect(isDebitStopLossPctValid(4)).toBe(false);
    expect(isDebitStopLossPctValid(100)).toBe(false);
    expect(isDebitStopLossPctValid(NaN)).toBe(false);
  });
  it('describes the stop in plain language', () => {
    expect(describeDebitStopLossPct(50, 10)).toBe('Max loss 50% of entry debit · stop $10.00');
  });
});

describe('clampSliderValue', () => {
  it('clamps and handles NaN', () => {
    expect(clampSliderValue(120, 150, 300)).toBe(150);
    expect(clampSliderValue(400, 150, 300)).toBe(300);
    expect(clampSliderValue(200, 150, 300)).toBe(200);
    expect(clampSliderValue(NaN, 150, 300)).toBe(150);
  });
});
