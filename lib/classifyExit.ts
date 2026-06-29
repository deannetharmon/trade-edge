// path: lib/classifyExit.ts
// Single source of truth for spread exit classification, shared by the
// performance and trade-log pages so they can never drift apart again.
//
// Design principle: every category maps to a behavior you reinforce or correct.
// Severity ALWAYS dominates speed — catastrophic conditions are checked before
// any "how fast" logic, so a large same-day loss is a Max Loss, not a Fast Cut.

export type ExitType =
  | 'TARGET_HIT'
  | 'SCRATCH_WIN'
  | 'HELD_TO_EXPIRY'
  | 'MANAGED_LOSS'
  | 'TIME_STOP'
  | 'FAST_CUT'
  | 'MAX_LOSS'
  | 'UNKNOWN';

// Tunables, anchored to the Prosper ruleset (50% target, 2x stop, 21 DTE).
const TARGET_FLOOR_PCT   = 50;   // a "target hit" means you actually reached target
const TARGET_CEIL_PCT    = 75;   // above this you held for the last few $ (let-run)
const HELD_DURATION_FRAC = 0.75; // >= 75% of trade life elapsed = held to expiry
const STOP_LOW_PCT       = -150; // 2x-credit stop zone lower edge
const STOP_HIGH_PCT      = -250; // beyond this is a failure, not a managed stop
const MAX_LOSS_PCT       = -150; // % of credit that counts as catastrophic
const MAX_LOSS_DOLLARS   = -400; // absolute $ that counts as catastrophic
const STALE_LOSS_DAYS    = 14;   // a loss sat on this long is a failure of discipline

export function classifyExit(
  pnl: number,
  creditReceived: number,
  holdDays: number,
  dteAtClose: number,
  dteAtEntry: number,
): ExitType {
  if (creditReceived === 0) return 'UNKNOWN';
  const pnlPct = (pnl / Math.abs(creditReceived)) * 100;
  const pctOfDteUsed = dteAtEntry > 0 ? holdDays / dteAtEntry : 0;

  if (pnl > 0) {
    // Held deep into the trade for the win — mild caution (gamma risk for last $).
    if (pctOfDteUsed >= HELD_DURATION_FRAC) return 'HELD_TO_EXPIRY';
    // Took the planned profit target.
    if (pnlPct >= TARGET_FLOOR_PCT && pnlPct <= TARGET_CEIL_PCT) return 'TARGET_HIT';
    // Above the target ceiling but closed early — still a clean target hit.
    if (pnlPct > TARGET_CEIL_PCT) return 'TARGET_HIT';
    // Small gain below target — neutral info: edge being clipped early.
    return 'SCRATCH_WIN';
  }

  // ---- Losses. Severity dominates speed: check catastrophic first. ----
  if (pnlPct < MAX_LOSS_PCT || pnl <= MAX_LOSS_DOLLARS) return 'MAX_LOSS';
  if (holdDays >= STALE_LOSS_DAYS) return 'MAX_LOSS'; // sat on a loss too long
  // Cut at the planned 2x-credit stop zone — a DISCIPLINED loss.
  if (pnlPct <= STOP_LOW_PCT && pnlPct > STOP_HIGH_PCT) return 'MANAGED_LOSS';
  // Closed per the 21-DTE time rule.
  if (dteAtClose >= 0 && dteAtClose <= 21) return 'TIME_STOP';
  // Small loss exited quickly — defensive, fine (size already gated above).
  if (holdDays <= 2) return 'FAST_CUT';
  return 'FAST_CUT';
}
