import type { Position } from '@/lib/portfolio-data/types';

export const STANDALONE_LEAPS_STOP_LOSS_CHOICES = [25, 35, 50] as const;
export type StandaloneLeapsStopLossPct = typeof STANDALONE_LEAPS_STOP_LOSS_CHOICES[number];
export type StandaloneLeapsStopEligibility = 'ELIGIBLE' | 'PMCC_MANAGED' | 'UNAVAILABLE';

export function evaluateStandaloneLeapsStopEligibility(position: Pick<Position, 'entryPriceEffect' | 'entryEconomicsComplete' | 'entryCredit' | 'quantity' | 'identity' | 'structureAmbiguous' | 'legs' | 'pairedShortCallKey' | 'dte'>): StandaloneLeapsStopEligibility {
  if (position.pairedShortCallKey != null) return 'PMCC_MANAGED';
  const leg = position.legs.length === 1 ? position.legs[0] : null;
  if (position.structureAmbiguous || !position.identity || position.identity.structureType !== 'NAKED' || position.entryPriceEffect !== 'Debit' || position.entryEconomicsComplete !== true || position.entryCredit == null || position.entryCredit <= 0 || position.quantity <= 0 || position.dte <= 120 || !leg || leg.direction !== 'Long' || leg.optionType !== 'C') return 'UNAVAILABLE';
  return 'ELIGIBLE';
}

export function standaloneLeapsStopProposal(entryDebitPerContract: number, maximumLossPct: StandaloneLeapsStopLossPct) {
  if (!Number.isFinite(entryDebitPerContract) || entryDebitPerContract <= 0) throw new Error('Original debit must be positive.');
  const triggerPrice = Number((entryDebitPerContract * (1 - maximumLossPct / 100)).toFixed(2));
  return { triggerPrice, maximumLossPct, expectedPnlPct: -maximumLossPct };
}
