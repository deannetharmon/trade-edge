import type { PmccPairResult } from './pmccTypes';

export interface PmccEntryOrderLeg {
  'instrument-type': 'Equity Option';
  symbol: string;
  quantity: number;
  action: 'Buy to Open' | 'Sell to Open';
}

/** The legacy PMCC entry ticket is exclusively for a new two-leg position.
 * Held-LEAPS candidates are deliberately rejected rather than degraded into
 * a dangerous two-leg order. */
export function buildNewPmccEntryOrderLegs(pair: PmccPairResult): PmccEntryOrderLeg[] {
  if (pair.entryMode === 'covered-short-call-against-held-leaps') {
    throw new Error('Held-LEAPS PMCC results are review-only and cannot use the two-leg entry ticket');
  }
  return [
    { 'instrument-type': 'Equity Option', symbol: pair.longLeg.occSymbol, quantity: 1, action: 'Buy to Open' },
    { 'instrument-type': 'Equity Option', symbol: pair.shortLeg.occSymbol, quantity: 1, action: 'Sell to Open' },
  ];
}
