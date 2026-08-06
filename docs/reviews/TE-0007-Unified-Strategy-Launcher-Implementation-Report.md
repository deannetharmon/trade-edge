# TE-0007 — Unified Screener Launcher: Implementation Report

**Branch:** `feature/te-0007-unified-strategy-launcher` (created from `main` @ `40f2b1a`, after TE-0007C's final corrective pass and the HELP-0001 corrective pass — both confirmed merged into `main` before this branch was cut).
**Initial-delivery commit:** `55d6d9c`.
**First corrective-pass commit:** `c664a8f` (migration reactivation defect + persistence-authority documentation).
**Second corrective-pass commit:** see final chat response for the exact hash (committed after this report; not pushed or merged — per delivery constraints).

> Sections 1–9 below describe the initial delivery (`55d6d9c`) as originally written. Section 12 documents the first required corrective pass (`c664a8f`). Section 13 documents the second required corrective pass, on top of `c664a8f`. Earlier sections are left as originally written (not rewritten or hidden) — where a later section changed something an earlier one described, the later section is authoritative. In particular, §9's "manual acceptance" walkthrough and any earlier references to "SCAN ELIGIBLE HOLDINGS FOR CC" as a normal scan action are superseded by §13.

## 1. State ownership — before and after

**Before:** three independent ticker states — the general/primary Screener list (`tickers: WatchlistTicker[]`, persisted server-side via `/api/watchlist` and mirrored to `localStorage['hunter-watchlist']`), a free-form CSP ticker string (`cspTickers`, persisted to `localStorage['hunter-tickers-csp']`), and a free-form PMCC ticker string (`pmccTickers`, persisted to `localStorage['hunter-tickers-pmcc']`). Each strategy button read its own state.

**After:** one canonical state, `tickers: WatchlistTicker[]`, unchanged in shape and unchanged in how it's loaded/persisted (`loadWatchlist()`/`persistWatchlist()` — untouched). A derived value, `opportunityUniverse = normalizeUniverse(tickers.filter(t => t.active).map(t => t.symbol))`, is the canonical `string[]` universe every strategy button reads. `cspTickers` and `pmccTickers` state, and their change handlers, were deleted entirely.

**Why `tickers` (not a new parallel state) is the backing store:** the ticket asks to "use the existing ticker-entry component and loading tools where practical." `WatchlistBox` (OCR import, named save/load sessions, per-ticker classification display) is that existing component, and its `active` checkbox already meant exactly "include this ticker in the next scan" for spread scanning — i.e., "willing to evaluate." Reusing it means every strategy button gets OCR/sessions/classification for free, and there is no shape mismatch to reconcile between two independent ticker stores.

## 2. localStorage migration

**New canonical key:** `hunter-opportunity-universe` (`LS_OPPORTUNITY_UNIVERSE` in `lib/screener/opportunityUniverse.ts`).

**Legacy keys read during migration (never written to again afterward):**
- `hunter-watchlist` — existing primary Screener tickers (`WatchlistTicker[]`; only the `symbol` is used for the union — active/inactive state is not part of the migration union, since the union's job is "which tickers existed," not "which were toggled on").
- `hunter-tickers-csp` — existing CSP tickers (legacy comma/whitespace-separated string).
- `hunter-tickers-pmcc` — existing PMCC tickers (legacy comma/whitespace-separated string).

**Migration order:** ordered unique union of primary, then CSP, then PMCC (`migrateOpportunityUniverse()` in `lib/screener/opportunityUniverse.ts` — pure, deterministic, unit tested). Runs exactly once, gated by a `useRef` flag in `app/screener/page.tsx`, only after the primary ticker list has finished its initial async load, and only if `LS_OPPORTUNITY_UNIVERSE` does not already exist. Any CSP/PMCC-only symbols (not already in the primary list) are folded into the visible `tickers` list via the existing `mergeTickerLists()` helper (classified and added as active) so they don't silently disappear from the UI; the canonical key is then written. Repeated app loads after that first migration are no-ops (idempotent — verified by test).

**`cspCashOverride`** was left untouched by the migration (it isn't a ticker list); it now lives in a collapsible "CSP Settings" row instead of its own card.

## 3. Per-button universe behavior

| Button | Universe source | Empty-universe behavior | Notes |
|---|---|---|---|
| Find Spreads | `opportunityUniverse` (opens the existing `RunModeModal`, unchanged) | Disabled | No changes to spread scan formulas, qualification, scoring, or the config-modal workflow. |
| Find CSPs | `opportunityUniverse` | Disabled, with a tooltip | Cash-availability check and no-margin-by-default preserved unchanged. |
| Find Covered Calls | `verified CC-eligible holdings`, intersected with `opportunityUniverse` when non-empty | Not disabled — an empty universe scans **all** eligible holdings (see §4) | Never disabled by an empty universe, since CC's real gating condition is verified share ownership, not the universe. |
| Find PMCCs | `opportunityUniverse` | Disabled, with a tooltip | No changes to PMCC DTE/delta/chain/candidate logic. Not added to Autopilot. |
| Find LEAPS | — | Always disabled | Calls no scanner. See §5. |

## 4. Covered Call intersection safety rule

Implemented exactly as specified in `runCcScan()`:

```
scan universe = universe non-empty ? (verified CC-eligible holdings ∩ universe) : all verified CC-eligible holdings
```

The intersection is a **filter over** the account's verified eligible holdings (`capacityReport.bySymbol`, fetched fresh every scan via the unmodified TE-0007C `getCoveredCallCapacityReport()` path) — a ticker typed into the shared Opportunity Universe box is never added to that set; if it isn't already a verified, capacity-available holding, it simply isn't in the set to intersect against. This makes "never create eligibility" a structural property (there's no code path that adds a symbol to the scan list from the universe), not just a runtime check.

- If the universe narrows the eligible set to zero (universe non-empty, some eligible holdings exist, but none overlap), the exact required message is shown: *"No covered-call-eligible holdings match the current Opportunity Universe."* — distinct from the pre-existing "no eligible holdings at all" empty state.
- An explicit **"Scan all eligible holdings"** control (shown whenever the universe is actually narrowing the eligible set) calls `runCcScan(true)`, which bypasses only the universe intersection — the underlying `availableCoveredContracts > 0` capacity check and the manual hide-only `ccHiddenSymbols` filter still apply unconditionally.
- All TE-0007C fail-closed behavior (`ccUnavailableReason` for unattributable exposure, per-symbol conservative-reservation disclosure) is untouched — the universe filter is applied strictly after that gate, and a data-integrity failure blocks scanning regardless of the universe.

## 5. LEAPS deferral

"Find LEAPS — Coming Soon" renders as a disabled button with the exact required tooltip: *"Standalone LEAPS scanning requires its own conviction, duration, delta, valuation, and exit rules. PMCC scanning remains available separately."* It has no `onClick` scan handler, calls no scanner, and there is no PMCC-repurposed or placeholder result added to `results`.

## 6. UI changes

- The three sidebar cards (general watchlist + PMCC + CSP) collapsed into one **"OPPORTUNITY UNIVERSE"** card: `WatchlistBox` (unchanged), a ticker-count line, the explanatory copy from the ticket, a 2-column grid of the five launcher buttons, and a collapsible `<details>` "CSP Settings" row holding the cash-override input (kept out of the button row per the ticket's "smallest change" guidance, still reachable without recreating a separate ticker list).
- The Covered Call "eligible holdings" display (verified-holdings chips, blocked/unclassified-exposure disclosures — all pre-existing TE-0007C UI) remains as its own compact card below, since it's status/output, not a ticker-list input. It gained the no-overlap empty state and the "Scan all eligible holdings" override control.
- `StrategyBox` (the component that powered the old PMCC/CSP cards) is no longer used but was left defined, unexported, in `app/screener/page.tsx` rather than deleted — a working, self-contained OCR+save/load component that's cheap to keep in case a future strategy-settings panel wants the same pattern. Deleting it is a trivial follow-up.

## 7. Behavior change beyond the ticket's literal text (documented, not hidden)

`mergeTickerLists()` previously added newly-typed tickers as **inactive** (`active: false`), requiring a second click to opt them into a scan. Now that the same list is the canonical Opportunity Universe every strategy button reads, requiring a second click for something the trader just explicitly typed in would contradict the ticket's own framing ("enter the companies you are willing to evaluate, then choose a strategy"). New tickers are now added **active** by default; the `active` checkbox remains available to opt a ticker back out without removing it. This does not touch any financial calculation, qualification threshold, or scoring — it only changes which newly-added tickers are included in the very next scan by default.

## 8. Deferred / not done in this ticket

- Standalone LEAPS financial logic and strategy specification — out of scope, as required.
- PMCC redesign (TE-0007D) — untouched.
- Live order execution for CSP/CC/PMCC — untouched.
- Full Screener page / shared result-card redesign — untouched.
- Deleting the now-dead `StrategyBox` component — left in place (see §6); safe, trivial follow-up.

## 9. Manual acceptance (performed via automated wiring tests in lieu of a live browser session — see §10)

The 10-step manual acceptance checklist from the ticket was exercised through `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx`, which renders the real `app/screener/page.tsx` (only the network boundary is mocked) and drives it through actual user interactions (typing tickers, clicking buttons) rather than reimplementing the logic under test:

1. Entering NKE, MU, NVDA and running each strategy button confirms canonical-universe usage (routing tests 2–3; CC intersection tests 1–8).
2. Covered Call intersection/uncovered-ticker-ignored/capacity-visible behavior — CC intersection tests 1, 3, 5, 8.
3. Clearing the universe and confirming Covered Calls scans all eligible holdings — CC intersection test 2.
4. Find LEAPS disabled / Coming Soon, with the exact tooltip and no scanner call — routing test 6.
5. No separate CSP/PMCC ticker inputs remain — routing test 4.
6. Migration/persistence — covered by `lib/screener/__tests__/opportunityUniverse.test.ts` (deterministic, since real browser refresh/persistence isn't observable in a unit-test render).

## 10. Validation

- **`tsc --noEmit`:** clean, no errors.
- **Targeted tests:** `lib/screener/__tests__/opportunityUniverse.test.ts` — 12/12 passing (uppercase, trim, dedupe, order-stable, invalid/empty rejection, empty input, legacy union migration, no-overwrite, idempotent, plus 2 save-path tests). `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx` — 16/16 passing (8 launcher-routing + 8 CC-intersection tests, exactly as enumerated in the ticket).
- **Full suite:** 107 test files / 1613 tests passing (up from 106 files / 1597 tests before this ticket — net +1 file, +16 tests from `UnifiedStrategyLauncher.test.tsx`, and the pre-existing `opportunityUniverse.test.ts` file is new too, contributing the other +12... see exact per-directory breakdown below since the full run was executed in three batches due to sandbox time limits, not because of any test failure):
  - `lib/**`: 75 files / 1298 tests passing.
  - `components/**` + `features/**`: 27 files / 251 tests passing.
  - `app/**`: 5 files / 64 tests passing.
  - Total: 107 files / 1613 tests, all passing.
- **Production build (`next build`):** succeeds — compiles, type-checks, generates all 54 static pages, finalizes optimization. (Console `ioredis`/`ECONNREFUSED` and `indexedDB is not defined` messages during build/tests are pre-existing sandbox artifacts — no Redis/IndexedDB available in this environment — not related to this change.)
- **`git status --porcelain`:** clean except this branch's own new/modified files and the pre-existing, unrelated untracked `docs/reviews/portfolio-position-metrics-audit.md`, which was not touched.

## 11. Changed files

- `lib/screener/opportunityUniverse.ts` — new. Pure normalization/migration module.
- `lib/screener/__tests__/opportunityUniverse.test.ts` — new. 12 tests.
- `app/screener/page.tsx` — modified. Unified Opportunity Universe card; canonical-universe wiring for Find Spreads/CSPs/PMCCs; CC intersection logic; LEAPS deferral button; removed `cspTickers`/`pmccTickers` state and handlers; `mergeTickerLists()` default-active change.
- `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx` — new. 16 tests (8 routing + 8 CC intersection).
- `docs/tickets/TE-0007-unified-strategy-launcher.md` — new.
- `docs/reviews/TE-0007-Unified-Strategy-Launcher-Implementation-Report.md` — this file.

## 12. Corrective pass (post-review, on top of `55d6d9c`)

Two defects were found in review and required a corrective pass before push/merge. No financial calculations, qualification rules, Covered Call capacity protections, or strategy scan behavior were touched.

### 12.1 Migration reactivation defect (required correction 1)

**Defect.** `55d6d9c`'s production migration effect computed `legacyOnly` by filtering legacy CSP/PMCC symbols against `existingSymbols = new Set(tickers.map(t => t.symbol))` — i.e. "is this symbol present at all," regardless of its `active` flag. A symbol already present but inactive (e.g. `MU`) was therefore treated as "nothing to do," even when its presence in a legacy CSP/PMCC list proved it had previously been selected for scanning. The tested pure helper (`loadOrMigrateOpportunityUniverse`, operating on flat string arrays with no concept of `active`) computed the mathematically correct union and would have included `MU` — but production never called it; production had its own, separately-written, behaviorally different merge logic. The pure helper's passing tests gave false confidence about what the app actually did.

**Exact failing scenario (from the ticket, now a passing regression test):** primary watchlist has `NKE` active and `MU` inactive; legacy CSP list has `MU`; no canonical key exists yet. Before the fix: migrated universe = `['NKE']` only, `MU` silently dropped. After the fix: migrated universe = `['NKE', 'MU']`, both active.

**Fix.** `lib/screener/opportunityUniverse.ts` now exports exactly one migration algorithm, `migratePrimaryTickers<T extends MigratableTicker>(existing, legacy, makeNew)`, generic over any `{symbol, active}`-shaped ticker (so it operates directly on the real `WatchlistTicker[]` production uses — no separate flat-array variant exists anymore). For each legacy CSP/PMCC symbol: if absent, append it (active); if present but inactive, **reactivate** it in place; if present and already active, leave it untouched (same object reference — verified by test, so no needless downstream re-render/re-persist). No ticker is ever removed. `app/screener/page.tsx`'s migration effect now calls this function directly and only handles orchestration around it (resolving async classification for newly-added symbols, deciding whether anything actually changed before calling `handleTickersChange`). The previous flat-array `migrateOpportunityUniverse()` and its localStorage-coupled wrapper `loadOrMigrateOpportunityUniverse()` were deleted — there is no longer a second, differently-behaved migration path anywhere in the codebase.

**Tests.**
- `lib/screener/__tests__/opportunityUniverse.test.ts` — `migratePrimaryTickers` describe block, 9 tests, including the exact reactivation scenario, a PMCC-equivalent reactivation, no-op-on-already-active (reference equality), no duplication across overlapping CSP+PMCC symbols, three-way overlap (primary ∩ CSP ∩ PMCC), never-removes, order preservation, and idempotency (re-running against its own output is a no-op).
- `app/screener/__tests__/OpportunityUniverseMigration.test.tsx` — new page-level regression file, 4 tests, rendering the real `ScreenerPage`:
  1. The exact required scenario — verifies both `NKE` and `MU` appear in the canonical persisted universe, and that clicking Find CSPs sends both to the scan (proving both are active, not merely present).
  2. Remount idempotency — unmounts and re-renders; the canonical universe and the scan input are unchanged, not doubled.
  3. A legacy-PMCC-only ticker (no primary entry at all) is added and active.
  4. Overlapping symbols across all three legacy sources (primary + CSP + PMCC) collapse to one active entry each, with nothing lost.

### 12.2 Persistence authority (required correction 2)

**Defect.** The original report (§1 above) described `hunter-opportunity-universe` as "the canonical persisted ticker universe" in a way that read as an independent source of truth, while the actually-rendered universe was always derived fresh from `tickers`/`hunter-watchlist`. Two things describable as "the authority" is itself a defect, independent of §12.1's bug.

**Chosen model (smallest change — matches what the code already does functionally; this pass makes it explicit and consistent):** `tickers` (`WatchlistTicker[]`, persisted via `/api/watchlist` and mirrored to `localStorage['hunter-watchlist']`) is the **sole authority**. `hunter-opportunity-universe` is a **derived, write-only mirror** — written every time `tickers` changes (via `saveOpportunityUniverse()` inside `handleTickersChange`) and during migration, but **never read back by production UI code** to reconstruct the rendered universe or drive any strategy button. Its only two reads in the entire codebase are: (a) the migration gate (`hasCanonicalUniverse()` — "has migration already run"), and (b) tests, which read it as an observable proxy for "what did the app just persist" rather than as something the app depends on at runtime. This is now stated explicitly at the top of `lib/screener/opportunityUniverse.ts` and in this report, so there is one documented ownership model, not an implicit one that the code and the report described inconsistently.

### 12.3 Validation (corrective pass)

- **`tsc --noEmit`:** clean.
- **Targeted:** `lib/screener/__tests__/opportunityUniverse.test.ts` — 20/20 passing (7 `normalizeUniverse` + 9 `migratePrimaryTickers` + 2 `hasCanonicalUniverse` + 1 `saveOpportunityUniverse`, all rewritten against the single canonical function — no divergent pure helper remains). `app/screener/__tests__/OpportunityUniverseMigration.test.tsx` — 4/4 passing (new). `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx` — 16/16 still passing unchanged (confirms the migration fix didn't disturb routing/CC-intersection behavior).
- **Full suite:** re-run in the same three batches as the initial delivery (sandbox time limits, not failures): `lib/**` 75 files / 1306 tests (up from 1298 — net +8 from the rewritten `opportunityUniverse.test.ts`, 12 → 20 tests), `components/**` + `features/**` 27 files / 251 tests (unchanged), `app/**` 6 files / 68 tests (up from 5 files / 64 tests — the new `OpportunityUniverseMigration.test.tsx`, +4). **Total: 108 files / 1625 tests, all passing** (up from 107 files / 1613 tests before this corrective pass).
- **Production build:** succeeds (re-verified after the corrective pass).
- **`git status --porcelain`:** clean except this branch's own files and the untouched, pre-existing, unrelated `docs/reviews/portfolio-position-metrics-audit.md`.

### 12.4 Changed files (corrective pass, on top of §11)

- `lib/screener/opportunityUniverse.ts` — rewritten: single `migratePrimaryTickers()` algorithm replaces the old flat `migrateOpportunityUniverse()`/`loadOrMigrateOpportunityUniverse()`; adds `hasCanonicalUniverse()`; documents the persistence-authority model.
- `lib/screener/__tests__/opportunityUniverse.test.ts` — rewritten against the new function, 20 tests.
- `app/screener/page.tsx` — migration effect rewritten to call `migratePrimaryTickers()` instead of its own ad hoc filter.
- `app/screener/__tests__/OpportunityUniverseMigration.test.tsx` — new, 4 tests.
- `docs/reviews/TE-0007-Unified-Strategy-Launcher-Implementation-Report.md` — this section.

## 13. Second corrective pass — remove the duplicate ordinary Covered Call launch action

`c664a8f` was approved, but review found that the page still rendered **two** ordinary entry points for the exact same Covered Call scan: `FIND COVERED CALLS` in the unified Opportunity Universe launcher (added in `55d6d9c`), and `SCAN ELIGIBLE HOLDINGS FOR CC`, a leftover button at the bottom of the eligible-holdings status card that had never been removed when the launcher consolidation happened. Both called `runCcScan()` — a second, redundant entry point for the same action, contradicting the unified-launcher design this whole ticket exists to deliver.

### 13.1 Fix

`app/screener/page.tsx`: deleted the `SCAN ELIGIBLE HOLDINGS FOR CC` button from the eligible-holdings status card. `FIND COVERED CALLS` (in the Opportunity Universe card) is now the sole ordinary Covered Call scan action. The status card keeps everything else it had: the verified-capacity summary line, the per-symbol holding chips with hide controls (`toggleCcSymbol`), the "Fully covered / blocked" disclosure, the conservative-exposure (`hasUnclassifiedExposure`) warning, the account-level fail-closed (`ccUnavailableReason`) blocking message, and the "Scan all eligible holdings" universe-bypass override — none of that status/output UI was touched.

No change was needed to `runCcScan()`'s override logic (`bypassUniverse` parameter) — it already only affected the `universeNarrows`/`scannable` computation (§4 of this report); capacity verification (`availableCoveredContracts > 0`), the hide-only `ccHiddenSymbols` filter, and the account-level `ccUnavailableReason` fail-closed gate were already structurally independent of it and remain so. This pass added regression coverage proving that explicitly, rather than needing to change the logic itself.

Also corrected a stale comment at the `LS_PMCC`/`LS_CSP` constant declarations that still referenced the deleted `loadOrMigrateOpportunityUniverse()` helper (removed in `c664a8f`'s corrective pass) — it now points to the `migratePrimaryTickers()`-based migration effect that actually replaced it.

### 13.2 Tests

- `app/screener/__tests__/CcCapacityGate.test.tsx` — updated `clickCcScan()` to drive the real `FIND COVERED CALLS` button instead of the now-removed `SCAN ELIGIBLE HOLDINGS FOR CC` button. Both of its pre-existing tests (unattributable-exposure blocking, conservative-exposure disclosure) pass unchanged otherwise — proving the fail-closed/disclosure behavior itself didn't move.
- `app/screener/__tests__/SingleCoveredCallLaunchAction.test.tsx` — new, 11 tests, rendering the real page:
  1. Exactly one button whose text matches "covered call" is rendered, and it reads `FIND COVERED CALLS`.
  2. `SCAN ELIGIBLE HOLDINGS FOR CC` is absent.
  3. The normal action still performs universe-intersection correctly (universe `[NKE, MU]`, eligible `[NKE, AAPL]` → scans only `NKE`).
  4. The override does not render when the universe is empty.
  5. The override does not render when the universe already covers every eligible holding (nothing to narrow).
  6. The override renders when the universe is actually narrowing eligible holdings.
  7. The override, once clicked, still excludes a zero-capacity holding.
  8. The override, once clicked, still excludes a holding whose capacity is fully reserved by existing + working short calls.
  9. The override, once clicked, still excludes a holding the trader hid via its chip.
  10. Unattributable-exposure blocking still prevents any scan, and the override is not offered at all while blocked (the status card's blocking-message branch never reaches the override's render branch).
  11. All pre-existing capacity-disclosure UI (conservative-exposure warning, blocked/fully-covered list, reduced-not-restored chip count) remains present and correct.

### 13.3 Validation

- **`tsc --noEmit`:** clean.
- **Opportunity Universe tests** (`lib/screener/__tests__/opportunityUniverse.test.ts`): 20/20 passing, unchanged by this pass.
- **Unified Strategy Launcher tests** (`app/screener/__tests__/UnifiedStrategyLauncher.test.tsx`): 16/16 passing, unchanged by this pass.
- **Covered Call capacity and UI-gating tests**: `CcCapacityGate.test.tsx` 2/2 passing (updated to click the real button); `SingleCoveredCallLaunchAction.test.tsx` 11/11 passing (new); `OpportunityUniverseMigration.test.tsx` 4/4 passing (unaffected).
- Combined targeted run across all five of the above files: **53/53 passing**.
- **Full suite:** `lib/**` 75 files / 1306 tests (unchanged), `components/**` + `features/**` 27 files / 251 tests (unchanged), `app/**` 7 files / 79 tests (up from 6/68 — the new `SingleCoveredCallLaunchAction.test.tsx`, +11). **Total: 109 files / 1636 tests, all passing** (up from 108/1625 after the first corrective pass).
- **Production build:** succeeds.
- **`git diff --check`:** clean (exit 0), no whitespace errors.
- **`git status --porcelain`:** clean except this branch's own files and the untouched, pre-existing, unrelated `docs/reviews/portfolio-position-metrics-audit.md`.

### 13.4 Changed files (second corrective pass)

- `app/screener/page.tsx` — removed the duplicate `SCAN ELIGIBLE HOLDINGS FOR CC` button; corrected the stale `loadOrMigrateOpportunityUniverse()` comment.
- `app/screener/__tests__/CcCapacityGate.test.tsx` — updated to drive `FIND COVERED CALLS`.
- `app/screener/__tests__/SingleCoveredCallLaunchAction.test.tsx` — new, 11 tests.
- `docs/reviews/TE-0007-Unified-Strategy-Launcher-Implementation-Report.md` — this section.

### 13.5 Confirmation

Exactly one ordinary Covered Call launch action remains on the page: **`FIND COVERED CALLS`**, in the unified Opportunity Universe launcher. It is verified by an automated regression test (`SingleCoveredCallLaunchAction.test.tsx`, test 1) that queries all rendered buttons and asserts only one matches "covered call" in its accessible text.
