import type { Position } from '@/lib/portfolio-data/types';
import { computeIcBreakevens, computeSingleLegBreakeven } from '@/lib/portfolio/positionMetrics';

export interface BreakevenViewModel {
  values: number[];
  unavailableReason: string | null;
}

export function buildBreakevenViewModel(position: Position): BreakevenViewModel {
  if (position.structureAmbiguous) return { values: [], unavailableReason: 'Position structure is ambiguous' };
  if (position.strategy === 'PMCC') return { values: [], unavailableReason: 'PMCC has no single canonical breakeven' };
  if (position.strategy === 'CC') return { values: [], unavailableReason: 'Covered Call share cost basis is not present on the option position' };
  if (position.entryEconomicsComplete !== true || position.entryCredit == null || !Number.isFinite(position.entryCredit)) {
    return { values: [], unavailableReason: 'Opening credit or debit is unavailable' };
  }
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    return { values: [], unavailableReason: 'Canonical contract quantity is unavailable' };
  }

  const creditPerShare = position.entryCredit / (position.quantity * 100);
  const shortPut = position.legs.find(leg => leg.direction === 'Short' && leg.optionType === 'P');
  const shortCall = position.legs.find(leg => leg.direction === 'Short' && leg.optionType === 'C');
  if (position.entryPriceEffect === 'Credit' && shortPut && shortCall) {
    const result = computeIcBreakevens(shortPut.strikePrice, shortCall.strikePrice, creditPerShare);
    return result.lowerBreakeven != null && result.upperBreakeven != null
      ? { values: [result.lowerBreakeven, result.upperBreakeven], unavailableReason: null }
      : { values: [], unavailableReason: 'Iron Condor opening economics are incomplete' };
  }
  if (position.entryPriceEffect === 'Credit' && shortPut) {
    const value = computeSingleLegBreakeven(shortPut.strikePrice, creditPerShare, 'P');
    return value == null ? { values: [], unavailableReason: 'Put breakeven is unavailable' } : { values: [value], unavailableReason: null };
  }
  if (position.entryPriceEffect === 'Credit' && shortCall) {
    const value = computeSingleLegBreakeven(shortCall.strikePrice, creditPerShare, 'C');
    return value == null ? { values: [], unavailableReason: 'Call breakeven is unavailable' } : { values: [value], unavailableReason: null };
  }
  return { values: [], unavailableReason: 'No canonical breakeven policy exists for this structure' };
}
