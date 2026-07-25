# WA-0002 — Positions & Legacy Mission Control Cleanup: Implementation Specification (CES)

**Status:** CES / design-only. No application code changed. Awaiting Dean/Paul/Quinn/Chuck review and approval before implementation is scoped as its own sprint.
**Repository:** `deannetharmon/trade-edge`, inspected against `main` @ `f93598c`.
**Author:** Dane (Lead Engineer)
**Authority:** `docs/design/WA-0001-Workspace-Content-Ownership-Audit.md` is authoritative. This CES cites its rulings; it does not reinterpret them.

## 1. Executive Conclusion

Every content item this CES touches is a presentation-layer placement problem, not a domain problem. The two duplicated cards on Positions (`DailyBriefingCard`, `PortfolioReviewCard`) and the legacy Mission Control tab all render already-canonical `PortfolioReviewSnapshot`/`TodaysPrioritiesDashboard`/`PortfolioObjective` data that `/dashboard`'s accepted MB-0002 Mission Control already renders in full. Retiring the duplicates requires deleting or trimming presentation components and one navigation entry — zero engine, scoring, or health changes.

The one piece of new-ish work is position-specific risk. Investigation found this is simpler than it looked: `RiskItem` (the flat type `DailyBriefingCard` currently renders) strips out the position identifier, but the identifier was never missing — it lives on the source `PortfolioObjective.subject.id`, and because `evaluatePositionObjective()` produces **exactly one objective per position** (§10), that same objective is already attached to every position today as `pos.portfolioObjective` (`app/portfolio/page.tsx`, confirmed at the `PositionCard`/`PositionIntelligencePanel` call site, line 8148). Position-specific risk association is therefore not a lookup or a join — it is a direct predicate on data each position already carries. No domain model change, no new identifier, and no cross-referencing is required.

Two content blocks are explicitly **not** deleted despite becoming unused on Positions: `DailyBriefingCard` and the health/top-risk/capital-income portion of `PortfolioReviewCard`'s underlying data are Briefing-owned (deferred to WA-0004) or Mission-Control-owned (already live). Their render call sites on Positions are removed; the components, their tests, and every domain function feeding them are preserved untouched, per WA-0001's explicit instruction not to discard Briefing-owned information before Briefing exists to render it.

**Recommendation: GO**, with the one open question in §17 resolved before implementation begins (it does not require Dean/Paul/Quinn/Chuck input — it is a naming/extraction detail for whoever implements this).

## 2. Current-State Evidence

Verified directly against `main` @ `f93598c`:

