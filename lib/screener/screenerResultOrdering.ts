// lib/screener/screenerResultOrdering.ts
//
// SCREENER-OI-0001 — canonical, pure minimum-relevant-leg-OI filtering and
// two-level result ordering, shared by Ranked, Filtered, and (optionally)
// Targeted scan result panels. See docs/tickets/SCREENER-OI-0001-oi-and-sort.md
// for the full ticket and docs/reviews/SCREENER-OI-0001-implementation-report.md
// for the implementation report, including the exact deviation on Bull Call
// Spread / Long LEAPS Call (canonical OI rule implemented and tested; no scan
// strategy exists yet to wire it into).
//
// This module deliberately keeps three concepts distinct, per the ticket:
//   1. Relevant-leg OI (what the user's minimum-OI filter and the "Relevant-
//      leg OI" sort field both read) — computeRelevantLegOI / OI_STRATEGY_LEGS.
//   2. All-leg quote validity (two-sided, non-crossed, finite bid/ask) — a
//      separate diagnostic, hasValidTwoSidedQuote / getProtectiveLegWarnings.
//      A candidate can have perfectly good relevant-leg OI and still carry a
//      quote-quality warning on a protective leg; the two are never merged
//      into one signal.
//   3. Any displayed diagnostic (e.g. "weakest leg across all legs") is
//      computed separately again and never silently substitutes for #1.
//
// Every function here is pure (no I/O, no React, no DOM) and works over
// small, structural, duck-typed interfaces rather than the full
// SpreadCandidate/ScreenResult shapes, so it can be unit-tested in isolation
// and reused from any UI surface without adapting those UI types first.

// ── Strategy-aware relevant-leg OI ──────────────────────────────────────────

export type OiStrategy = 'CSP' | 'CC' | 'BPS' | 'BCS' | 'BULL_CALL' | 'IC' | 'PMCC' | 'LEAPS';

// Structural, narrow input shape -- callers adapt their real candidate type
// into this (see extractOiLegsFromSpreadCandidate below for the adapter that
// covers every strategy SpreadCandidate actually produces today: CSP, CC,
// BPS, BCS, IC, PMCC). BULL_CALL and LEAPS are included in the type and in
// every pure function below (and are covered by the required regression
// tests) even though no scan strategy currently produces candidates for them
// -- see the implementation report for why that's an intentional, documented
// scope boundary rather than an oversight.
export interface OiCandidateLegs {
  strategy: OiStrategy;
  shortPutOI?: number | null;
  shortCallOI?: number | null;
  longCallOI?: number | null;
  longPutOI?: number | null;
}

interface LegOiSet {
  required: (number | null | undefined)[];
  protective: (number | null | undefined)[];
}

// Canonical strategy-aware OI rules (ticket, verbatim):
//   CSP: short put OI. CC: short call OI. BPS: short put OI.
//   BCS: short call OI. BULL_CALL: short call OI (mirrors BCS's shape).
//   IC: both short legs required independently; relevant-leg OI is the lower
//       of the two.
//   PMCC: both the long LEAPS call and the short call required independently.
//   LEAPS: long call OI.
// Protective long legs (BPS's long put, BCS/BULL_CALL's long call, IC's long
// put and long call) are never required to meet the floor -- they're
// diagnostic-only (see getProtectiveLegWarnings).
function getLegOiSet(legs: OiCandidateLegs): LegOiSet {
  switch (legs.strategy) {
    case 'CSP':
      return { required: [legs.shortPutOI], protective: [] };
    case 'CC':
      return { required: [legs.shortCallOI], protective: [] };
    case 'BPS':
      return { required: [legs.shortPutOI], protective: [legs.longPutOI] };
    case 'BCS':
      return { required: [legs.shortCallOI], protective: [legs.longCallOI] };
    case 'BULL_CALL':
      return { required: [legs.shortCallOI], protective: [legs.longCallOI] };
    case 'IC':
      return { required: [legs.shortPutOI, legs.shortCallOI], protective: [legs.longPutOI, legs.longCallOI] };
    case 'PMCC':
      // Both required independently -- neither is "protective" for PMCC:
      // the long LEAPS call IS the position, not a hedge on it.
      return { required: [legs.longCallOI, legs.shortCallOI], protective: [] };
    case 'LEAPS':
      return { required: [legs.longCallOI], protective: [] };
    default: {
      const _exhaustive: never = legs.strategy;
      return _exhaustive;
    }
  }
}

