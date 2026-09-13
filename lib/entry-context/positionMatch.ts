// lib/entry-context/positionMatch.ts
//
// EXIT-PRESSURE-0001 -- a live open Position has no transaction ID to join
// against an entry snapshot's sourceTransactionIds (that join, in
// performance.ts's findSnapshotForTrade, only works for already-closed
// trades reconstructed from broker transaction history). A live position
// from the broker's positions API carries no memory of which transaction(s)
// opened it. The only available join here is structural: symbol,
// expiration, and strikes together are extremely unlikely to collide for
// two genuinely different positions on the same account, so a match on all
// of them is treated as strong evidence of the same position -- not proof
// the way a transaction ID would be, but the best available signal.
//
// If the same exact structure is opened twice (same symbol, expiration,
// strikes, quantity) before the first is closed, this cannot tell them
// apart -- an acknowledged, narrow limitation of structural matching that
// transaction-ID matching wouldn't have. Genuinely rare in practice (Dean's
// own trading doesn't stack identical structures), and the failure mode is
// silent non-detection (falls through to the generic threshold, today's
// behavior), not a wrong answer presented as right.
import type { Position } from '@/lib/portfolio-data/types';
import type { CreditSpreadEntrySnapshot } from './types';

/**
 * Finds the entry snapshot matching a live open credit-spread position, if
 * one exists. Returns null when there's no match (most positions today,
 * since this only covers trades opened after TRADE-ENTRY-SNAPSHOT-0001
 * shipped) or when the position's own strikes can't be determined.
 */
export function findSnapshotForOpenPosition(
  position: Position,
  snapshots: CreditSpreadEntrySnapshot[],
): CreditSpreadEntrySnapshot | null {
  const shortLeg = position.legs.find(leg => leg.direction === 'Short');
  const longLeg = position.legs.find(leg => leg.direction === 'Long');
  if (!shortLeg || !longLeg) return null;

  const candidates = snapshots.filter(snapshot =>
    snapshot.symbol === position.symbol &&
    snapshot.expiration === position.expDate &&
    snapshot.shortStrike === shortLeg.strikePrice &&
    snapshot.longStrike === longLeg.strikePrice &&
    snapshot.quantity === position.quantity
  );
  if (candidates.length === 0) return null;
  // If more than one snapshot structurally matches (the identical-structure-
  // opened-twice case above), prefer the most recently captured -- the
  // position currently open is more likely the recent entry than a stale
  // duplicate opened, closed, and reopened identically.
  return candidates.reduce((latest, candidate) =>
    candidate.capturedAt > latest.capturedAt ? candidate : latest
  );
}
