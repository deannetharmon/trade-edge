// lib/scans/pmccScanStatusSuffix.ts

// PMCC-RECEIPT-0001 part 2 (interim): the short delta window the scan actually ran with, appended
// to the scan-complete status line. Reads the scan SNAPSHOT criteria only, never live controls.

export interface PmccStatusSnapshotLike {
  criteria?: { shortDelta?: { min?: unknown; max?: unknown } | null } | null;
}

/** e.g. " · Δ 0.20–0.35"; '' when the snapshot has no finite delta window. Reversed bounds are ordered. */
export function pmccScanStatusSuffix(snapshot: PmccStatusSnapshotLike | null | undefined): string {
  const window = snapshot?.criteria?.shortDelta;
  if (!window) return '';
  const a = window.min;
  const b = window.max;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return '';
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return ` · Δ ${lo.toFixed(2)}–${hi.toFixed(2)}`;
}
