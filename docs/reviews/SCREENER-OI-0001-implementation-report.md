# Implementation Report — SCREENER-OI-0001: Minimum OI Filter and Two-Level Sorting

See `docs/tickets/SCREENER-OI-0001-oi-and-sort.md` for the full ticket and rationale.

## Strategy-specific OI semantics

Implemented in `lib/screener/screenerResultOrdering.ts` (`getLegOiSet`, `computeRelevantLegOI`, `evaluateOiEligibility`):

- Single-required-leg strategies (CSP, CC, BPS, BCS, BULL_CALL, LEAPS): the relevant leg's OI must independently clear the floor; a protective leg (BPS/BCS/BULL_CALL's long leg) is diagnostic-only.
- Two-required-leg strategies (IC: both short legs; PMCC: the LEAPS long call and the short call): both legs must independently clear the floor. Relevant-leg OI for display/sort is `Math.min` of the two — for single-leg strategies this is the same function applied to a one-element array, so one implementation covers both shapes.
- A positive floor fails a candidate closed if any required leg's OI is missing, non-finite, or below the floor. "Any" (0) never fails on missing OI and `computeRelevantLegOI` returns `null` (never a fabricated number) whenever a required leg is unknown.
- Protective-leg warnings (`buildProtectiveWarnings`) are computed independently of the eligibility decision and never affect it — a candidate can be fully eligible while still carrying a warning about a weak or unverified protective leg.
- A quote-validity diagnostic (`hasValidTwoSidedQuote`) mirrors the existing strict two-sided/non-crossed/finite gate in `lib/scans/covered-call-finder.ts`'s `isEligibleCcLeg` (not imported — that function is file-private and gates candidate generation itself, a different responsibility) — kept as a separately named check so quote quality is never implied by OI passing.
- `extractOiLegsFromSpreadCandidate` is the one place that decodes `SpreadCandidate`'s field-reuse convention (CSP/CC/BPS/BCS/PMCC reuse `shortOI`/`longOI` generically; only IC populates `shortCallOI`/`longCallOI`) into the canonical per-strategy leg shape, so no call site re-derives "which field means which leg for which strategy."

## Score-awareness verification

Score is **not** changed by this ticket. The canonical scoring function remains `scoreCandidate` in `lib/scans/rank-scoring.ts`, called identically to before (`scoreCandidate(result, rankConfig)`) at every site that needs a Score value for sorting (Ranked mode's `getRankedMetrics`, Filtered mode's metrics extractor, Targeted mode's pre-existing per-entry `score` field). It is strategy-aware: internally, `scoreCandidate` branches on `c.strategy === 'BPS' | 'BCS' | 'IC'` for direction/sign-sensitive dimensions (expected-move clearance, range, buffer percentage, strategy-alignment). CSP, CC, and PMCC are not scored by `scoreCandidate` at all today (Ranked/Targeted's `exploreAllCandidatesForRank` only ever generates BPS/BCS/IC candidates) — that is pre-existing behavior, unchanged by this ticket. No scoring formula, weight, or threshold was modified.

Score-band behavior: confirmed via investigation that no grouped/tolerance-based Score ranking exists anywhere in the codebase — Ranked mode's Score sort has always been a flat, continuous descending sort by the raw `scoreCandidate` value (`lib/scans/rank-scoring.ts`, `lib/scans/ranked-scan-runner.ts`). The only "band" concept, `RankedScoreTierSummary`'s green/yellow/orange/red counts, is a presentational count re-derived independently and does not reorder the results list. This ticket's Score sort field preserves that exact behavior; the tier-count display is untouched.

## Ordering precedence

`sortItems` (in the canonical module) applies the primary field, then the secondary field (if not "None") as a tie-breaker, then relies on `Array.prototype.sort`'s spec-guaranteed stability to preserve input order for anything still tied — a real, reproducible determinism guarantee, not an implementation accident. All eight fields (Score, POP, Credit $, Credit %, ROC %, OTM %, Relevant-leg OI, DTE) sort descending, matching the pre-existing codebase convention (every existing sort in this file sorts `b - a`). Missing values sort last at either level.

