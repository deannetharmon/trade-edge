# PI-0013 — Daily Briefing Dashboard — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `59de0c5` (may be one amend behind `docs/HANDOFF.md`'s self-reference — see that file's own note on this cosmetic quirk)

## Executive Summary

Adds a **Daily Briefing** card as the first section on the Portfolio page, above the Portfolio Review card (PI-0012A) and the position list. It answers "what do I need to know before I make a single trading decision today?" in six compact sections: Executive Summary, Today's Priorities, Portfolio Snapshot, Upcoming Events, Current Opportunities, Current Risks. Every value shown is either a direct pass-through of an existing engine's output (Portfolio Health, Portfolio Review's Top Risks, Today's Priorities' already-bucketed objectives) or a deterministic, template-based grouping of those same values — no new score, no new recommendation, no re-ranking, and no AI/LLM/internet calls anywhere in `lib/dailyBriefing/`.

## Files Changed

New:
- `lib/dailyBriefing/types.ts` — `DailyBriefingInput`, `DailyBriefing`, `DailyBriefingSnapshot`, `UpcomingEvent`(+Kind), `OpportunityItem`(+Kind), `RiskItem`(+Kind).
- `lib/dailyBriefing/buildDailyBriefing.ts` — the pure orchestrator (`buildDailyBriefing()`).
- `lib/dailyBriefing/index.ts` — public barrel.
- `lib/dailyBriefing/__tests__/buildDailyBriefing.test.ts` — 13 targeted tests.
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` — the UI card.
- `features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx` — 8 component tests.
- `docs/reviews/PI-0013-Daily-Briefing-Implementation-Report.md` — this report.

Modified:
- `app/portfolio/page.tsx` — four additions: (1) `lib/dailyBriefing`/`DailyBriefingCard` imports; (2) `averagePositionHealth` lifted out of the existing `healthInput` `useMemo` into its own `useMemo`, so it has exactly one call site and both `healthInput` and the new `dailyBriefingInput` read the same computed value rather than each computing their own copy; (3) a `dailyBriefingInput`/`dailyBriefing` `useMemo` pair, placed immediately after the existing `portfolioReview` `useMemo` (PI-0012A); (4) the `<DailyBriefingCard>` render, placed inside the `activeTab === 'positions'` block, immediately before `<PortfolioReviewCard>` (i.e. first on the page). No other line in this file was touched.
- `docs/HANDOFF.md` — session handoff updated with this sprint's completion.

## Reused Engines (no recomputation)

- **Portfolio Health** (`lib/portfolioHealth`, via `portfolioReview.currentState.health`) — read directly for the Executive Summary's health clause and the Portfolio Snapshot's score/status.
- **Portfolio Review** (`lib/portfolioReview`, PI-0012A) — `currentState.topRisks` becomes `DailyBriefing.priorities` **unchanged** (same array reference, same order); `currentState.concentrationConcerns`/`capitalConcerns` feed two of the five Risk Summary categories; `composition.positionCount`/`maxSymbolConcentrationPct` feed the Portfolio Snapshot.
- **Today's Priorities** (`lib/todaysPriorities`) — `dashboard.reviewToday.expiringPositions` (DTE), `.earningsReviews` (earnings), and `.needsFollowUp` (Decision Review follow-up) become Upcoming Events, read verbatim, in that fixed order, with zero new trigger-type filtering or date math. `dashboard.opportunities`' four existing buckets (roll/covered-call/CSP/screener) become Opportunity Summary counts — the same four buckets Mission Control's own Opportunity Summary section already counts. `dashboard.immediateAction` becomes the "positions requiring immediate attention" Risk Summary category.
- **Canonical objective list** (`lib/portfolio-intelligence`) — consulted only for its existing, stable `ruleId === 'OBJ-ASSIGNMENT-RISK'` tag, to build the Assignment Exposure risk category. No objective is re-evaluated.
- **`<PriorityRankedList>`** (`features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`) — the same component Portfolio Review and Mission Control already render, reused for Today's Priorities.

## Architecture

```
lib/dailyBriefing/
  types.ts
  buildDailyBriefing.ts
  index.ts
```

Dependency direction (one-way, matching `lib/portfolioReview` and every other orchestration package in this repo):

```
lib/dailyBriefing
   -> lib/portfolioReview        (PortfolioReviewSnapshot, reused verbatim)
   -> lib/todaysPriorities       (TodaysPrioritiesDashboard, reused verbatim)
   -> lib/portfolio-intelligence (PortfolioObjective[], ruleId tag only)

lib/portfolioReview, lib/todaysPriorities, lib/portfolio-intelligence, lib/portfolioHealth
   -> (never import lib/dailyBriefing)
```

`buildDailyBriefing()` is a pure function: no fetch, no Redis, no React, no internet calls, no AI/LLM calls. It reads the clock only via the explicit, overridable `now` parameter (for `generatedAt`), matching this codebase's existing convention.

## UI Decisions

`<DailyBriefingCard>` renders first on the Portfolio page's Positions tab, above `<PortfolioReviewCard>`. Layout choices:
- Executive Summary is a single highlighted paragraph, colored by health status (same palette `PortfolioReviewCard`/`MissionControl` already use) — deliberately not a bulleted list, since the point is a 30-second read, not a scan.
- Today's Priorities reuses `<PriorityRankedList>` exactly, so it looks and behaves identically to the same list wherever else it appears in the app.
- Portfolio Snapshot and Current Opportunities use a `grid-cols-2` base (mobile-first, two stats per row, never a single wide row that would force horizontal scrolling), expanding to `sm:grid-cols-3 lg:grid-cols-6` and `sm:grid-cols-4` respectively at wider breakpoints — the same responsive pattern `MissionControl.tsx`'s Opportunity Summary already established.
- Upcoming Events and Current Risks render as simple bordered list rows with a small uppercase kind label, matching Portfolio Review's existing concentration/capital list styling.
- Every section has its own clean empty state (no blank space, no "0" where nothing exists).

## Data Flow

```
app/portfolio/page.tsx (existing state: portfolioReview, todaysPrioritiesDashboard,
                         canonicalPriorities, balances, averagePositionHealth)
        |
        v
dailyBriefingInput (useMemo) -- assembles the above into DailyBriefingInput,
        |                        nothing new fetched or computed
        v
buildDailyBriefing(input) -- lib/dailyBriefing, pure, no fetch/API/React/AI
        |
        v
DailyBriefing (executiveSummary, priorities, snapshot, upcomingEvents,
        |       opportunities, risks)
        v
<DailyBriefingCard briefing={...} loading={...} th={...} />
```

## Deterministic Behavior

- No AI, no LLM, no internet calls anywhere in `lib/dailyBriefing/`.
- The Executive Summary is built by straightforward string templating over already-computed fields (health status, immediate-action count, first concentration concern's title, count of earnings-tagged Upcoming Events) — the same input always produces the exact same sentence, verified by a dedicated test asserting the full literal string for a fixed input.
- A determinism test (`produces deterministic output for identical input, regardless of call order`) asserts two calls with identical input and clock produce a deeply-equal result.
- Ordering within every section is fixed: Upcoming Events are DTE, then earnings, then follow-up (never re-sorted); Risk Summary categories are concentration, capital, assignment exposure, earnings exposure, immediate attention (declaration order, never re-sorted); Today's Priorities is exactly `portfolioReview.currentState.topRisks`' existing order (already Priority-Score-sorted upstream).

## Testing

`lib/dailyBriefing/__tests__/buildDailyBriefing.test.ts` — 13 tests: empty portfolio, healthy portfolio, portfolio requiring action, multiple priorities passed through unranked, no priorities, upcoming events from all three buckets, no upcoming events, opportunity counts across all four buckets (including zero), risks across all five categories, missing optional data (`null` `averagePositionHealth`/`capitalDeploymentPct`, never fabricated), deterministic output for identical input, exact executive-summary string generation, and `generatedAt` stamped from the injected clock.

`features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx` — 8 tests: null/not-loading renders nothing, null/loading renders a loading state, all six sections render in order, executive summary text renders verbatim, snapshot stats render, upcoming events/risks render when present, all three empty states render cleanly, and a check that the Portfolio Snapshot/Current Opportunities grids use a mobile-first `grid-cols-2` base class (never a bare wide grid or horizontal-scroll container).

All 43 test files in the repo (28 in `lib/`, 15 in `features/`) were run this session (in batches, per the sandbox's per-command time budget) — 100% pass, no regressions.

## Validation

- `vitest run` — all 43 test files pass.
- `tsc --noEmit` — clean, no errors.
- `next build` — reproduces this repo's known sandbox limitation (hangs at the initial Next.js banner). Consistent with PI-0012A and every prior PI ticket's experience in this sandbox; not treated as a regression given `tsc --noEmit` is clean and all tests pass. **Vercel's build remains the authoritative check and is still required before this is considered fully verified in production.**

## Trade-offs

- **Executive Summary covers four clauses (health, immediate attention, concentration, earnings), not every possible condition.** The ticket's own example targets a concise, readable sentence, not an exhaustive report — Portfolio Review and the rest of this same card already surface the fuller detail. Additional clauses (e.g. buying power, idle cash) could be added later as simple additional `sentences.push(...)` lines without restructuring anything.
- **Assignment Exposure risk relies on the `OBJ-ASSIGNMENT-RISK` ruleId tag** rather than a dedicated, purpose-built "assignment exposure" bucket (no such bucket exists yet in Today's Priorities). This is a legitimate reuse of an existing, stable tag, but means Assignment Exposure items are sourced slightly differently (full objective list + ruleId filter) than the other four risk categories (existing dashboard/Portfolio-Review buckets).
- **No historical/trend view** — the briefing is a snapshot of "right now," consistent with the ticket's explicit out-of-scope list (no persistence, no trailing performance).
- **No visual/screenshot QA** — same sandbox rendering limitation noted in PI-0012A; verified via passing component tests and code review, plus a markup-level check for mobile-first grid classes (jsdom cannot evaluate CSS breakpoints directly).

## Deferred Enhancements

Explicitly out of scope per the ticket, captured here for future consideration:
- AI-generated summary text (an optional richer alternative to the deterministic Executive Summary, clearly labeled as AI-assisted if ever added).
- News/market sentiment integration.
- Trailing performance and Decision Quality metrics in the briefing itself (both already designed for Portfolio Review's own PI-0012B/C — the Daily Briefing could surface a one-line summary of either once those ship, without new calculation).
- Notifications/scheduled delivery of the briefing (e.g. an email or push summary each morning) — would require new persistence and a scheduled job, both explicitly out of scope here.
- A "what changed since yesterday" clause in the Executive Summary, mirroring `features/portfolio/briefing/whatChanged.ts`'s existing diff-against-snapshot pattern — a natural, low-risk follow-on that reuses an existing mechanism rather than inventing a new one.
