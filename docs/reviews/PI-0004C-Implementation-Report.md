# PI-0004C — Today's Priorities Workflow Improvements — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `def2c45`

## Executive summary

Today's Priorities is now a Portfolio subpage (Positions → Today's Priorities → Balances) instead of an inline block that pushed Positions down the page. It also gained a lightweight Complete/Reopen workflow: items move into a "Completed Priorities" section below "Open Priorities" and stay there — persisted in the browser via `localStorage` — until the trader reopens them manually or the underlying recommendation materially changes (priority escalates, actionability shifts, evidence changes), in which case they auto-reopen. Portfolio Intelligence itself was not touched — `evaluatePortfolioObjectives`, `evaluatePositionObjective`, `prioritizePortfolioObjectives`, ranking, and Rule IDs are all unchanged. Completion is a presentation-layer overlay on top of the canonical objective list, matching the sprint's `Canonical Objective + Workflow State → View` model.

## Files changed

New:
- `features/portfolio/priorities/priorityWorkflowState.ts` — pure workflow-state logic: stable objective identity, material-change fingerprinting, open/completed partitioning, `localStorage` persistence
- `features/portfolio/components/TodaysPrioritiesWorkflow.tsx` — the subpage component (Open/Completed sections, Mark Complete/Reopen wiring)
- `features/portfolio/priorities/__tests__/priorityWorkflowState.test.tsx` — 24 tests
- `features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx` — 15 tests
- `docs/reviews/PI-0004C-Implementation-Report.md` — this report

Modified:
- `app/portfolio/page.tsx` — `activeTab` union gained `'priorities'`; a third tab button added between Positions and Balances; `TodaysPriorities` import swapped for `TodaysPrioritiesWorkflow`; the old inline render removed from the Positions block and re-mounted under the new tab. Positions and Balances render branches are otherwise untouched.
- `features/portfolio/components/TodaysPriorities.tsx` — two new optional props, `title` and `renderAction`, both defaulting to today's exact existing behavior. No change for any caller that omits them (verified: all 20 pre-existing tests still pass unmodified).

## UI changes

The sub-tab bar (the same one already switching Positions/Balances) gained a third tab, "Today's Priorities," positioned between the two per the sprint's requested order. Positions and Balances render exactly as before. The old inline `<TodaysPriorities>` render above the Positions list is gone — it only renders now when the "Today's Priorities" tab is active. Each priority card gained one new button in its header row: "Mark Complete" (Open Priorities) or "Reopen" (Completed Priorities). Card visuals, badges, expand/collapse, and the Evidence/Concerns/Review Trigger/Expected Outcome panels are unchanged.

## Workflow design decisions

**Identity.** `objective.id` can't be used to track completion — Portfolio Intelligence regenerates it randomly on every evaluation run (already asserted by existing lib tests). Completion is instead keyed on `ruleId + subject` (position id / symbol / label, whichever the objective has), which is stable across re-evaluations of the same underlying condition.

**Material-change detection.** A "fingerprint" of the substantive fields — priority, urgency, actionability, summary, supporting-evidence values — is computed and stored at completion time. `id` and `createdAt` are deliberately excluded, since both change on every portfolio refresh even when nothing material happened, and the brief is explicit that a refresh alone must never reopen a completed item. On each render, a completed item's current fingerprint is compared against the stored one; a mismatch auto-reopens it. This single mechanism covers every reopening example in the brief (priority escalation, concentration escalation, actionability becoming REVIEW_SOON, evidence changes) without special-casing each one.

**WAIT.** Excluded from completion at the `isCompletable()` boundary (`type !== 'WAIT'`), so it can never end up in Completed regardless of what's in storage — `markComplete()` is a no-op for it, and `partitionPriorities()` always routes it to Open.

