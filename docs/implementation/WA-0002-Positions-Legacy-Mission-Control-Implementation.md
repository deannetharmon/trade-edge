# WA-0002 — Positions & Legacy Mission Control Cleanup: Implementation Report

**Status:** Implementation complete. Not yet reviewed, accepted, or merged.
**Branch:** `feature/wa-0002-positions-cleanup`
**Base:** `main` @ `0b207aca92ff443a20d2f8dcbc44f6f022664854` (verified equal to `origin/main`, clean tree, at preflight)
**Authoritative specification:** `docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md` (as corrected). Implemented as specified; no reinterpretation, expansion, or redesign.

## 1. Implemented Behavior

**Legacy Mission Control retirement.** The Portfolio page's `mission-control` sub-tab, its navigation entry, its render branch, its `activeTab` type-union value, and its import were all removed. The default `activeTab` changed from `'mission-control'` to `'positions'`. `features/portfolio/missionControl/MissionControl.tsx` was deleted after re-confirming (at implementation time, not just at CES time) zero remaining consumers and no unique capability — its five sections (Portfolio Summary, Top Priority, Today's Work Queue, Portfolio Health, Opportunity Summary) are each already fully duplicated on `/dashboard`'s Mission Control (MB-0002) or reused unchanged elsewhere (`TodaysPrioritiesDashboard`, still mounted on the `today` tab). `/dashboard` itself was not modified.

**Transitional Briefing content preserved on Positions.** `DailyBriefingCard` gained a `variant: 'full' | 'transitional'` prop (default `'full'`, byte-for-byte unchanged existing behavior — verified by a regression-guard test). The `'transitional'` variant renders only Executive Summary, Portfolio Snapshot, and Upcoming Events, plus a visible label ("Temporary — moving to Briefing in WA-0004"), and excludes Today's Priorities, Current Opportunities, and all five `Current Risks` kinds. Positions now mounts `<DailyBriefingCard variant="transitional" .../>`. No `lib/dailyBriefing` function or data structure changed — this is conditional rendering of sections the component already had.

**Portfolio Composition extraction.** A new component, `features/portfolio/positions/PositionCompositionCard.tsx`, contains the Portfolio Composition rendering (position count, largest-symbol %, wheel-managed %, strategy breakdown) previously inside `PortfolioReviewCard`, unchanged field-for-field. It deliberately excludes `concentrationConcerns` (portfolio-wide risk, not a composition fact), Portfolio Health, Top Risks, and Capital & Income — all three already fully owned by Mission Control (`/dashboard`). Positions now mounts `PositionCompositionCard` in place of `PortfolioReviewCard`.

