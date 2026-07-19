# TC-0001 — Trade Command Center

**Status:** Implemented, pending Product Owner review. Complete on `feature/trade-command-center`. Not committed, not pushed, not merged.
**Project:** TradeEdge
**Owner:** Dean Harmon
**Implementation Branch:** `feature/trade-command-center` (created off clean `main` @ `424e068`, ES-0002's merge commit)

## 1. Purpose

TradeEdge has multiple completed intelligence capabilities, but they are distributed across separate pages. TC-0001 creates a single morning landing experience that composes existing intelligence into one decision-oriented dashboard.

The Trade Command Center must answer:

1. What requires attention now?
2. What is the best available trade opportunity?
3. What is the current portfolio condition?
4. Are any background workflows still running?
5. Where should the user go next for detail or action?

This is a composition and integration sprint. It does not introduce a second recommendation engine, duplicate portfolio rules, or create new live-execution behavior.

## 2. Product Outcome

Opening `/dashboard` presents:

- Portfolio health
- Today's highest-priority portfolio actions
- The highest-ranked available opportunity
- Current Daily Briefing summary
- Background-task status
- Clear links into the existing detailed workflows

## 3. Scope, as implemented

### 3.1 New Command Center route

`app/dashboard/page.tsx` — a new, additive route. No existing page was removed or materially redesigned.

### 3.2 Morning header

`components/command-center/CommandCenterHeader.tsx` — time-appropriate greeting (`greetingFor()` in `lib/command-center/buildCommandCenterViewModel.ts`), last-refreshed timestamp, and an explicit `loading`/`loaded`/`empty`/`error`/`unavailable` state per panel. No live market status, price, news, or account-freshness value is ever fabricated.

### 3.3 Daily Briefing composition

`components/command-center/BriefingSummaryCard.tsx` renders `buildDailyBriefing()`'s own `executiveSummary` verbatim, sourced through the new shared composition module (§5). No Daily Briefing rule logic is reproduced in the card or the page.

### 3.4 Portfolio health

`components/command-center/PortfolioHealthCard.tsx` renders the existing canonical `calculatePortfolioHealthScore()` result (score + status) verbatim, with a link to the Portfolio Review. No new score is computed.

### 3.5 Today's priorities

`components/command-center/PriorityListCard.tsx` reuses the existing `<PriorityRankedList>` component (the same one Portfolio Review and the Daily Briefing card already render), fed the canonical, already-ordered `PrioritizedObjective[]`. It does not sort, filter, or rescore.

### 3.6 Best opportunity

`lib/command-center/buildOpportunityRecommendations.ts` wires the existing, real `decisionAnalysesToOpportunityCandidates()` adapter and `rankOpportunityCandidates()` ranker (both from OE-0001's `lib/opportunity-engine`) and mounts the existing, previously-unmounted `components/opportunity-engine/BestOpportunitiesPanel.tsx` inside `components/command-center/BestOpportunityCard.tsx`. See §7 ("Known limitation") for why this always renders its real empty state today. No fabricated candidate, no fallback demo data, no live order submission, and no autonomous paper execution exist anywhere in this path.

### 3.7 Background task status

`components/command-center/BackgroundTaskCard.tsx` reads the existing global `useTaskManager()` (TE-0001/0003/0004/0005 series) — the same task list the global status bar and task drawer already read. No second task-state store was created.

### 3.8 Navigation

`components/command-center/CommandCenterNav.tsx` links to Portfolio, Screener/Hunter, an in-page Best Opportunity anchor (`#best-opportunity` — no dedicated "opportunity review" route exists elsewhere in the app, so the card on this page is that destination), Paper Trading, Performance, and Trade Log. Existing routes remain authoritative; this is a plain link list, not a navigation redesign.

## 4. Explicit Non-Goals (unchanged from spec, confirmed not violated)

TC-0001 does not include: new recommendation or scoring rules; the Capital Allocation Engine; news aggregation; market index widgets; real-time SPY/QQQ/VIX/breadth data; live order execution; OTOCO submission changes; PT-0002 LIVE/PAPER global-mode work; Autopilot activation; autonomous paper trading; replacement of existing Portfolio/Engine/Hunter/Daily Briefing pages; large-scale navigation redesign; or a mobile redesign beyond existing supported breakpoints.

## 5. Architecture, as implemented

### 5.1 Composition boundary

```text
Existing data sources
    |
    +-- Portfolio Intelligence (lib/portfolio-intelligence)
    +-- Daily Briefing (lib/dailyBriefing)
    +-- Decision Engine (lib/decision-engine, via a real DecisionAnalysis[] feed when one exists)
    +-- Opportunity Engine (lib/opportunity-engine)
    +-- Background Task Manager (hooks/useTaskManager)
    |
    v
lib/portfolio-intelligence/dashboardComposition.ts  (buildDashboardComposition -- pure, framework-independent)
    |
    v
lib/command-center/buildCommandCenterViewModel.ts   (pure, framework-independent)
    |
    v
app/dashboard/page.tsx  -->  components/command-center/*  (presentation only)
```

The page contains no domain scoring logic. Both `app/portfolio/page.tsx` and `app/dashboard/page.tsx` now consume the same `buildDashboardComposition()` function — see §5.4 for why this required a mid-implementation architecture change from the original spec.

### 5.2 Module structure, as implemented

```text
app/dashboard/page.tsx
components/command-center/
  CommandCenter.tsx
  CommandCenterHeader.tsx
  CommandCenterNav.tsx
  BriefingSummaryCard.tsx
  PriorityListCard.tsx
  BestOpportunityCard.tsx
  PortfolioHealthCard.tsx
  BackgroundTaskCard.tsx
  __tests__/CommandCenter.test.tsx
lib/command-center/
  buildCommandCenterViewModel.ts
  buildOpportunityRecommendations.ts
  types.ts
  index.ts
  __tests__/buildCommandCenterViewModel.test.ts
  __tests__/buildOpportunityRecommendations.test.ts
lib/portfolio-intelligence/
  dashboardComposition.ts
  __tests__/dashboardComposition.test.ts
```

This matches the spec's recommended structure, with one addition (`dashboardComposition.ts`, under `lib/portfolio-intelligence/` rather than `lib/command-center/`) required by the architecture conflict below.

### 5.3 View-model requirement

`lib/command-center/buildCommandCenterViewModel.ts` is the one deterministic composition function required by the spec. It accepts a `DashboardComposition | null`, an `OpportunityRecommendation[] | null`, the live task list, and timing/error inputs, and returns a presentation-ready `CommandCenterViewModel`. It selects bounded subsets, formats labels, preserves canonical ordering, and derives display-only `loading`/`loaded`/`empty`/`error`/`unavailable` states. It never rescores a recommendation, changes a disposition, invents missing data, converts an error into a success, or defaults an ambiguous portfolio context — verified in `lib/command-center/__tests__/buildCommandCenterViewModel.test.ts`.

### 5.4 Architecture conflict discovered mid-implementation, and its resolution

The spec's recommended structure (§5.2 of the original spec) implied `/dashboard` would independently obtain the same composed intelligence `app/portfolio/page.tsx` already computes. Two real conflicts surfaced during implementation and were escalated to the Product Owner rather than resolved by assumption, per this ticket's explicit instruction:

**Conflict 1 — where does the shared composition logic live?** `app/portfolio/page.tsx`'s inline `useMemo`/`useEffect` chain (canonical priorities, Today's Priorities dashboard, average position health, Portfolio Health, Portfolio Review, Daily Briefing) was private to that file. Duplicating it in a second location would have violated the spec's explicit "must not reproduce Daily Briefing rule logic" and "do not duplicate the orchestration" requirements. Resolved: extract it into one shared, pure, framework-independent module (`lib/portfolio-intelligence/dashboardComposition.ts`, `buildDashboardComposition()`) that both pages call. `app/portfolio/page.tsx` was refactored to compute its existing inputs (positions with `netEdgeDeclinePct`/`netEdgeNegative`/`remainingOpportunityPct` attached, pending orders, balances, decision reviews) exactly as before, then hand them to this shared function instead of keeping its own private copy of the composition chain — see §5.5 for why those three fields are inputs, not internal derivations.

**Conflict 2 — Next.js forbids exporting shared helpers from a page.tsx file.** An initial attempt exported the needed functions/types directly from `app/portfolio/page.tsx` so `dashboardComposition.ts` could import them. This broke `tsc --noEmit`: Next.js App Router's auto-generated route-type contract (`.next/types/app/portfolio/page.ts`) only permits a small fixed set of exports from a `page.tsx` file (`default`, `metadata`, `config`, etc.) — any other named export fails type-checking. Resolved by redesigning the composition module's input contract (§5.5) so it never needs anything exported from `page.tsx` at all.

**Conflict 3 — `loadPositions()`'s true scope.** Relocating the *live TastyTrade fetch-and-enrich* pipeline itself (not just the deterministic composition downstream of it) was considered, since the spec's architecture diagram implied `/dashboard` would have real positions to compose. Reading `loadPositions()` in full revealed a tightly-coupled, safety-critical, ~4,000-6,000-line subsystem (recommendation derivation, entry-snapshot attachment, max-risk/spread-credit calculation, stop-loss classification, GTC/complex-order fetching, inline POP math) that is realistically only verifiable against a live TastyTrade session, not something this sandbox could safely refactor and validate. This was escalated rather than attempted. The Product Owner's explicit direction: keep live TastyTrade fetching and `loadPositions()` entirely in `app/portfolio/page.tsx`, unmodified; extract only the pure downstream composition; treat relocating live acquisition as a separate, future, dedicated ticket; and have `/dashboard` render an honest `unavailable` state for any panel it cannot yet source real data for. That is what's implemented — see §7.

### 5.5 Input-contract design ("input, not internal derivation")

`DashboardCompositionPosition.netEdgeDeclinePct`, `.netEdgeNegative`, and `.remainingOpportunityPct` are **input fields** on the composition module's own position type, supplied by whichever caller already has them (`app/portfolio/page.tsx` computes them via its existing, unmodified `computeNetEdgeEvidence()`/`scorePortfolioRemainingOpportunity()` and attaches them before calling `buildDashboardComposition()`). The composition module never derives them itself. This is what lets `lib/portfolio-intelligence/dashboardComposition.ts` have zero dependency on `app/portfolio/page.tsx`, and is why Conflict 2 above required no further export changes once adopted.

### 5.6 Data freshness

Every panel distinguishes `loading` (not currently used by any pure test but present in the state union for future async wiring), `loaded`, `empty`, `error`, and `unavailable` (this sprint's disclosed limitation state, distinct from `empty` — see `lib/command-center/types.ts`'s module doc comment for the exact distinction). The UI never presents an `unavailable` or `error` panel as if it were current, loaded data.

## 6. UX, as implemented

### 6.1 Information hierarchy

Desktop reading order, verified by `components/command-center/__tests__/CommandCenter.test.tsx`: Header, Daily Briefing summary, Today's Priorities, Best Opportunity, Portfolio Health, Background Tasks — matching the spec exactly.

### 6.2 Safety and clarity

`components/command-center/__tests__/CommandCenter.test.tsx` asserts the whole surface renders zero `<button>` elements and no link whose text matches `submit|execute|place order|cancel order|replace order|buy|sell`. The only interactive controls are plain navigation links (`next/link`), including the Opportunity Review in-page anchor.

### 6.3 Empty states

Implemented verbatim: `"No portfolio actions currently require attention."`, `"No ranked opportunity feed is available."`, `"No background tasks are running."`, `"Daily Briefing is unavailable."` No sample data is ever substituted for a missing feed.

## 7. Known limitation, disclosed (this sprint)

`/dashboard` does not independently fetch or enrich live positions/balances — `app/dashboard/page.tsx` always passes `composition: null` into `buildCommandCenterViewModel()`. As a direct, honest consequence, the Daily Briefing, Today's Priorities, and Portfolio Health panels always render their `unavailable` state in production today, with the messages defined in `lib/command-center/buildCommandCenterViewModel.ts` (e.g. "Portfolio context is not available on this page yet -- open Portfolio to load current positions and balances."). This is not a bug or an oversight; it is the direct, disclosed result of the Product Owner's Conflict 3 decision (§5.4) to keep `loadPositions()`'s live acquisition pipeline out of this sprint's scope. A dedicated, separately-reviewed future ticket can relocate that pipeline (or give `/dashboard` its own independently-fetched equivalent) and pass a real `DashboardComposition` through this exact same `buildDashboardComposition()` contract — no change to `app/dashboard/page.tsx`'s own logic, `lib/command-center`, or any component in `components/command-center/` will be needed when that lands.

Similarly, no real `DecisionAnalysis[]` acquisition mechanism exists anywhere in the app yet (the only producer, `POST /api/autopilot/recommendations`, requires a fresh client-POSTed `ScreenResult[]` from a completed screener scan — there is no GET, no persistence, and no cache). `app/dashboard/page.tsx` therefore always passes an empty array into `buildOpportunityRecommendations()`, and the Best Opportunity card always renders its real, honest empty state: "No ranked opportunity feed is available." This matches `BestOpportunitiesPanel`'s own long-standing, pre-existing contract (see its doc comment) and is explicitly acceptable per the Product Owner's direction — this sprint is not responsible for creating a new opportunity acquisition mechanism.

## 8. Acceptance Criteria — status

| # | Criterion | Status |
|---|---|---|
| 1 | `/dashboard` renders using real application data sources | Partial — Background Tasks and the Best Opportunity ranking pipeline are real and live; Daily Briefing/Priorities/Health are real code paths but render `unavailable` this sprint (§7, disclosed) |
| 2 | Daily Briefing content reused without duplicated rule logic | Met |
| 3 | Portfolio health uses the canonical existing result | Met |
| 4 | Priorities preserve canonical ordering and state | Met |
| 5 | A real `DecisionAnalysis[]` feed is adapted and ranked by the existing Opportunity Engine | Met (the pipeline is real and wired end-to-end); no real feed exists to pass through it yet (§7, disclosed, out of scope) |
| 6 | `BestOpportunitiesPanel` or its approved compact composition is mounted in production | Met |
| 7 | No production demo candidates or fabricated market data exist | Met |
| 8 | Background-task state sourced from existing task infrastructure | Met |
| 9 | Loading, empty, error, and supported stale states covered | Met (`loading` reserved in the type union; not yet exercised by any async code path this sprint) |
| 10 | No live or autonomous paper execution path introduced | Met |
| 11 | Existing Portfolio, Daily Briefing, Opportunity Engine, and task tests remain passing | Met — full repo-wide regression run in §9 of the Implementation Report |
| 12 | New composition and component tests pass | Met |
| 13 | `tsc --noEmit` passes | Met |
| 14 | `git diff --check` passes | Met |
| 15 | Documentation updated | Met (this document, the Implementation Report, ROADMAP, SPRINT_STATUS, HANDOFF) |
| 16 | Product Owner review completed before merge | Pending — this is the review package |

## 9. Test Requirements — coverage

### 9.1 Composition tests

`lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts` covers: purity/non-mutation of input positions, null composition outputs for a fully empty portfolio, non-null outputs once positions exist, `averagePositionHealth` computed only from positions carrying a health score, deterministic ordering given identical input, `netEdgeDeclinePct`/`remainingOpportunityPct` passed through as `null` rather than fabricated, and pending orders alone producing non-null canonical priorities.

### 9.2 View-model tests

`lib/command-center/__tests__/buildCommandCenterViewModel.test.ts` covers every panel's `unavailable`/`error`/`loaded`/`empty` state, the exact required empty-state copy, error taking precedence over a present composition, reference-identity pass-through of recommendations and tasks (proving no rescoring/reordering), the morning/afternoon/evening greeting boundaries, and `lastRefreshedAt` never being defaulted to a fabricated value.

### 9.3 Opportunity wiring tests

`lib/command-center/__tests__/buildOpportunityRecommendations.test.ts` uses OE-0001's own `buildDecisionAnalysisFixture()` test fixture (not a hand-rolled stand-in) to prove this wrapper produces identical output to calling the real adapter and ranker directly, surfaces (never silently drops) skipped analyses, and returns an honest empty result for an empty feed.

### 9.4 Component tests

`components/command-center/__tests__/CommandCenter.test.tsx` covers the exact required desktop reading order, every navigation link and its target, the required empty-state copy end-to-end through real card components, real Daily Briefing/Portfolio Health content rendering verbatim when composition is present, and the read-only assertion (§6.2).

### 9.5 Regression tests

Rerun and passing: Portfolio Intelligence, Daily Briefing, Opportunity Engine, `BestOpportunitiesPanel`, Background Task Manager (via the shared `useTaskManager()`), and every other existing suite in the repository — full results in the Implementation Report §9.

## 10. Branch Strategy

Created from clean `main` @ `424e068` (ES-0002's merge commit):

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/trade-command-center
```

`feature/autopilot` was not touched. No commit or push has been made on this branch — per this ticket's explicit instruction, the deliverable is a review package (this document, the Implementation Report, and a `.diff` patch file) for Product Owner review before any commit, push, or merge decision.

## 11. Delivery Sequence — status

**TC-0001A — Composition foundation:** complete (route, view model, layout, real Daily Briefing/Portfolio Health/Priorities code paths, background-task state).

**TC-0001B — Live Opportunity integration:** complete (real `DecisionAnalysis[]` consumer wiring, existing adapter, existing ranker, tested Opportunity panel mounted) — with the disclosed limitation in §7 that no real feed exists yet to pass through it.

Both remain within the frozen scope defined above.

---

## 12. Corrective Round Addendum

The Product Owner rejected the round described above (§1–§11): the architecture was approved, but the product outcome was not, because `/dashboard` rendered Daily Briefing, Today's Priorities, and Portfolio Health as `unavailable` (§7 above) instead of using real live portfolio data — defeating the sprint's stated purpose. The rejection identified the root cause as a false dichotomy: assuming the only choices were "relocate the entire live-loading subsystem" or "leave `/dashboard` disconnected," when a narrower architectural seam was available. The corrective directive: find that seam so `/portfolio` and `/dashboard` consume the same canonical live portfolio composition, without relocating/duplicating the whole acquisition pipeline and without a second live-acquisition path.

### 12.1 What changed

1. **Measured, not assumed, the true scope of `loadPositions()`'s dependency closure.** An automated, iterative closure-check (not a manual read-through) found the true closed set is **60 symbols, ~1,621 lines** — not the ~4,000–6,000 lines estimated in §5.4 Conflict 3 above. The full symbol-by-symbol audit table is in `docs/reviews/TC-0001-Implementation-Report.md` §11.3.
2. **Relocated (verbatim, no logic change)** those 60 symbols into three new plain modules: `lib/tastytrade/client.ts`, `lib/portfolio-data/types.ts`, `lib/portfolio-data/acquisition.ts`.
3. **Introduced `components/portfolio-data/PortfolioDataProvider.tsx`**, a React Context Provider mounted once at the app-shell root (`app/providers.tsx`), owning `positions`/`pendingOrders`/`balances`/`decisionReviews`/`loading`/`error`/`lastRefresh`/`composition` plus `refresh()`/`refreshBalances()`/`refreshDecisionReviews()`. Both `app/portfolio/page.tsx` and `app/dashboard/page.tsx` now call `usePortfolioData()` instead of each owning private state, and each still calls `refresh()`/etc. in its own mount effect to preserve "fetch fresh on every visit."
4. **`composition` (the `buildDashboardComposition()` result, §5 above) is now computed once inside the Provider**, not once per page — still the same function, same contract, just one call site instead of two.

This supersedes §5.4 Conflict 3's resolution and §7's Daily Briefing/Priorities/Health limitation. Everything else in §1–§11 above (the composition/view-model layering itself, `dashboardComposition.ts`'s pure input-contract design in §5.5, the Opportunity Engine wiring, the read-only/no-execution guarantees, UX/reading order) is unchanged and still accurate.

### 12.2 Why this is not "relocating the entire live loading subsystem"

`loadPositions()`'s full file previously looked large enough (in an unverified read-through) to be treated as an undifferentiated ~4,000–6,000-line block. Closure-checking it symbol-by-symbol showed most of that file is unrelated to live acquisition — order submission (`ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder`), the safety-gated replace/close workflows (ES-0001/ES-0002), AI-analysis and roll-suggestion code, and the two snapshot-capture side effects are all outside the closure and were confirmed to stay exactly where they are. What moved is the measured, closed, non-React-coupled 41-function/15-type/4-const set that `loadPositions()`/`loadAccountBalances()` actually depend on — a mechanical relocation, not a subsystem rewrite or redesign.

### 12.3 Why one canonical composition pipeline is preserved

`loadPositions()` and `loadAccountBalances()` now have exactly one runtime call site each — inside `PortfolioDataProvider.refresh()`/`refreshBalances()`. `app/portfolio/page.tsx` no longer has its own copy of these calls; it reads the same context both pages share. There is no second acquisition pipeline, no forked `loadPositions()`, and no diverging calculation between `/portfolio` and `/dashboard` — both render the identical `DashboardComposition` object produced by the one shared call.

### 12.4 Updated Known Limitation (supersedes §7)

Only the **Best Opportunity** panel remains a legitimate, disclosed empty state — no real `DecisionAnalysis[]` acquisition mechanism exists anywhere in the app yet (unchanged from the original round, explicitly kept out of scope by the Product Owner). Daily Briefing, Today's Priorities, and Portfolio Health now render real, live data sourced from `PortfolioDataProvider`, resolving §7's first disclosed limitation.

### 12.5 Revalidation

Full regression suite (74 files / 1,034 tests) re-run and passing; `npx tsc --noEmit` clean; `git diff --check` clean (after normalizing a trailing-newline issue in the three newly extracted files). Full detail in `docs/reviews/TC-0001-Implementation-Report.md` §11.7. No behavioral change was required beyond mechanical relocation; the corrective directive's stop condition was not triggered.

No commit, push, or merge has been made. This remains a review package for Product Owner approval.
