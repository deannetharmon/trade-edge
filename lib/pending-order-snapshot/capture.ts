// lib/pending-order-snapshot/capture.ts
//
// PENDING-ENTRY-DECISION-SUPPORT-0001 -- fire-and-forget capture, called
// once per portfolio refresh cycle. Two responsibilities:
// 1. Write a new snapshot for a still-pending order when its reference
//    price has moved meaningfully since the LAST recorded point (not on
//    every refresh -- that would just be noise, same "threshold-based
//    writes" shape as the existing position-snapshot system).
// 2. Clean up history for orders that are no longer pending (filled or
//    cancelled) -- their drift history is no longer relevant to anything.
//
// Deliberately non-blocking: mirrors how snapshot/trend fetches in
// PortfolioDataProvider never block or fail the main refresh. A failure
// here degrades to "no new capture this cycle," never an error surfaced
// to the trader.

import type { PendingOrder } from '@/lib/portfolio-data/types';
import { MIN_TICK_FLOOR } from './driftEngine';
import type { PendingOrderQuoteSnapshot } from '@/app/api/pending-order-snapshots/route';

export async function fetchPendingOrderSnapshotStore(): Promise<Record<string, PendingOrderQuoteSnapshot[]>> {
  const res = await fetch('/api/pending-order-snapshots', { cache: 'no-store' });
  if (!res.ok) throw new Error(`pending-order-snapshots fetch failed (${res.status})`);
  const body = await res.json();
  return body?.snapshots ?? {};
}

/**
 * Decides whether the current reference is worth recording as a new data
 * point, given the most recent one on file. A simple tick-floor check --
 * not the full AND-with-gap-percentage rule computeDrift uses for the
 * recommendation itself, since this is a different question ("is this
 * worth logging at all") from "does the total drift since placement clear
 * the recommendation threshold."
 */
export function shouldCapture(lastRecorded: PendingOrderQuoteSnapshot | undefined, currentReference: number): boolean {
  if (!lastRecorded) return true; // always capture the first observation
  return Math.abs(currentReference - lastRecorded.currentReference) >= MIN_TICK_FLOOR;
}

export async function capturePendingOrderSnapshots(
  stillPending: PendingOrder[],
  noLongerPending: PendingOrder[],
  store: Record<string, PendingOrderQuoteSnapshot[]>,
): Promise<void> {
  const writes = stillPending
    .filter(order => order.quoteQuality === 'RELIABLE' && order.currentExecutablePrice != null)
    .filter(order => shouldCapture(store[order.id]?.at(-1), order.currentExecutablePrice!))
    .map(order =>
      fetch('/api/pending-order-snapshots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingOrderId: order.id,
          snapshot: { capturedAt: new Date().toISOString(), currentReference: order.currentExecutablePrice },
        }),
      }).catch(err => console.error('Pending order snapshot capture failed (non-blocking):', err))
    );

  const cleanups = noLongerPending
    .filter(order => store[order.id]?.length)
    .map(order =>
      fetch(`/api/pending-order-snapshots?pendingOrderId=${encodeURIComponent(order.id)}`, { method: 'DELETE' })
        .catch(err => console.error('Pending order snapshot cleanup failed (non-blocking):', err))
    );

  await Promise.all([...writes, ...cleanups]);
}
