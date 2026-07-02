# RF-0001 — Establish Feature-Oriented Screener Module

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Begin decomposing the large `app/screener/page.tsx` file by extracting the Ranked Scan UI and related orchestration into a feature-oriented Screener module.

This is a refactoring ticket. It must not change user-facing behavior.

## Required Reading

Claude must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/tickets/TE-0005A-background-ranked-scan-infrastructure.md`
- `docs/reviews/TE-0005A-Implementation-Report.md`
- `docs/decisions/ADR-0004-feature-oriented-architecture.md`

Claude should inspect:

- `app/screener/page.tsx`
- `lib/scans/`
- `lib/commands/command-handlers.ts`
- `lib/tasks/`
- `lib/commands/`

## Problem

`app/screener/page.tsx` has grown into a very large file that mixes UI, state, scan orchestration, ranking, helper logic, dialogs, and display behavior.

TE-0005A extracted scan execution infrastructure. RF-0001 continues the cleanup by extracting the Ranked Scan UI layer while preserving behavior.

## Scope

Create a feature-oriented Screener module and move Ranked Scan UI concerns into it.

Suggested target structure:

```text
features/screener/
  components/
    RankedScanPanel.tsx
    RankedToolbar.tsx
    RankedProgress.tsx
    RankedResultsTable.tsx
  hooks/
    useRankedScan.ts
  types.ts
```

The exact component split may vary if the current code shape requires it, but the goal is to reduce `app/screener/page.tsx` responsibility and establish the pattern for future Screener decomposition.

## Non-Goals

Do not:

- Change Ranked Scan behavior.
- Change Filter behavior.
- Change Targeted behavior.
- Change scan formulas.
- Change ranking/scoring logic.
- Change Command Bus semantics.
- Change Task Manager semantics.
- Add notifications.
- Add Task Center UI.
- Add new visual design.
- Migrate additional Screener modes.
- Add server-side persistence.

## Requirements

### 1. Preserve behavior

The Ranked Scan UI must look and behave the same after extraction.

### 2. Keep `page.tsx` as orchestrator

`app/screener/page.tsx` should remain the route entry point, but it should delegate Ranked Scan UI rendering and related local UI state where practical.

### 3. Do not over-extract

Extract only Ranked Scan UI and orchestration code needed to make that area maintainable.

Do not attempt to clean up the entire Screener page in this ticket.

### 4. Avoid duplicate logic

Do not duplicate Ranked Scan behavior. Reuse the extracted TE-0005A scan runner/helpers.

### 5. Keep public APIs small

Feature components/hooks should expose narrow props and return values.

### 6. Preserve provider architecture

Do not alter the existing TaskProvider or CommandProvider wiring except if absolutely required to fix an issue discovered during refactor.

## Acceptance Criteria

- `features/screener/` exists.
- Ranked Scan UI is extracted into feature module components/hooks.
- `app/screener/page.tsx` is smaller and delegates Ranked Scan rendering.
- Ranked Scan still starts, runs, reconnects, and displays results.
- Filter and Targeted modes still behave as before.
- Build passes.
- No visible UI change is introduced intentionally.
- No temporary scripts are committed.

## Validation

Run:

- `npm run build`
- `npm run lint` if available and currently working

Manual smoke test:

1. Open the Screener page.
2. Run Ranked Scan.
3. Navigate away while it runs.
4. Return to Screener.
5. Confirm Ranked Scan reconnects and results display.
6. Run or inspect Filter mode.
7. Run or inspect Targeted mode.
8. Confirm no blank pages.
9. Confirm browser console has no new runtime/provider errors.

## Git Commit

After validation:

```bash
git add app/screener features/screener docs/tickets/RF-0001-feature-oriented-screener-module.md docs/architecture/System-Map.md docs/roadmap/ROADMAP.md
git commit -m "refactor(screener): extract ranked scan feature module"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Claude Completion Report

After implementation, create:

- `docs/reviews/RF-0001-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- Components/hooks extracted
- Before/after Screener page responsibilities
- Behavior preservation notes
- Build results
- Manual smoke test results
- Diff statistics
- Technical debt
- Recommendations before TE-0005B
