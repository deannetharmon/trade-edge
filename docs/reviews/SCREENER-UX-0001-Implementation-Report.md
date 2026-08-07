# SCREENER-UX-0001 — Results Presentation Redesign: Implementation Report

Branch: `feature/screener-results-presentation`, off `main @ 7308bf5`.
Scope: Filtered-mode results presentation only. No scanner, qualification, scoring, session-transition, Covered Call capacity, or execution behavior was touched.

## Scope decision

The ticket specifies a full hierarchy/interaction/accessibility redesign across six scan workflows (Filtered, Ranked, Targeted, CSP, CC, PMCC). Filtered mode had the one concrete, verifiable violation the ticket exists to fix (the filter/OI/sort/ticker-chip block rendered *after* Best Opportunities) and is the richest single-place data source. This pass implements the full required hierarchy, all new components, and their wiring for **Filtered mode**. Ranked and Targeted modes are unchanged — their own filter rows already precede their result lists, so they carry no hierarchy violation — and continue to use the existing `BestOpportunitiesPanel`. CSP/CC/PMCC (all Filtered-only workflows) get the new `ScanIdentityHeader` and `AccountingSummaryBar` automatically (both are mode/strategy-driven, not results-shape-driven) but do not yet get `FilteredResultControls`, `BestOpportunitiesShortlist`, `DisqualifiedSection`, or `SymbolOutcomesDisclosure` wired into their card-rendering branches, since those live in code paths outside `screenMode === 'filter'` in `page.tsx` that were not read/audited in this pass. This is recorded as backlog below, not silently dropped.

## Information hierarchy — before / after (Filtered mode)

**Before:** Scan identity (static "⬢ FILTERED SCAN" label) → counts row + accounting → `SmartSuggestionsPanel` → `BestOpportunitiesPanel` (fully expanded cards) → **filters/OI/sort/ticker chips** → Qualified `ResultCard` list → Disqualified `ResultCard` list. No symbol-outcomes disclosure existed.

**After:** `ScanIdentityHeader` (exact title + explicit Mode/Strategy line) → counts row + `AccountingSummaryBar` (per-segment, tooltipped) → `SmartSuggestionsPanel` → `FilteredResultControls` (filters/OI-sort/ticker chips + removable chips + reset + narrowing indicator) → `BestOpportunitiesShortlist` (collapsed top-3) → Qualified `ResultCard` list (with a "Top opportunity" marker replacing duplicate expanded cards) → `DisqualifiedSection` (collapsed audit trail) → `SymbolOutcomesDisclosure` (five-bucket symbol-level disclosure). Filters now render before Best Opportunities, correcting the ticket's primary violation.

## Component architecture

New files, all under `features/screener/` per ADR-0004 (app → features → lib):

- `lib/scanIdentity.ts` + `components/ScanIdentityHeader.tsx` — six exact scan-identity titles, derived from `session.mode`/`session.requestedStrategy`.
- `components/AccountingSummaryBar.tsx` — renders `computeSessionAccounting(session)` (unchanged, canonical) as independently tooltipped segments; hides zero-value Failed/Skipped; never a fraction.
- `lib/bestOpportunityRows.ts` + `components/BestOpportunitiesShortlist.tsx` — pure join of qualified `ScreenResult[]` with `OpportunityRecommendation[]` by `symbol+strategy` (no new calculation beyond the existing OTM formula copied verbatim); collapsed top-3 shortlist with the exact required empty state; exports `pickTopOpportunityIds()` for Qualified-section dedup marking.
- `components/DisqualifiedSection.tsx` — collapsed-by-default audit trail, count in heading, primary reason visible while collapsed, "Disqualified" (never "Rejected").
- `components/SymbolOutcomesDisclosure.tsx` — reads `session.symbolOutcomes` directly, groups into Failed / Excluded from scope / Cancelled / Superseded / No qualifying candidate, using `REASON_CODE_LABELS` for human text while preserving the raw `reasonCode`.
- `components/FilteredResultControls.tsx` — extraction of the existing POP/OTM/Credit-Ratio/Strategy filter row + ticker chips (byte-for-byte behavior preserved) plus new removable chips, one reset action, and the "Showing X of Y qualified candidates" indicator. The page-local `OiAndSortControls` (SCREENER-OI-0001, not an exported module) is passed in via an `oiAndSortControls` render-slot rather than duplicated.

