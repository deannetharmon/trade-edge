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

// PMCC-COMPARE-HELD-0001 — the held-LEAPS counterpart to
// buildNewPmccEntryOrderLegs above: a single-leg Sell to Open against a
// long call already owned in the account. Deliberately rejects any pair
// that is NOT held-LEAPS mode, mirroring the fail-closed shape of the
// function above -- each function only ever builds the order shape its
// own entry mode allows, so neither can be pointed at the wrong pair by
// mistake. quantity is the caller's UI-layer responsibility to cap at
// pair.heldLongLeg.quantity before calling this -- this function itself
// only guards against a non-positive/non-integer quantity. The real
// held-quantity ceiling is enforced authoritatively server-side in
// submitHeldPmccShortCallOrder (lib/leaps-analysis/serverTradeReview.ts),
// re-checked against the live broker position immediately before
// submission -- never trusted from the client alone.
export function buildHeldLeapsShortCallOrderLegs(pair: PmccPairResult, quantity: number): PmccEntryOrderLeg[] {
  if (pair.entryMode !== 'covered-short-call-against-held-leaps') {
    throw new Error('Only held-LEAPS PMCC results may use the single-leg sell-to-open ticket');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Quantity must be a positive integer');
  }
  return [
    { 'instrument-type': 'Equity Option', symbol: pair.shortLeg.occSymbol, quantity, action: 'Sell to Open' },
  ];
}
