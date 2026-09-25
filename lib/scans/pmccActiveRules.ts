// lib/scans/pmccActiveRules.ts

// PMCC-RECEIPT-0001 part 1: pure formatting for the "Active PMCC rules" line. Reads the scan
// SNAPSHOT criteria only (never live controls). Any item whose value is missing or non-finite is
// omitted, so nothing can render NaN, null or undefined. The delta window is not repeated here (it
// is on the scan-complete status line). SCAN-GUIDE-0001 can reuse this via the generic types.

export type PmccRulesEntryMode = 'new-pmcc' | 'covered-short-call-against-held-leaps';

/** Loose structural view of PmccScanSnapshot so any snapshot-shaped object (or an older one) works. */
export interface PmccActiveRulesSnapshotLike {
  criteria?: {
    dte?: { shortMin?: unknown; shortMax?: unknown } | null;
    shortOiMin?: unknown;
    quotePolicy?: { qualifyingSpreadPctMax?: unknown; shortWidthCeiling?: unknown } | null;
  } | null;
}

export interface PmccActiveRuleItem { label: string; value: string }

export interface PmccActiveRules {
  heading: string;
  items: PmccActiveRuleItem[];
  caption: string;
}

export const PMCC_RULES_CAPTION = 'Short call rules only. LEAP rules are not shown.';
export const PMCC_EARNINGS_RULE_TEXT = 'Short calls expiring on or after the report are removed';

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function trimNumber(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/**
 * Held scans are identified by the result pairs' entryMode (the source the held outcome cards use).
 * The PMCC scan today only ever runs against held LEAPS, so with no result to read the answer is
 * 'held'; a scan is 'new' only when a result explicitly says new-pmcc and none says held.
 */
export function pmccScanEntryMode(
  results: ReadonlyArray<{ pmccPair?: { entryMode?: PmccRulesEntryMode } | null }> | null | undefined,
): PmccRulesEntryMode {
  let sawNew = false;
  const list = results ?? [];
  for (let i = 0; i < list.length; i++) {
    const mode = list[i]?.pmccPair?.entryMode;
    if (mode === 'covered-short-call-against-held-leaps') return mode;
    if (mode === 'new-pmcc') sawNew = true;
  }
  return sawNew ? 'new-pmcc' : 'covered-short-call-against-held-leaps';
}

/** Returns null when there is no snapshot (render nothing). */
export function formatPmccActiveRules(
  snapshot: PmccActiveRulesSnapshotLike | null | undefined,
  entryMode: PmccRulesEntryMode = 'new-pmcc',
): PmccActiveRules | null {
  if (!snapshot) return null;
  const c = snapshot.criteria ?? null;
  const items: PmccActiveRuleItem[] = [];

  const dte = c?.dte;
  if (dte && finite(dte.shortMin) && finite(dte.shortMax)) {
    const lo = Math.min(dte.shortMin, dte.shortMax);
    const hi = Math.max(dte.shortMin, dte.shortMax);
    items.push({ label: 'Short DTE', value: `${trimNumber(lo, 0)}–${trimNumber(hi, 0)}` });
  }
  const spread = c?.quotePolicy?.qualifyingSpreadPctMax;
  if (finite(spread)) items.push({ label: 'Max spread', value: `${trimNumber(spread, 2)}% of mid (min $0.05)` });
  const ceiling = c?.quotePolicy?.shortWidthCeiling;
  if (finite(ceiling)) items.push({ label: 'Width ceiling', value: `$${ceiling.toFixed(2)}` });
  const oi = c?.shortOiMin;
  if (finite(oi)) items.push({ label: 'Short OI', value: `≥ ${trimNumber(oi, 0)}` });
  items.push({ label: 'Earnings', value: PMCC_EARNINGS_RULE_TEXT });

  return {
    heading: `Active PMCC rules · ${entryMode === 'covered-short-call-against-held-leaps' ? 'Held LEAP' : 'new LEAP + short call'}`,
    items,
    caption: PMCC_RULES_CAPTION,
  };
}
