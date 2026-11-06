// LIQUIDITY-SYNC-0001 (Ian, Dean): ONE liquidity policy for every strategy's scan.
//  - Open interest of exactly 0 means no market exists: it is disqualified (a gate), never a warning.
//  - A preset/rule OI minimum (500 / 250 / 1000...) is advisory only: an amber chip, it never hides a trade.
//  - A "best pick" surface needs a non-POOR spread AND open interest at or above PICK_OI_FLOOR.
export const PICK_OI_FLOOR = 100;

/** True when the contract has any open interest at all (finite and > 0). */
export function hasOpenInterestMarket(oi: unknown): boolean {
  return typeof oi === 'number' && Number.isFinite(oi) && oi > 0;
}
