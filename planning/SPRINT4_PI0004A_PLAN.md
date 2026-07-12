# Sprint 4, PI-0004A — Today's Priorities

**Branch:** `feature/portfolio-intelligence`
**Date:** 2026-07-12
**Status:** Complete, locally verified. Vercel preview confirmation pending push.

---

## Problem statement

Portfolio Intelligence (PI-0001 through PI-0003.5) is fully built and wired into the Portfolio page's state (`canonicalPriorities`), but nothing renders it. Sprint 4's goal is to expose the existing intelligence to users — a pure rendering task, not a reasoning task.

## Current architecture

`app/portfolio/page.tsx` already computes `canonicalPriorities: CanonicalPortfolioPriorities | null` via `computeCanonicalPortfolioPriorities()` (PI-0003/0003.5), storing ranked `PortfolioObjective[]` in React state, recomputed only when `positions`/`pendingOrders`/`balances` change. This slice adds a UI layer that reads that existing state — it introduces no new computation.

## Files changed

- New: `features/portfolio/components/TodaysPriorities.tsx` — the rendering component.
- New: `features/portfolio/components/__tests__/TodaysPriorities.test.tsx` — 20 tests.
- New: `vitest.setup.ts` — jest-dom matchers + automatic cleanup between tests.
- Modified: `vitest.config.ts` — added `@vitejs/plugin-react`, scoped `jsdom` environment to `*.test.tsx` only via `environmentMatchGlobs` (existing 206 `.test.ts` files stay on the unchanged `node` environment), broadened `include` to cover `features/**/__tests__/**/*.test.tsx`.
- Modified: `app/portfolio/page.tsx` — one import line, one render call (`<TodaysPriorities objectives={canonicalPriorities?.objectives ?? null} loading={loading} th={th} />`), placed right after the error banner, before the position-loading/empty states.
- New devDependencies: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@vitejs/plugin-react` — no component-testing infrastructure existed in this repo before this slice.

## Component hierarchy

```
PortfolioPage (app/portfolio/page.tsx)
  └─ TodaysPriorities (features/portfolio/components/TodaysPriorities.tsx)
       └─ PriorityCard (memoized, one per objective)
            └─ ImpactRow (one per impact dimension, only when expanded)
```

## Data flow

```
canonicalPriorities.objectives (already computed, existing state)
        ↓ (prop, read-only)
TodaysPriorities
        ↓ (prop, read-only)