**`PortfolioReviewCard` deletion.** Re-verified at implementation time: zero remaining consumers (only its own file, its own test, and prose comments referenced it after the composition swap) and no unique user-facing capability (Health/Top Risks/Capital & Income are all confirmed still fully rendered, unmodified, by Mission Control's `PortfolioStatusSection` on `/dashboard`). `features/portfolio/review/PortfolioReviewCard.tsx` and its test were deleted; the now-empty `features/portfolio/review/` directory was removed.

**Position-specific risk badges.** A new component, `features/portfolio/positions/PositionRiskBadges.tsx`, reads each position's existing `pos.portfolioObjective` directly — no lookup, no join, no display-text matching, no domain-model change. It renders an "Assignment Risk" badge when `objective.ruleId === 'OBJ-ASSIGNMENT-RISK'` and an "Earnings Risk" badge when `objective.reviewTriggers.some(t => t.triggerType === 'earnings')` (the identical predicate already used by `lib/portfolio-intelligence/dashboardComposition.ts:219`). It renders nothing for `null` objectives, nothing when neither predicate matches, and both badges when both are true. It is wired into `PositionCard` just above the existing Action/Analyze row — the smallest safe placement, adjacent to existing header-level controls, not inside the collapsed Position Intelligence panel. `PositionIntelligencePanel` itself is unmodified.

**Every other Positions capability** (inventory, structure/lifecycle, valuation/P&L, objectives, Greeks, pending orders, bulk actions, controls, decision review, healthy-position monitoring, Portfolio Mode gating) is unchanged.

## 2. Files Added

- `features/portfolio/positions/PositionRiskBadges.tsx`
- `features/portfolio/positions/__tests__/PositionRiskBadges.test.tsx`
- `features/portfolio/positions/PositionCompositionCard.tsx`
- `features/portfolio/positions/__tests__/PositionCompositionCard.test.tsx`
- `app/portfolio/__tests__/PortfolioPage.test.tsx` (new — this is the first component-level test under `app/portfolio/`)

## 3. Files Changed

- `app/portfolio/page.tsx` — removed the `mission-control` tab entry/render branch/import; changed `activeTab`'s type union and default; swapped `DailyBriefingCard`/`PortfolioReviewCard` render calls for the transitional variant and `PositionCompositionCard`; added the `PositionRiskBadges` import and render call inside `PositionCard`; removed one now-stale doc comment block that referenced the deleted Mission Control import.
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` — added the `variant` prop and its conditional rendering; no change to any section's existing content or the six-section `'full'` output.
- `features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx` — added five new test cases for the `'transitional'` variant plus one explicit default/`'full'`-variant regression guard; zero existing test cases modified.
- `lib/dailyBriefing/buildDailyBriefing.ts` — comment-only correction: a doc comment referencing the now-deleted `features/portfolio/missionControl/MissionControl.tsx` was updated to describe the retirement and correctly distinguish this function's portfolio-derived opportunity counts from `/dashboard`'s separate, screener-sourced `NewOpportunitiesSection`. No executable line changed.
- `vitest.config.ts` — added `'app/**/__tests__/**/*.test.tsx'` to the test `include` glob. Without this, `app/portfolio/__tests__/PortfolioPage.test.tsx` (the first `.tsx` test under `app/`) would silently never run under `npm test`, the same trap this file's own comments already document for `components/` and `lib/`.

## 4. Files Deleted

- `features/portfolio/missionControl/MissionControl.tsx`
- `features/portfolio/review/PortfolioReviewCard.tsx`
- `features/portfolio/review/__tests__/PortfolioReviewCard.test.tsx`
- The resulting empty `features/portfolio/review/` directory was also removed.

## 5. Confirmation: Canonical Domain Logic Unchanged

No file under `lib/` had any executable line changed. `lib/dailyBriefing/buildDailyBriefing.ts`'s only edit is a doc comment. No scoring, ranking, health-calculation, or recommendation logic changed anywhere. `PortfolioObjective`, `PortfolioReviewSnapshot`, `DailyBriefing`, and `TodaysPrioritiesDashboard` are all the same canonical objects, unchanged in shape or derivation, consumed by fewer or differently-arranged presentation components after this sprint — never recomputed differently. `PositionRiskBadges` and `PositionCompositionCard` are both pure, presentation-only extractions/reads of already-computed data.

## 6. Test and Validation Results

**Targeted tests (new/changed code), run throughout development:**

- `features/portfolio/positions/__tests__/PositionRiskBadges.test.tsx` — 6/6 passing (null objective, neither predicate, assignment only, earnings only, both, concentration/capital-only objective never badges).
- `features/portfolio/positions/__tests__/PositionCompositionCard.test.tsx` — 7/7 passing (null/loading, empty state, populated stats/strategy breakdown, `concentrationConcerns` exclusion, Health/Top-Risks/Capital-Income exclusion, no NaN/undefined).
- `features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx` — 13/13 passing (7 pre-existing default-variant tests unchanged and passing; 5 new `'transitional'`-variant tests; 1 explicit default/`'full'`-variant regression guard).
- `app/portfolio/__tests__/PortfolioPage.test.tsx` — 1/1 passing: renders the full `PortfolioPage` (wrapped in `PortfolioModeProvider`/`PortfolioDataProvider`, with the live acquisition module and `fetch` stubbed) and asserts, after the mode-resolution gate clears, that (a) the retired "Mission Control" tab label is absent anywhere in the document, (b) the Positions-only "NO OPEN POSITIONS FOUND" empty state renders without clicking any tab, and (c) no other tab's content (e.g. Today's Priorities' "Immediate Action" section) is present — proof the default tab is Positions, not blank or invalid.

**Full-breadth regression (every test file in the repository, run in batches due to this sandbox's documented ~45-second per-command ceiling — the same, previously-established limitation from prior sprints in this history):**

| Area | Files | Tests | Result |
|---|---:|---:|---|
| `lib/` (6 batches) | 66 | 987 | All passing |
| `features/portfolio/**` (3 batches) | 16 | 96 | All passing |
| `components/**` (3 batches) | 11 | 81 | All passing |
| `app/**` (1 batch) | 2 | 8 | All passing |
| **Total** | **95** | **1,172** | **0 failures** |

This is full repository test-file coverage (95/95 files, matching a repository-wide `find` count), executed as multiple complete, non-overlapping batches rather than one literal `npm test` invocation, because a single `npm test`/`vitest run` process for the whole suite could not finish inside this sandbox's hard 45-second per-command ceiling (confirmed directly: it reached the final 1-2 files before being cut off, with zero failures visible in the truncated output). Every batch's own summary line is a clean pass with no `FAIL`/`✗` output anywhere.

**TypeScript validation:** `npx tsc --noEmit` — clean, zero errors, zero warnings.

**Production build:** `npx next build` was attempted twice (fresh, no cache) and did not complete within the sandbox's 45-second per-command ceiling on either attempt; both runs reached "Creating an optimized production build..." with only benign, unrelated `swc-*` cross-platform-binary path warnings (present on every build in this repository, unrelated to any code in this diff) and no compile/type errors before being cut off. This is the same, previously-documented, previously-accepted environment limitation noted in this repository's own `SPRINT_STATUS.md` (e.g. PT-0001, MB-0001A) — a full production build cannot be completed inside a single command in this sandbox. Given `tsc --noEmit` is clean and all 1,172 tests across all 95 files pass with zero failures, there is no evidence of a build-breaking defect; the build's completion itself simply could not be directly observed in this environment.

**`git diff --check`:** clean, no whitespace errors.

**`git status`:** matches exactly the file list in Sections 2-4 above (plus the generated `tsconfig.tsbuildinfo`, reverted/excluded from this change since it is a `tsc` build artifact, not a WA-0002 file).

## 7. Disclosed Deviations

- **Production build not directly observed to completion** — see Section 6. Disclosed, not worked around; consistent with this repository's established practice of documenting this exact sandbox limitation rather than silently skipping or fabricating a result.
- **`vitest.config.ts` was modified**, which is not one of the CES's explicitly named files. This was necessary infrastructure, not scope creep: without adding the `app/**/__tests__/**/*.test.tsx` glob, the CES/implementation-instruction-mandated `app/portfolio/__tests__/PortfolioPage.test.tsx` test would silently never run under `npm test` at all (the exact trap this same config file's own pre-existing comments document for `components/` and `lib/`). No other config, dependency, or build setting was touched.
- **`lib/dailyBriefing/buildDailyBriefing.ts` received a one-comment edit.** The instructions said not to modify Daily Briefing domain logic or data structures; this is neither — it is a doc-comment correction to remove a now-dangling reference to the deleted `MissionControl.tsx` file and to accurately distinguish this function's dashboard-derived opportunity counts from `/dashboard`'s separate, screener-sourced Opportunities section (the previous comment's wording, if left as-is, would have asserted a false equivalence between the two after the legacy component's deletion). No executable line changed.
- **`PortfolioReviewCard` was deleted outright**, per the CES's own recommendation in its now-resolved "Open Decisions" section (§18: "recommended: delete outright, since `/dashboard`'s `PortfolioStatusSection` is a complete, independent, already-shipped reimplementation with no dependency on `PortfolioReviewCard`'s code"), after re-confirming the deletion criteria at implementation time as required.
- No other deviation from the approved CES.

## 8. WA-0004 Obligation (Recorded, Not Yet Actioned)

`DailyBriefingCard`'s `'transitional'` variant, mounted on Positions, is an explicit bridge, not a permanent home, for Executive Summary/Portfolio Snapshot/Upcoming Events. **WA-0004's own CES and acceptance criteria must include removing this transitional call site from Positions** (reverting to no `DailyBriefingCard` mount there, or whatever WA-0004 determines is correct) once the Briefing workspace ships an equivalent, permanent destination for this content. This obligation is recorded here and in `docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md` §17 so it is not silently dropped when WA-0004 is scoped.

## 9. Sprint-Status Documentation

`planning/SPRINT_STATUS.md` was reviewed and **intentionally not modified.** Its own established convention, followed consistently across every prior sprint in this repository's history (PT-0001, TC-0001, PT-0002A/B, DT-0001, OE-0001/OE-0002A/OE-0002B, MB-0001A/MB-0001B), is to record a sprint's entry only once it is accepted, merged, and closed out — there is no precedent anywhere in that document for an "implemented, pending review" interim entry, and the explicit instruction for this sprint was not to mark WA-0002 merged or complete. Recording an entry now would both deviate from established convention and risk implying an acceptance status that has not occurred. `planning/SPRINT_STATUS.md` will be updated at WA-0002's own closeout, following the same pattern as every prior sprint.

## 10. Final Commit Hash

Recorded after commit and push (see the accompanying message to the repository owner for the exact hash) — this document is committed in the same commit as the implementation it describes, so its own commit hash is that commit's hash.