**Component boundary.** `TodaysPriorities.tsx` stayed a dumb renderer — extended with `renderAction` (an optional per-card action slot) and `title` (so the same component renders both "Open Priorities" and "Completed Priorities" without duplicating card markup), rather than forked or rewritten. `TodaysPrioritiesWorkflow.tsx` calls it twice and owns all workflow logic, keeping business logic out of `page.tsx`.

## Persistence approach

`localStorage`, matching this app's existing pattern for client-only UI/workflow state (`LS_THEME`, `LS_DRY_RUN`, `LS_SECTION_ORDER` already live in `page.tsx` this way) rather than the Redis-backed endpoints used for actual trading data (position-intent, position-snapshots). Storage key: `hunter-priorities-workflow-state`, following this file's existing `hunter-` prefix convention. Satisfies the brief's requirement — survives refresh, navigation, and browser restart — with no new API route or server round-trip. Load/save both fail closed (empty state) on missing or corrupted data rather than throwing.

## Tests added

39 new tests, 275/275 total passing.

`priorityWorkflowState.test.tsx` (24, pure logic): key stability across id/createdAt changes and across different subjects/rules; fingerprint sensitivity to priority, actionability, and evidence changes and insensitivity to id/createdAt; partitioning (open/completed split, WAIT always-open even against a stale entry, canonical order preservation in Open, newest-first sort in Completed, no mutation of inputs); auto-reopen on material change vs. no-reopen on a plain refresh; `markComplete`/`reopenPriority` no-ops and reference-equality on no-op; `localStorage` round-trip and corrupted-JSON recovery.

`TodaysPrioritiesWorkflow.test.tsx` (15, component): Mark Complete/Reopen transitions between sections; completed items remain expandable; WAIT renders no Mark Complete button; canonical ordering preserved in Open and newest-first in Completed (using fake timers for determinism); persistence across a simulated remount; material-change auto-reopen vs. refresh-only no-reopen; completion never mutates the objective object passed in; and a static-import check mirroring `TodaysPriorities.test.tsx`'s own purity test (the component does not import `evaluatePortfolioObjectives`, `evaluatePositionObjective`, or `prioritizePortfolioObjectives`).

**Not covered by an automated test:** full-page navigation between subpages and "Positions/Balances remain unchanged" as an end-to-end assertion. `app/portfolio/page.tsx` has no existing test harness — it's 8,800+ lines with TastyTrade/NextAuth/fetch dependencies, and `vitest.config.ts`'s `include` glob doesn't pick up `app/**` at all. Building that harness would itself be the kind of broad, unrelated refactoring the sprint explicitly excludes. Verified instead by direct code review (the Positions and Balances render branches are byte-for-byte unmoved) and by the production build below successfully compiling and statically generating `/portfolio`.

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build`: exit 0. Compiled successfully, type-checked cleanly, all 43 routes generated. `/portfolio`: 104 kB / 201 kB first load (was 104 kB / 200 kB before this sprint). Verified in a disposable sandbox copy of the repo, not the working `node_modules`/lockfile.

## Manual validation status

Not run against a live account (no local TastyTrade session in the verification sandbox). Recommend confirming after deploy: the "Today's Priorities" tab appears and switches correctly; Mark Complete moves a real recommendation into Completed and it survives a browser refresh; Reopen brings it back; and — if reachable — that a completed recommendation whose underlying condition changes (e.g. DTE crosses a threshold on the next refresh) reopens on its own.

## Technical debt / follow-ups

- No automated coverage of the Portfolio page's tab-switching itself (see "Tests added" above) — flagged rather than silently skipped.
- `TodaysPriorities.tsx`'s `expandedIds` state is keyed by `objective.id`, which is regenerated on every Portfolio Intelligence run — expand/collapse state already didn't survive a data refresh before this sprint, and still doesn't. Pre-existing behavior, not introduced or worsened here.
- Completion entries for objectives that disappear entirely (e.g. a position closes) are never pruned from `localStorage` — harmless (they simply sit unused unless the same key reappears), but could be revisited if storage growth ever matters.