PriorityCard (renders fields verbatim; local useState only for expand/collapse)
```

No evaluation, ranking, scoring, or computation happens in this component tree — verified by a dedicated test that reads the component's own source and asserts it never references `evaluatePortfolioObjectives`, `evaluatePositionObjective`, or `prioritizePortfolioObjectives`.

## Field mapping (existing data only, nothing fabricated)

| UI element | Source field |
|---|---|
| Priority title | `objective.title` |
| Recommendation badge (collapsed) | `objective.type`, formatted to a readable label |
| Priority tier | `objective.priority` |
| Urgency | `objective.urgency` |
| Stable Rule ID | `objective.ruleId` |
| Short explanation | `objective.summary` |
| Recommendation (expanded) | `objective.rationale` |
| Evidence | `objective.supportingEvidence` |
| Concerns | `objective.concerns` |
| Review Trigger | `objective.reviewTriggers` |
| Expected Outcome | `objective.portfolioImpact` / `incomeImpact` / `riskImpact` / `capitalImpact` — `PortfolioObjective` has no single `expectedOutcome` field; these four existing impact dimensions collectively are the closest existing representation of "what happens," rendered verbatim rather than synthesized into new text |

## Empty state

When `computeCanonicalPortfolioPriorities()` finds nothing to flag, it already returns a single `WAIT` objective (via `prioritizePortfolioObjectives`'s existing empty-input fallback from PI-0003) rather than an empty array. The empty-state UI renders that WAIT objective's own `title` and `rationale` directly — no separate empty-state copy is invented; the "nothing to do" message is Portfolio Intelligence's own text, not the UI's.

When `canonicalPriorities` itself is `null` (no positions/orders loaded at all) and the page isn't loading, the component renders nothing, deferring to the page's existing "NO OPEN POSITIONS FOUND" state rather than showing a second, redundant empty state.

## Ordering

`objectives.map(...)` in array order, no `.sort()`/`.filter()` anywhere in the component. Verified by a test that passes objectives in a deliberately non-priority-sorted order and asserts the rendered heading order matches exactly.

## Visual design

Reuses the Portfolio page's existing three-theme system (`THEMES.dark/medium/light` from `lib/theme.ts`) via a `th` prop — the same pattern already used by `SummaryBar`, `AuditLogPanel`, and `MemoryPanel`. Typography/spacing conventions (uppercase `tracking-widest` labels, `rounded-xl border` cards, `text-[Npx]` sizing) match those existing components exactly. The older, unused `DailyPriorityList.tsx` component (TE-0006C-era, hardcoded dark-only) was not reused as a base, since it operates on the legacy `PriorityItem` shape (position-only, missing evidence/concerns/review-trigger/impact fields) rather than the canonical `PortfolioObjective`; deliberately not modified in this slice.

## Interaction and performance

- Expand/collapse state is local (`useState<ReadonlySet<string>>` of expanded objective IDs) in `TodaysPriorities` — toggling never touches `canonicalPriorities` or triggers recomputation.
- `PriorityCard` is wrapped in `React.memo`; the toggle callback is `useCallback`-stabilized so unrelated re-renders of the parent don't cascade into every card.
- `motion-safe:` Tailwind variants gate the expand-icon rotation and hover-color transitions, respecting `prefers-reduced-motion`.
- No `useEffect` anywhere in the new component — it is a pure function of props plus local expand/collapse UI state.

## Accessibility

- Each card's header is a real `<button>` with `aria-expanded` and `aria-controls`.
- The expandable region has `role="region"` and `aria-labelledby` pointing back to the toggle button.
- `hidden` attribute (not just CSS) on the collapsed panel, so screen readers and the accessibility tree correctly skip it when collapsed.
- Icons (`▼`, colored dots) are `aria-hidden="true"` — the toggle button's own text content and `aria-expanded` state carry the meaning.

## Test plan

20 new component tests: rendering (titles/priority/urgency/rule ID/item count), ordering preservation, empty state (WAIT objective's own copy, and the null/no-data case), loading state, expand/collapse (initial collapsed state, expand reveals sections, collapse again, independent per-card state), ARIA semantics, expanded-detail rendering (evidence/concerns/review-trigger/all four impact dimensions, and omission of empty sections), theming (renders under all three themes, actually reads `th` rather than hardcoding), and purity (identical re-render output, static source check confirming no evaluation-function imports).

## Non-goals confirmed respected

No Daily Briefing, Decision History, Paper Trading, Autopilot, execution, broker integration, trade buttons, notifications, Portfolio Summary redesign, Objective Timeline, Analytics, or AI-generated explanations were added. `objective.metadata.executionAllowed`/`paperExecutionAllowed` are never read or surfaced as actionable controls — the component has no interactive element beyond expand/collapse.

## Acceptance criteria — final status

| Criterion | Status |
|---|---|
| Today's Priorities renders canonical Portfolio Intelligence | ✅ |
| No duplicate business logic | ✅ — verified by source-inspection test |
| Ordering comes from Portfolio Intelligence | ✅ — no sort/filter in component |
| Expand/collapse works | ✅ |
| Existing metadata renders | ✅ — Recommendation, Evidence, Concerns, Review Trigger, Expected Outcome |
| Empty state works | ✅ — renders the canonical WAIT objective's own copy |
| TypeScript passes | ✅ `tsc --noEmit` clean |
| Tests pass | ✅ 226/226 (20 new) |
| Build passes | ✅ `next build` clean, `/portfolio` at 102 kB |
| Vercel preview passes | ⬜ pending push |
| No execution capability introduced | ✅ |

## Known gaps

- No screenshots included in this document — text-based verification only (DOM assertions via Testing Library); a visual check on the live preview is still recommended.
- `TodaysPriorities` is placed above the position list but not yet integrated with the page's existing "select a position" interactions (e.g. clicking a priority card doesn't scroll to or highlight the corresponding position card) — the brief's non-goals list didn't request this, so it wasn't built, but it's a natural PI-0004B candidate.
- The older `DailyPriorityList`/`buildDailyPriorities` (TE-0006C shim from PI-0003) remains unused and unwired — still a candidate for removal or reconciliation in a later slice.
