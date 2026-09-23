# SCREENER-SORT-0001 — Implementation report

**Date:** 2026-09-23 · **Built by:** Dane · **Base:** `794207e`

## What changed

Spreads Targeted results now have the same two-level sort as Ranked: primary sort buttons plus a "then" secondary dropdown, default Score then None.

| File | Change |
|---|---|
| `lib/screener/screenerResultOrdering.ts` | Adds `buildSpreadSortMetrics` (one shared metrics builder) and `SPREAD_SORT_FIELDS` (the sort fields a spread can populate). |
| `app/screener/page.tsx` | Extracts `SortRow` from `OiAndSortControls` (unchanged markup and behavior; `OiAndSortControls` now renders it). Targeted panel renders `SortRow`, sorts through `sortItems`, and takes a `SortSpec` instead of a single field. Ranked builds its sort metrics through the same shared builder. Removes the Targeted hard-coded comparator and `TargetedSortField`. |
| `app/screener/__tests__/OiAndSortWiring.test.tsx` | Adds a wiring test for the Targeted sort. Keeps every guard that the Ranked/Filtered OI floor never reaches Targeted. |
| `lib/screener/__tests__/spreadSortMetrics.test.ts` | New: 18 tests (builder mapping, field list pinned to the builder, each primary sort, legacy-order equivalence, secondary tie-break, missing-last, no mutation). |

## Deviation from the ticket, for Ian to confirm

The ticket said "the same eleven fields as Ranked." Three of them (Width minus debit %, Breakeven distance %, Annualized ROI %) are PMCC-only and always null for spreads, so as sort buttons they do nothing. Targeted offers the eight fields spreads can populate. A test pins the list to the builder so they cannot drift. **Ranked still shows those three inert buttons; that is existing behavior and was not changed.** Aligning Ranked is a one-line change (pass `SPREAD_SORT_FIELDS` to its `OiAndSortControls`).

## Behavior notes

- Score then None reproduces the previous Targeted Score order exactly (descending, ties keep input order). Tests replay the previous comparator for POP, Credit $, Credit %, ROC %, and OTM % as well.
- Targeted's "POP %" button label is kept (`sortLabels`).
- A field with no value sorts last. Previously a missing Credit $ or Credit % counted as 0 and a missing OTM % as -999; this only differs for entries with no value.
- Targeted's own Leg OI control and eligibility are untouched. State: `targetedSortBy` became `targetedSort` (a `SortSpec`). It was never persisted; it resets on the same events as before.

## Sibling paths checked

Ranked panel (now on the shared builder; its ordering tests pass unchanged), Filtered results via `FilteredResultControls`, CC, PMCC, and CSP call sites of `OiAndSortControls` (call count still 5, rendering unchanged), CSP Targeted (already uses the shared sort path), and the Targeted results cache/"restored" path (sort state is not part of it). Filtered-path metrics builders elsewhere in `page.tsx` were not changed.

## Verification

- `npx tsc --noEmit -p tsconfig.check.json`: 0 errors (also 0 before the change).
- `npx vitest run app/screener features/screener lib/screener lib/scans`: 80 files, 909 tests passed, 2 failed.
- The 2 failures are in `app/screener/__tests__/CspCandidateDiscovery.test.tsx` and **fail identically on the unchanged base `794207e`**. They are CSP tests this change does not touch. They should be looked at separately.
- Not covered by an automated test: the rendered Targeted panel. `TargetedScanResultsPanel` lives inside `page.tsx` and is not exported, so the wiring is pinned by source-structure tests instead. Check on the Vercel preview: run a Spreads Targeted scan, confirm the Sort row shows eight buttons and a "then" dropdown, sort by Score then Credit %, and confirm Score with None matches the previous order.
