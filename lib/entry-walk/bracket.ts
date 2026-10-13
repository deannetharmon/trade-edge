// lib/entry-walk/bracket.ts
//
// ENTRY-WALK-0001 (Ian, condition 1): the profit target and stop follow each step's price. These are the same
// expressions the Screener entry dialogs use for a single order (exitCredit = entryLimit); the walk recomputes all
// three from the step's own price and never carries the first step's bracket forward.

export interface EntryBracket {
  entryCredit: number;
  profitBuyback: number;
  stopTrigger: number;
  stopLimit: number;
}

export function bracketForPrice(entryCredit: number, gtcPct: number, stopMultiple: number): EntryBracket {
  const exitCredit = entryCredit;
  const profitBuyback = parseFloat((exitCredit * (1 - gtcPct / 100)).toFixed(2));
  const stopTrigger = parseFloat((exitCredit * stopMultiple).toFixed(2));
  const stopLimit = parseFloat((stopTrigger * 1.10).toFixed(2));
  return { entryCredit, profitBuyback, stopTrigger, stopLimit };
}
