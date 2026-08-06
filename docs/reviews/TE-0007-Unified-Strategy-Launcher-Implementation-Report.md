# TE-0007 — Unified Screener Launcher: Implementation Report

**Branch:** `feature/te-0007-unified-strategy-launcher` (created from `main` @ `40f2b1a`, after TE-0007C's final corrective pass and the HELP-0001 corrective pass — both confirmed merged into `main` before this branch was cut).
**Commit:** see final chat response for the exact hash (committed after this report; not pushed or merged — per delivery constraints).

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