function isUsableOi(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v >= 0;
}

// The single relevant-leg OI value used for both the minimum-OI filter and
// the "Relevant-leg OI" sort field. For single-required-leg strategies this
// is just that leg's OI. For IC and PMCC (two independently-required legs)
// this is the lower of the two -- Math.min over a one-element array is that
// element, so one implementation covers both shapes. Returns null (not a
// fabricated 0) whenever any required leg's OI is unknown -- "Any" callers
// must not read this as "zero liquidity," just "unknown."
export function computeRelevantLegOI(legs: OiCandidateLegs): number | null {
  const { required } = getLegOiSet(legs);
  if (required.length === 0) return null;
  if (!required.every(isUsableOi)) return null;
  return Math.min(...(required as number[]));
}

export interface OiEligibilityResult {
  eligible: boolean;
  relevantLegOI: number | null;
  failureReason?: string;
  protectiveLegWarnings: string[];
}

// Fail-closed minimum-OI eligibility. minOi === 0 means "Any" -- the floor
// check is skipped entirely (never fabricates an OI value, and never fails a
// candidate for missing OI data). For any minOi > 0: every required leg must
// be present, finite, and >= minOi, or the candidate is ineligible -- missing
// OI data on a required leg is NOT treated as passing. Protective legs are
// never part of the pass/fail decision; they only ever produce warnings.
export function evaluateOiEligibility(legs: OiCandidateLegs, minOi: number): OiEligibilityResult {
  const { required, protective } = getLegOiSet(legs);
  const relevantLegOI = computeRelevantLegOI(legs);
  const protectiveLegWarnings = buildProtectiveWarnings(protective, minOi);

  if (minOi <= 0) {
    return { eligible: true, relevantLegOI, protectiveLegWarnings };
  }

  const anyMissing = required.some((v) => !isUsableOi(v));
  if (anyMissing) {
    return {
      eligible: false,
      relevantLegOI,
      failureReason:
        'Missing OI data on a required leg -- cannot verify the selected minimum-OI floor, so this candidate fails closed.',
      protectiveLegWarnings,
    };
  }

  const anyBelowFloor = (required as number[]).some((v) => v < minOi);
  if (anyBelowFloor) {
    return {
      eligible: false,
      relevantLegOI,
      failureReason: `Required leg OI is below the selected minimum of ${minOi}.`,
      protectiveLegWarnings,
    };
  }

  return { eligible: true, relevantLegOI, protectiveLegWarnings };
}

function buildProtectiveWarnings(protective: (number | null | undefined)[], minOi: number): string[] {
  const warnings: string[] = [];
  for (const v of protective) {
    if (!isUsableOi(v)) {
      warnings.push('Protective long leg OI data is unavailable -- its liquidity has not been verified.');
    } else if (minOi > 0 && v < minOi) {
      warnings.push(
        `Protective long leg OI (${v}) is below the selected minimum (${minOi}) -- weaker liquidity than the required leg(s). It is not required to clear the floor, but the weaker liquidity is real.`,
      );
    }
  }
  return warnings;
}

// ── Quote-validity diagnostic (distinct from OI) ────────────────────────────
//
// Mirrors, deliberately, the strict two-sided/non-crossed/finite quote gate
// already enforced for Covered Call's required leg in
// lib/scans/covered-call-finder.ts's isEligibleCcLeg (not imported -- that
// function is file-private and gates candidate generation itself, a
// different responsibility from this module's post-hoc diagnostic over
// whatever quote fields a given candidate already carries). Kept as its own
// named check so a protective leg's quote quality is never silently implied
// by the required leg's OI passing.
export interface LegQuote {
  bid?: number | null;
  ask?: number | null;
}

export function hasValidTwoSidedQuote(leg: LegQuote): boolean {
  if (leg.bid == null || leg.ask == null) return false;
  if (!Number.isFinite(leg.bid) || !Number.isFinite(leg.ask)) return false;
  if (!(leg.bid > 0) || !(leg.ask > 0)) return false;
  if (leg.ask < leg.bid) return false; // crossed market
  return true;
}

// ── Sorting ──────────────────────────────────────────────────────────────

export const SORT_FIELDS = [
  'score',
  'pop',
  'creditDollars',
  'creditPct',
  'rocPct',
  'otmPct',
  'relevantLegOI',
  'dte',
] as const;

