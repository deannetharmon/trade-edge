// features/portfolio/positions-workspace/__tests__/longOptionRecovery.test.ts

import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { buildLongOptionRecovery } from '../model/longOptionRecovery';

const longPut = (overrides: Partial<Position> = {}): Position => ({
  key: 'p1', symbol: 'MRNA', strategy: 'PUT', quantity: 1, structureAmbiguous: false,
  identity: { quantity: 1 } as Position['identity'],
  entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 2574,
  closeValue: 286, currentValue: 303,
  legs: [{ symbol: 'put', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 3.03, currentDelta: null }],
  ...overrides,
} as Position);

describe('Long-option recovery model', () => {
  it('leads with liquidation value as a share of the verified debit', () => {
    const r = buildLongOptionRecovery(longPut());
    expect(r).not.toBeNull();
    expect(r!.paid).toBe(2574);
    expect(r!.closeNow).toBe(286);
    expect(Math.round(r!.remainingPct)).toBe(11);
    expect(r!.atOrAbovePaid).toBe(false);
  });

  it('turns the percent red at 25% or below, amber above, and the bar stays amber until at or above paid', () => {
    expect(buildLongOptionRecovery(longPut({ closeValue: 643.5 }))!.pctTone).toBe('negative');
    expect(buildLongOptionRecovery(longPut({ closeValue: 650 }))!.pctTone).toBe('warning');
    const mid = buildLongOptionRecovery(longPut({ closeValue: 1388 }))!;
    expect(mid.pctTone).toBe('warning');
    expect(mid.barTone).toBe('warning');
  });

  it('is green only when closing returns at least what was paid', () => {
    const r = buildLongOptionRecovery(longPut({ closeValue: 2574 }))!;
    expect(r.atOrAbovePaid).toBe(true);
    expect(r.pctTone).toBe('positive');
    expect(r.barTone).toBe('positive');
  });

  it('returns null for credit, mixed-leg, ambiguous, unverified, or unpriced positions', () => {
    expect(buildLongOptionRecovery(longPut({ entryPriceEffect: 'Credit' }))).toBeNull();
    expect(buildLongOptionRecovery(longPut({ legs: [
      { symbol: 'long', optionType: 'C', strikePrice: 50, direction: 'Long', quantity: 1, avgOpenPrice: 10, currentPrice: 9, currentDelta: null },
      { symbol: 'short', optionType: 'C', strikePrice: 60, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 1, currentDelta: null },
    ] }))).toBeNull();
    expect(buildLongOptionRecovery(longPut({ structureAmbiguous: true }))).toBeNull();
    expect(buildLongOptionRecovery(longPut({ entryEconomicsComplete: false }))).toBeNull();
    expect(buildLongOptionRecovery(longPut({ closeValue: null }))).toBeNull();
  });
});