Per-mode precedence: Ranked mode applies existing chip filters, then the new OI floor, then the two-level sort, then slices to `rankTopN` (`Show Top N`) — filtering and both sort levels run before the slice, per the ticket. Filtered mode applies the pre-existing qualify/disqualify split and chip filters, then the OI floor, then the two-level sort, to the QUALIFIED section (the DISQUALIFIED section is an unfiltered audit trail, deliberately left alone). Targeted mode's existing filter chain (ticker/POP/OTM/credit-ratio/strategy/trend) now also includes the OI floor before the two-level sort, before its own `showTopN` slice.

## Deviations

1. **Bull Call Spread and Long LEAPS Call**: canonical OI rule implemented and unit-tested (9 dedicated test cases across both), but no scan-strategy/candidate-generation exists for either anywhere in this codebase, and building that was explicitly descoped by product decision before implementation began (asked and confirmed). They remain unavailable in the live Screener UI, unchanged from before this ticket.
2. **Filtered mode's Strategy chip default** was extended from `['BPS','BCS','IC']` to include `CSP`, `CC`, `PMCC` — a minimal, in-scope enabling correction (see ticket doc) discovered while building the required wiring-level test for item 18; without it, CC/CSP/PMCC results were silently excluded from Filtered mode's QUALIFIED/DISQUALIFIED display regardless of any OI setting, which directly blocked this ticket's "consistent behavior... across scan modes" requirement for those strategies.
3. **Protective-leg quote-validity check** (`hasValidTwoSidedQuote`) is provided as a diagnostic-capable pure function but is not independently wired into every finder — `SpreadCandidate`'s type only carries one bid/ask pair for the primary short/long leg (no separate quote fields for IC's call side or CC/PMCC), so full per-leg quote-validity wiring beyond what the existing finders already gate at candidate-generation time was not attempted; this is disclosed as a data-shape limitation, not an oversight.

## Tests

`lib/screener/__tests__/screenerResultOrdering.test.ts` — 33 tests, covering all 16 lib-level required scenarios (vertical-spread pass/fail with weak protective leg, IC both-pass/one-fail/missing-OI, PMCC pass/either-fails, LEAPS, every preset + custom value, missing OI under Any vs. a floor, all three required Score→X sort combinations, duplicate primary/secondary prevention, deterministic tie-breaking, filter-and-sort-before-Show-Top-N).

`app/screener/__tests__/OiAndSortWiring.test.tsx` — 4 tests covering the remaining wiring-level requirements: the canonical control/functions are defined exactly once and used at all three call sites (Filtered/Ranked/Targeted), the control doesn't render before there are results (in either mode, structurally identical), and a real end-to-end Filtered-mode Covered Call scan (real network-boundary-mocked `findBestCoveredCall` pipeline, not a reimplementation) proves the OI floor actually narrows/restores the live QUALIFIED count — direct evidence for "no regression to Covered Call capacity protections."

Regression: the full pre-existing Screener suite (`CcCapacityGate`, `SingleCoveredCallLaunchAction`, `UnifiedStrategyLauncher`, `OpportunityUniverseMigration` — 148 tests) passes unchanged after this ticket's wiring changes, satisfying "no regression to... the unified Opportunity Universe."

## Validation totals

- `npx tsc --noEmit`: clean.
- `lib/screener` + `lib/scans` + `app/screener` (targeted): 9 files / 152 tests passing.
- Full suite: 111 files / 1673 tests passing (`lib` 76 files/1339 tests, `components features` 27 files/251 tests, `app` 8 files/83 tests).
- `git diff --check`: clean.
- **Production build (`npx next build`): not completed in this sandbox**, for the same disclosed reason as PORTFOLIO-MODE-0001's implementation report — the build dies silently at the earliest compile phase ("Creating an optimized production build...") with no error output, consistent with an out-of-memory kill given this environment's ~1GB typical free RAM. Attempted twice for this ticket (plain, and with a reduced 1536MB V8 heap), both with the identical failure signature already documented for Part 1. `tsc --noEmit` and the full test suite are both clean; this is an environment limitation requiring a higher-memory build environment, not a known code defect.
