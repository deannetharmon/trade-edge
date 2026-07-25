# WA-0001 — Workspace Content Ownership Audit

**Status:** Documentation only. No implementation. Awaiting Dean/Paul/Quinn/Chuck approval of rulings and sprint boundaries.
**Repository:** `deannetharmon/trade-edge`, audited against `main` @ `34f6d4d`.
**Author:** Dane (Lead Engineer)

## 1. Executive Conclusion

The domain layer is already sound: one canonical `PortfolioObjective`/`TodaysPrioritiesDashboard`/`PortfolioReviewSnapshot`/`AttentionFeed`/`ReviewNarrative`/`OpportunityRecommendation` set feeds every surface in the app. The problem WA-0001 exists to fix is entirely at the **presentation layer**: the same canonical objects are rendered as *full, complete experiences* in three or four places at once, so no workspace has an exclusive job today.

The clearest organizing fact this audit found: **`ReviewNarrative` (MB-0001B) already decomposes almost exactly onto the frozen five-workspace architecture.** Its five sections map one-to-one onto four of the five workspaces (`portfolioStatus` → Mission Control, `sinceLastReview` → Briefing, `attention` → Today's Priorities, `newOpportunities` → Opportunities), with Positions standing outside `ReviewNarrative` entirely as the one workspace that inspects raw position state rather than narrated conclusions about it. Achieving the frozen architecture does not require new domain logic — it requires each workspace to render its own section of the *existing* narrative in full, while every other workspace renders, at most, a compact summary of that same section plus a link. Mission Control's own `/dashboard` implementation (MB-0002) already does this correctly for one section (its `SummaryStrip`); it currently violates the same principle for three others (see §3, rows 5–7).

A second, non-obvious finding: **two unrelated concepts currently share the word "opportunity."** Portfolio-derived roll/covered-call/CSP actions (`TodaysPrioritiesOpportunities`, `lib/todaysPriorities`) are actions available on the trader's *existing* book. Screener-discovered candidates (`OpportunityRecommendation`, `lib/opportunity-engine`) are *new* trades found by scanning the market. Paul's "new-trade discovery belongs in Opportunities" applies only to the second. Conflating them when building the Opportunities workspace would misassign portfolio-management actions to a discovery workspace.

Third: Priority List's Mark Complete / Reopen workflow (`features/portfolio/priorities/priorityWorkflowState.ts`) is genuinely unique — no other surface tracks a trader's local decision that an objective is "done." Retiring Priority List without relocating this capability would be a real regression, not a simplification.

Fourth, flagged for resolution rather than decided here: splitting the MB-0001B/MB-0002 Review across three independent, separately-entered workspaces raises a real question about what "Review Complete" — a first-class closure feature Chuck specifically asked for — means once there is no single linear Review to finish. See §7.

## 2. Current Workspace Inventory

| Surface | Route / location | Current content |
|---|---|---|
| Mission Control (new) | `/dashboard` → `components/mission-control/MissionControl.tsx` | Summary Strip (health, lead item, since-last-review count, attention count); full Portfolio Status; full Since Your Last Review; full Attention Required (+ Recommended Actions + Supporting Evidence folded in); full New Opportunities (`BestOpportunitiesPanel`); Review Complete band; Background Tasks (relocated below the narrative, MB-0002) |
| Mission Control (legacy) | `/portfolio` → `activeTab === 'mission-control'` → `features/portfolio/missionControl/MissionControl.tsx` | Portfolio Summary (text lines); Top Priority (single card); full Today's Work Queue (`TodaysPrioritiesDashboard`, all four buckets); Portfolio Health; Opportunity Summary (counts only) |
| Today's Priorities (drill-down tab) | `/portfolio` → `activeTab === 'today'` → `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx` | Immediate Action, Review Today (earnings/expiring/medium/follow-up), **Monitor (all healthy positions)**, Opportunities (roll/CC/CSP + screener flag) |
| Briefing | `/portfolio` → `activeTab === 'briefing'` → `features/portfolio/briefing/DailyPortfolioBriefing.tsx` | 3-level Portfolio Health banner (a second, simpler health derivation — see §6); **full embedded `TodaysPrioritiesWorkflow`**; Portfolio Summary; What Changed (a second, independent "what changed" mechanism — see §6); Suggested Focus |
| Positions | `/portfolio` → `activeTab === 'positions'` | `DailyBriefingCard` (Executive Summary, Today's Priorities top risks, Portfolio Snapshot, Upcoming Events, Current Opportunities counts, Current Risks) **then** `PortfolioReviewCard` (Portfolio Health, Top Risks, Portfolio Composition, Capital & Income) **then** the actual position/pending-order list, Greeks, bulk actions |
| Priority List | `/portfolio` → `activeTab === 'priorities'` → `features/portfolio/components/TodaysPrioritiesWorkflow.tsx` | Full, unbucketed canonical objective list (every objective, not just actionable ones), expandable detail, **Mark Complete / Reopen** (unique — see §4) |
| Opportunities | none | No dedicated route. Closest existing surface is `/screener` (`app/screener/page.tsx`), which scans the market, publishes to `lib/recommendations`, and already renders the full `BestOpportunitiesPanel` |
| Background Tasks | `/dashboard`, below Mission Control's narrative | Global Task Manager state (`useTaskManager`), via `BackgroundTaskCard` |
| Decision History, Balances | `/portfolio` → `activeTab === 'history' / 'balances'` | Unaffected by this audit — no overlap with the frozen five workspaces |

## 3. Ownership Matrix

| Content item | Current location(s) | Primary owner | Other appearances | Ruling | Rationale |
|---|---|---|---|---|---|
| Portfolio Health score/status (`lib/portfolioHealth`, PI-0011B) | Legacy Mission Control; Positions (`DailyBriefingCard`, `PortfolioReviewCard`); `/dashboard` Summary Strip + Portfolio Status | **Mission Control** | Positions, legacy Mission Control | OWN (Mission Control, full); REMOVE (legacy MC, whole tab retired); MOVE→REFERENCE (Positions keeps at most a one-line status badge, drops the full score/contributor breakdown) | "Assess overall portfolio condition" is Mission Control's literal job |
| Top Risks / concentration / capital / income concerns (`PortfolioReviewSnapshot`) | Legacy MC (via Portfolio Summary text); Positions (`PortfolioReviewCard`); `/dashboard` Portfolio Status | **Mission Control** | Positions | REMOVE (legacy MC); MOVE (Positions' full `PortfolioReviewCard` detail moves to Mission Control, which already renders it) | Same canonical `PortfolioReviewSnapshot`; one full owner |
| Portfolio Composition (position count, by-strategy, concentration %, wheel-managed %) | Positions (`PortfolioReviewCard`) | **Positions** | Mission Control (compact) | OWN (Positions, full); Mission Control may keep a compact composition line if useful, not required | Composition is a fact about existing positions, which is Positions' job |
| Lead Item / "the one thing" (`ReviewNarrative.leadItem`) | `/dashboard` Summary Strip | **Mission Control** | none today | OWN | Exactly Mission Control's "what deserves attention right now" summary role |
| Since Your Last Review / commitment changes (`RevalidationResult[]`) | `/dashboard` (full section, MB-0002) | **Briefing** | Mission Control (compact count only) | MOVE (full experience: `/dashboard`→Briefing); Mission Control keeps only the existing Summary Strip count line | "Understand what changed and why it matters" is Briefing's literal job; Mission Control "must not reproduce full working experiences" |
| "What Changed" (legacy diff mechanism, `features/portfolio/briefing/whatChanged.ts`) | Briefing tab | **Briefing** | none | OWN, but flagged — a second, independent "what changed" mechanism from the Revalidation Engine (see §6) | Same job as the row above, different implementation; needs reconciliation before/at the Briefing sprint, not two competing "what changed" systems long-term |
| Immediate Action / Review Today items (`PrioritizedObjective[]`, actionable buckets) | Legacy MC (Today's Work Queue); Today's Priorities tab; `/dashboard` Attention Required (full) | **Today's Priorities** | Mission Control (compact count + lead item only) | MOVE (full experience: `/dashboard`→Today's Priorities, legacy MC's embedded copy REMOVE); Mission Control keeps only its existing compact summary | "Process today's finite action queue" is Today's Priorities' literal job |
| Recommended Action / Supporting Evidence per item (`AttentionItem.recommendedAction`/`.explanation`) | `/dashboard` Attention Required cards | **Today's Priorities** | none after migration | MOVE with the item above (moves as one unit — these are beats of the same item, not separate content, per MB-0001B's own design note) | "Recommendation rationale stays with the recommendation" |
| Monitor / healthy-position inventory (`TodaysPrioritiesMonitorEntry[]`) | Today's Priorities tab; embedded copy inside legacy MC | **Positions** | none should remain in Today's Priorities | MOVE (Today's Priorities → Positions); REMOVE (legacy MC's embedded copy) | Explicit Paul constraint: "Healthy-position inventory belongs in Positions, not the daily queue" |
| Portfolio-derived opportunities: roll / covered call / CSP (`TodaysPrioritiesOpportunities`) | Today's Priorities tab; legacy MC (Today's Work Queue); Positions (`DailyBriefingCard` counts) | **Today's Priorities** | Positions (compact count only, optional) | OWN (Today's Priorities, full); REMOVE (legacy MC copy); Positions keeps counts only if useful | These are actions on the *existing* book, not new-trade discovery — do not send to Opportunities (see §1) |
| Screener-discovered new-trade candidates (`OpportunityRecommendation[]`, `lib/opportunity-engine`) | `/screener` (full); `/dashboard` New Opportunities (full, MB-0002) | **Opportunities** (workspace does not exist yet — see §5) | Mission Control (compact count only) | MOVE (full experience: `/dashboard`→Opportunities); Mission Control keeps a compact count, not the panel | Explicit Paul constraint: "New-trade discovery belongs in Opportunities" |
| Opportunity Review nav anchor (`#best-opportunity`, `CommandCenterNav`) | `/dashboard` nav | **Opportunities** | none | MOVE (repoint to the real Opportunities workspace once it exists) | Preserve the existing contextual deep link; only its target changes |
| Full canonical objective list + Mark Complete/Reopen (Priority List) | `/portfolio` → `priorities` tab | **Today's Priorities** (workflow-state capability); no single workspace owns the *unbucketed full list* view | Briefing (embeds the same component today) | MOVE (capability) / REMOVE (surface) — see §4 in full | Today's Priorities is the natural home for "mark this handled"; the flat, unbucketed list view itself has no place in the frozen architecture (see §4) |
| Executive Summary / Portfolio Snapshot stats / Upcoming Events (`DailyBriefing`, PI-0013) | Positions (`DailyBriefingCard`, first card) | **Briefing** | none after migration | MOVE (Positions → Briefing) | This is exactly "what do I need to know before I act," Briefing's job, not Positions' |
| Current Risks (`DailyBriefing.risks`) | Positions (`DailyBriefingCard`) | **Briefing** | Mission Control (already covered via Top Risks) | MOVE (Positions → Briefing, or REMOVE if judged fully redundant with Mission Control's Top Risks at implementation time) | Overlaps Mission Control's Top Risks; exact boundary is an implementation-time call, not a content-ownership dispute |
| Position list, Greeks, pending orders, bulk actions, decision-review-per-position | Positions | **Positions** | none | OWN, unchanged | Positions' undisputed core job |
| Background Task status | `/dashboard`, below Mission Control | **None of the five workspaces** — recommend app-shell-level chrome | none | REFERENCE/LINK at most from any workspace; do not assign primary ownership to Mission Control by default | Answers "is a scan running," not a portfolio-condition question; `TaskStatusBar`/`TaskDrawer` already exist, built, unmounted, for exactly this |
| Review Complete / closure signal | `/dashboard` (single band, MB-0002) | **Unresolved** | — | Flagged, not ruled — see §7 | Splitting Review across three workspaces removes the one linear "end" this feature assumed |
| Legacy Mission Control sub-tab as a whole | `/portfolio` → `mission-control` tab | — | — | REMOVE (entire tab) | Two Mission Controls violates the frozen architecture directly; `/dashboard` is the accepted MB-0002 implementation per Quinn's preservation directive |

## 4. Priority List Migration and Retirement Plan

Priority List (`features/portfolio/components/TodaysPrioritiesWorkflow.tsx`, the `priorities` tab) has two genuinely separable parts:

1. **The flat, unbucketed, "every objective" list view.** This has no place in the frozen architecture: Today's Priorities is explicitly finite/actionable-only, Briefing is context not a list, Mission Control must not reproduce full working experiences, and Positions is about positions, not objectives generally. **Ruling: retire this view outright.** Nothing needs to replace it — Today's Priorities (actionable) and Positions (per-position) already cover every objective that matters to a specific decision.
2. **Mark Complete / Reopen workflow state** (`features/portfolio/priorities/priorityWorkflowState.ts`, localStorage-backed, keyed by objective id/fingerprint). This is real, unique capability with no equivalent anywhere else in the app today. **Ruling: this must migrate into Today's Priorities before Priority List is retired** — Today's Priorities' finite queue is the natural place a trader marks an item handled. This is the one required migration blocking retirement; everything else in Priority List is either already duplicated elsewhere or being removed outright.

Briefing's embedded copy of `TodaysPrioritiesWorkflow` (§2, §3) must be replaced by Briefing's own change-context content (Executive Summary, What Changed, Suggested Focus) independent of this migration — Briefing should stop rendering the full Priority List experience regardless of where Mark Complete ends up.

**Order dependency:** Mark Complete/Reopen must land in Today's Priorities *before* the Priority List tab is removed, or the capability is lost with no replacement — this is the one hard sequencing constraint in this entire audit.

## 5. Navigation Changes Required

- `/portfolio` sub-tab bar: remove `mission-control` (retired) and `priorities` (retired) tabs; `today`, `briefing`, `positions`, `history`, `balances` remain, with `today` and `briefing` content redistributed per §3.
- `/dashboard` remains the sole Mission Control entry point and, per Quinn's directive, the accepted MB-0002 implementation to build on rather than replace.
- `CommandCenterNav`'s `#best-opportunity` anchor must repoint once an Opportunities workspace exists (§3).
- **An Opportunities workspace route does not exist and must be decided, not assumed.** Two candidates: (a) a new top-level route (e.g. `/opportunities`) that surfaces the same `lib/recommendations` feed `/screener` already publishes to, or (b) repositioning `/screener` itself as the Opportunities workspace, since it already scans, ranks, and renders the full panel. This is a product decision for Paul, not one this audit resolves (see §7).
- No other page's navigation is implicated by this audit's findings.

## 6. Architecture Dependencies and Regression Risks

- **One canonical source is already true for every item in §3** except two disclosed pre-existing exceptions, both predating WA-0001 and neither introduced by this audit:
  - Two independent "portfolio health" derivations: `lib/portfolioHealth`'s real 0–100 score (used by Mission Control, Positions' cards) and `features/portfolio/briefing/portfolioHealth.ts`'s simpler 3-level banner (used only by the Briefing tab). The legacy Mission Control component's own code comments already acknowledge the newer one supersedes the older. Reconciling this is in scope for the Briefing sprint's implementation, not this audit.
  - Two independent "what changed" mechanisms: the Briefing tab's localStorage-based objective diffing (`whatChanged.ts`) and MB-0001B's Revalidation Engine (`lib/revalidation`, commitment-based, not yet backed by any persistence). They do not conflict today only because neither is complete — Revalidation has no store, and `whatChanged.ts` is not commitment-aware. Whichever becomes Briefing's canonical "what changed" needs to be decided before both are built out further in parallel.
- **No engine, scoring, ranking, or health logic changes** are required by any ruling above — every migration in §3 is a presentation-layer move of an already-computed value to a different component tree.
- **Regression risk — Mark Complete/Reopen:** the only capability genuinely lost if sequencing in §4 is not followed.
- **Regression risk — Background Tasks:** already flagged in the MB-0002 implementation report as having no other visible surface in the app. Do not remove without confirming a replacement (app-shell chrome, per §3) is in place first.
- **Regression risk — PortfolioMode gating:** `/dashboard` and `/portfolio` are the only two PortfolioMode-gated surfaces today (PT-0002B). A new Opportunities route would need an explicit PortfolioMode decision (gated LIVE-only like Mission Control, or mode-independent like `/screener` today) — this audit does not resolve that, it flags it as a dependency for whoever scopes the Opportunities sprint.
- **Dependency order:** Positions/legacy-Mission-Control cleanup has no dependency on anything else and can go first. Today's Priorities' finite-queue work depends on nothing but benefits from Mark Complete/Reopen migrating in the same sprint. Briefing's separation depends on deciding the health/what-changed reconciliation (or explicitly deferring it). Opportunities depends on the route/ownership decision in §5. Priority List retirement depends on Today's Priorities' migration landing first (§4).

## 7. Unresolved Product Decisions

1. **What does "Review Complete" mean once Review is split across three workspaces?** MB-0001B/MB-0002 built one linear narrative with a single, first-class closure moment. The frozen architecture makes Mission Control, Today's Priorities, and Briefing three independently-entered workspaces. Candidates: (a) Mission Control keeps the only "you're done" signal, as the landing/summary workspace; (b) each workspace gets its own local completion signal (queue empty, nothing changed, healthy status); (c) some other synthesis. This materially affects Chuck's core ask and should not be decided by implementation default.
2. **Where does the Opportunities workspace live** — a new route, or `/screener` repositioned? Affects PortfolioMode gating, navigation, and whether "discover new trades" and "scan the market" are treated as the same job or two adjacent ones.
3. **Health/what-changed reconciliation timing** (§6) — fix before, during, or after the Briefing sprint. Not blocking, but should be an explicit choice rather than an accident of sequencing.
4. **Positions' Current Risks content** — fully move to Briefing, or judge it redundant with Mission Control's Top Risks and remove outright. Left as an implementation-time call above; flagging in case Paul wants to decide it now instead.

## 8. Recommended Implementation Sequence

The CES's suggested boundaries are sound; this audit found no reason to reorder them, only to make the Priority List dependency explicit:

1. Remove duplication from Positions (drop `DailyBriefingCard`'s and `PortfolioReviewCard`'s content per §3) and retire the legacy Portfolio Mission Control tab. No dependencies; lowest risk.
2. Establish Today's Priorities as the finite action workspace: absorb the full Attention Required experience from `/dashboard`, move Monitor/healthy-position inventory to Positions, **migrate Mark Complete/Reopen in this same sprint** (required before step 5).
3. Separate Briefing from action processing: remove the embedded Priority List workflow, absorb Executive Summary/Snapshot/Upcoming Events from Positions and Since-Your-Last-Review from `/dashboard`, resolve or explicitly defer the health/what-changed reconciliation (§6, §7).
4. Establish Opportunities once §7's routing decision is made; migrate the full New Opportunities experience out of `/dashboard`; repoint the `#best-opportunity` nav anchor.
5. Retire Priority List (dependent on step 2's migration having landed); complete remaining navigation/deep-link changes.

## 9. Proposed Sprint Boundaries

- **WA-0002 — Positions & Legacy Mission Control Cleanup:** implementation sequence step 1.
- **WA-0003 — Today's Priorities Finite Queue (incl. Mark Complete/Reopen migration):** sequence step 2.
- **WA-0004 — Briefing Separation:** sequence step 3, contingent on Decision 3 in §7 (or an explicit decision to defer it).
- **WA-0005 — Opportunities Workspace:** sequence step 4, contingent on Decision 2 in §7.
- **WA-0006 — Priority List Retirement & Navigation Cleanup:** sequence step 5, hard-blocked on WA-0003.

Each boundary above should get its own CES before implementation begins, per standard project governance — this audit authorizes none of them.
