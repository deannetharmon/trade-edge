// lib/portfolio/__tests__/stopSlider.test.ts

import { describe, expect, it } from 'vitest';
import {
  CREDIT_STOP_PCT_DEFAULT, CREDIT_STOP_PCT_MAX, CREDIT_STOP_PCT_MIN,
  DEBIT_STOP_LOSS_PCT_DEFAULT, DEBIT_STOP_LOSS_PCT_MAX, DEBIT_STOP_LOSS_PCT_MIN,
  clampSliderValue, creditStopPctFromTrigger, creditStopTriggerFromPct,
  CREDIT_STOP_CUSTOM_LABEL, debitStopLossDollars, describeCreditStopReadout, describeDebitStopReadout, isCreditStopPctInSliderRange, ocoSplitPercent, isDebitStopLossPctValid, stopDialogVerb,
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
  it('reads out price, dollars, then percent', () => {
    expect(describeCreditStopReadout(4.02, 200, -201)).toBe('Stop $4.02 · loss -$201.00 (200% of credit)');
    expect(describeCreditStopReadout(2.52, 125, -51)).toBe('Stop $2.52 · loss -$51.00 (125% of credit)');
    expect(describeCreditStopReadout(1.5, null, 40)).toBe('Stop $1.50 · protected profit +$40.00');
  });
  it('labels a stop outside the slider range as custom', () => {
    expect(CREDIT_STOP_CUSTOM_LABEL).toBe('Custom stop — outside the 150–300% slider range');
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
  it('computes the dollar loss and reads it out like the credit stop', () => {
    expect(debitStopLossDollars(21.3, 50, 1)).toBe(1065);
    expect(debitStopLossDollars(21.3, 50, 2)).toBe(2130);
    expect(describeDebitStopReadout(10.65, 50, 1065)).toBe('Stop $10.65 · loss -$1065.00 (50% of entry debit)');
  });
});

describe('stopDialogVerb', () => {
  it('matches the card button', () => {
    expect(stopDialogVerb('NO_STOP')).toBe('Add');
    expect(stopDialogVerb('ALIGNED')).toBe('Edit');
    expect(stopDialogVerb('TOO_LOOSE')).toBe('Adjust');
    expect(stopDialogVerb('TOO_TIGHT')).toBe('Review');
    expect(stopDialogVerb(undefined)).toBe('Review');
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

describe('ocoSplitPercent', () => {
  it('moves with the profit vs stop amounts', () => {
    expect(ocoSplitPercent(76, -100)).toBe(43);
    expect(ocoSplitPercent(76, -51)).toBe(60);
    expect(ocoSplitPercent(100, -100)).toBe(50);
  });
  it('clamps and handles empty values', () => {
    expect(ocoSplitPercent(1, -1000)).toBe(15);
    expect(ocoSplitPercent(1000, -1)).toBe(85);
    expect(ocoSplitPercent(0, 0)).toBe(50);
    expect(ocoSplitPercent(NaN, -5)).toBe(50);
  });
});
