import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { aggregateFinancialValues, aggregatePnlPercentage, buildOptionInstrumentViewModel, classifySymbolComposition, optionMidpointValue } from '../model/valuation';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P', quantity = 1): PositionLeg => ({ symbol: 'X', direction, optionType, quantity, strikePrice: 100, avgOpenPrice: 1, currentPrice: 1 });
const option = (overrides: Partial<Position> = {}): Position => ({ key: 'X', symbol: 'X', legs: [leg('Long', 'C')], quantity: 1, identity: { quantity: 1 }, structureAmbiguous: false, entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 100, currentValue: 760, closeValue: 750, pnl: 660, closeNowPnl: 650, ...overrides } as unknown as Position);
const equity = (overrides: Partial<EquityHolding> = {}): EquityHolding => ({ accountNumber: 'A', symbol: 'X', direction: 'Long', quantity: 2, settledQuantity: null, basis: 1500, basisComplete: true, currentPrice: 1438, marketValue: 2876, unrealizedPnl: -124, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...overrides });

describe('portfolio workspace valuation contracts', () => {
  it('never remultiplies whole-position option dollars for one or many contracts', () => {
    expect(optionMidpointValue(option({ quantity: 1, currentValue: 760 }))).toBe(760);
    expect(optionMidpointValue(option({ quantity: 5, currentValue: 3800 }))).toBe(3800);
  });

  it('classifies canonical long, short, equity, mixed, and ambiguous groups', () => {
    const long = buildOptionInstrumentViewModel(option());
    const short = buildOptionInstrumentViewModel(option({ legs: [leg('Short', 'P')], entryPriceEffect: 'Credit' }));
    expect(long.role).toBe('long-call'); expect(short.role).toBe('short-put');
    expect(classifySymbolComposition([equity()], [])).toBe('equity-only');
    expect(classifySymbolComposition([], [long])).toBe('long-option-only');
    expect(classifySymbolComposition([], [short])).toBe('short-option-only');
    expect(classifySymbolComposition([], [long, short])).toBe('mixed-options');
    expect(classifySymbolComposition([equity()], [short])).toBe('equity-and-options');
    const ambiguous = buildOptionInstrumentViewModel(option({ identity: null, structureAmbiguous: true }));
    expect(classifySymbolComposition([], [ambiguous])).toBe('ambiguous');
  });

  it('distinguishes complete, partial, unavailable, not-applicable, and genuine zero', () => {
    expect(aggregateFinancialValues([], 'mark-mid', null).completeness).toBe('not-applicable');
    expect(aggregateFinancialValues([{ key: 'a', value: null, reason: 'missing' }], 'mark-mid', null).completeness).toBe('unavailable');
    expect(aggregateFinancialValues([{ key: 'a', value: 0, reason: '' }], 'mark-mid', null)).toMatchObject({ completeness: 'complete', value: 0 });
    expect(aggregateFinancialValues([{ key: 'a', value: 5, reason: '' }, { key: 'b', value: null, reason: 'missing' }], 'mark-mid', null)).toMatchObject({ completeness: 'partial', value: 5, includedCount: 1, expectedCount: 2 });
  });

  it('uses structure-specific P/L denominators and refuses mixed percentages', () => {
    expect(aggregatePnlPercentage([equity({ basis: 1500, unrealizedPnl: -124 })], []).value).toBeCloseTo(-4.1333);
    expect(aggregatePnlPercentage([], [option({ pnl: 50, entryCredit: 100 })]).value).toBe(50);
    expect(aggregatePnlPercentage([equity()], [option()]).reason).toMatch(/not comparable/i);
    expect(aggregatePnlPercentage([], [option({ entryCredit: 0 })]).value).toBeNull();
  });
});