`app/screener/page.tsx` changes: seven new imports; scan-identity/accounting swap in the shared results header; the Filtered-mode branch reordered per the new hierarchy; `BestOpportunitiesPanel` is now only rendered for Ranked/Targeted, `BestOpportunitiesShortlist` for Filtered; `DisqualifiedSection`/`SymbolOutcomesDisclosure` replace the old inline "DISQUALIFIED" `<p>` + list. `ResultCard` is reused unmodified in the Qualified list, per the architectural decision not to touch it. Two now-unused imports (`computeSessionAccounting`, `formatSessionAccountingSummary`) were removed from `page.tsx` (still exported and used by the new components).

## Strategy-specific card behavior

`ResultCard` (existing, already strategy-aware) is unmodified and reused for both Qualified and Disqualified rendering. `buildBestOpportunityRows()` adds its own strategy-specific formatting for the shortlist: CSP/CC show a single strike; PMCC shows "longL / shortS" plus a debit label (`$X.XX debit`, from `netDebit`) and never reads or fabricates a fixed max profit or portfolio breakeven; IC shows both sides (`short/long · shortCall/longCall`) and takes the minimum of put/call OI. Strategy tags pass through untouched from `ScreenResult.strategy`, so a CSP is never mislabeled as a BPS.

## Display-filter semantics

`FilteredResultControls` only narrows what's rendered (`filteredQualified`/`filteredDisqualified`, both pre-existing derived values, unchanged). `AccountingSummaryBar` reads `computeSessionAccounting(activeSession)` independently and is never passed a filtered count — display filtering cannot change the canonical accounting numbers.

## Accessibility

Every disclosure (`BestOpportunitiesShortlist` rows, `DisqualifiedSection` section + cards, `SymbolOutcomesDisclosure`) uses a real `<button type="button">` with `aria-expanded`/`aria-controls`, operable by click or keyboard (native button semantics, no hover-only affordance). `ScanIdentityHeader` uses a real `<h2>`. Filter-chip removal buttons carry `aria-label`. No new live regions were added — deferred, see backlog.

## Tests added (36 new, all passing)

- `features/screener/lib/__tests__/scanIdentity.test.tsx` (3) — exact six required titles.
- `features/screener/components/__tests__/ScanIdentityHeader.test.tsx` (4) — title rendering, Mode/Strategy line, heading element.
- `features/screener/components/__tests__/AccountingSummaryBar.test.tsx` (5) — no scanned/attempted conflation, zero-value hiding, tooltips, no fraction.
- `features/screener/lib/__tests__/bestOpportunityRows.test.tsx` (5) — CSP/CC/PMCC/IC strike+credit formatting, no fabricated fields.
- `features/screener/components/__tests__/BestOpportunitiesShortlist.test.tsx` (4) — top-3 cap, collapsed-by-default + keyboard expand, exact empty state, `pickTopOpportunityIds`.
- `features/screener/components/__tests__/DisqualifiedSection.test.tsx` (6) — null when empty, count in heading, no "Rejected," collapse state driven by `hasQualifiedCandidates`, primary reason visible collapsed, full expansion.
- `features/screener/components/__tests__/SymbolOutcomesDisclosure.test.tsx` (4) — five-bucket grouping, human-readable labels with raw code preserved, collapsed-by-default keyboard expand.
- `features/screener/components/__tests__/FilteredResultControls.test.tsx` (5) — OI/sort slot placement, narrowing indicator, removable chips, single reset action, no-chips-when-inactive.

