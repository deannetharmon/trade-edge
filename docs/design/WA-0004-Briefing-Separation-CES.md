# WA-0004 — Briefing Separation: Implementation Specification (CES)

**Status:** CES / design-only. No application code changed.
**Repository:** `deannetharmon/trade-edge`, inspected against `feature/wa-0004-briefing-separation-ces` @ branch point off `main`/`origin/main` @ `2e4b15b06c5d0803bfbe273b4f15058d39d80c95` (working tree clean at inspection time).
**Author:** Dane (Lead Engineer)
**Authority:** `docs/design/WA-0001-Workspace-Content-Ownership-Audit.md`, `docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md`, and `docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md` are authoritative and frozen. This CES cites and extends their rulings; it does not reinterpret them. In particular it closes WA-0002's binding transitional-content obligation (§17 of that CES; restated in `planning/SPRINT_STATUS.md`'s "Known Follow-Ups → Workspace Architecture" section) and executes WA-0001 ruling 3's deferred portfolio-health/what-changed reconciliation and ruling 4's contextual-risk slice, both explicitly assigned to "WA-0004's CES scoping" (WA-0001 §6, §9).

## 1. Executive Summary

Briefing does not currently exist as one coherent workspace — it exists as **two independent, unreconciled implementations** answering overlapping questions with different data, different health derivations, and different "what changed" mechanisms, plus a third, unrelated obligation (WA-0002's transitional content) parked on Positions waiting for a permanent home.

1. **The `briefing` tab** (`features/portfolio/briefing/DailyPortfolioBriefing.tsx`, mounted at `app/portfolio/page.tsx:9256`) renders Portfolio Health (a bespoke 3-bucket derivation, `features/portfolio/briefing/portfolioHealth.ts`), Portfolio Summary, What Changed (a bespoke `localStorage`-diff mechanism, `features/portfolio/briefing/whatChanged.ts`), Suggested Focus — **and the entire legacy Priority List workflow** (`TodaysPrioritiesWorkflow`, imported at line 20, rendered at line 89), Mark Complete/Reopen controls included.
2. **The `DailyBriefingCard` transitional variant** (`features/portfolio/dailyBriefing/DailyBriefingCard.tsx`, mounted on the **Positions** tab at `app/portfolio/page.tsx:9321-9332` with `variant="transitional"`) renders Executive Summary, Portfolio Snapshot, and Upcoming Events, sourced from a third, independent data producer (`lib/dailyBriefing/buildDailyBriefing.ts`), explicitly labeled "Temporary — moving to Briefing in WA-0004." This is WA-0002's binding, carried-forward obligation: *"WA-0004's own CES and acceptance criteria **must** include removing this transitional content and its Positions call site once the Briefing workspace ships an equivalent, permanent destination for it"* (`planning/SPRINT_STATUS.md`).
3. **Mission Control's "Since Your Last Review"** (`components/mission-control/SinceLastReviewSection.tsx`, mounted at `components/mission-control/MissionControl.tsx:43-80` via `narrative.sinceLastReview.changes`) is architecturally complete but **functionally always empty in production** today, because `lib/mission-control/buildMissionControlViewModel.ts:75` hardcodes `revalidationResults: []` — no Trader Commitment persistence is wired to any page. WA-0001 assigns this section's full presentation to Briefing and its Mission-Control remnant to a compact summary; this CES must relocate the mechanism honestly, without implying it currently surfaces real data it does not yet surface.

This CES resolves both of WA-0001's explicitly deferred reconciliations (ruling 3: portfolio health, "what changed") by designating **one canonical producer for each** and retiring the other from *presentation* only (§7, §9, §10). It removes the legacy Priority List from the `briefing` tab per WA-0001 §4's explicit ruling, independent of the Priority List's own eventual WA-0006 retirement. It defines Briefing's new information architecture as a pure composition layer over already-computed data — `buildDailyBriefing()`, `PortfolioReviewSnapshot.currentState.health`, and `ReviewNarrative.sinceLastReview` — introducing zero new scoring, ranking, or eligibility logic anywhere.

**Recommendation: GO**, subject to two Product Owner decisions flagged in §21 (the Portfolio-health canonical source, and whether "Since Your Last Review" ships in Briefing now with an honest empty state or waits for Trader Commitment persistence).

## 2. Problem Statement

Per the frozen product objective (WA-0001 §1, restated in this ticket): Briefing must become the canonical workspace answering "what changed, why does it matter, and what should I understand before acting?" — without competing with Today's Priorities (action queue, WA-0003, frozen), Positions (inventory/monitoring, WA-0002, frozen), or Mission Control (compact command overview).

Today, no single workspace does this. Change-context content is split across three surfaces (`briefing` tab, Positions' transitional `DailyBriefingCard`, Mission Control's `SinceLastReviewSection`), using three different underlying computations for overlapping concepts (two portfolio-health derivations, two "what changed" mechanisms), and the `briefing` tab additionally duplicates the entire Priority List action-completion workflow — violating the "Briefing must not gain completion/action controls" boundary WA-0001 already froze. WA-0002 left an explicit, binding placeholder on Positions pending this sprint. This CES defines the target architecture, the exact content movement, the reconciliation of competing sources of truth, and the sequencing required to close all of the above without touching any canonical engine, the WA-0003 queue contract, or the priority completion workflow.

## 3. Current-State Inventory

Verified directly against the branch point commit:

- `app/portfolio/page.tsx:9211-9232` — six-tab bar: `todays-priorities`, `briefing`, `positions`, `priorities`, `history`, `balances`. Type union at line 8758: `'todays-priorities' | 'briefing' | 'positions' | 'priorities' | 'history' | 'balances'`.
- `app/portfolio/page.tsx:8758-8762` — default-tab `useState` initializer reads `?tab=` from `window.location.search`; only `'todays-priorities' | 'positions' | 'history'` are allow-listed deep-link values (§13), else falls back to `'positions'`. `'briefing'` is **not** currently deep-linkable via `?tab=briefing` — only reachable by clicking the tab.
- `app/portfolio/page.tsx:9256-9264` — `briefing` tab render: `<DailyPortfolioBriefing objectives={canonicalPriorities?.objectives ?? null} loading={loading} th={th} />`.
- `app/portfolio/page.tsx:9321-9332` — inside the `positions` render branch (not `briefing`): a code comment reading *"WA-0002: DailyBriefingCard's transitional variant -- Executive Summary, Portfolio Snapshot, and Upcoming Events only, explicitly labeled temporary. ... Remove this call site as part of WA-0004 once Briefing provides its permanent destination for this content"*, followed by `<DailyBriefingCard briefing={dailyBriefing} loading={loading} th={th} variant="transitional" />`.
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx:104` — `variant?: 'full' | 'transitional'` (default `'full'`); `isTransitional` (line 120) gates out sections 2 (Today's Priorities, via `PriorityRankedList`, imported line 35 from `../dashboard/TodaysPrioritiesDashboard`), 5 (Current Opportunities), 6 (Current Risks), and shows an amber "Temporary — moving to Briefing in WA-0004" banner (lines 129-136). **No production call site anywhere renders `variant="full"` or omits `variant`** — `app/portfolio/page.tsx:9332` is the only production call, and it always passes `"transitional"`. Only test files (`features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx`) exercise the full variant.
- `features/portfolio/briefing/DailyPortfolioBriefing.tsx` (full file, 122 lines) — module doc: *"the Portfolio page's default subpage. 'What do I need to know before the market opens?' ... Portfolio Health, Today's Priorities (reused, unmodified), Portfolio Summary, What Changed ..., and a single closing Suggested Focus line."* Line 20: `import { TodaysPrioritiesWorkflow } from '../components/TodaysPrioritiesWorkflow';`. Line 89: `<TodaysPrioritiesWorkflow objectives={objectives} loading={loading} th={th} />` — the full legacy Priority List experience, Mark Complete/Reopen included, rendered inside a section with no distinguishing label, directly under the `briefing` tab's DOM tree.
- `lib/dailyBriefing/buildDailyBriefing.ts` (204 lines) / `types.ts` (101 lines) — canonical producer for the transitional content. `buildDailyBriefing(input: DailyBriefingInput, now?: Date): DailyBriefing`. `DailyBriefingInput = { portfolioReview: PortfolioReviewSnapshot; dashboard: TodaysPrioritiesDashboard; objectives: PortfolioObjective[]; averagePositionHealth: number | null; capitalDeploymentPct: number | null }`. Output `DailyBriefing = { generatedAt; executiveSummary: string; priorities: PrioritizedObjective[]; snapshot: DailyBriefingSnapshot; upcomingEvents: UpcomingEvent[]; opportunities: OpportunityItem[]; risks: RiskItem[] }`. `DailyBriefingSnapshot = { healthScore; healthStatus: PortfolioReviewSnapshot['currentState']['health']['status']; openPositionCount; capitalDeploymentPct; largestConcentrationPct; averagePositionHealth }` — **its health fields are sourced from `PortfolioReviewSnapshot.currentState.health`, the same canonical score Mission Control uses.** `UpcomingEvent = { id; kind: 'dte'|'earnings'|'decision_review_follow_up'; label; symbol: string|null; detail }`, built by `buildUpcomingEvents()` (lines 51-85) from `dashboard.reviewToday.{expiringPositions, earningsReviews, needsFollowUp}`. `RiskItem = { id; kind: RiskKind; label; detail }`, `RiskKind = 'concentration'|'capital'|'assignment_exposure'|'earnings_exposure'|'immediate_attention'`, built by `buildRiskSummary()` (lines 114-142) — flat, no position identifier field. `buildExecutiveSummary()` (lines 150-180) is a deterministic template, no AI, no independent judgment.
- `features/portfolio/briefing/portfolioHealth.ts` — `derivePortfolioHealth(objectives)`, a **second, independent** health derivation: reads only `objectives[0]`'s `priority`/`actionability` and buckets into `healthy | attention | action`, ignoring `lib/portfolioHealth`'s real 0-100 score entirely. Consumed only by `DailyPortfolioBriefing.tsx:74,81-87` ("Portfolio Health" section).
- `lib/portfolioHealth/` (`config.ts`, `portfolioHealth.ts`, `index.ts`) — the canonical 0-100 `PortfolioHealthStatus` score engine, surfaced via `PortfolioReviewSnapshot.currentState.health`. Consumed by `DailyBriefingCard.tsx:34` (`HEALTH_STATUS_STYLE`, Portfolio Snapshot's Health Score/Status stats), `components/mission-control/SummaryStrip.tsx`, and `components/mission-control/PortfolioStatusSection.tsx` (both on Mission Control).
- `components/command-center/PortfolioHealthCard.tsx` — a third, pre-MB-0002 derivation surface. Confirmed unrouted from any page (`components/command-center/CommandCenter.tsx` has no importer under `app/`); retained only because `components/command-center/PriorityListCard.tsx`, a sibling, still imports `PriorityRankedList`/`SectionHeader`/`EmptyState`/`CoveredCallOpportunityRow`/`NeedsFollowUpRow` from `TodaysPrioritiesDashboard.tsx` (WA-0003 Implementation Report §9's own disclosed-gap finding, reconfirmed unchanged). Out of WA-0004's scope to touch; noted only as a third existing derivation surface, not a live user-facing one.
- `features/portfolio/positions/PositionCompositionCard.tsx` — its own doc comment confirms it *"deliberately excludes ... Portfolio Health ... already fully duplicated on Mission Control"* — i.e., WA-0002 already made a presentation decision not to add a fourth health surface on Positions. Unaffected by this CES.
- `features/portfolio/briefing/whatChanged.ts` (107 lines) — `computeWhatChanged(objectives, previous): WhatChangedEntry[]`, `WhatChangedEntry.kind: 'new'|'changed'|'resolved'`. `localStorage`-based (`BRIEFING_SNAPSHOT_STORAGE_KEY = 'hunter-briefing-last-snapshot'`), diffs current `objectives` against a persisted snapshot using `getPriorityWorkflowKey`/`computeObjectiveFingerprint` (reused, unmodified, from `priorityWorkflowState.ts`). Consumed only by `DailyPortfolioBriefing.tsx:24-30,100-112` ("What Changed" section, rendered only when non-empty).
- `lib/revalidation/types.ts` — `RevalidationChange = { whatChanged: string; whyItMatters: string; whyNow: string }`; `RevalidationResult = { commitment: TraderCommitment; changed: boolean; change: RevalidationChange | null }` (`change` is `null` exactly when `changed` is `false`). `lib/revalidation/rules.ts` — `DEFAULT_REVALIDATION_RULES` registers rules for `HOLD_UNTIL_DTE`, `WAIT_FOR_EARNINGS`, `MONITOR` only; `LET_THETA_WORK` and `GTC_WORKING` have no registered rule (disclosed gap, no theta-decay signal / no live order-status feed).
- `lib/review-conductor/conductReview.ts` (75 lines) — pure `conductReview(input): ReviewNarrative`. `ReviewNarrative.sinceLastReview = { changes: RevalidationResult[] }` (`lib/review-conductor/types.ts:64-123`).
- `components/mission-control/SinceLastReviewSection.tsx` (44 lines) — `aria-label="Since Your Last Review"`, prop `changes: RevalidationResult[]`. Per change, renders `result.commitment.subject.label` (bold title) and, when `result.change` exists, `result.change.whatChanged` and `result.change.whyItMatters` — **does not render `whyNow`**. Empty-state copy: `"Nothing changed since your last review."`
- `components/mission-control/MissionControl.tsx:43-80` — renders `<SinceLastReviewSection changes={narrative.sinceLastReview.changes} th={th} />`, second of seven narrative sections after `SummaryStrip`.
- `lib/mission-control/buildMissionControlViewModel.ts:75` — `revalidationResults: []` (hardcoded). No `lib/trader-commitments` persistence is wired to `/dashboard` or any other page. **"Since Your Last Review" always renders its empty state in production today.**
- `lib/trader-commitments/` (`index.ts`, `store.ts`, `types.ts`) — pure, persistence-agnostic functions (`createTraderCommitment`, `upsertTraderCommitment`, `removeTraderCommitment`, `listActiveCommitments`, `commitmentsForSubject`, `parseTraderCommitmentStore`). No page calls any of them. `TraderCommitment` is a discriminated union (`HoldUntilDteCommitment | MonitorCommitment | LetThetaWorkCommitment | WaitForEarningsCommitment | GtcWorkingCommitment`), each `{ id, createdAt, subject: { type: 'position'|'portfolio', id, symbol, label }, status: 'active', note }`.
- `lib/todays-priorities-queue/` (`types.ts`, `buildTodaysPrioritiesQueue.ts`, `index.ts`) — frozen WA-0003 queue module. `TodaysPrioritiesQueueItem = { kind: 'attention'|'covered_call_opportunity'|'needs_follow_up'; id; stableKey; subjectId; headline; detail; completable; attentionItem?; coveredCallOpportunity?; decisionReview? }`. Built by `buildTodaysPrioritiesQueue({ dashboard, generatedAt })`. **Not touched by this CES.**
- `features/portfolio/todaysPriorities/TodaysPrioritiesQueueView.tsx` (299 lines) — owns level-1 `?priority=<stableKey>` resolution (line 142, `useUrlQueryParam('priority')`) and renders level-2 destination links (`?tab=history&reviewId=…`, `?tab=positions&focus=…`, or unfocused `?tab=positions`). **Not touched by this CES.**
- `features/portfolio/positions/HealthyMonitoringSection.tsx` (74 lines) — `aria-label="Healthy Position Monitoring"`, mounted on Positions (`app/portfolio/page.tsx:9345`, inside the `positions` branch, alongside `PositionCompositionCard`). Props `{ monitor: TodaysPrioritiesMonitorEntry[]; th }`. No completion control, never counted in any queue. **Stays on Positions; not touched by this CES.**
- `features/portfolio/components/TodaysPriorities.tsx` (322 lines, exports `PriorityCard`, `TodaysPriorities`) and `features/portfolio/components/TodaysPrioritiesWorkflow.tsx` (137 lines, the Priority List's Open/Completed + Mark Complete/Reopen shell, `localStorage`-backed) — the legacy Priority List, mounted independently on the `priorities` tab (unaffected, unmodified) **and** embedded inside `DailyPortfolioBriefing.tsx` (§3 above, to be removed — §6).
- `features/portfolio/priorities/priorityWorkflowState.ts` (172 lines) — `PRIORITY_WORKFLOW_STORAGE_KEY = 'hunter-priorities-workflow-state'`; `getPriorityWorkflowKey`, `computeObjectiveFingerprint`, `isCompletable`, `partitionPriorities`, `markComplete`, `reopenPriority`, `loadPriorityWorkflowState`, `savePriorityWorkflowState`. **Not touched by this CES** — reused, unmodified, only by `whatChanged.ts`'s diff keys, exactly as it already is today.
- Deep-link params confirmed exact (WA-0003, unchanged): `tab` (allow-listed `todays-priorities|positions|history`, read once in `page.tsx`'s `useState` initializer, line 8760), `priority` (level-1, read exclusively inside `TodaysPrioritiesQueueView.tsx` via `useUrlQueryParam('priority')`), `focus` (level-2, `pos.key` match, `page.tsx` lines 8804-8808), `reviewId` (level-2, `DecisionReview.id`, `page.tsx` lines 8809-8812). No `useSearchParams` usage anywhere under `app/portfolio/` or `features/portfolio/` — this app deliberately avoids it (no Suspense boundary elsewhere); all params are read via `useState` initializers or the small `useUrlQueryParam` hook.
- `components/portfolio-mode/PortfolioModeGateNotice.tsx` — shared gate notice (`resolving`/`invalid`/`PAPER`/unresolved states, `role="status"`/`aria-live="polite"` or `role="alert"`). Loading-copy convention: `"Loading Today's Briefing…"` (`DailyBriefingCard.tsx:113`), `"Loading briefing…"` (`DailyPortfolioBriefing.tsx:68`). Fail-safe dismissible notice convention: `"This priority is no longer open."` (`TodaysPrioritiesQueueView.tsx:202`), `"The position this link pointed to is no longer open."` (`page.tsx:9317`). Empty-state convention: small centered `<p>` in `th.textFaint`, e.g. `"Nothing needs your attention right now."`, `"No upcoming events right now."`, `"No active risks right now."`, `"Nothing changed since your last review."` Stale-data convention: `stalePriceWarning: boolean` → `"⚠ Price moved since load"` (`page.tsx:3759`); `~` P&L suffix when `pos.pnl == null && pos.plOpen != null` (`isStale`, line 7792).
- `package.json` scripts (verbatim): `{ "dev": "next dev", "build": "next build", "start": "next start", "lint": "next lint", "test": "vitest run", "test:watch": "vitest" }` — no planning-doc-consistency script exists.

## 4. Current Data-Flow and Component Ownership

```
PortfolioObjective[] (lib/portfolio-intelligence, unchanged)
PortfolioReviewSnapshot (lib/portfolio-intelligence + lib/portfolioHealth, unchanged)
TodaysPrioritiesDashboard (lib/todaysPriorities, unchanged)
         |
         +-----------------------------+-----------------------------+
         v                             v                             v
buildDailyBriefing()          derivePortfolioHealth()        computeWhatChanged()
(lib/dailyBriefing,            (features/portfolio/briefing,  (features/portfolio/briefing,
 CANONICAL -- reads real       BESPOKE -- reads only            BESPOKE -- localStorage diff,
 health score via              objectives[0], ignores the       independent of RevalidationResult)
 PortfolioReviewSnapshot)      real health score)
         |                             |                             |
         v                             v                             v
DailyBriefingCard              DailyPortfolioBriefing         DailyPortfolioBriefing
variant="transitional"         "Portfolio Health" section     "What Changed" section
mounted on POSITIONS           mounted on BRIEFING tab        mounted on BRIEFING tab
(app/portfolio/page.tsx:9332)  (app/portfolio/page.tsx:9256)  (same)
                                        |
                                        v
                               TodaysPrioritiesWorkflow
                               (embedded legacy Priority List,
                                Mark Complete/Reopen included --
                                VIOLATES the Briefing/Today's
                                Priorities boundary, WA-0001 §4)

Separately:
TraderCommitment[] (lib/trader-commitments, unwired -- no persistence anywhere)
         |
         v (hardcoded revalidationResults: [] at buildMissionControlViewModel.ts:75)
conductReview()  -->  ReviewNarrative.sinceLastReview.changes  (always [])
(lib/review-conductor, unchanged)         |
                                           v
                               SinceLastReviewSection
                               mounted on MISSION CONTROL (/dashboard)
                               (always renders empty state today)
```

**Target flow (post WA-0004):**

```
PortfolioReviewSnapshot.currentState.health   (lib/portfolioHealth, CANONICAL, unchanged)
TraderCommitment[] / RevalidationResult[]     (lib/trader-commitments + lib/revalidation, CANONICAL for
                                                "what changed", unchanged -- persistence remains a
                                                separate, unscoped obligation, see §21)
buildDailyBriefing()                          (lib/dailyBriefing, CANONICAL for Executive Summary /
                                                Snapshot / Upcoming Events, unchanged)
buildTodaysPrioritiesQueue() partition        (lib/todays-priorities-queue, CANONICAL for "how many
                                                open items exist" -- read-only reference, never mutated
                                                or completed from Briefing)
         |
         v
BriefingView (new, features/portfolio/briefing/)
  composes, does not compute:
  - Portfolio Health section        <- PortfolioReviewSnapshot.currentState.health (via buildDailyBriefing's snapshot)
  - Executive Summary / Snapshot /  <- buildDailyBriefing() (relocated from Positions' transitional
    Upcoming Events                    DailyBriefingCard, and from the briefing tab's own Portfolio Summary)
  - Since Your Last Review          <- ReviewNarrative.sinceLastReview.changes (relocated from Mission
                                        Control; same conductReview() output, no re-derivation)
  - Contextual / newly-intensified  <- buildDailyBriefing().risks (RiskItem[], already computed,
    risks                              re-presented, not re-scored)
  - (removed) legacy Priority List embed -- gone
         |
         v
Mission Control's reduced "Since Your Last Review" summary
  <- same ReviewNarrative.sinceLastReview.changes + same buildTodaysPrioritiesQueue()-derived counts
     Briefing uses -- single shared source, per §11, mirrors WA-0003 §11's Mission Control pattern
```

## 5. Target Workspace Architecture

| Workspace | Job | WA-0004 disposition |
|---|---|---|
| Mission Control | Compact cross-workspace command overview and navigation | Loses the full "Since Your Last Review" presentation; gains a compact summary + deep link into Briefing (§11) |
| **Briefing** | What changed, why it matters, what to understand — explanatory, not actionable | Becomes the single canonical composition of: Portfolio Health, Executive Summary/Snapshot/Upcoming Events, Since Your Last Review, contextual/newly-intensified risks. Loses the embedded legacy Priority List. |
| Today's Priorities | Finite queue of concrete actions (WA-0003, frozen) | Unaffected. Referenced read-only by Mission Control's and Briefing's counts, never mutated from either. |
| Positions | Complete inventory, management, healthy monitoring | Loses the transitional `DailyBriefingCard` content (moves to Briefing) once Briefing's replacement is verified (§20 sequencing). `HealthyMonitoringSection`, `PositionCompositionCard` unaffected. |
| Opportunities/Screener | Discovery/evaluation of new trades | WA-0005 scope. Not touched, not redesigned, not begun. |
| Legacy Priority List (`priorities` tab) | Interim action-completion surface pending WA-0006 retirement | Unaffected as a tab. Its *embedded copy inside Briefing* is removed (this is a removal of duplication, not of the Priority List itself). |

## 6. Exact Content Movement

| Content | Current location(s) | Current producer | WA-0004 disposition | New location |
|---|---|---|---|---|
| Executive Summary | `DailyBriefingCard` (Positions, transitional) | `buildDailyBriefing()` | MOVE | Briefing |
| Portfolio Snapshot (health score/status, open count, capital deployment, concentration, avg position health) | `DailyBriefingCard` (Positions, transitional) | `buildDailyBriefing()` | MOVE | Briefing |
| Upcoming Events | `DailyBriefingCard` (Positions, transitional) | `buildDailyBriefing()` | MOVE | Briefing |
| Current Opportunities / Current Risks sections of `DailyBriefingCard` | Never rendered in production (suppressed by `variant="transitional"`) | `buildDailyBriefing()` | Current Risks: MOVE (the contextual/change-driven slice, §9). Current Opportunities: EXCLUDE from Briefing — this is discovery-of-new-trade content, WA-0005/Opportunities' concern, not Briefing's, per WA-0001's already-frozen distinction (mirrors WA-0003 §4's "screener candidates" exclusion). | Current Risks → Briefing. Current Opportunities → left unrendered pending WA-0005; not in scope here. |
| `DailyBriefingCard` component + its `variant="transitional"` call site | `app/portfolio/page.tsx:9321-9332` | n/a (view) | REMOVE the Positions call site and the `transitional` variant, **only after** Briefing's replacement content is verified live (§20 sequencing — this is WA-0002's binding obligation, closed here) | n/a — component itself may be retired or repurposed as Briefing's own renderer (§16) |
| Portfolio Health (bespoke 3-bucket) | `briefing` tab, `DailyPortfolioBriefing.tsx` | `derivePortfolioHealth()` (`features/portfolio/briefing/portfolioHealth.ts`) | REMOVE from presentation (superseded by the canonical score, §7); underlying function may remain in the tree unless confirmed to have zero other consumers | n/a |
| Portfolio Health (canonical 0-100 score) | Mission Control (`SummaryStrip`, `PortfolioStatusSection`); `DailyBriefingCard`'s Portfolio Snapshot (dormant, transitional) | `lib/portfolioHealth` via `PortfolioReviewSnapshot.currentState.health` | STAYS on Mission Control (compact); becomes Briefing's canonical health presentation via `buildDailyBriefing()`'s snapshot | Briefing (new), Mission Control (unchanged) |
| Portfolio Summary (bullet list) | `briefing` tab, `DailyPortfolioBriefing.tsx` | `derivePortfolioSummary()` | SUPERSEDED by relocated Portfolio Snapshot (§7) — functionally overlapping; retained only if it presents fields Snapshot does not (implementation-time check, §16) | Briefing (folded into Snapshot, or removed if fully redundant) |
| What Changed (bespoke objective-diff) | `briefing` tab, `DailyPortfolioBriefing.tsx` | `computeWhatChanged()` (`features/portfolio/briefing/whatChanged.ts`) | REMOVE from presentation (superseded by "Since Your Last Review," §10); underlying function retained only if a future sprint needs objective-level diffing again — not deleted from the repo by this CES unless §17's four-criteria test is met at implementation time | n/a |
| Since Your Last Review (full presentation) | Mission Control, `SinceLastReviewSection.tsx` | `conductReview()` → `ReviewNarrative.sinceLastReview` | MOVE (full presentation) | Briefing |
| Since Your Last Review (Mission Control remnant) | n/a (did not exist as a separate summary before) | Same `ReviewNarrative.sinceLastReview` + same `buildTodaysPrioritiesQueue()`-style count | NEW, compact | Mission Control (§11) |
| Suggested Focus (single closing line) | `briefing` tab, `DailyPortfolioBriefing.tsx` | `deriveSuggestedFocus()` | RETAIN, unchanged in meaning — this is legitimately Briefing's own "what to understand" content and does not overlap any other surface | Briefing (unchanged position/behavior) |
| Legacy Priority List embed (`TodaysPrioritiesWorkflow`, Mark Complete/Reopen) | `briefing` tab, `DailyPortfolioBriefing.tsx:20,89` | `TodaysPrioritiesWorkflow` / `priorityWorkflowState.ts` | **REMOVE from Briefing.** Not a relocation — Today's Priorities (WA-0003) and the `priorities` tab (unmodified) already own this content; Briefing gains nothing by re-embedding it and gaining it would violate the "Briefing must not gain completion/action controls" boundary | Removed; no replacement needed (already fully owned elsewhere) |
| `DailyBriefingCard`'s dormant `PriorityRankedList` import (section 2, "Today's Priorities," only active under `variant="full"`) | `DailyBriefingCard.tsx:35,151-160` | `TodaysPrioritiesDashboard.tsx`'s `PriorityRankedList` (read-only ranked list, not the Mark Complete workflow) | If `DailyBriefingCard` (or its content) becomes Briefing's renderer with a `'full'`-equivalent variant, this section must **not** activate — Briefing does not render a ranked action list, Today's Priorities already owns that. Explicitly suppress or delete this section as part of the same change that removes the `transitional`/`full` variant split (§16) | n/a — suppressed, not relocated |
| Healthy-position monitoring | Positions, `HealthyMonitoringSection.tsx` | `TodaysPrioritiesMonitorEntry[]` (`lib/todaysPriorities`) | **NO CHANGE — stays on Positions** (WA-0003 §10, reaffirmed) | Positions (unchanged) |
| WA-0003 finite queue (Today's Priorities) | Today's Priorities | `buildTodaysPrioritiesQueue()` | **NO CHANGE — contract frozen** | Today's Priorities (unchanged) |
| Legacy Priority List as a tab | `priorities` tab | `TodaysPriorities.tsx` / `TodaysPrioritiesWorkflow.tsx` | **NO CHANGE — retirement is WA-0006** | `priorities` tab (unchanged) |

## 7. Source-of-Truth Decisions

| Concept | Competing implementations found | Canonical producer (this CES's ruling) | Deprecated from presentation | Deprecated implementation's fate |
|---|---|---|---|---|
| Portfolio health | (a) `lib/portfolioHealth` real 0-100 score, surfaced via `PortfolioReviewSnapshot.currentState.health`; (b) `features/portfolio/briefing/portfolioHealth.ts`'s `derivePortfolioHealth()`, a 3-bucket derivation reading only `objectives[0]` | **(a)**, `lib/portfolioHealth` via `PortfolioReviewSnapshot.currentState.health` — already Mission Control's and the transitional `DailyBriefingCard`'s canonical source; the only one of the two that reflects the whole portfolio rather than a single objective | (b) `derivePortfolioHealth()` | Removed from Briefing's rendering. The function itself is not deleted by this CES unless implementation-time inspection under §17's four-criteria test confirms zero other consumers (currently its only consumer is `DailyPortfolioBriefing.tsx`, which this CES replaces) |
| "What changed" | (a) `features/portfolio/briefing/whatChanged.ts`'s `computeWhatChanged()`, an objective-level `localStorage` diff; (b) `lib/revalidation`'s `RevalidationResult.change` (`whatChanged`/`whyItMatters`/`whyNow`), a commitment-level revalidation mechanism, surfaced via `ReviewNarrative.sinceLastReview` | **(b)**, `lib/revalidation` via `ReviewNarrative.sinceLastReview` — this is the mechanism WA-0001 assigns "Since Your Last Review" to, is commitment-scoped (ties a change to *why the trader is holding*, not just *that a field differs*), and already carries `whyItMatters`/`whyNow` context (a) never computed | (a) `computeWhatChanged()` | Removed from Briefing's rendering. Retained in the repo only if a future sprint needs objective-level diffing independent of commitments — not deleted here unless §17's criteria are met |
| "Since Your Last Review" open-item count (for Mission Control's summary and Briefing's own count line) | (a) `ReviewNarrative.counts.attention` (filtered, excludes items a commitment change already covers this cycle); (b) `buildTodaysPrioritiesQueue()`'s partitioned open count (WA-0003 §11's chosen source for Mission Control's Attention summary) | **(b)**, the same `buildTodaysPrioritiesQueue()` partition WA-0003 §11 already established as Mission Control's Attention-summary source — reused, not re-derived, to guarantee this new summary cannot drift from the existing one | (a) as a *count source* only — `ReviewNarrative.attention`/`counts.attention` remain fully valid, unchanged, for their own existing purpose (§2 of WA-0003 CES); this CES does not touch `conductReview()` | n/a — (a) is not deprecated, only not reused for this specific new count |
| Executive Summary / Snapshot / Upcoming Events | `lib/dailyBriefing/buildDailyBriefing()` — sole existing producer, no competitor found | `lib/dailyBriefing/buildDailyBriefing()`, unchanged | None (no competing implementation exists) | n/a |
| Contextual/newly-intensified risks | `buildDailyBriefing().risks` (`RiskItem[]`) — sole existing producer; `buildAttentionFeed()`/`buildTodaysPrioritiesQueue()` cover the actionable-risk slice separately, not a competitor for this concept | `buildDailyBriefing().risks`, unchanged | None (no competing implementation exists) | n/a |

**No new scoring, ranking, or health engine is created.** Every decision above selects between two already-existing computations; neither selected producer's internals are modified by this CES.

## 8. Rules for Classifying Informational vs. Actionable Items

Mirroring WA-0003 CES §4's rigor: every rule below reads a field or function that already exists; nothing here is a new classification invented for this sprint.

| Rule | Reads | Informational (→ Briefing) | Actionable (→ Today's Priorities, unchanged) |
|---|---|---|---|
| Actionability tier | `PortfolioObjective.actionability` | `MONITOR` or no objective at all | `CRITICAL`, `ACTION_NEEDED`, `REVIEW_SOON` (already Today's Priorities' queue membership rule, WA-0003 §4 — unchanged) |
| Commitment revalidation | `RevalidationResult.changed` / `RevalidationResult.change` | `changed === true` — a commitment's premise has shifted; the trader needs to *understand* the shift, but `conductReview()` already deliberately dedupes any such item that also appears in `attentionFeed.orderedActionable` (§2 of WA-0003 CES) out of the actionable list, so it cannot double-count as a queue item | Never — a commitment change alone, without a corresponding `AttentionItem`, has no completion identity and is not placed in the queue by `buildTodaysPrioritiesQueue()` (frozen, unchanged) |
| Risk kind | `RiskItem.kind` (`concentration`\|`capital`\|`assignment_exposure`\|`earnings_exposure`\|`immediate_attention`) | Any `RiskItem` **not** already backed by a queue-eligible `PortfolioObjective` — i.e., a risk surfaced for awareness (e.g. rising concentration approaching, but not yet crossing, a threshold) | A risk is actionable, not informational, exactly when the same underlying condition already produced a `PortfolioObjective` with `actionability` in `{CRITICAL, ACTION_NEEDED, REVIEW_SOON}` — in that case it is already in Today's Priorities via the existing queue rule above, and Briefing shows it (if at all) as *context*, never with its own action control |
| Upcoming event | `UpcomingEvent.kind` (`dte`\|`earnings`\|`decision_review_follow_up`) | Any `UpcomingEvent` whose corresponding position/review has **not yet** crossed into an `AttentionItem`/`needs_follow_up` queue item — i.e., "this is coming" awareness | The identical underlying position/review, once it crosses into `reviewToday.expiringPositions`/`earningsReviews`/`needsFollowUp` and thus into the WA-0003 queue (via `buildAttentionFeed()` or the `needs_follow_up` queue-item kind), is actionable and lives in Today's Priorities — Briefing's Upcoming Events entry for it is not removed (it remains useful lead-time context) but is never shown with a completion control |
| Health-status summary vs. position-level monitoring | `PortfolioReviewSnapshot.currentState.health` (portfolio-wide) vs. `TodaysPrioritiesMonitorEntry` (per-position) | Portfolio-wide health score/status → Briefing (and Mission Control, compact) | Per-position monitoring rows → Positions' `HealthyMonitoringSection`, unchanged; Briefing never renders a per-position list, only the aggregate |

**Worked examples:**

1. *Concentration rising from 18% to 22%, threshold at 25%.* No `PortfolioObjective` is produced (threshold not crossed) → `RiskItem { kind: 'concentration' }` only. **Briefing** shows it as context ("Concentration in XYZ has risen to 22%"). It does **not** appear in Today's Priorities, because no objective exists for `buildTodaysPrioritiesQueue()` to surface.
2. *Concentration crosses 25%.* `evaluatePortfolioObjectives()` now produces a `REDUCE_CONCENTRATION` objective with `actionability: 'ACTION_NEEDED'` → it enters `buildAttentionFeed()`'s `orderedActionable` and thus `buildTodaysPrioritiesQueue()` (unchanged, WA-0003 §4). It is now **actionable**, lives in Today's Priorities with a completion control. Briefing may still list the same `RiskItem` as context ("Concentration in XYZ now requires action — see Today's Priorities"), but Briefing renders no Mark Complete control of its own — completion happens only in Today's Priorities.
3. *A `HOLD_UNTIL_DTE` commitment's underlying position crosses its DTE threshold.* `revalidateCommitment()` (once wired, §21) produces a `RevalidationResult { changed: true, change: {...} }`. This is **informational** — it explains *why the trader's original premise changed* — and belongs in Briefing's "Since Your Last Review." Separately, if the position's actionability tier also now qualifies (e.g. `expiringPositions`), it independently appears in Today's Priorities via the unchanged queue rule — the two are not the same list item and neither is derived from the other.
4. *An earnings date is 10 days out, no objective yet.* `UpcomingEvent { kind: 'earnings' }` only. **Briefing**, awareness-only, no action expected yet.
5. *An earnings-triggered review becomes due today.* The same position now also appears in `dashboard.reviewToday.earningsReviews`, entering the WA-0003 queue. **Today's Priorities** shows it as actionable; **Briefing** may retain the original Upcoming Events entry for continuity but never adds a completion control.
6. *Portfolio health score drops from 78 to 65 (no single objective crosses a threshold).* This is a portfolio-wide aggregate shift, not tied to one position → **Briefing**'s Portfolio Health section (and Mission Control's compact summary) reflect the new score. It never becomes a Today's Priorities queue item on its own, because no `PortfolioObjective` was produced.

## 9. Portfolio-Health Reconciliation

Two live, independent derivations exist today (§3, §7): `lib/portfolioHealth`'s real 0-100 score (canonical, already used by Mission Control) and `features/portfolio/briefing/portfolioHealth.ts`'s `derivePortfolioHealth()` (a 3-bucket derivation reading only the first objective in the list, ignoring the real score). **Ruling: the canonical 0-100 score, via `PortfolioReviewSnapshot.currentState.health` (already surfaced through `buildDailyBriefing()`'s `DailyBriefingSnapshot`), becomes Briefing's sole health presentation.** `derivePortfolioHealth()` is removed from Briefing's rendering. This is not a computation change — `buildDailyBriefing()` already computes `healthScore`/`healthStatus` from this exact source (§3); Briefing simply stops using the second, narrower derivation. `derivePortfolioHealth()` itself is not deleted from the repository by this CES (§17 applies at implementation time); it becomes an unreferenced function once `DailyPortfolioBriefing.tsx` is replaced.

## 10. "What Changed" Reconciliation

Two independent mechanisms exist today (§3, §7): `computeWhatChanged()` (objective-level, `localStorage`-diffed) and `lib/revalidation`'s commitment-level `RevalidationResult.change`, surfaced via `ReviewNarrative.sinceLastReview`. **Ruling: `ReviewNarrative.sinceLastReview` becomes Briefing's sole "what changed" presentation**, under the section heading "Since Your Last Review" (relocated from Mission Control, §6) — not a second, separately-labeled "What Changed" section. `computeWhatChanged()` is removed from Briefing's rendering.

**Disclosed, load-bearing caveat, not silently smoothed over:** `ReviewNarrative.sinceLastReview.changes` is always `[]` in production today, because `buildMissionControlViewModel.ts:75` hardcodes `revalidationResults: []` — no Trader Commitment persistence exists anywhere in the app (§3). Relocating this section to Briefing, as specified, does not by itself make it show real data; it inherits the same empty state Mission Control shows today. This CES does **not** scope building Trader Commitment persistence (creating/editing commitments is a separate, larger feature, never scoped by WA-0001-WA-0003 either) — it only relocates the presentation layer and its (currently empty) data source honestly. See §21 for the explicit Product Owner decision this raises: ship Briefing's "Since Your Last Review" now with its accurate empty state, or hold it pending a persistence-wiring sprint.

`computeWhatChanged()` itself is not deleted from the repository by this CES (§17 applies at implementation time).

## 11. Mission Control's Reduced Summary Contract

Mirrors WA-0003 CES §11's exact pattern: Mission Control must never independently recompute what Briefing already computes.

**Current:** `SinceLastReviewSection.tsx` renders the *entire* `narrative.sinceLastReview.changes` list as full cards (title + `whatChanged` + `whyItMatters` per change) — a second, complete reading experience, not a summary.

**New:** `SinceLastReviewSection.tsx` (or a renamed replacement — cosmetic naming choice, mirroring WA-0003's own "cosmetic naming" allowance for `AttentionRequiredSection.tsx`) renders exactly:
1. **Lead change** — the first entry's `commitment.subject.label` (or a "Nothing changed since your last review" empty state, reusing the exact existing copy).
2. **Change count** — `narrative.sinceLastReview.changes.length`, unchanged source (this is *not* the WA-0003 queue count — it is specifically the commitment-change count, a distinct concept from Today's Priorities' open-action count, and must not be conflated with it).
3. **Compact summary** — one line, e.g. `"{count} things changed since your last review."`, mirroring `SummaryStrip.tsx`'s existing `attentionSummary()` phrasing pattern.
4. **Deep link** — one link into **Briefing** (`?tab=briefing`, extended per §13 if a specific-item anchor is added), never bypassing Briefing to jump to a specific position or commitment directly — mirroring WA-0003 ruling 6's "never bypass the intermediate workspace" precedent.

**Parity requirement:** both Mission Control's summary and Briefing's full "Since Your Last Review" section read `ReviewNarrative.sinceLastReview.changes` from the identical `conductReview()` call already made once per `buildMissionControlViewModel()`/Briefing-view-model computation — neither recomputes or independently filters this array. `conductReview()` itself, `ReviewNarrative`, and every existing field on it are completely unchanged. This is a presentation reduction only, exactly like WA-0003 §11's Attention Required reduction.

**Defined behaviors** (mirroring WA-0003 §11):
- **No changes exist** (always true today, per §10's caveat): lead text reads "Nothing changed since your last review." (existing copy, reused verbatim); count reads 0; no deep link rendered (or a disabled/absent link — implementer's choice, consistent with the empty-state pattern already used elsewhere, e.g. `TodaysPrioritiesQueueView.tsx`'s "no lead item" state).
- **Changes exist:** lead = first change's subject label; count = array length; link targets Briefing.

## 12. Briefing Information Architecture and Section Ordering

Reusing `DailyPortfolioBriefing.tsx`'s existing "30-second read" framing (its own module doc, §3) but replacing its content sources per §6-10:

1. **Portfolio Health** — canonical score/status (§9), same visual treatment style as today's health banner (color-coded border/bg per status).
2. **Executive Summary** — relocated from the transitional `DailyBriefingCard` (§6), `buildDailyBriefing().executiveSummary`.
3. **Portfolio Snapshot** — relocated from the transitional `DailyBriefingCard` (§6), `buildDailyBriefing().snapshot` (health score/status, open position count, capital deployment, largest concentration, average position health). Supersedes the old `briefing` tab's separate "Portfolio Summary" bullet list (§6) — if implementation-time inspection finds fields in `derivePortfolioSummary()`'s output not covered by Snapshot, those fields are folded in rather than dropped (§16).
4. **Since Your Last Review** — relocated from Mission Control (§10), full `ReviewNarrative.sinceLastReview.changes` presentation, reusing `SinceLastReviewSection.tsx`'s existing per-change rendering (subject label, `whatChanged`, `whyItMatters` — `whyNow` may be added here since Briefing's job is explicitly "why it matters," and `whyNow` is already computed and simply not rendered today; adding it is a presentation change, not a new computation).
5. **Upcoming Events** — relocated from the transitional `DailyBriefingCard` (§6), `buildDailyBriefing().upcomingEvents`.
6. **Contextual/Newly-Intensified Risks** — the informational slice of `buildDailyBriefing().risks`, per §8's classification rule (risks not already backed by a queue-eligible objective render here; risks that are already actionable may still appear for context but never with a completion control).
7. **Suggested Focus** — retained, unchanged (§6), closing line.

Ordering rationale: health status first (orientation), then the two "what's new since you last looked" sections (Executive Summary/Snapshot as the compact overview, Since Your Last Review as the detailed change narrative) grouped together, then forward-looking awareness (Upcoming Events, Risks), then a single closing synthesis (Suggested Focus) — mirrors the existing `briefing` tab's "orient, then explain, then look ahead, then focus" shape, just with reconciled sources.

**Not included anywhere in Briefing:** Mark Complete/Reopen controls, the legacy Priority List embed, Current Opportunities (discovery content, WA-0005's concern), any per-position monitoring list (Positions' concern).

## 13. Deep-Link and Navigation Contracts

Extends, does not replace, WA-0003's `tab`/`priority`/`focus`/`reviewId` contract (§3, §12 above).

- **`?tab=briefing`** — currently renders but is not in the `tab` allow-list at `app/portfolio/page.tsx:8758-8762` (only `todays-priorities|positions|history` are recognized as explicit deep-link values; unrecognized values fall through to the `'positions'` default). This CES adds `'briefing'` to that allow-list so Mission Control's new deep link (§11) actually lands on Briefing rather than silently falling back to Positions — a **required** change, not optional, since §11's link is otherwise broken.
- **No new item-level anchor param is required for WA-0004's scope.** Mission Control's link targets Briefing as a whole (`?tab=briefing`), mirroring the *level* of specificity WA-0003 ruling 6 required for Today's Priorities (a workspace-level landing, with in-workspace resolution) — but unlike WA-0003, Briefing has no individual completable items to scroll-to/highlight, so no `stableKey`-equivalent is needed. If a future sprint wants to deep-link to a specific "Since Your Last Review" change, that would need its own distinctly-named param (never `priority`, `focus`, or `reviewId` — those are reserved, per WA-0003's "distinct params, distinct resolvers" discipline) — explicitly not built here (§19 non-goals).
- **`priority`/`focus`/`reviewId`** — unchanged, unaffected. Briefing never reads or writes any of these.
- Any param Briefing does add follows the established convention: read via a `useState` initializer or a small dedicated hook (never `useSearchParams`, per the app-wide precedent, §3).

## 14. Loading, Empty, Partial-Data, Stale-Data, and Failure States

Reusing existing vocabulary (§3), not inventing new copy:

| State | Briefing's behavior | Pattern reused from |
|---|---|---|
| Loading (objectives/dashboard not yet available) | `"Loading Today's Briefing…"` or equivalent, centered, `role="status"` | `DailyBriefingCard.tsx:113`, `DailyPortfolioBriefing.tsx:68` |
| No changes since last review | `"Nothing changed since your last review."` | `SinceLastReviewSection.tsx` existing empty copy |
| No upcoming events | `"No upcoming events right now."` | `DailyBriefingCard.tsx` existing empty copy |
| No contextual risks | `"No active risks right now."` | `DailyBriefingCard.tsx` existing empty copy |
| Portfolio Mode not LIVE/resolved | Full-page gate, unaffected — sits above all tab content including Briefing | `PortfolioModeGateNotice.tsx`, unchanged |
| Stale position price feeding into Snapshot/health | Inherits `buildDailyBriefing()`'s existing stale-price handling (unchanged, not touched by this CES) — this CES does not add a new stale-data code path, only relocates the rendering of already-stale-aware data | `stalePriceWarning` convention, `page.tsx:3759` |
| "Since Your Last Review" data source unwired (§10 caveat) | Renders its accurate, honest empty state — **never** implies data exists when `revalidationResults: []` is hardcoded upstream. This is a release requirement, not a cosmetic choice, given this app manages real brokerage positions: a misleadingly-empty-looking-complete "nothing changed" banner must not be confused with "we checked and nothing changed" when in fact the underlying commitment-tracking feature isn't wired yet. Implementation must confirm the empty-state copy remains identical whether zero commitments exist or zero commitments are simply untracked — no new distinguishing copy is invented by this CES (flagged in §21 for Product Owner awareness, not solved here) | N/A — new disclosure requirement specific to this relocation |
| Briefing tab reached via `?tab=briefing` deep link before objectives load | Same loading state as direct navigation — no special-cased "arrived via link" state | Existing pattern (WA-0003's level-1 resolution waits for queue availability the same way) |

## 15. Responsive and Accessibility Expectations

Consistent with existing conventions (§3, item 14 of the research): the Portfolio tab bar and Briefing's own section list use no responsive breakpoint classes (single-column/flex-row at all sizes, matching `TodaysPrioritiesQueueView.tsx` and `HealthyMonitoringSection.tsx`). Only Portfolio Snapshot's stat grid (relocated from `DailyBriefingCard`) retains its existing responsive grid classes (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`, per `DailyBriefingCard.tsx:165`) — this CES does not add new breakpoints beyond what's already relocated verbatim. Each section keeps its existing `aria-label` (`"Portfolio Health"`, `"Since Your Last Review"`, etc.) so no accessibility regression occurs from relocation; `role="status"`/`aria-live="polite"` is preserved on loading states per existing convention.

## 16. File-Level Implementation Plan

| File | Expected change | Reason |
|---|---|---|
| `features/portfolio/briefing/DailyPortfolioBriefing.tsx` | Rewritten: remove `TodaysPrioritiesWorkflow` import/render (§6), remove `derivePortfolioHealth`/`portfolioHealth.ts` usage (§9), remove `computeWhatChanged`/`whatChanged.ts` usage (§10), add `buildDailyBriefing()`-sourced Executive Summary/Snapshot/Upcoming Events (§6, §12), add `ReviewNarrative.sinceLastReview`-sourced Since Your Last Review (§10, §12), add contextual-risk slice of `buildDailyBriefing().risks` (§8, §12), retain `deriveSuggestedFocus()` unchanged | Becomes Briefing's single canonical composition per §12 |
| `features/portfolio/briefing/portfolioHealth.ts` | No longer imported by `DailyPortfolioBriefing.tsx`; retained in the tree pending §17's deletion criteria at implementation time | Superseded by canonical health source (§9) |
| `features/portfolio/briefing/whatChanged.ts` | No longer imported by `DailyPortfolioBriefing.tsx`; retained in the tree pending §17's deletion criteria at implementation time | Superseded by `ReviewNarrative.sinceLastReview` (§10) |
| `features/portfolio/briefing/portfolioSummary.ts` | Likely no longer imported (superseded by relocated Snapshot, §6/§12); implementer confirms no field loss before removing the import, per §17 | Superseded, pending field-coverage confirmation |
| `app/portfolio/page.tsx` | (a) Add `'briefing'` to the `tab` allow-list (§13); (b) **only after** (§20 sequencing) Briefing's replacement content is verified: remove the `DailyBriefingCard`/`variant="transitional"` call site and its surrounding comment block (lines 9321-9332) | Closes WA-0002's binding obligation |
| `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` | Either (a) retired entirely if Briefing's new composition fully supersedes it (no remaining production consumer), or (b) retained and repurposed as (part of) Briefing's renderer with the `transitional`/`full` variant split removed and the dormant `PriorityRankedList` import (§6) deleted — implementer's call at implementation time, gated on §17's four-criteria test; either path must not leave `variant="full"` reachable with its dormant Priority-List-adjacent section still wired | Component's only reason to exist (the transitional/full split) goes away once Positions' call site is removed |
| `lib/dailyBriefing/buildDailyBriefing.ts` / `types.ts` | **No change** — canonical producer, reused as-is | Out of scope; source-of-truth, not touched |
| `lib/portfolioHealth/*` | **No change** | Canonical engine, out of scope |
| `lib/revalidation/*`, `lib/trader-commitments/*`, `lib/review-conductor/conductReview.ts` | **No change** | Canonical engines, out of scope (mirrors WA-0003's explicit "no executable line changed" list) |
| `lib/mission-control/types.ts` / `buildMissionControlViewModel.ts` | No new input required (unlike WA-0003's `workflowState` addition) — `ReviewNarrative.sinceLastReview` is already computed and already flows through the existing view model; only the *rendering* component changes | Additive-free; the data is already there |
| `components/mission-control/SinceLastReviewSection.tsx` | Reduced to lead change/count/summary/deep-link (§11), or renamed replacement | Ruling mirrored from WA-0003 §11 |
| `components/mission-control/MissionControl.tsx` | Mount point for the reduced section unchanged in position (still second, after `SummaryStrip`); only the child component's internal rendering shrinks | Minimal-risk insertion point, same as before |
| `lib/todays-priorities-queue/*`, `features/portfolio/todaysPriorities/*`, `priorityWorkflowState.ts` | **No change** | Frozen WA-0003 contract |
| `features/portfolio/positions/HealthyMonitoringSection.tsx`, `PositionCompositionCard.tsx` | **No change** | Frozen Positions content |
| `features/portfolio/components/TodaysPriorities.tsx`, `TodaysPrioritiesWorkflow.tsx` | **No change** | Legacy Priority List, WA-0006 scope only |

## 17. Test Strategy and Required Coverage

(Specification only — this CES does not write tests.)

- **Briefing composition:** Portfolio Health renders the canonical score/status, not the bespoke 3-bucket derivation (assert `derivePortfolioHealth` is no longer imported/called); Executive Summary/Snapshot/Upcoming Events render `buildDailyBriefing()`'s exact fields, matching what the transitional `DailyBriefingCard` previously rendered on Positions (regression parity test); Since Your Last Review renders `ReviewNarrative.sinceLastReview.changes` identically to Mission Control's pre-move full rendering (same fields, same empty-state copy); contextual risks render the informational slice per §8's rule, with a test asserting a risk that also has a queue-eligible objective still renders (as context) but with no completion control; Suggested Focus unchanged.
- **Legacy Priority List removal from Briefing:** a test asserting `DailyPortfolioBriefing`'s rendered output contains no Mark Complete/Reopen control and does not import `TodaysPrioritiesWorkflow`.
- **`DailyBriefingCard` variant retirement (if retired/repurposed per §16):** if the component is kept, a test confirming the dormant `PriorityRankedList` section (§6) never renders under any variant Briefing uses; if retired, confirm no remaining import anywhere (`grep`-style test or lint rule at implementation time).
- **Positions regression:** confirm the `DailyBriefingCard`/`variant="transitional"` call site's removal from Positions does not orphan any other Positions content, and that `PositionCompositionCard`/`HealthyMonitoringSection` render unaffected — extend WA-0002's own `PortfolioPage.test.tsx` pattern.
- **Mission Control summary reduction:** lead change/count/summary/deep-link render correctly for zero-changes (current, always-true state) and for a populated `changes` array (constructed test fixture); deep link targets `?tab=briefing`; `MissionControl.test.tsx`'s existing narrative-order assertions for every other section remain green; a test asserting the reduced section never renders a completion control (there never was one, but WA-0003's own precedent requires this assertion explicitly for a reduced section).
- **Deep-link allow-list:** `?tab=briefing` is recognized (not falling through to `'positions'`); explicit `?tab=todays-priorities`, `?tab=positions`, `?tab=history` continue to work unchanged; default (`/portfolio` with no params) still lands on `'positions'`.
- **Source-of-truth reconciliation:** a test confirming `features/portfolio/briefing/portfolioHealth.ts` and `whatChanged.ts` are not imported anywhere in the new `DailyPortfolioBriefing.tsx` (guards against silent reintroduction of the deprecated dual sources).
- **Regression:** WA-0003's full suite (`lib/todays-priorities-queue`, `features/portfolio/todaysPriorities/**`, `priorityWorkflowState.test.tsx`, `MissionControl.test.tsx`'s non-SinceLastReview assertions) re-run unmodified and green; WA-0002's Positions suite re-run unmodified and green (minus the now-removed transitional call site's own assertions, which move to Briefing's test file); `lib/dailyBriefing`, `lib/portfolioHealth`, `lib/revalidation`, `lib/trader-commitments`, `lib/review-conductor` suites re-run unmodified and green (no executable line in any of them changes).

## 18. Acceptance Criteria

- Briefing is the single workspace presenting: Portfolio Health (canonical score), Executive Summary, Portfolio Snapshot, Upcoming Events, Since Your Last Review, and contextual/newly-intensified risks — sourced respectively from `PortfolioReviewSnapshot.currentState.health` (via `buildDailyBriefing()`), `buildDailyBriefing()`, and `ReviewNarrative.sinceLastReview`, with no field independently recomputed.
- The `briefing` tab no longer imports or renders `TodaysPrioritiesWorkflow`, and renders no Mark Complete/Reopen control anywhere.
- The `DailyBriefingCard`/`variant="transitional"` call site on Positions is removed, and only after Briefing's equivalent content is verified live (§20) — closing WA-0002's binding obligation.
- `derivePortfolioHealth()` (bespoke 3-bucket) and `computeWhatChanged()` (bespoke objective diff) are no longer referenced by any production rendering path.
- Mission Control's "Since Your Last Review" is reduced to lead change/count/summary/deep-link, sourced from the identical `ReviewNarrative.sinceLastReview` Briefing uses, with a deep link to `?tab=briefing`.
- `?tab=briefing` is a recognized, working deep-link value; the default landing tab remains `'positions'`, unchanged.
- Today's Priorities' queue contract, deep-link contract, and completion workflow have zero executable-line changes.
- Positions' `HealthyMonitoringSection` and `PositionCompositionCard` are unaffected.
- The legacy Priority List (`priorities` tab) is fully functional, unmodified, not retired.
- No new scoring, ranking, risk, or health engine exists anywhere in the diff — every Briefing section is a composition of an already-existing typed output.
- Empty/loading/stale-state copy in Briefing reuses existing app-wide conventions (§14), with no misleading "nothing changed" framing when the underlying commitment-tracking source is simply unwired (§10, §21).

## 19. Explicit Non-Goals

- Building Trader Commitment persistence (creating, editing, or storing `TraderCommitment` records against any page) — `revalidationResults: []` remains hardcoded unless a separate, future sprint scopes this; WA-0004 only relocates the (currently empty) presentation.
- Any redesign, scoping, or touching of Opportunities/Screener (WA-0005).
- Retiring the legacy Priority List, its tab, or its `priorityWorkflowState.ts` (WA-0006).
- Changing the default Portfolio landing tab (`'positions'`, frozen WA-0002/WA-0003).
- Any change to portfolio scoring, recommendation, decision-analysis, or opportunity-ranking logic.
- Introducing a new deep-link param beyond adding `'briefing'` to the existing `tab` allow-list — no item-level Briefing anchor is built in this sprint.
- Deleting `derivePortfolioHealth()`, `computeWhatChanged()`, `derivePortfolioSummary()`, or `DailyBriefingCard.tsx` outright — their fate is gated on §17's four-criteria test at implementation time, not decided here.
- Retiring `TodaysPrioritiesDashboard.tsx`'s remaining `CommandCenter`/`PriorityListCard` dependency (WA-0003's own disclosed, unscoped gap) — untouched, unrelated to Briefing.

## 20. Migration and Deletion Sequencing

Applying WA-0003 CES §17-18's exact deletion-criteria/implementation-sequence model:

**Deletion criteria (applied to every candidate in §16):** zero remaining production consumers; no orphaned test; no domain computation lost (the underlying data-producing function, if any, is either reused elsewhere or has a named future owner); capability either fully duplicated in the new location or explicitly, honestly not carried forward (e.g. the bespoke health/what-changed derivations, superseded per §9-10).

**Sequence:**
1. Build Briefing's new composition in `DailyPortfolioBriefing.tsx` (§12, §16) — additive alongside the still-present legacy embed and the still-present transitional `DailyBriefingCard` on Positions. Add its tests (§17). At this point, the same content briefly exists in three places (old `briefing` tab content, new `briefing` tab content, transitional Positions content) — acceptable, temporary, verifiable overlap, not yet a removal step.
2. Add `'briefing'` to the `tab` allow-list (§13) and verify `?tab=briefing` deep-linking works, independent of any other change.
3. Remove the legacy Priority List embed (`TodaysPrioritiesWorkflow` import/render) and the bespoke `derivePortfolioHealth()`/`computeWhatChanged()` usages from `DailyPortfolioBriefing.tsx`, now that step 1's replacements are live and tested. Confirm via §17's tests that no completion control remains reachable from Briefing.
4. **Only once steps 1-3 are merged, deployed, and confirmed rendering correctly** (this is WA-0002's explicit sequencing requirement — "once the Briefing workspace ships an equivalent, permanent destination"): remove the `DailyBriefingCard`/`variant="transitional"` call site from `app/portfolio/page.tsx` (§6, §16). Do not perform this step in the same change as step 1 — the obligation is specifically to verify the replacement first.
5. Reduce Mission Control's `SinceLastReviewSection` to its compact summary (§11), now that Briefing's full presentation (step 1) is the verified destination its deep link targets.
6. Resolve `derivePortfolioHealth()`, `computeWhatChanged()`, `derivePortfolioSummary()`, and `DailyBriefingCard.tsx`'s ultimate fate (retain vs. retire) per §17's four-criteria test, once steps 1-5 make their consumer status final and inspectable.
7. Full targeted test run (`features/portfolio/briefing/**`, `features/portfolio/dailyBriefing/**`, `components/mission-control/**`, `features/portfolio/positions/**`, `app/portfolio/**`) plus `tsc --noEmit` and `git diff --check` (implementation-time, not this CES).

Rationale: additive-and-verified first (steps 1-2), then removal only after the replacement is proven (steps 3-5), then cleanup of now-orphaned files last (step 6) — identical ordering discipline to WA-0003 §18.

## 21. Risks, Ambiguities, and Unresolved Decisions

**Requires explicit Product Owner sign-off before implementation:**

1. **Portfolio-health canonical source (§9).** *Alternatives:* (a) adopt `lib/portfolioHealth`'s real 0-100 score as Briefing's sole health presentation (this CES's recommendation — already Mission Control's source, already computed inside `buildDailyBriefing()`, avoids a fourth-in-the-app derivation surface), or (b) redesign a new unified health presentation that blends both signals. *Recommendation:* (a) — no new computation, immediate consistency with Mission Control, and the 3-bucket derivation's only stated purpose (a quick visual band) is already achievable by mapping the existing `PortfolioHealthStatus` to a color band, which `DailyBriefingCard.tsx`'s existing `HEALTH_STATUS_STYLE` already does. *Rationale for flagging rather than deciding unilaterally:* this changes what number/label the trader sees first when opening Briefing — a genuine information-hierarchy change WA-0001 §6 explicitly reserved for this CES's own product-level scoping, not an engineering-only call.
2. **"Since Your Last Review" ships now with its honest-empty state, or waits for Trader Commitment persistence (§10, §14).** *Alternatives:* (a) relocate the section as specified, accepting it will show "Nothing changed since your last review" for every trader until a future, unscoped sprint wires persistence (this CES's default assumption, since WA-0001 assigns the *relocation* to WA-0004 and does not scope persistence to any numbered sprint), or (b) defer this section's relocation until persistence exists, keeping it on Mission Control (its current, equally-empty location) until then. *Recommendation:* (a) — relocating an honestly-empty section is not misleading (the copy already says "nothing changed," not "no data available"), and Briefing is the correct permanent home regardless of when persistence ships; delaying the move only means redoing this work later. *Rationale for flagging:* shipping a section that always reads empty could reasonably be judged as adding no value this sprint, and the Product Owner may prefer to sequence persistence-wiring before this relocation, or to accept it as-is — a scope/priority call, not an engineering one, and this app's real-money-trading stakes mean any risk of a misleading "all clear" signal deserves explicit sign-off.
3. **Whether `DailyBriefingCard.tsx` and its `transitional`/`full` variant split are retired outright or repurposed as (part of) Briefing's renderer (§16, §20 step 6).** *Alternatives:* (a) retire the component entirely once Briefing's new composition (a fresh `DailyPortfolioBriefing.tsx`) fully supersedes it, or (b) repurpose it, removing the variant split, as Briefing's actual rendering component (avoiding rewriting layout/styling that already exists and is tested). *Recommendation:* (b), for the Portfolio Snapshot stat-grid layout specifically (§6, §15) — reuse its existing tested markup rather than rewrite it — but this is an implementation-detail choice with no user-facing difference, deferred to implementation time per §17's criteria rather than mandated here.

**Disclosed ambiguities, not requiring sign-off (implementation-time judgment calls):**

- Whether `derivePortfolioSummary()`'s bullet-list output has any field not already covered by `buildDailyBriefing().snapshot` (§6, §16) — requires a direct field-by-field diff at implementation time; if any field is unique, it is folded into Snapshot's presentation rather than dropped.
- Whether `whyNow` is added to Briefing's "Since Your Last Review" rendering (§12) — already computed, not currently rendered anywhere; a presentation-only addition, low risk, implementer's call.
- The exact final component/file names for the reduced Mission Control section and any renamed Briefing renderer — cosmetic, mirrors WA-0003's own explicit allowance for naming flexibility.

## 22. Confirmation: WA-0004 Does Not Begin WA-0005 or WA-0006

- **WA-0005 (Opportunities/Screener):** not touched. §6 explicitly excludes `DailyBriefingCard`'s "Current Opportunities" section from Briefing's scope, routing it to WA-0005 territory rather than including or redesigning it here. No file under `lib/opportunity-engine`, the `/screener` route, or Mission Control's `NewOpportunitiesSection.tsx` appears in §16's file plan. No `?screener`/discovery-related deep-link param is introduced.
- **WA-0006 (Priority List retirement):** not touched. §6, §16, and §19 explicitly retain `TodaysPriorities.tsx`, `TodaysPrioritiesWorkflow.tsx`, `priorityWorkflowState.ts`, and the `priorities` tab unmodified. This CES removes only the *embedded copy* of the Priority List inside Briefing — a duplication-removal, not a step toward retiring the Priority List itself, which continues to exist as its own tab exactly as before. §20's sequencing contains no step that touches the `priorities` tab or its underlying files.

Both confirmations are structural (traceable to specific, cited sections above), not merely asserted.

## 23. Stop/Go Recommendation

**GO**, contingent on Product Owner resolution of the two flagged decisions in §21 (items 1 and 2) before implementation begins. Every content movement in §6 traces to an existing typed field on an existing canonical producer; every source-of-truth decision in §7 selects between two already-existing computations rather than inventing a third. The one genuinely new mechanical requirement (§13's `tab` allow-list addition for `'briefing'`) is a one-line, low-risk change with a direct precedent (WA-0003's own `todays-priorities`/`positions`/`history` allow-list). The sequencing in §20 explicitly protects WA-0002's obligation from being closed prematurely (Positions' transitional content is removed only after Briefing's replacement is verified, per WA-0002's own binding wording) and protects WA-0003's frozen queue contract (zero files under `lib/todays-priorities-queue`, `features/portfolio/todaysPriorities`, or `priorityWorkflowState.ts` appear anywhere in this CES's file plan). The one substantive risk this CES does not resolve unilaterally — shipping a "Since Your Last Review" section that will read empty until a future, unscoped persistence sprint — is disclosed plainly in §21 rather than smoothed over, consistent with this app's real-money-trading stakes. Recommend proceeding to implementation once Dean confirms §21's two decisions.
