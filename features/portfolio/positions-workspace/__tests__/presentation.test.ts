import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildCapitalViewModel, buildMoneynessViewModel, comparisonTone, directionalMovementTone, stopPresentation } from '../model/presentation';

const leg = (optionType: 'P' | 'C', strikePrice: number, direction: 'Long' | 'Short'): PositionLeg => ({ symbol: 'X', optionType, strikePrice, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 });

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
});