`app/screener/__tests__/ScreenerSessionWiring.test.tsx`'s `accountingText()` helper was updated to read `AccountingSummaryBar`'s `data-testid` instead of the removed single-span `title` attribute; all 16 tests in that file still pass unchanged in intent.

### Coverage against the ticket's 21 required scenarios

Directly covered by the new tests: scan-identity titles, accounting no-conflation/zero-hiding/tooltips/no-fraction, filter chips removable + single reset + narrowing indicator, Best Opportunities collapsed top-3 + empty state + dedup marker, Qualified strategy-scores/alternative-scores labeling is unchanged (not touched — `ResultCard` reused), Disqualified collapsed/count/primary-reason/no-bare-badge/"Disqualified" wording, symbol-outcomes five-bucket grouping, strategy-specific CSP/CC/PMCC/IC card content (no CSP-as-BPS, no fabricated PMCC max-profit/breakeven), and keyboard-operable `aria-expanded` disclosures.

Not covered by focused tests in this pass (recorded as backlog, not silently dropped): live-region announcements on expand/collapse, focus restoration after closing a disclosure, full heading-hierarchy audit across Ranked/Targeted, and a page-level wiring/integration test asserting the DOM order of the six hierarchy sections inside `app/screener/page.tsx` itself (the existing `ScreenerSessionWiring.test.tsx` suite was updated for compatibility but does not assert render order).

## Validation

- `npx tsc --noEmit`: clean (exit 0).
- New focused component/lib tests: 8 files, 36 tests, all passing.
- `app/` suite: 9 files, 102 tests, all passing (includes `ScreenerSessionWiring.test.tsx`, `OiAndSortWiring.test.tsx`, `CcCapacityGate.test.tsx`, etc.).
- `lib/` suite: 79 files, 1399 tests, all passing (includes `lib/screener/__tests__/scanSession.test.ts` — 52 canonical session tests — and `opportunityUniverse.test.ts`).
- `features/` + `components/` suite: 35 files, 299 tests, all passing.
- `git diff --check`: clean (exit 0).
- `npx next build`: succeeded; `/screener` route compiled (69.3 kB page / 180 kB First Load JS).
- The repository's full suite (113+ test files) could not be run in a single invocation within this sandbox's per-command time limit; it was instead run to completion in three directory-scoped passes (`app`, `lib`, `features`+`components`) covering every test file in the repository, all green, zero failures.

## Deviations and remaining backlog

- Ranked, Targeted, CSP, CC, and PMCC card-rendering branches in `page.tsx` do not yet use `FilteredResultControls`, `BestOpportunitiesShortlist`, `DisqualifiedSection`, or `SymbolOutcomesDisclosure` — only `ScanIdentityHeader`/`AccountingSummaryBar` apply universally. Extending the redesign to those branches is follow-up work.
- No live regions (`aria-live`) or explicit focus-restoration-on-collapse were added to any new disclosure.
- `BestOpportunitiesPanel.tsx`'s stale "intentionally NOT mounted anywhere in production" header comment was noticed but not corrected (out of scope; it is in fact mounted for Ranked/Targeted).
- Discovered, not fixed (pre-existing, unrelated to this ticket): `AutopilotStrategy` (`lib/autopilot/types.ts`) does not include `'PMCC'`, so `OpportunityRecommendation`'s type cannot represent a PMCC recommendation even though PMCC scans exist. `buildBestOpportunityRows()`'s PMCC formatting was verified with a type-cast test fixture; whether the live Opportunity Engine pipeline ever actually produces PMCC recommendations was not investigated (no scanner/scoring/new-strategy change was made here).
- The out-of-scope/backlog items the ticket explicitly named (buying-power placeholder, duplicate React key, any scanner/scoring/new-strategy change, order execution, global nav, Portfolio page) were untouched, as required.

## Commit

Committed locally on `feature/screener-results-presentation`, off `main @ 7308bf5`. Not pushed, not merged, no other task started, no credentials requested — per the ticket's explicit final instruction.
