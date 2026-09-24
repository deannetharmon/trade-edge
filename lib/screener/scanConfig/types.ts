// lib/screener/scanConfig/types.ts
//
// SCREENER-CONFIG-0001A -- the vocabulary of the scan-configuration registry.
//
// Every scan control is one of these lifecycles. The lifecycle says what the
// engine really does with the value, so the UI can never promise behavior the
// engine does not perform:
//
//   fetch          Sets the boundary of what is fetched. Nothing outside it is
//                  ever seen. Changing it needs a new scan.
//   gate           A qualification rule. A candidate that fails it is either a
//                  visible near-miss or a disqualified candidate, per strategy
//                  policy. Applied when the scan runs.
//   rank           A preference. Candidates stay, but their order (and, where a
//                  criterion says so, Best Opportunities eligibility) depends
//                  on it.
//   advisory       A warning only. Never removes or reorders a candidate.
//   result-filter  Retained in the fetched dataset and hidden from the current
//                  view. Adjustable after the scan without a rescan.
//   read-only      Disclosed context only.

export type Lifecycle = 'fetch' | 'gate' | 'rank' | 'advisory' | 'result-filter' | 'read-only';

export const LIFECYCLES: readonly Lifecycle[] = ['fetch', 'gate', 'rank', 'advisory', 'result-filter', 'read-only'];

/** Trader-facing tag text for each lifecycle. */
export const LIFECYCLE_TAG_LABEL: Record<Lifecycle, string> = {
  fetch: 'SEARCH RANGE',
  gate: 'GATE',
  rank: 'PREFERENCE',
  advisory: 'ADVISORY',
  'result-filter': 'RESULT FILTER',
  'read-only': 'READ ONLY',
};

/** Can relaxing the control recover a candidate that was already fetched? */
export type Recovery = 'yes' | 'no' | 'if-retained' | 'not-applicable';

export interface RetentionRule {
  /** What happens to a candidate the control excludes or demotes. */
  disposition: string;
  recovery: Recovery;
}

// The candidate-retention contract from SCREENER-CONFIG-0001, one row per lifecycle.
export const RETENTION: Record<Lifecycle, RetentionRule> = {
  fetch: { disposition: 'Not fetched outside the boundary', recovery: 'no' },
  gate: {
    disposition: 'Qualified, or an auditable near-miss or disqualified candidate, according to strategy policy',
    recovery: 'if-retained',
  },
  rank: { disposition: 'Retained and re-ordered', recovery: 'yes' },
  advisory: { disposition: 'Retained with a warning', recovery: 'yes' },
  'result-filter': { disposition: 'Retained in the fetched dataset but hidden from the current view', recovery: 'yes' },
  'read-only': { disposition: 'Disclosed context only', recovery: 'not-applicable' },
};

/** A scalar quick-select choice. `value: null` is the explicit off state ("Any"). */
export interface ScalarPreset {
  label: string;
  value: number | null;
}

/** A range quick-select choice (both ends set together). */
export interface RangePreset {
  label: string;
  min: number;
  max: number;
}

/** Where a criterion appears in the scan summary and the result receipt. */
export type SummaryGroup = 'search' | 'gates' | 'always' | 'advisory' | 'order' | 'adjustable' | 'capital' | 'capacity';

export const SUMMARY_GROUP_LABEL: Record<SummaryGroup, string> = {
  search: 'Search range',
  gates: 'Gates',
  always: 'Always applied',
  advisory: 'Advisory and preferences',
  order: 'Order',
  adjustable: 'Adjustable after the scan',
  capital: 'Capital',
  capacity: 'Capacity',
};

/** A rendered receipt group. `rescan` is true when the group needs a new scan to change. */
export interface ReceiptGroup {
  key: SummaryGroup;
  label: string;
  rescan: boolean;
  items: string[];
}
