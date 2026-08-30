import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import {
  buildLeapsEconomics,
  computeDebitCloseNowReturnPct,
  computeLongCallIntrinsicValue,
  computeLongCallMoneynessPct,
} from '../leapsPositionIntelligence';

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'nvda-leaps', symbol: 'NVDA', expDate: '2028-01-21', dte: 510, strategy: 'CALL',
    structureAmbiguous: false, structureBlockMessage: null,
    legs: [{ symbol: 'NVDA  280121C00120000', optionType: 'C', strikePrice: 120, direction: 'Long', quantity: 1, avgOpenPrice: 75, currentPrice: 94.5 }],
    quantity: 1,
    identity: { contractMultiplier: 100 } as Position['identity'],
    entryPriceEffect: 'Debit', entryCredit: 7500, entryEconomicsComplete: true, creditReceived: 0,
    currentValue: 9450, closeValue: 9200, pnl: 1950, pnlPct: 26, closeNowPnl: 1700,
    pnlReliable: true, stockPrice: 184.35,
    ...overrides,
  } as Position;
}

describe('LEAPS position intelligence', () => {
  it('computes debit close-now return from verified original debit', () => {
    expect(computeDebitCloseNowReturnPct({ entryPriceEffect: 'Debit', entryEconomicsComplete: true, originalDebit: 7500, closeNowPnl: 1700 }))
      .toBeCloseTo(22.6667, 3);
  });

  it('never computes close-now return from missing or credit economics', () => {
    expect(computeDebitCloseNowReturnPct({ entryPriceEffect: 'Debit', entryEconomicsComplete: false, originalDebit: 7500, closeNowPnl: 1700 })).toBeNull();
    expect(computeDebitCloseNowReturnPct({ entryPriceEffect: 'Credit', entryEconomicsComplete: true, originalDebit: 7500, closeNowPnl: 1700 })).toBeNull();
    expect(computeDebitCloseNowReturnPct({ entryPriceEffect: 'Debit', entryEconomicsComplete: true, originalDebit: null, closeNowPnl: 1700 })).toBeNull();
  });

  it('applies quantity and multiplier exactly once to intrinsic value', () => {
    expect(computeLongCallIntrinsicValue({ underlyingPrice: 184.35, strikePrice: 120, quantity: 2, contractMultiplier: 100 }))
      .toBeCloseTo(12870, 6);
  });

  it('computes signed moneyness relative to the underlying', () => {
    expect(computeLongCallMoneynessPct({ underlyingPrice: 184.35, strikePrice: 120 })).toBeCloseTo(34.91, 2);
  });

  it('builds distinct midpoint and marketable LEAPS economics', () => {
    const result = buildLeapsEconomics(position());
    expect(result).toMatchObject({
      originalCost: 7500,
      estimatedValueNowMid: 9450,
      estimatedSellNowValue: 9200,
      unrealizedPnlMid: 1950,
      profitIfClosedNow: 1700,
    });
    expect(result?.returnIfClosedNowPct).toBeCloseTo(22.6667, 3);
    expect(result?.slippageVsMid).toBe(-250);
    expect(result?.intrinsicValueMid).toBeCloseTo(6435, 6);
    expect(result?.extrinsicValueMid).toBeCloseTo(3015, 6);
  });

  it('fails honestly when executable quote evidence is absent', () => {
    const result = buildLeapsEconomics(position({ closeValue: null, closeNowPnl: null }));
    expect(result?.estimatedSellNowValue).toBeNull();
    expect(result?.profitIfClosedNow).toBeNull();
    expect(result?.returnIfClosedNowPct).toBeNull();
    expect(result?.reasons).toContain('Executable sell quote unavailable');
  });
});