export type SortField = (typeof SORT_FIELDS)[number];

export type SecondarySortField = SortField | 'none';

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  score: 'Score',
  pop: 'POP',
  creditDollars: 'Credit $',
  creditPct: 'Credit %',
  rocPct: 'ROC %',
  otmPct: 'OTM %',
  relevantLegOI: 'Relevant-leg OI',
  dte: 'DTE',
};

export interface SortSpec {
  primary: SortField;
  secondary: SecondarySortField;
}

// Every one of these metrics is "higher is better" by the existing codebase
// convention (score, pop, credit, roc, otm, oi, dte are all sorted
// descending elsewhere in the Screener today -- see
// TargetedScanResultsPanel's existing sort buttons and the Ranked-mode score
// sort). This module preserves that convention rather than introducing a
// per-field direction concept the ticket didn't ask for.
export interface SortableMetrics {
  score: number | null;
  pop: number | null;
  creditDollars: number | null;
  creditPct: number | null;
  rocPct: number | null;
  otmPct: number | null;
  relevantLegOI: number | null;
  dte: number | null;
}

// "Selecting a primary field already used as secondary should clear or
// appropriately replace the secondary field" -- and the reverse (primary and
// secondary can never be equal at rest). Both UI entry points funnel through
// these two functions so the dedup rule lives in exactly one place.
export function setPrimarySortField(spec: SortSpec, primary: SortField): SortSpec {
  return { primary, secondary: spec.secondary === primary ? 'none' : spec.secondary };
}

export function setSecondarySortField(spec: SortSpec, secondary: SecondarySortField): SortSpec {
  if (secondary !== 'none' && secondary === spec.primary) {
    // Can't set secondary to the current primary -- leave secondary
    // unchanged rather than silently clearing the user's primary choice.
    return spec;
  }
  return { primary: spec.primary, secondary };
}

function compareField(field: SortField, a: SortableMetrics, b: SortableMetrics): number {
  const av = a[field];
  const bv = b[field];
  // Missing values sort last regardless of which field or which sort level
  // they appear at, matching the existing `?? 0` / `?? -999` "missing loses"
  // convention used throughout the pre-existing Screener sort code.
  const aMissing = av == null;
  const bMissing = bv == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (bv as number) - (av as number); // descending
}

// Score-band note (ticket requirement: "preserve the existing intended
// score-band behavior if Score remains a grouped or tolerance-based ranking
// dimension; document the exact rule"): investigation confirmed no such
// grouped/tolerance-based ordering exists anywhere in the codebase today --
// Ranked mode's Score sort has always been a flat, continuous descending
// sort by the raw numeric score from scoreCandidate() (see
// lib/scans/rank-scoring.ts and lib/scans/ranked-scan-runner.ts). The only
// "band" concept, RankedScoreTierSummary's green/yellow/orange/red counts,
// is a presentational count derived independently by re-running
// scoreCandidate per result -- it has never grouped or reordered the actual
// results list, and this module does not change that. Score here therefore
// sorts exactly like every other numeric field: flat, continuous, descending.
//
// Deterministic tie-breaking rule (ticket requirement, documented exactly):
// primary field descending -> secondary field descending (if any) -> stable
// preservation of input order for anything still tied. Array.prototype.sort
// has been spec-guaranteed stable (ECMA-262 since ES2019; V8/Node have
// implemented this for years) so "preserve input order" is a real,
// reproducible guarantee, not an implementation accident -- given the same
// input array in the same order, sortItems always produces the same output.
export function sortItems<T>(items: T[], spec: SortSpec, getMetrics: (item: T) => SortableMetrics): T[] {
  const withMetrics = items.map((item) => ({ item, m: getMetrics(item) }));
  withMetrics.sort((a, b) => {
    const primaryCmp = compareField(spec.primary, a.m, b.m);
    if (primaryCmp !== 0) return primaryCmp;
    if (spec.secondary !== 'none') {
      const secondaryCmp = compareField(spec.secondary, a.m, b.m);
      if (secondaryCmp !== 0) return secondaryCmp;
    }
    return 0; // tie -- Array.sort's guaranteed stability preserves input order
  });
  return withMetrics.map((x) => x.item);
}

