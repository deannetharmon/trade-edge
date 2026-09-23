# SCREENER-SORT-0001 — Two-level sort on Targeted spread results

## Status

**Approved by Dean 2026-09-23 (request).** Ian confirms the sort-field list before build. Independent of `SCREENER-CONFIG-0001A`; recommended to build first (both touch `app/screener/page.tsx`).

## Problem

Spreads results had a primary sort plus a secondary "then" sort (for example score, then credit %). It is gone in Targeted. Dean sees it on the Ranked scan (Score, POP, Credit $, Credit %, ROC %, OTM %, Relevant-leg OI, DTE, Width minus debit %, Breakeven distance %, Annualized ROI %, then a secondary dropdown) but not on the Targeted scan (single sort: Score, POP %, Credit $, Credit %, ROC %, OTM %).

## Cause

Not a deletion. `SCREENER-OI-0001` (2026-08-06) deliberately kept Targeted out of scope, and tests enforce that (`OiAndSortWiring.test.tsx`). Targeted keeps a hard-coded single-field comparator ("pre-dating SCREENER-OI-0001") in `TargetedScanResultsPanel`. The two-level sort was reachable through Filter mode, which was hidden on 2026-09-11 (`3e8d949`, FILTER-MODE-REMOVAL-0002). Targeted is now where Spreads scans are run, so the gap is visible.

## Required behavior

1. Spreads Targeted results offer the same primary and secondary sort as Ranked: same fields, same secondary "then" dropdown, same default (Score, then None).
2. Ordering comes from the canonical `sortItems` and `SortSpec` in `lib/screener/screenerResultOrdering.ts`. No new local comparator.
3. Build the sort metrics for Targeted entries through one shared metrics builder that Ranked also uses, so the two modes cannot drift. A field with no value for an entry sorts last, as it does in Ranked.
4. Targeted keeps its own eligibility and Leg OI control unchanged. Only the sort is added. The OI floor state (`rankMinOi`, `filteredMinOi`) must not reach Targeted.
5. Extract the sort row from `OiAndSortControls` so Targeted renders the sort without the OI floor. Ranked, Filtered-path, CC, PMCC, and CSP call sites behave exactly as today.
6. Targeted sort state becomes a `SortSpec` (replacing `targetedSortBy`), reset on the same events the current sort resets on. Dane verifies whether it is persisted and matches that.

## Out of scope

CSP Targeted (already uses the shared sort path), Ranked, CC, PMCC, LEAPS, the Leg OI control, and any change to Targeted qualification.

## Tests

- Targeted orders by primary, then by secondary, for every field pair with a distinct expected order (fixture per field).
- Missing values sort last for primary and secondary.
- Score-then-None matches today's single-sort order exactly (no regression for the default).
- Ranked ordering and its controls are unchanged.
- Update the `OiAndSortWiring.test.tsx` assertions that say Targeted never renders the sort. Keep asserting Targeted never references `minOi`, `rankMinOi`, or `filteredMinOi`, and that the extracted sort row is used, not a copy.

## Verification

`tsc --noEmit` and the `app/screener` and `lib/screener` suites. Vercel preview is the authoritative build check. Compare Targeted results before and after with sort at Score, then None: identical order.

## Sibling paths to confirm

Ranked panel (`getRankedMetrics`), Filtered results via `FilteredResultControls`, CC and PMCC call sites, `TargetedScanResultsPanel` props and its tests, session or cache restore of Targeted results ("restored" state in the screenshot).
