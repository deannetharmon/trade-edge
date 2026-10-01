import type { Position } from '@/lib/portfolio-data/types';

import { isDebitStopLossPctValid, DEBIT_STOP_LOSS_PCT_MIN, DEBIT_STOP_LOSS_PCT_MAX } from './stopSlider';

// STOP-SLIDER-0001: the fixed 25/35/50 buttons were replaced by a slider
// (see stopSlider.ts for the range). The value is any trader-selected maximum
// loss percentage inside that range.
export type StandaloneLeapsStopLossPct = number;
export type StandaloneLeapsStopEligibility = 'ELIGIBLE' | 'PMCC_MANAGED' | 'UNAVAILABLE';

export function evaluateStandaloneLeapsStopEligibility(position: Pick<Position, 'entryPriceEffect' | 'entryEconomicsComplete' | 'entryCredit' | 'quantity' | 'identity' | 'structureAmbiguous' | 'legs' | 'pairedShortCallKey' | 'dte'>): StandaloneLeapsStopEligibility {
  if (position.pairedShortCallKey != null) return 'PMCC_MANAGED';
  const leg = position.legs.length === 1 ? position.legs[0] : null;
  if (position.structureAmbiguous || !position.identity || position.identity.structureType !== 'NAKED' || position.entryPriceEffect !== 'Debit' || position.entryEconomicsComplete !== true || position.entryCredit == null || position.entryCredit <= 0 || position.quantity <= 0 || !leg || leg.direction !== 'Long' || leg.optionType !== 'C') return 'UNAVAILABLE';
  return 'ELIGIBLE';
}

export function standaloneLeapsStopProposal(entryDebitPerContract: number, maximumLossPct: StandaloneLeapsStopLossPct) {
  if (!Number.isFinite(entryDebitPerContract) || entryDebitPerContract <= 0) throw new Error('Original debit must be positive.');
  if (!isDebitStopLossPctValid(maximumLossPct)) throw new Error(`Maximum loss must be between ${DEBIT_STOP_LOSS_PCT_MIN}% and ${DEBIT_STOP_LOSS_PCT_MAX}%.`);
  const triggerPrice = Number((entryDebitPerContract * (1 - maximumLossPct / 100)).toFixed(2));
  return { triggerPrice, maximumLossPct, expectedPnlPct: -maximumLossPct };
}
