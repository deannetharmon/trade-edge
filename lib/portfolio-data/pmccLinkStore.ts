// lib/portfolio-data/pmccLinkStore.ts
//
// PMCC-0003: client-side fetch/post helpers for the PmccLink store
// (app/api/pmcc-links), mirroring stopPolicyStore.ts's shape exactly --
// same reasoning applies here: kept in its own module so the pure
// intrinsic/extrinsic and decay-clock logic never needs to import anything
// network-shaped, and so page.tsx's PMCC UI can persist/read links without
// pulling in acquisition.ts's much larger surface.

import type { PmccLink } from './types';

// Stable identity for a PMCC pairing. Keyed by account + the LEAP's own
// position key -- mirrors positionStopPolicyKey's exact shape and reasoning
// (stopPolicyStore.ts) since the same collision risk applies here: a LEAP
// can only ever be paired with one short call at a time (see PMCC-0003
// ticket, "one call per slot"), so the LEAP's key is a natural, stable
// identity that doesn't change across short-call rolls -- but without the
// account scope, the same symbol+expiry LEAP open in two different
// accounts would silently collide in the store (PMCC-0004, Alan's finding).
export function pmccLinkKey(accountNumber: string, leapPositionKey: string): string {
  return `${accountNumber}::${leapPositionKey}`;
}

export async function fetchPmccLinks(): Promise<Record<string, PmccLink>> {
  try {
    const res = await fetch('/api/pmcc-links');
    if (!res.ok) return {};
    const data = await res.json();
    return data?.links ?? {};
  } catch {
    return {};
  }
}

// Always overwrites the record at this key -- used both for creating a new
// link and for updating an existing one (e.g. incrementing
// cumulativePremiumCollected/rollCount after a confirmed roll, or updating
// shortCallPositionKey to point at the new short leg). Non-blocking: a
// failed persist leaves the PMCC pairing exactly as it was before this
// call, never a corrupted partial state.
export async function postPmccLinks(
  entries: { key: string; link: PmccLink }[]
): Promise<Record<string, PmccLink> | null> {
  if (entries.length === 0) return null;
  try {
    const res = await fetch('/api/pmcc-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.links ?? null;
  } catch {
    return null;
  }
}

// Removes a PMCC pairing entirely (e.g. the trader closes the whole PMCC
// and doesn't want it cluttering future loads). Non-blocking, best-effort.
export async function deletePmccLink(key: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/pmcc-links?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
