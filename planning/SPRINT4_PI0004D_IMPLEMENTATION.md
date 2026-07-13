# PI-0004D — Daily Portfolio Briefing — Implementation Specification

Branch: `feature/portfolio-intelligence`

## Executive Summary

The Daily Portfolio Briefing is a new Portfolio subpage that answers "what do I need to know before the market opens?" in a 30-second read. It is not a dashboard and not another Positions view — it is a compact executive summary sitting on top of the already-computed canonical Portfolio Intelligence objective list (`canonicalPriorities.objectives`), the same data `Today's Priorities` and `Balances` already consume. It becomes the default tab on `/portfolio`.

## Objectives

- Give the trader one place to read, in ~30 seconds, whether the portfolio needs attention today.
- Derive every judgment (health, summary, focus) from the existing canonical objective list — zero new evaluation rules.
- Reuse `TodaysPrioritiesWorkflow` verbatim for the priorities section.
- Surface only meaningful changes since the last refresh, not noise.

## User Experience

Trader opens `/portfolio` (or clicks the Portfolio tab); the Briefing is the first thing shown, before Positions/Balances. Top to bottom: a single health status, the existing priorities workflow (collapsed cards, expand on demand), a short natural-language summary, a "What Changed" list (hidden if nothing changed), and one closing "Suggested Focus" line.

## Layout

Single column, `max-w` matched to existing Portfolio subpages, sections stacked vertically in this fixed order:

1. Portfolio Health (one line + emoji)
2. Today's Priorities (reused component, collapsed by default)
3. Portfolio Summary (2–4 short bullet lines)
4. What Changed (omitted entirely when there is nothing to report)
5. Suggested Focus (final section, one line)

No tabs-within-the-tab, no charts, no additional navigation.

## Component Architecture

New directory `features/portfolio/briefing/`, mirroring the existing `features/portfolio/priorities/` split of pure logic vs. presentation:

- `portfolioHealth.ts` — `derivePortfolioHealth(objectives)`: pure aggregation over the already-ranked list's top entry.
- `portfolioSummary.ts` — `derivePortfolioSummary(objectives)`: pure presence/absence check over objective `type`s already produced.
- `suggestedFocus.ts` — `deriveSuggestedFocus(objectives)`: pure repackaging of the top-ranked objective's existing `subject`/`summary` fields.
- `whatChanged.ts` — `buildBriefingSnapshot` / `computeWhatChanged` / `loadBriefingSnapshot` / `saveBriefingSnapshot`: diffs the current objective list against a stored snapshot, reusing `getPriorityWorkflowKey` and `computeObjectiveFingerprint` from `priorityWorkflowState.ts` (PI-0004C) rather than re-deriving identity/change-detection.
- `DailyPortfolioBriefing.tsx` — the view. Same prop contract as `TodaysPrioritiesWorkflow` (`objectives`, `loading`, `th`), so it drops into the Portfolio page's existing data flow with no new props threaded through.

## Reuse Strategy

- **Data**: consumes the exact same `canonicalPriorities` state (`computeCanonicalPortfolioPriorities`) the Portfolio page already computes for the Priorities/Positions tabs. No new fetch, no new Portfolio Intelligence call.
- **Priorities**: renders `<TodaysPrioritiesWorkflow>` unmodified — same Mark Complete/Reopen workflow, same persistence key, same tests' guarantees.
- **Change detection**: reuses `getPriorityWorkflowKey` (stable identity) and `computeObjectiveFingerprint` (material-change detection) from PI-0004C instead of writing a second notion of "did this change."
- **Ranking**: `prioritizePortfolioObjectives` already sorts worst-first; Health and Suggested Focus read `objectives[0]` rather than re-scoring anything.

Nothing in `lib/portfolio-intelligence` is modified. All new logic lives in `features/portfolio/briefing/`, the same architectural tier as the existing `features/portfolio/priorities/` workflow layer — presentation-adjacent derivations on top of the canonical list, not new Portfolio Intelligence rules.

## Data Sources

- `canonicalPriorities.objectives: PortfolioObjective[] | null` — from the Portfolio page's existing state (unchanged).
- `loading: boolean` and `th: Theme` — existing Portfolio page state.
- Browser `localStorage` (`hunter-briefing-last-snapshot`) — the only new persistence, storing the prior refresh's objective fingerprints for "What Changed." Same client-only pattern already used for theme, section order, and priorities workflow state.

## Portfolio Intelligence Integration

```
Decision Engine
  ↓
Portfolio Intelligence (evaluatePortfolioObjectives / evaluatePositionObjective / prioritizePortfolioObjectives)
  ↓
canonicalPriorities.objectives  (computed once, in app/portfolio/page.tsx, unchanged)
  ↓
Daily Portfolio Briefing (this ticket) ──┬── Today's Priorities (TodaysPrioritiesWorkflow, unchanged)
                                          ├── Portfolio Health (new, pure aggregation)
                                          ├── Portfolio Summary (new, pure aggregation)
                                          ├── What Changed (new, diff against stored snapshot)
                                          └── Suggested Focus (new, pure aggregation)
```

Portfolio Intelligence remains the single source of truth; the Briefing only aggregates and diffs what it already produced.

## UI Behavior

- **Portfolio Health**: `objectives[0].type === 'WAIT'` → 🟢 Healthy. Otherwise 🔴 Action Required if top priority is `critical` or actionability is `CRITICAL`; 🟡 Needs Attention if top priority is `high` or actionability is `ACTION_NEEDED`; else 🟢 Healthy.
- **Portfolio Summary**: WAIT-only list → `"Portfolio remains healthy."` Otherwise one line per checked concern (threatened positions, concentration, buying power, income), each stating either the concern or its absence, based solely on which objective `type`s are present.
- **Suggested Focus**: WAIT-only list → `"No action required today."` Otherwise `"{symbol or subject label}: {top objective's summary}"`.
- **What Changed**: on first-ever load in a browser (no stored snapshot), the section is omitted — there is no baseline to diff against, and showing every current item as "new" would be noise, not signal. On subsequent refreshes, an objective is reported as new / changed (fingerprint differs) / resolved (present last time, absent now). Entries reuse the objective's own `title` text; nothing is authored here.
- Loading/null `objectives` renders a lightweight loading placeholder (loading) or nothing (not loading, no data yet) — same convention as `TodaysPriorities`.

## Testing Strategy

Unit tests (pure functions) for `portfolioHealth`, `portfolioSummary`, `suggestedFocus`, and `whatChanged` (including the no-baseline case, new/changed/resolved detection, and localStorage round-trip / corrupted-JSON recovery). Component tests for `DailyPortfolioBriefing` covering section order, WAIT-only messaging, and that no Portfolio Intelligence evaluation function is imported (matching the existing purity checks in `TodaysPrioritiesWorkflow.test.tsx`). All new tests follow this repo's `.test.tsx` convention under `features/**/__tests__/` (required for vitest's include glob even for pure-logic files — see `priorityWorkflowState.test.tsx` precedent).

## Acceptance Criteria

- `/portfolio` opens on the Briefing tab by default; Positions and Balances tabs are unchanged.
- Portfolio Health, Today's Priorities, Portfolio Summary, and Suggested Focus always render (once objectives are available); What Changed renders only when there is something to report.
- No new Portfolio Intelligence rule, evaluator, or duplicate ranking logic is introduced.
- All existing and new tests pass; `tsc --noEmit` is clean; `next build` succeeds.

## Non-Goals

AI-generated commentary, market news, economic calendar, earnings calendar, Paper Trading, Autopilot, Decision History, additional recommendation logic, and any Portfolio page redesign beyond adding this one subpage.