- `app/portfolio/page.tsx:8713` — `activeTab` is a plain `useState`, default `'mission-control'`, typed `'mission-control' | 'today' | 'briefing' | 'positions' | 'priorities' | 'history' | 'balances'`. No `localStorage`, no URL query/hash, no persistence of any kind (confirmed by inspection of the full component and a repository-wide search for `location.hash`/`useSearchParams` touching this page — the only hit outside this page is `app/login/page.tsx`, unrelated).
- `app/portfolio/page.tsx:9144` — the sub-tab bar array, defining all seven tabs and their labels/icons.
- `app/portfolio/page.tsx:9178-9187` — the `mission-control` render branch, mounting `features/portfolio/missionControl/MissionControl.tsx`.
- `app/portfolio/page.tsx:9258-9271` — the `positions` render branch's first two elements: `<DailyBriefingCard briefing={dailyBriefing} .../>` then `<PortfolioReviewCard review={portfolioReview} .../>`, both above the position list.
- `features/portfolio/missionControl/MissionControl.tsx` — single file, no test file, no sub-components, imported only at `app/portfolio/page.tsx:117`. Renders Portfolio Summary, Top Priority, full `TodaysPrioritiesDashboard` (all four buckets), Portfolio Health, Opportunity Summary (counts).
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` — sole consumer `app/portfolio/page.tsx`; has a test file (`__tests__/DailyBriefingCard.test.tsx`). Renders Executive Summary, Today's Priorities top risks, Portfolio Snapshot, Upcoming Events, Current Opportunities counts, Current Risks (flat, all five `RiskKind`s).
- `features/portfolio/review/PortfolioReviewCard.tsx` — sole consumer `app/portfolio/page.tsx`; has a test file. Renders Portfolio Health, Top Risks, Portfolio Composition (stats + `concentrationConcerns` list), Capital & Income.
- `lib/dailyBriefing/buildDailyBriefing.ts:110-138` (`buildRiskSummary`) — the exact source of every `RiskItem`: `concentration`/`capital` from `PortfolioReviewSnapshot.currentState` (both portfolio-level by construction — the source objectives are `REDUCE_CONCENTRATION`/`PRESERVE_BUYING_POWER` types, always `subject.type === 'portfolio'`); `assignment_exposure` from objectives with `ruleId === 'OBJ-ASSIGNMENT-RISK'`; `earnings_exposure` from `dashboard.reviewToday.earningsReviews` (objectives carrying an `'earnings'` `reviewTrigger`); `immediate_attention` from `dashboard.immediateAction` (mixed position- and portfolio-level objectives).
- `lib/dailyBriefing/types.ts:84-89` — `RiskItem` is `{id, kind, label, detail}` only; no position identifier field.
- `lib/portfolio-intelligence/objectives/positionObjective.ts:318-338` — `KIND_TO_RULE_ID` confirms one recommendation kind, hence one `ruleId`, hence one `PortfolioObjective`, per position.
- `app/portfolio/page.tsx:8148` — `PositionIntelligencePanel` already receives `objective={pos.portfolioObjective ?? null}` — the exact object `buildRiskSummary` would have matched by `ruleId`/trigger — but only renders inside a collapsed, opt-in "Position Intelligence" panel (`showIntelligence`, default `false`), not as an always-visible signal.
- No test file exists for `PositionCard` or `PositionIntelligencePanel`'s host (`app/portfolio/page.tsx` has no component-level tests at all — only `lib/`-level tests cover the data these components render).
- `features/portfolio/briefing/portfolioSummary.ts`'s `derivePortfolioSummary()` is imported by **both** the legacy `MissionControl.tsx` and `DailyPortfolioBriefing.tsx` — confirmed via repository-wide search. It is not deletable; Briefing keeps using it after Mission Control's copy is removed.

## 3. Exact In-Scope Behavior

- Remove the `mission-control` sub-tab, its nav entry, its render branch, and `features/portfolio/missionControl/MissionControl.tsx` entirely.
- Change `activeTab`'s default value and type union to no longer include `'mission-control'`.
- Remove `<DailyBriefingCard>` and the health/top-risks/capital-income portion of `<PortfolioReviewCard>` from the Positions tab's render output.
- Trim `PortfolioReviewCard` to render only its Portfolio Composition section (stats; excluding the `concentrationConcerns` list, which is portfolio-wide risk, not a composition fact) — Positions keeps this, per WA-0001's matrix.
- Add a small, always-visible-when-present position-specific risk indicator to each position's own card, driven by that position's existing `portfolioObjective`, for exactly two kinds: `assignment_exposure` (`ruleId === 'OBJ-ASSIGNMENT-RISK'`) and `earnings_exposure` (an `'earnings'` `reviewTrigger` present).
- Update or add tests for every changed/added behavior above.

## 4. Exact Out-of-Scope Behavior

Per the CES's explicit exclusions — none of the following are touched, implied, or partially started by this sprint: WA-0003 finite-queue work, Mark Complete/Reopen migration, moving healthy-position monitoring, WA-0004 Briefing implementation, health-model reconciliation, What Changed reconciliation, contextual-risk migration into Briefing, WA-0005 Screener/Opportunities work, WA-0006 Priority List retirement, `/dashboard` narrative changes, new engine intelligence, new scoring/ranking, health-calculation changes, recommendation changes, general position-card redesign, general UI cleanup, new routes. `concentration`/`capital`/`immediate_attention` risk kinds are explicitly **not** rendered anywhere by WA-0002 (see §8) — they remain exactly where they are today (inside `DailyBriefingCard`, whose Positions render call is being removed) until WA-0004 (contextual) picks up its slice; Mission Control already covers the portfolio-wide slice independently via its own `PortfolioStatusSection`, unmodified.

## 5. Content Disposition Matrix

| Current content/component | Current location | WA-0002 disposition | Final owner | Timing | Rationale |
|---|---|---|---|---|---|
| Legacy Mission Control tab (Portfolio Summary, Top Priority, Today's Work Queue, Portfolio Health, Opportunity Summary) | `/portfolio` → `mission-control` tab | REMOVE (entire tab, component, and nav entry) | Mission Control (`/dashboard`, already complete) | WA-0002 | WA-0001 ruling: two Mission Controls violates the frozen architecture; `/dashboard` is the accepted implementation |
| Executive Summary, Portfolio Snapshot, Upcoming Events (`DailyBriefingCard`) | Positions | REMOVE render call only; PRESERVE component, test, and `lib/dailyBriefing` logic | Briefing (WA-0004) | Deferred — component untouched, just unmounted from Positions | WA-0001: "WA-0002 must not silently discard Briefing-owned information before Briefing can render it" |
| Today's Priorities top risks (`DailyBriefingCard`'s `PriorityRankedList`) | Positions (`DailyBriefingCard`) | REMOVE (redundant — Mission Control's Lead Item and, later, Today's Priorities already cover this) | Mission Control / Today's Priorities (both already exist or are WA-0003) | WA-0002 | Not Briefing-owned; a duplicate of content already fully owned elsewhere |
| Current Opportunities counts (`DailyBriefingCard`) | Positions | REMOVE (redundant with Today's Priorities' own Opportunities section) | Today's Priorities (WA-0003) | WA-0002 removes the duplicate; WA-0003 owns the real thing | Portfolio-derived opportunities are Today's Priorities' job per WA-0001, not Positions' |
| Portfolio Health, Top Risks, Capital & Income (`PortfolioReviewCard`) | Positions | REMOVE (full experience already exists in Mission Control) | Mission Control (`/dashboard`, already complete) | WA-0002 | Same canonical `PortfolioReviewSnapshot`; Mission Control is the one full owner |
| Portfolio Composition stats (`PortfolioReviewCard`) | Positions | RETAIN, trimmed to stats only (drop `concentrationConcerns` list) | Positions | WA-0002 | WA-0001 matrix: composition is a fact about existing positions, Positions' job |
| Current Risks — `concentration`, `capital` (`DailyBriefingCard`) | Positions | REMOVE (already fully covered by Mission Control's existing Top Risks/concerns) | Mission Control (already live, unmodified) | WA-0002 removes the duplicate; no new Mission Control work needed | Portfolio-wide risk per ruling 4; source objectives are always `subject.type === 'portfolio'` |
| Current Risks — `immediate_attention` (`DailyBriefingCard`) | Positions | REMOVE, not re-rendered anywhere by WA-0002 | Split between Mission Control (already covers portfolio-level via Lead Item/counts) and Today's Priorities (WA-0003, position-level) | Deferred | This kind mixes position- and portfolio-level objectives; WA-0002 deliberately does not resolve the split (§8) rather than guess |
| Current Risks — `assignment_exposure`, `earnings_exposure` (`DailyBriefingCard`) | Positions | MOVE — new position-card risk indicator, driven by `pos.portfolioObjective` directly | Positions | WA-0002 | Position-specific per ruling 4; deterministic 1:1 association already exists (§8) |
| Position inventory, structure, lifecycle, valuation/P&L, objectives, Greeks, pending orders, bulk actions, controls, decision review, `PositionIntelligencePanel` | Positions | RETAIN, unchanged | Positions | Unaffected | Positions' undisputed core job |
| Healthy-position monitoring (Monitor bucket) | Today's Priorities tab (not Positions) | RETAIN as-is, not touched | Positions (WA-0003) | Deferred to WA-0003 | Explicitly excluded from WA-0002 by this CES's assignment |
| `derivePortfolioSummary()` / `portfolioSummary.ts` | Shared: legacy MC + Briefing | RETAIN, unmodified | Briefing | N/A | Still consumed by `DailyPortfolioBriefing.tsx`; deleting it would break Briefing |

## 6. Legacy Mission Control Retirement Plan

1. Remove the `{ key: 'mission-control', ... }` entry from the tab array (`app/portfolio/page.tsx:9144`).
2. Remove the `activeTab === 'mission-control'` render branch (`app/portfolio/page.tsx:9178-9187`).
3. Remove `'mission-control'` from `activeTab`'s type union and change the `useState` default to `'positions'` (see §9 for why `'positions'`, not `'briefing'` or `'today'`).
4. Remove the now-unused `import { MissionControl } from '@/features/portfolio/missionControl/MissionControl';` (`app/portfolio/page.tsx:117`).
5. Delete `features/portfolio/missionControl/MissionControl.tsx` (the entire directory; it is the only file in it, has no test file, and its sole consumer is the import being removed).
6. Do not touch `derivePortfolioSummary()`/`portfolioSummary.ts`, `TodaysPrioritiesDashboard`/`PriorityRankedList`, or any `PortfolioHealthResult`/`PortfolioHealthStatus` type — all remain consumed elsewhere (Briefing, the `today` tab, `DailyBriefingCard`/`PortfolioReviewCard`, `/dashboard`).
7. No unique capability was found inside legacy Mission Control. Its five sections (§2) are each either already fully duplicated at `/dashboard` (Portfolio Summary/Health, Top Priority, Opportunity Summary counts) or a wholesale reuse of a component still alive elsewhere (`TodaysPrioritiesDashboard`, still mounted on the `today` tab). Nothing requires relocation before deletion.
8. Do not modify `/dashboard`. No navigation or regression adjustment there is required by this retirement — `/dashboard` never linked to or depended on the legacy tab.

## 7. Positions Cleanup Plan

1. Remove the `<DailyBriefingCard briefing={dailyBriefing} loading={loading} th={th} />` render call (`app/portfolio/page.tsx:9262-9264`). Do not delete `DailyBriefingCard.tsx`, its test, or any `lib/dailyBriefing` function — WA-0004 needs all three.
2. Replace the `<PortfolioReviewCard review={portfolioReview} loading={loading} th={th} />` render call (`app/portfolio/page.tsx:9269-9271`) with a trimmed version that renders only the Portfolio Composition section (position count, largest-symbol %, wheel-managed %, by-strategy breakdown) and drops the Portfolio Health, Top Risks, Capital & Income sections and the `concentrationConcerns` list nested inside Composition today.
3. Implementation choice (flagged, not decided — §17): trim `PortfolioReviewCard.tsx` itself down to a composition-only component (simplest, but changes a component name to no longer match its remaining content), or extract a new `PositionCompositionCard` from the existing composition-rendering code and stop calling `PortfolioReviewCard` on Positions entirely (cleaner naming, slightly more surface area). Either way, `PortfolioReviewCard.test.tsx` must be updated to match whichever shape is kept — remove assertions for the deleted sections, keep/add assertions for composition.
4. Add the position-specific risk indicator to `PositionCard` (§8) — the only addition to Positions in this sprint.
5. No other change to the Positions tab. Position list, Greeks, pending orders, bulk actions, per-position controls, and `PositionIntelligencePanel` are unmodified.

## 8. Position-Specific Risk Design

**Association mechanism:** no lookup, join, or new identifier is needed. Each position already carries exactly one `PortfolioObjective` at `pos.portfolioObjective` (confirmed one-objective-per-position by `KIND_TO_RULE_ID`, §2). A position has a risk if and only if that same, already-attached objective satisfies one of two predicates:

- **Assignment exposure:** `pos.portfolioObjective?.ruleId === 'OBJ-ASSIGNMENT-RISK'`
- **Earnings exposure:** `pos.portfolioObjective?.reviewTriggers.some(t => t.triggerType === 'earnings')`

Both predicates read a field already present on data the position already holds today (visible, just not surfaced, inside the collapsed `PositionIntelligencePanel`). This satisfies "do not infer from display text or fragile string matching" by construction — there is no matching step at all, only a direct field read on the position's own objective.

**What happens when a risk cannot be safely associated with exactly one position:** `concentration` and `capital` risk kinds never can be — their source objectives are always portfolio-level (`subject.type === 'portfolio'`) — so WA-0002 does not attempt to associate them; they stay fully out of Positions (§5). `immediate_attention` mixes position- and portfolio-level objectives with no single reliable predicate; rather than guess at a split, **WA-0002 does not render `immediate_attention` on any position card**, deferring its position-level slice to whichever future sprint reconciles it (flagged in §16, not silently dropped — the underlying data is untouched and still flows through `lib/dailyBriefing` for whoever picks it up next).

**Where it appears:** a small, inline badge/line on `PositionCard`'s existing header row (near the current recommendation/intent controls, not inside the collapsed Intelligence panel), reusing the position's own `objective.title` as the label and `objective.summary` as the detail — no new copy, no new severity model. Recommended concrete placement: a compact chip (e.g., "Assignment Risk" / "Earnings Risk") the trader sees without expanding anything, consistent with `RiskKind`'s existing label vocabulary (`RISK_KIND_LABEL` in `DailyBriefingCard.tsx`, reusable as-is).

**Always visible or only when present:** only when present. A position without a matching objective (including every "healthy hold" position, which has `portfolioObjective: null`) shows nothing extra — consistent with this codebase's existing "silence is a feature" convention.

**Severity/text representation:** no new severity field. `RiskKind` (already defined, `lib/dailyBriefing/types.ts`) supplies the two labels needed; `objective.title`/`.summary` supply the text, exactly as `DailyBriefingCard` already displays them today, just relocated.

**Duplicate prevention:** structurally impossible to duplicate. Since a position has exactly one objective and that objective has exactly one `ruleId`, a position can match at most one of the two predicates' *kind* label at a time — though in principle `ruleId === 'OBJ-ASSIGNMENT-RISK'` and an earnings `reviewTrigger` could both be true of the same single objective simultaneously (a position can be both assignment-at-risk and earnings-flagged). This CES specifies: render both badges if both predicates are true — this is not a duplicate, it is two real, distinct facts about the same position, both already true today and both currently visible (only inside the collapsed panel).

**New component recommended:** extract a small, pure `PositionRiskBadges({ objective }: { objective: PortfolioObjective | null })` component (return `null` when neither predicate matches) rather than inlining this logic into the already-enormous `PositionCard` function. This is the one new, independently unit-testable unit this CES introduces, and it is the only way to satisfy the test-plan requirement below given `PositionCard` itself has no test harness today.

**Tests required:** new file `features/portfolio/positions/__tests__/PositionRiskBadges.test.tsx` (or co-located with wherever the component lives) covering: no badge when `objective` is `null`; no badge when `objective.ruleId` is anything else and no earnings trigger; assignment badge when `ruleId === 'OBJ-ASSIGNMENT-RISK'`; earnings badge when an earnings trigger is present; both badges when both are true; portfolio-level objectives (`subject.type === 'portfolio'`) never reach this component in the first place because `pos.portfolioObjective` is only ever position-scoped by construction (documented, not re-tested here — that invariant belongs to `evaluatePositionObjective()`'s own existing test suite, unchanged).

## 9. Navigation and Persisted-State Handling

- **Persisted state:** none exists. `activeTab` is in-memory `useState` only (§2) — there is no `localStorage` key, no URL query parameter, no hash fragment anywhere in the codebase that can request the `mission-control` tab. A repository-wide search for hash/query-param-driven tab selection confirmed zero hits outside this page's own component state.
- **What happens to an old bookmark/link:** none can exist that targets a specific tab, since no page ever generated one — every internal link to `/portfolio` (checked: `app/dashboard/page.tsx`'s `CommandCenterNav`/`MissionControl` nav, and every other page's top nav) links to the bare route with no tab-selecting parameter. The retired tab cannot be reached by any existing link once its entry is removed from the tab array.
- **Safe fallback:** the `useState` default changes from `'mission-control'` to `'positions'`. Rationale: `'positions'` is the frozen architecture's own answer to "what does a trader open Portfolio to do" absent Mission Control (which now lives at `/dashboard`), and it is the tab this entire CES is about making self-sufficient.
- **Mobile/desktop:** the tab bar (`app/portfolio/page.tsx:9141-9166`) is one shared component/state for both; there is no separate mobile tab definition to keep in sync.
- **Test coverage for the fallback:** none exists today (no component test file covers `app/portfolio/page.tsx`'s tab switching at all). This CES recommends adding one focused test asserting the default `activeTab` renders the Positions experience, not a blank state — see §14.
- **Conclusion:** there is no "old URL/query/hash requests the retired tab" scenario to design a redirect for, because no mechanism to request a specific tab externally exists in this codebase today. The only safety net needed is the default-value change in point 3.

## 10. Canonical Logic and Data-Flow Preservation

No function under `lib/` is added, removed, or changed by this CES. Every disposition above is a change to what a component renders or which component is mounted, never to what `buildDashboardComposition`, `buildPortfolioReview`, `buildTodaysPrioritiesDashboard`, `buildDailyBriefing`, `calculatePortfolioHealthScore`, `evaluatePortfolioObjectives`/`evaluatePositionObjective`, or any Decision/Opportunity Engine function computes. `PortfolioReviewSnapshot`, `TodaysPrioritiesDashboard`, `DailyBriefing`, and `PortfolioObjective` remain the same canonical objects, unchanged in shape or derivation, consumed by fewer presentation components after this sprint, not different ones.

## 11. Exact File-Impact Analysis

| File | Expected change | Reason | Risk | Validation |
|---|---|---|---|---|
| `app/portfolio/page.tsx` | Remove `mission-control` tab entry, render branch, import; change `activeTab` type/default; remove `DailyBriefingCard`/`PortfolioReviewCard` render calls (replace the latter with trimmed composition-only render or a new component call) | Core retirement + cleanup surface | Medium (large file; changes are localized but must not disturb adjacent Positions rendering, dry-run banner, error banner, or the position list immediately below) | Manual review of the full `positions` render branch after edit; confirm no other `activeTab` reference remains stale |
| `features/portfolio/missionControl/MissionControl.tsx` | Delete file (and directory) | Sole consumer removed, no unique capability, no test file | Low | Confirm zero remaining references via repository-wide search before deletion |
| `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` | No change | Preserved for WA-0004 | None | N/A — verify it still compiles with no callers is not required since import is simply not present; no orphan-import risk since the file itself does not import anything Positions-specific |
| `features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx` | No change | Tests the component in isolation, unaffected by its Positions call site being removed | None | N/A |
| `features/portfolio/review/PortfolioReviewCard.tsx` | Trim to composition-only (or superseded by a new extracted component, §7 point 3) | Positions keeps composition, drops health/top-risks/capital-income (owned by Mission Control) | Medium (component is being reduced, not deleted — must not silently lose the composition rendering itself) | Updated test file must assert composition still renders correctly with the same field mappings as today |
| `features/portfolio/review/__tests__/PortfolioReviewCard.test.tsx` | Update: remove assertions for health/top-risks/capital-income sections, retain/adjust composition assertions | Matches the trimmed component | Medium (must not leave stale assertions that silently stop testing anything) | Re-run this file's suite after edit (implementation-time, not this CES) |
| New: `features/portfolio/positions/PositionRiskBadges.tsx` (path illustrative — see §17) | New file | Houses the two-predicate risk-badge logic extracted for testability | Low (new, additive, no existing consumer to break) | New unit tests (§8) |
| New: `features/portfolio/positions/__tests__/PositionRiskBadges.test.tsx` | New file | Test coverage for the new component | Low | Runs as part of the standard suite |
| `app/portfolio/page.tsx` (`PositionCard`, ~line 7240–8156) | Add one new render call: `<PositionRiskBadges objective={pos.portfolioObjective ?? null} />` near the existing header controls | Surfaces position-specific risk without redesigning the card | Medium (touches a large, sensitive, already-dense component region) | Visual/manual check that placement does not crowd or break the existing intent/recommendation controls |
| `features/portfolio/briefing/portfolioSummary.ts` and its test | No change | Still consumed by `DailyPortfolioBriefing.tsx` | None | N/A |
| `lib/dailyBriefing/*`, `lib/portfolioReview/*`, `lib/portfolioHealth/*`, `lib/portfolio-intelligence/*` | No change | Domain logic untouched by this CES | None | N/A |

## 12. Component and Dependency Deletion Criteria

A file is deleted only if all of the following hold, verified by direct repository search (not assumption):

1. Zero remaining import sites after the render-branch/tab-entry removal.
2. No test file exists that would be left asserting behavior of a deleted file (if one exists, it is deleted in the same change).
3. No underlying domain computation is deleted alongside it — only presentation.
4. The capability it provides either has no unique value (fully duplicated elsewhere, verified against the WA-0001 matrix) or has an explicit, named future owner (Briefing/WA-0004, Today's Priorities/WA-0003) and is therefore preserved rather than deleted.

Applying this: only `features/portfolio/missionControl/MissionControl.tsx` meets all four criteria for outright deletion in this sprint. `DailyBriefingCard.tsx` fails criterion 4's "no unique value" branch (it has real future value to WA-0004) and is therefore explicitly preserved, unmounted only. `PortfolioReviewCard.tsx` is partially retained (composition) and partially redundant (health/top-risks/capital-income, criterion 4's "fully duplicated" branch) — trimmed, not deleted.

## 13. Implementation Sequence

1. Add `PositionRiskBadges` (new, additive, zero regression risk) and its tests first — independently verifiable before anything else changes.
2. Wire `PositionRiskBadges` into `PositionCard`.
3. Trim `PortfolioReviewCard` to composition-only; update its test.
4. Remove the `DailyBriefingCard`/`PortfolioReviewCard`(old)/composition-only-`PortfolioReviewCard` render calls' surrounding JSX on the Positions tab to their final form.
5. Remove the legacy Mission Control tab entry, render branch, and import; change the `activeTab` default and type.
6. Delete `features/portfolio/missionControl/MissionControl.tsx`.
7. Full targeted test run (`lib/dailyBriefing`, `lib/portfolioReview`, `features/portfolio/**`) plus `tsc --noEmit` and `git diff --check` (implementation-time, not this CES).

Ordering rationale: additive change first (lowest risk, independently testable), then trims, then deletions last (irreversible steps go last, after everything depending on their removal has already been proven not to break).

## 14. Acceptance Criteria

- `/dashboard` remains the only Mission Control; nothing under `/portfolio` presents itself as Mission Control.
- The `mission-control` Portfolio tab entry, its render branch, and `features/portfolio/missionControl/MissionControl.tsx` no longer exist.
- `activeTab`'s type union no longer includes `'mission-control'`; the default value renders the Positions experience directly, not a blank or invalid state (verified by a new test — see §15).
- No mechanism in the codebase can request the retired tab (verified by the search in §9 remaining valid at implementation time).
- Positions opens directly into position inventory, without `DailyBriefingCard`'s or `PortfolioReviewCard`'s health/top-risks/capital-income/executive-summary/snapshot/events/opportunity-counts content preceding it.
- No Mission-Control-owned full experience (Portfolio Health, Top Risks, Capital & Income) remains duplicated on Positions.
- `DailyBriefingCard.tsx`, its test, and every `lib/dailyBriefing` function still exist, compile, and pass their existing tests unchanged — nothing Briefing will need in WA-0004 was deleted.
- Every position whose `portfolioObjective.ruleId === 'OBJ-ASSIGNMENT-RISK'` or whose objective carries an earnings `reviewTrigger` shows the corresponding risk badge; every other position (including `objective: null`) shows none.
- No `concentration`, `capital`, or `immediate_attention` risk content appears on any position card.
- Position inventory, structure/lifecycle state, valuation/P&L, objectives, Greeks, pending orders, bulk actions, controls, and decision review are all pixel-for-pixel unchanged except for the new risk badge's presence.
- No file under `lib/` changed; no scoring, ranking, health, or recommendation output differs from before this sprint.
- Background Task visibility (`/dashboard`, unrelated to `/portfolio`) is unaffected — this CES touches nothing it depends on.
- PortfolioMode gating (wraps both `/dashboard` and `/portfolio` as whole pages) is unaffected — this CES does not touch mode-resolution logic or either page's top-level gate.
- `today`, `briefing`, `history`, `balances` tabs remain fully functional and unchanged.

## 15. Test Plan

- **New:** `PositionRiskBadges` unit tests (§8) — five cases (null objective, neither predicate, assignment only, earnings only, both).
- **Updated:** `PortfolioReviewCard.test.tsx` — remove health/top-risks/capital-income assertions, retain/adjust composition assertions to match the trimmed component.
- **New (recommended, not currently present anywhere):** one focused test asserting `app/portfolio/page.tsx`'s default `activeTab` renders the Positions experience (satisfies §9's fallback-safety requirement, since no existing test covers tab-switching at all).
- **Unchanged, must still pass:** `DailyBriefingCard.test.tsx` (component untouched), `portfolioSummary.test.tsx`, `DailyPortfolioBriefing.test.tsx`, `TodaysPrioritiesWorkflow.test.tsx`, `TodaysPriorities.test.tsx`, `PositionIntelligencePanel.test.tsx`, `priorityWorkflowState.test.tsx`, and every `lib/portfolioReview`/`lib/dailyBriefing`/`lib/portfolioHealth`/`lib/portfolio-intelligence`/`lib/todaysPriorities` suite — none of their inputs or the functions they test change.
- **Regression check (implementation-time):** a full targeted run across `features/portfolio/**`, `lib/dailyBriefing`, `lib/portfolioReview`, `lib/portfolioHealth`, `lib/portfolio-intelligence`, `lib/todaysPriorities` to confirm zero unintended breakage, plus `tsc --noEmit` and `git diff --check`. Not performed in this CES per its documentation-only validation instructions.

## 16. Regression Risks and Mitigations

- **Risk: losing Briefing's future content by deleting too aggressively.** Mitigated by §12's deletion criteria and by explicitly listing `DailyBriefingCard`/`lib/dailyBriefing` as preserve-not-delete in the disposition matrix and file-impact analysis.
- **Risk: `immediate_attention` risk silently vanishing with no future owner recorded.** Mitigated by explicitly flagging it in §5/§8 as deferred (not resolved, not deleted from the domain layer — only unmounted from Positions along with the rest of `DailyBriefingCard`).
- **Risk: editing a ~9,000-line file (`app/portfolio/page.tsx`) introduces an unrelated regression.** Mitigated by the sequencing in §13 (additive change first, deletions last) and by scoping every edit to named, line-cited regions rather than broad rewrites.
- **Risk: `PortfolioReviewCard` trimming accidentally drops the composition section instead of the sections meant for removal.** Mitigated by the explicit field-level breakdown in §7/§8 and by requiring the updated test file to assert composition output matches today's values exactly.
- **Risk: a future sprint assumes Positions' risk badge covers all `RiskKind`s.** Mitigated by this CES stating explicitly, twice (§5, §8), that only two of five kinds are covered and why.

## 17. Deferred Work and Downstream Dependencies

- `immediate_attention` risk's position-level slice: unresolved split, deferred to whichever sprint next touches Today's Priorities (WA-0003) or Mission Control's redundancy with it.
- Executive Summary, Portfolio Snapshot, Upcoming Events, Current Opportunities counts, and `concentration`/`capital`/contextual risk: all explicitly WA-0004's (Briefing) responsibility, per WA-0001.
- Healthy-position monitoring migration: WA-0003, untouched here.
- Health/What-Changed reconciliation: WA-0004 CES scoping, per WA-0001 ruling 3.

## 18. Open Decisions

One implementation-detail decision, not a product decision — does not require Dean/Paul/Quinn/Chuck:

- Whether to trim `PortfolioReviewCard.tsx` in place (component keeps its name, loses most of its content) or extract a new `PositionCompositionCard` and stop calling `PortfolioReviewCard` from Positions entirely (§7 point 3). Recommendation: extract new — a component named "Portfolio Review" that only shows composition stats is a confusing name for what remains; a future implementer should make the final call once actually touching the code, guided by whether `PortfolioReviewCard`'s health/top-risks/capital-income code is worth keeping around as reference material for anything, or is simply dead weight to delete outright (recommended: delete outright, since `/dashboard`'s `PortfolioStatusSection` is a complete, independent, already-shipped reimplementation with no dependency on `PortfolioReviewCard`'s code).

No other open decisions. All four WA-0001 product rulings apply cleanly to this sprint's scope with no ambiguity requiring further product input.

## 19. Stop/Go Recommendation

**GO.** Every deletion in this CES is evidence-backed (verified consumers, verified test coverage, verified absence of unique capability) rather than assumed. The one genuinely new piece of work (position-specific risk) turned out to require no domain-model change, no new identifier, and no cross-referencing — the lowest-risk kind of "new" work available. The single open item (§18) is a naming/extraction choice with a stated recommendation, not a blocker. Recommend proceeding to implementation once Dean/Paul/Quinn/Chuck confirm no objection to this specification.
