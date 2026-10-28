import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildCapitalViewModel, buildMoneynessMovementViewModel, buildMoneynessViewModel, buildPositionMoneyness, comparisonTone, directionalMovementTone, stopPresentation, stopPresentationForPosition } from '../model/presentation';

const leg = (optionType: 'P' | 'C', strikePrice: number, direction: 'Long' | 'Short'): PositionLeg => ({ symbol: 'X', optionType, strikePrice, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 , currentDelta: null});

describe('position analysis presentation', () => {
  it.each([
    ['long call OTM', 90, leg('C', 100, 'Long'), 'OTM'], ['long call ITM', 110, leg('C', 100, 'Long'), 'ITM'],
    ['short call OTM', 90, leg('C', 100, 'Short'), 'OTM'], ['short call ITM', 110, leg('C', 100, 'Short'), 'ITM'],
    ['long put OTM', 110, leg('P', 100, 'Long'), 'OTM'], ['long put ITM', 90, leg('P', 100, 'Long'), 'ITM'],
    ['short put OTM', 110, leg('P', 100, 'Short'), 'OTM'], ['short put ITM', 90, leg('P', 100, 'Short'), 'ITM'],
  ])('%s', (_name, stock, optionLeg, expected) => expect(buildMoneynessViewModel(stock as number, [optionLeg as PositionLeg])?.state).toBe(expected));

  it('uses ATM display tolerance and fails closed for invalid or ambiguous evidence', () => {
    expect(buildMoneynessViewModel(100.02, [leg('C', 100, 'Long')])?.state).toBe('ATM');
    expect(buildMoneynessViewModel(null, [leg('C', 100, 'Long')])).toBeNull();
    expect(buildMoneynessViewModel(0, [leg('C', 100, 'Long')])).toBeNull();
    expect(buildMoneynessViewModel(100, [leg('P', 90, 'Short'), leg('C', 110, 'Short')])).toBeNull();
  });

  it('uses the sole short leg for an unambiguous multi-leg structure independent of array order', () => {
    const short = leg('P', 100, 'Short'); const long = leg('P', 95, 'Long');
    expect(buildMoneynessViewModel(110, [long, short])?.leg).toBe(short);
    expect(buildMoneynessViewModel(110, [short, long])?.leg).toBe(short);
  });

  it('MONEYNESS-LEAP-0001: an OTM bought LEAP call is informational, not red; short-dated long options and long puts keep the standard colours', () => {
    const lc = leg('C', 70, 'Long');
    const leap = { stockPrice: 62.56, legs: [lc], entryDte: 400, dte: 325 };
    expect(buildPositionMoneyness(leap)?.tone).toBe('informational');
    expect(buildPositionMoneyness({ ...leap, stockPrice: 80 })?.tone).toBe('positive');
    expect(buildPositionMoneyness({ ...leap, stockPrice: 69 })?.tone).toBe('informational');
    expect(buildPositionMoneyness({ stockPrice: 62.56, legs: [lc], entryDte: 30, dte: 20 })?.tone).toBe('negative');
    expect(buildPositionMoneyness({ stockPrice: 100, legs: [leg('P', 70, 'Long')], entryDte: 400, dte: 325 })?.tone).toBe('negative');
  });

  it('colors moneyness by current state from the position perspective, not price direction', () => {
    const sp = leg('P', 100, 'Short');
    expect(buildMoneynessViewModel(110, [sp])?.tone).toBe('positive');
    expect(buildMoneynessViewModel(103, [sp])?.tone).toBe('warning');
    expect(buildMoneynessViewModel(100.02, [sp])?.tone).toBe('warning');
    expect(buildMoneynessViewModel(90, [sp])?.tone).toBe('negative');
    const sc = leg('C', 100, 'Short');
    expect(buildMoneynessViewModel(90, [sc])?.tone).toBe('positive');
    expect(buildMoneynessViewModel(97, [sc])?.tone).toBe('warning');
    expect(buildMoneynessViewModel(110, [sc])?.tone).toBe('negative');
    const lc = leg('C', 100, 'Long');
    expect(buildMoneynessViewModel(110, [lc])?.tone).toBe('positive');
    expect(buildMoneynessViewModel(97, [lc])?.tone).toBe('warning');
    expect(buildMoneynessViewModel(80, [lc])?.tone).toBe('negative');
    const lp = leg('P', 100, 'Long');
    expect(buildMoneynessViewModel(90, [lp])?.tone).toBe('positive');
    expect(buildMoneynessViewModel(103, [lp])?.tone).toBe('warning');
    expect(buildMoneynessViewModel(120, [lp])?.tone).toBe('negative');
  });

  it('uses the 5% yellow buffer boundary (distance is measured against the stock price, so 5% is about 105.26 for a 100 strike)', () => {
    expect(buildMoneynessViewModel(105.3, [leg('P', 100, 'Short')])?.tone).toBe('positive');
    expect(buildMoneynessViewModel(105.2, [leg('P', 100, 'Short')])?.tone).toBe('warning');
  });

  it('colors the Price Change movement by current moneyness, not by whether the stock rose or fell', () => {
    // Short put, stock fell but still comfortably OTM: green (was red under the old direction-based rule).
    expect(buildMoneynessMovementViewModel(120, 110, [leg('P', 100, 'Short')])?.tone).toBe('positive');
    // Short put that moved from OTM to near-strike: yellow; then ITM: red.
    expect(buildMoneynessMovementViewModel(120, 103, [leg('P', 100, 'Short')])?.tone).toBe('warning');
    expect(buildMoneynessMovementViewModel(120, 90, [leg('P', 100, 'Short')])?.tone).toBe('negative');
    // Short put that recovers but is still ITM stays red.
    expect(buildMoneynessMovementViewModel(87.6, 91.8, [leg('P', 100, 'Short')])?.tone).toBe('negative');
    // Long call (LEAPS) ITM stays green even when the stock dipped.
    expect(buildMoneynessMovementViewModel(112.4, 108.2, [leg('C', 100, 'Long')])?.tone).toBe('positive');
  });

  it('classifies interpreted comparisons rather than current signs', () => {
    expect(comparisonTone(-210, -120)).toBe('positive');
    expect(comparisonTone(-120, -210)).toBe('negative');
    expect(comparisonTone(50, 50)).toBe('neutral');
    expect(comparisonTone(null, 50)).toBe('neutral');
    expect(directionalMovementTone(20, 25)).toBe('informational');
  });

  it('shows verified whole-position debit as capital at risk and fails incomplete economics closed', () => {
    const base = { identity: { quantity: 2 }, structureAmbiguous: false, entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 2574 } as unknown as Position;
    expect(buildCapitalViewModel(base)).toEqual({ label: 'Capital at risk', value: 2574 });
    expect(buildCapitalViewModel({ ...base, entryEconomicsComplete: false })).toMatchObject({ label: 'Unavailable', value: null });
    expect(buildCapitalViewModel({ ...base, identity: null })).toMatchObject({ label: 'Unavailable', value: null });
  });

  it('maps each canonical stop classification to explicit copy', () => {
    expect(stopPresentation('NO_STOP').action).toBe('Add Stop');
    expect(stopPresentation('ALIGNED').action).toBe('Adjust');
    expect(stopPresentation('TOO_TIGHT').action).toBe('Verify/Adjust');
    expect(stopPresentation('UNKNOWN_PROVENANCE').action).toBe('Verify');
    expect(stopPresentation('INVALID').action).toBe('Repair Stop');
  });

  it('STOP-DIALOG-UNIFY-0001: an eligible long call with no matched stop reads "No stop", not "Unsupported"', () => {
    const longCall = { stopLossClassification: 'UNSUPPORTED', entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 2000, quantity: 1, identity: { structureType: 'NAKED' }, structureAmbiguous: false, legs: [{ direction: 'Long', optionType: 'C' }], pairedShortCallKey: null, dte: 365, stopAssessment: { matchedOrderId: null } } as unknown as Position;
    expect(stopPresentationForPosition(longCall).label).toBe('No stop');
    expect(stopPresentationForPosition({ ...longCall, stopAssessment: { matchedOrderId: '123' } } as unknown as Position).label).toBe('Unsupported');
    expect(stopPresentationForPosition({ ...longCall, legs: [{ direction: 'Long', optionType: 'P' }] } as unknown as Position).label).toBe('No stop');
    expect(stopPresentationForPosition({ ...longCall, stopLossClassification: 'TOO_TIGHT' } as unknown as Position).label).toBe('Too tight');
  });
});
