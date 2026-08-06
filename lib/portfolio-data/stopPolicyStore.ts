// lib/portfolio-data/stopPolicyStore.ts
//
// TE-0002 corrective round: client-side fetch/post helpers for the
// canonical StopLossPolicy provenance store (app/api/position-stop-policies),
// mirroring fetchEntrySnapshots/postEntrySnapshots's shape in
// lib/portfolio-data/acquisition.ts. Kept in its own module (rather than
// folded into acquisition.ts) so the pure classification/breach logic in
// lib/portfolio/stopLossPolicy.ts never needs to import anything
// network-shaped, and so app/portfolio/page.tsx's stop-order authoring code
// can persist provenance without importing acquisition.ts's much larger
// surface.

import type { StopLossPolicy } from '@/lib/portfolio/stopLossPolicy';

// Stable position identity, independent of any particular stop ORDER id
// (which changes every time the stop is replaced/OCO-rebuilt). Keyed by
// account + short leg symbol -- the same identity classifyPositionStopLoss
// already uses to find the matching GTC order. This key intentionally does
// NOT change when a stop is replaced, so posting a new policy naturally
// overwrites the old one; the record's own `brokerOrderId` field is what
// gets cross-checked against the live order at read time.
export function positionStopPolicyKey(accountNumber: string, shortLegSymbol: string): string {
  return `${accountNumber}::${shortLegSymbol.replace(/\s+/g, '')}`;
}

export async function fetchStopPolicies(): Promise<Record<string, StopLossPolicy>> {
  try {
    const res = await fetch('/api/position-stop-policies');
    if (!res.ok) return {};
    const data = await res.json();
    return data?.policies ?? {};
  } catch {
    return {};
  }
}

// Always overwrites -- see the route's module doc. Non-blocking: callers
// treat this as best-effort (a failed persist means the stop still exists
// at the broker and correctly classifies UNKNOWN_PROVENANCE next load,
// never a fabricated basis).
export async function postStopPolicies(
  entries: { positionKey: string; policy: StopLossPolicy }[]
): Promise<Record<string, StopLossPolicy> | null> {
  if (entries.length === 0) return null;
  try {
    const res = await fetch('/api/position-stop-policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.policies ?? null;
  } catch {
    return null;
  }
}