// ── Combined filter + sort pipeline ─────────────────────────────────────────
//
// One canonical entry point for "apply the minimum-OI floor, then apply the
// two-level sort" -- Ranked, Filtered, and Targeted all call this instead of
// each re-deriving eligibility/ordering. "Show Top N" is deliberately NOT
// applied inside this function: the ticket requires filtering and both sort
// levels to happen BEFORE any Show-Top-N slice, so callers slice the
// returned array themselves (or call filterSortAndSliceTop below, a thin
// convenience wrapper that does exactly that in the correct order).
export interface FilterAndSortOptions<T> {
  minOi: number;
  getLegs: (item: T) => OiCandidateLegs;
  getMetrics: (item: T) => SortableMetrics;
  sort: SortSpec;
}

export interface FilterAndSortResultEntry<T> {
  item: T;
  oi: OiEligibilityResult;
}

export function filterAndSortByOi<T>(items: T[], opts: FilterAndSortOptions<T>): FilterAndSortResultEntry<T>[] {
  const evaluated = items.map((item) => ({ item, oi: evaluateOiEligibility(opts.getLegs(item), opts.minOi) }));
  const eligible = evaluated.filter((e) => e.oi.eligible);
  const sortedItems = sortItems(
    eligible.map((e) => e.item),
    opts.sort,
    opts.getMetrics,
  );
  const byItem = new Map(eligible.map((e) => [e.item, e] as const));
  return sortedItems.map((item) => byItem.get(item) as FilterAndSortResultEntry<T>);
}

export function filterSortAndSliceTop<T>(
  items: T[],
  opts: FilterAndSortOptions<T>,
  topN: number,
): FilterAndSortResultEntry<T>[] {
  return filterAndSortByOi(items, opts).slice(0, topN);
}

// ── Minimum-OI presets ──────────────────────────────────────────────────────

export interface OiPreset {
  label: string;
  value: number; // 0 == "Any"
}

export const OI_PRESETS: OiPreset[] = [
  { label: 'Any', value: 0 },
  { label: '100', value: 100 },
  { label: '250', value: 250 },
  { label: '500', value: 500 },
];

export const MIN_OI_LABEL = 'Minimum relevant-leg OI';

export const MIN_OI_HELPER_TEXT =
  'The "relevant leg" depends on the strategy -- e.g. the short put for a Cash-Secured Put, the short call for a Covered Call, or the lower of both short legs for an Iron Condor. Protective long legs are never required to clear this floor.';

// ── Adapter: real SpreadCandidate-shaped data -> OiCandidateLegs ──────────
//
// SpreadCandidate (lib/scans/types.ts) reuses shortOI/longOI generically
// across CSP/CC/BPS/BCS/PMCC, with shortCallOI/longCallOI only populated for
// IC. This adapter is the one place that mapping is decoded, so nothing
// else has to re-derive "which field means which leg for which strategy."
export interface SpreadCandidateOiShape {
  shortOI?: number | null;
  longOI?: number | null;
  shortCallOI?: number | null;
  longCallOI?: number | null;
}

export function extractOiLegsFromSpreadCandidate(
  strategy: OiStrategy,
  candidate: SpreadCandidateOiShape,
): OiCandidateLegs {
  switch (strategy) {
    case 'CSP':
      return { strategy, shortPutOI: candidate.shortOI };
    case 'CC':
      return { strategy, shortCallOI: candidate.shortOI };
    case 'BPS':
      return { strategy, shortPutOI: candidate.shortOI, longPutOI: candidate.longOI };
    case 'BCS':
      return { strategy, shortCallOI: candidate.shortOI, longCallOI: candidate.longOI };
    case 'BULL_CALL':
      return { strategy, shortCallOI: candidate.shortOI, longCallOI: candidate.longOI };
    case 'IC':
      return {
        strategy,
        shortPutOI: candidate.shortOI,
        shortCallOI: candidate.shortCallOI,
        longPutOI: candidate.longOI,
        longCallOI: candidate.longCallOI,
      };
    case 'PMCC':
      // page.tsx's PMCC candidate construction sets shortOI = short call's
      // OI, longOI = the long LEAPS call's OI (both reusing the generic
      // fields, matching CC/CSP's convention of reuse-not-add).
      return { strategy, shortCallOI: candidate.shortOI, longCallOI: candidate.longOI };
    case 'LEAPS':
      return { strategy, longCallOI: candidate.longOI };
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}
