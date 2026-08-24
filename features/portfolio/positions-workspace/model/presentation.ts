import type { Position, PositionLeg } from '@/lib/portfolio-data/types';

export type SemanticTone = 'positive' | 'negative' | 'warning' | 'informational' | 'neutral';
export type MoneynessState = 'OTM' | 'ATM' | 'ITM';

export const SEMANTIC_TONE_CLASS: Record<SemanticTone, string> = {
  positive: 'text-emerald-400', negative: 'text-red-400', warning: 'text-amber-300',
  informational: 'text-sky-300', neutral: 'text-white/50',
};

export function comparisonTone(prior: number | null | undefined, current: number | null | undefined, goodWhenHigher = true): SemanticTone {
  if (prior == null || current == null || !Number.isFinite(prior) || !Number.isFinite(current)) return 'neutral';
  const delta = current - prior;
  if (Math.abs(delta) < 0.01) return 'neutral';
  return (delta > 0) === goodWhenHigher ? 'positive' : 'negative';
}

export function directionalMovementTone(prior: number | null | undefined, current: number | null | undefined): SemanticTone {
  if (prior == null || current == null || !Number.isFinite(prior) || !Number.isFinite(current) || Math.abs(current - prior) < 0.01) return 'neutral';
  return 'informational';
}

function relevantLeg(legs: readonly PositionLeg[]): PositionLeg | null {
  if (legs.length === 1) return legs[0];
  const shorts = legs.filter(leg => leg.direction === 'Short');
  return shorts.length === 1 ? shorts[0] : null;
}

export interface MoneynessViewModel { state: MoneynessState; distancePct: number; tone: SemanticTone; leg: PositionLeg }

export function buildMoneynessViewModel(stockPrice: number | null, legs: readonly PositionLeg[], atmDisplayTolerancePct = 0.05): MoneynessViewModel | null {
  if (stockPrice == null || !Number.isFinite(stockPrice) || stockPrice <= 0) return null;
  const leg = relevantLeg(legs);
  if (!leg || !Number.isFinite(leg.strikePrice) || leg.strikePrice <= 0) return null;
  const distancePct = Math.abs(stockPrice - leg.strikePrice) / stockPrice * 100;
  const state: MoneynessState = distancePct < atmDisplayTolerancePct ? 'ATM'
    : leg.optionType === 'C' ? (stockPrice < leg.strikePrice ? 'OTM' : 'ITM')
      : (stockPrice > leg.strikePrice ? 'OTM' : 'ITM');
  const adverseItm = state === 'ITM' && leg.direction === 'Short';
  const tone: SemanticTone = state === 'ATM' ? 'warning' : state === 'ITM' ? (adverseItm ? 'negative' : 'positive') : distancePct < 5 ? 'warning' : 'positive';
  return { state, distancePct, tone, leg };
}

export interface CapitalViewModel { label: string; value: number | null; suffix?: string; reason?: string }

export function buildCapitalViewModel(position: Position): CapitalViewModel {
  if (position.structureAmbiguous || !position.identity) return { label: 'Unavailable', value: null, reason: position.structureBlockMessage ?? 'Canonical position identity unavailable' };
  if (position.entryPriceEffect === 'Debit') {
    const debit = position.entryEconomicsComplete === true && position.entryCredit != null && Number.isFinite(position.entryCredit) && position.entryCredit > 0 ? position.entryCredit : null;
    return debit == null ? { label: 'Unavailable', value: null, reason: 'Verified opening debit unavailable' } : { label: 'Capital at risk', value: debit };
  }
  if (position.strategy === 'CSP') return position.maxRiskReliable === true && Number.isFinite(position.maxRisk) ? { label: 'Cash required', value: position.maxRisk } : { label: 'Unavailable', value: null, reason: 'Cash-secured collateral unavailable' };
  if (position.strategy === 'CC') return { label: 'Shares securing call', value: position.identity.quantity * 100, suffix: ' shares' };
  if (position.maxRiskReliable === true && Number.isFinite(position.maxRisk)) return { label: 'Max risk', value: position.maxRisk };
  return { label: 'Unavailable', value: null, reason: 'Reliable capital requirement unavailable' };
}

export function stopPresentation(classification: Position['stopLossClassification']): { label: string; tone: SemanticTone; action: string } {
  switch (classification) {
    case 'ALIGNED': return { label: 'Aligned', tone: 'positive', action: 'Adjust' };
    case 'TOO_LOOSE': return { label: 'Too loose', tone: 'warning', action: 'Adjust' };
    case 'TOO_TIGHT': return { label: 'Too tight', tone: 'warning', action: 'Verify/Adjust' };
    case 'UNKNOWN_PROVENANCE': return { label: 'Unverified', tone: 'warning', action: 'Verify' };
    case 'INVALID': return { label: 'Invalid', tone: 'negative', action: 'Repair Stop' };
    default: return { label: 'No stop', tone: 'warning', action: 'Add Stop' };
  }
}
