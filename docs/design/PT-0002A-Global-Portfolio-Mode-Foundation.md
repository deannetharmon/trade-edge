# PT-0002A — Global Portfolio Mode Foundation

**Status:** Corrective round complete, pending Product Owner review. Complete on `feature/global-portfolio-mode-foundation` (branched from `feature/trade-command-center` @ `2827ad9`, which contains the accepted, pushed TC-0001 corrective round). Not committed, not pushed, not merged. The original round (§1–§8 below) was rejected — see §9, Corrective Round Addendum.
**Project:** TradeEdge
**Owner:** Dean Harmon

## 1. Objective

Introduce a single, application-wide `PortfolioMode` (`LIVE | PAPER`) abstraction, preserving current LIVE behavior exactly and preventing any paper/live data crossover — infrastructure only, no screen/action integration, no Autopilot activation.

## 2. Scope, as implemented

### 2.1 In scope (delivered)

- Canonical `PortfolioMode` type + strict runtime validator (`lib/portfolio-mode/types.ts`).
- Global `PortfolioModeProvider`, mounted once in `app/providers.tsx`.
- Versioned, hydration-safe persistence (`lib/portfolio-mode/persistence.ts`, key `hunter-portfolio-mode-v1`).
- `usePortfolioMode()` hook with strict provider enforcement.
- Global, unmistakable `PortfolioModeIndicator` (mode badge + switch control + forced-choice prompt for invalid state), mounted once, visible on every route.
- Canonical mode-aware portfolio-context envelope (`lib/portfolio-mode/contract.ts`).
- LIVE adapter (`lib/portfolio-mode/liveAdapter.ts`) — thin wrapper around the existing `usePortfolioData()`.
- PAPER adapter (`lib/portfolio-mode/paperAdapter.ts`) — thin wrapper around the existing PT-0001 `GET /api/paper-trading/account` route.
- Guardrail utilities (`lib/portfolio-mode/guardrails.ts`) — `assertLiveContext` / `assertPaperContext`, tested, not yet wired to any call site (see §7).
- Isolation tests (source-scan + behavioral) proving PAPER cannot reach LIVE acquisition/broker paths and LIVE cannot reach the PAPER ledger.
- Architecture investigation (§4) and this documentation.

### 2.2 Out of scope (deferred to PT-0002B or later, unchanged from the design brief)

- Wiring any existing screen (Dashboard, Portfolio, Daily Briefing, Portfolio Review, Screener/Hunter, Performance, Trade Log) to actually consume `usePortfolioMode()` or either adapter.
- Wiring `assertLiveContext`/`assertPaperContext` into any real broker-submission or paper-mutation call site.
- Autopilot activation, new Decision/Opportunity Engine rules, new paper-trade strategy logic, Capital Allocation Engine, Income Engine, multi-portfolio support, copying live positions into paper, automatic live/paper synchronization, screen redesigns, or broker submission semantic changes.

## 3. Product principle

One application, two isolated portfolio contexts. Selecting PAPER in the new global indicator does not yet change what any existing screen renders — every screen today continues to render exactly what it rendered before this ticket, because no screen has been wired to read the new mode (see §7, Known Limitations). This is intentional, disclosed scope discipline, not an oversight.

## 4. Architecture investigation

Required by the Implementation Directive before any code was written.

### 4.1 Root provider hierarchy (before)

```text
app/layout.tsx
└── Providers (app/providers.tsx)
    └── SessionProvider
        └── TaskProvider
            └── CommandProvider
                └── PortfolioDataProvider   (TC-0001 corrective round)
                    └── {children}
                    └── RankedScanTaskMirror
                    └── ScreenerCardPolish
                    └── ScreenerJobStatus
```

### 4.2 TC-0001 `PortfolioDataProvider` and dashboard composition

`components/portfolio-data/PortfolioDataProvider.tsx` (TC-0001 corrective round) is the one runtime call site for `loadPositions()`/`loadAccountBalances()` (`lib/portfolio-data/acquisition.ts`), shared by `app/portfolio/page.tsx` and `app/dashboard/page.tsx` via `usePortfolioData()`. It also computes `composition` (`buildDashboardComposition()`, `lib/portfolio-intelligence/dashboardComposition.ts`) once, from live positions/pending orders/balances/decision reviews. This is the canonical LIVE pipeline PT-0002A's LIVE adapter wraps — untouched by this ticket.

### 4.3 PT-0001 ledger, API routes, persistence, adapters, page

- Ledger domain: `lib/paper-trading/` (`types.ts`, `service.ts`, `ledger.ts`, `pricing.ts`, `capital.ts`, `validation.ts`, `audit.ts`, `idempotency.ts`, `persistence/{store,commit,locking,keys}.ts`).
- Persistence: extends the existing Autopilot `PaperAccount` Redis record (`lib/autopilot/persistence/paperAccountStore.ts`, key `autopilot:paper-account:<userId>`) via one new optional field, `paperTrading` — not a second account per user. Fully separate from the still-dormant Autopilot Decision Engine's own paper fields on the same record.
- API routes: `app/api/paper-trading/{account,account/reset,positions,positions/[id]/close,positions/[id]/mark,intelligence}/route.ts`.
- Page: `app/paper-trading/page.tsx` — fetches `GET /api/paper-trading/account`, the same route PT-0002A's PAPER adapter calls.
- Existing, enforced isolation: `lib/paper-trading/__tests__/liveIsolation.test.ts` already source-scans the entire paper-trading domain and proves it never imports `lib/tastytrade.ts` or references `placeOrder`/order-builder functions. PT-0002A's `adapterIsolation.test.ts` extends this same technique to the new adapters (§6.2).

### 4.4 Live position/account acquisition

`lib/portfolio-data/acquisition.ts` (`loadPositions`, `loadAccountBalances`, TC-0001 corrective-round relocation) and `lib/tastytrade/client.ts` (`ttFetch`, `getAccessToken`) — the read side of the LIVE pipeline. One call site each, inside `PortfolioDataProvider`.

### 4.5 Live and paper mutation boundaries

- LIVE: `app/portfolio/page.tsx` owns every broker-submission call site (`ttPost`, `ttPostComplex`, `ttValidateOrder`, `ttDelete`, `cancelOrder`, `lib/tastytrade.ts`'s `placeOrder`), gated by ES-0001 (`lib/portfolio/closeOrderSafety.ts`, `closeOrderSubmission.ts`) and ES-0002 (`lib/portfolio/pendingOrderReplacementSafety.ts`, `pendingOrderReplacementSubmission.ts`). `app/rinse-repeat/page.tsx` has its own separate, previously-flagged (ES-0002 broker inventory, item 11) OTOCO submission path — out of scope for PT-0002A, unchanged.
- PAPER: `lib/paper-trading/service.ts`'s `openPaperPosition`/`closePaperPosition`/`resetPaperLedger`/`refreshPaperMark`, reachable only via the PT-0001 API routes, structurally unable to import the broker module (enforced by `liveIsolation.test.ts`).

### 4.6 Broker submission paths and safety gates

Fully enumerated in ES-0002's broker-submission inventory (`docs/reviews/ES-0002-Broker-Submission-Inventory.md`). PT-0002A changes none of them — no broker payload construction, no safety-gate semantics, confirmed unmodified (§6.3).

### 4.7 Portfolio-dependent routes (inventory)

| Route | Consumes `PortfolioDataProvider` today? | PT-0002A wires mode-awareness? |
|---|---|---|
| `/dashboard` | Yes (TC-0001) | No — deferred to PT-0002B |
| `/portfolio` | Yes (TC-0001) | No — deferred to PT-0002B |
| Daily Briefing / Portfolio Review (rendered inside `/dashboard` and `/portfolio`) | Indirectly, via `composition` | No — deferred to PT-0002B |
| `/screener` (Hunter) | No — its own direct TastyTrade calls, unrelated to `PortfolioDataProvider` | No — out of scope |
| Decision Engine inputs | No live position feed; per-candidate evaluation from screener output | No — out of scope |
| Opportunity Engine inputs | No live `DecisionAnalysis[]` feed exists yet (TC-0001, disclosed) | No — out of scope |
| `/performance` | No — its own data path | No — out of scope |
| `/trade-log` | No — its own data path (`lib/tradeLog/reconstructTrades.ts`) | No — out of scope |
| `/paper-trading` | No — PT-0001's own fetch of `GET /api/paper-trading/account` | No — deferred to PT-0002B (natural first PAPER-adapter consumer) |

Only `/dashboard` and `/portfolio` currently consume live portfolio data through a shared provider; every other route already has its own independent data path unaffected by this ticket.

### 4.8 Existing persistence conventions

`localStorage`, unprefixed by any framework, keyed with a short `hunter-*` prefix (`LS_THEME = 'hunter-theme'` in `lib/theme.ts`; `PRIORITY_WORKFLOW_STORAGE_KEY = 'hunter-priorities-workflow-state'`). No existing key uses an explicit version suffix. PT-0002A's `hunter-portfolio-mode-v1` follows the existing prefix convention and adds the version suffix the design doc explicitly requires (§4.10 explains why this ticket also diverges from the existing keys' silent-fallback-on-corruption behavior).

### 4.9 SSR / client hydration constraints

Every existing portfolio-adjacent page is a `'use client'` component. The existing `getSavedTheme()` (`lib/theme.ts`) reads `localStorage` synchronously during the render body itself (`const th = THEMES[getSavedTheme()]`), guarded only by `typeof window !== 'undefined'` — this can genuinely mismatch between server and first client render, but is tolerated today for a low-stakes visual theme. The design doc explicitly requires stricter hydration safety for portfolio mode (a decision with real safety weight, unlike a color theme), so `PortfolioModeProvider` does not follow that looser existing pattern — see §5.2.

### 4.10 Tests protecting existing LIVE behavior

`lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts`, `lib/command-center/__tests__/*`, `components/command-center/__tests__/CommandCenter.test.tsx` (TC-0001), plus the full regression suite (§6.4). None of these were modified by PT-0002A; all were rerun and pass unchanged.

### 4.11 Conclusion — no stop condition triggered

The investigation found no case requiring a rewrite of existing production behavior, no unavoidable provider cycle, no need to touch ES-0001/ES-0002 semantics, and no path that could expose paper data as live or vice versa. Proceeded to implementation per the Preferred Delivery Shape.

## 5. Architecture, as implemented

### 5.1 Provider hierarchy (after)

```text
app/layout.tsx
└── Providers (app/providers.tsx)
    └── SessionProvider
        └── TaskProvider
            └── CommandProvider
                └── PortfolioModeProvider        <- NEW (PT-0002A)
                    └── PortfolioDataProvider     (unchanged, TC-0001)
                        └── {children}
                        └── RankedScanTaskMirror
                        └── ScreenerCardPolish
                        └── ScreenerJobStatus
                        └── PortfolioModeIndicator <- NEW (PT-0002A)
```

`PortfolioModeProvider` and `PortfolioDataProvider` have no dependency on each other in either direction — no provider cycle, no coupling between mode selection and live data acquisition. Nesting `PortfolioModeProvider` outside `PortfolioDataProvider` reflects only that mode conceptually governs which context a future consumer should use; PT-0002A does not wire that dependency (§7).

### 5.2 Hydration-safe resolution

`PortfolioModeProvider`'s first render — server, and the client's first paint before hydration — is always `{ status: 'resolving', mode: null }`, identical on both sides, so there is nothing to mismatch. A `useEffect` (client-only, runs once after mount) then reads `lib/portfolio-mode/persistence.ts`'s `readPersistedPortfolioMode()` and transitions to exactly one of:

- **`first-use`** (no key ever stored): documented, tested, product-intentional new-user initialization. Silently resolves to `LIVE` and persists that choice once. This is the design doc's explicitly-permitted exception to "never silently default."
- **`valid`**: resolves to the stored mode.
- **`invalid`** (a key exists but isn't exactly `'LIVE'`/`'PAPER'`, or the storage read itself threw): never coerced to LIVE or PAPER. Status stays `'invalid'`; `PortfolioModeIndicator` renders a forced, visible choice (§5.4) — the only way out of this state is an explicit `setMode()` call.

Because no existing screen reads this context yet, this resolution window causes zero visible change or flicker anywhere in the current app.

### 5.3 Versioned persistence

`hunter-portfolio-mode-v1` (`lib/portfolio-mode/persistence.ts`). Persists only the mode string — never portfolio data, positions, or balances. Deliberately diverges from `lib/theme.ts`/`priorityWorkflowState.ts`'s existing "silently default on corruption" convention: Mandatory Invariant 5 requires missing/ambiguous context to fail visibly, so this module's read result is a three-way discriminated union (`first-use` / `valid` / `invalid`) rather than a plain value-or-default.

### 5.4 Global mode indicator/selector

`components/portfolio-mode/PortfolioModeIndicator.tsx`, mounted once (same fixed-overlay pattern as `ScreenerJobStatus`/`RankedScanTaskMirror`) — visible on every route without any per-page change. Three states matching the provider exactly: a neutral, textless placeholder while resolving; a loud `role="alert"` forced-choice prompt (showing the offending raw value) when invalid; and a colored badge (amber for LIVE, emerald for PAPER) plus a one-click switch when ready. Switching calls only `setMode()` — no fetch, no broker call, no paper mutation (Mandatory Invariant 3, verified by test — §6.1).

### 5.5 Canonical mode-aware contract + adapters

`lib/portfolio-mode/contract.ts` defines a shared envelope, `PortfolioModeAdapterState<TData>` (`mode`, `status`, `error`, `lastRefreshedAt`, `data`, `refresh()`), deliberately generic over `TData` rather than forcing LIVE `Position[]` and PAPER `PaperTradingPosition[]` into one artificial shape — those are genuinely different domains, and forcing parity would itself be the kind of duplicated logic Mandatory Invariant 7 forbids.

- `lib/portfolio-mode/liveAdapter.ts` — `useLivePortfolioModeAdapter()` calls the existing `usePortfolioData()` and reshapes its result. No new acquisition logic; `loadPositions()`/`loadAccountBalances()` still have exactly one call site (inside `PortfolioDataProvider`).
- `lib/portfolio-mode/paperAdapter.ts` — `usePaperPortfolioModeAdapter()` calls `GET /api/paper-trading/account` (the same route `/paper-trading` already uses) and reshapes the response. No import of any server-side paper-trading module, no import of any live acquisition module.

Neither adapter is wired into any existing screen in this round (§7).

### 5.6 Guardrails

`lib/portfolio-mode/guardrails.ts` — `assertLiveContext(mode, action)` / `assertPaperContext(mode, action)`, throwing a typed `PortfolioModeGuardError` on mismatch. Pure, tested, not called from any real call site yet (§7) — ready for PT-0002B to wire at the actual broker-submission and paper-mutation boundaries.

## 6. Validation

### 6.1 LIVE-regression assessment

`app/portfolio/page.tsx`, `app/dashboard/page.tsx`, `components/portfolio-data/PortfolioDataProvider.tsx`, `lib/portfolio-data/acquisition.ts`, and every ES-0001/ES-0002 module are byte-for-byte unchanged by this diff (`git diff --stat` confirms zero lines touched in any of them). The only production file modified is `app/providers.tsx`, which adds two new provider/component mounts without altering any existing child's props, behavior, or render order relative to each other. The full regression suite (82 files, all passing — §6.4) is the empirical proof.

### 6.2 PAPER/LIVE isolation proof

`lib/portfolio-mode/__tests__/adapterIsolation.test.ts` source-scans `liveAdapter.ts` and `paperAdapter.ts` (mirroring `lib/paper-trading/__tests__/liveIsolation.test.ts`'s established technique) and proves: the PAPER adapter never imports `lib/tastytrade.ts`, `lib/tastytrade/client.ts`, `lib/portfolio-data/acquisition.ts`, or `PortfolioDataProvider`, and never references `loadPositions`/`loadAccountBalances`/`ttFetch`/`getAccessToken`/`placeOrder`/`usePortfolioData`; the LIVE adapter never imports anything under `lib/paper-trading` or `app/api/paper-trading`. Behavioral tests (`liveAdapter.test.tsx`, `paperAdapter.test.tsx`) confirm each adapter's data mapping and refresh behavior in isolation via mocks. `lib/paper-trading/__tests__/liveIsolation.test.ts` itself (unchanged, 29 tests) continues to pass, confirming the existing PT-0001 boundary is untouched.

### 6.3 Broker-safety-gate assessment

`git diff` confirms zero changes to `lib/portfolio/closeOrderSafety.ts`, `closeOrderSubmission.ts`, `pendingOrderReplacementSafety.ts`, `pendingOrderReplacementSubmission.ts`, or any `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder` call site. `lib/portfolio/__tests__/closeOrderSafety.test.ts` (46 tests), `closeOrderSubmission.test.ts` (19 tests), `pendingOrderReplacementSafety.test.ts` (35 tests), and `pendingOrderReplacementSubmission.test.ts` (23 tests) — all rerun, all passing.

### 6.4 Test results

**New PT-0002A tests: 77, across 8 files, all passing** —

| File | Tests |
|---|---:|
| `lib/portfolio-mode/__tests__/types.test.ts` | 21 |
| `lib/portfolio-mode/__tests__/persistence.test.tsx` | 11 |
| `lib/portfolio-mode/__tests__/guardrails.test.ts` | 6 |
| `lib/portfolio-mode/__tests__/adapterIsolation.test.ts` | 18 |
| `lib/portfolio-mode/__tests__/liveAdapter.test.tsx` | 2 |
| `lib/portfolio-mode/__tests__/paperAdapter.test.tsx` | 5 |
| `components/portfolio-mode/__tests__/PortfolioModeProvider.test.tsx` | 7 |
| `components/portfolio-mode/__tests__/PortfolioModeIndicator.test.tsx` | 7 |

**Full repository regression: 82 files, all passing** (74 pre-existing + 8 new PT-0002A files), run in 8 batches due to this sandbox's per-command execution-time ceiling:

| Batch | Scope | Files | Tests | Result |
|---|---|---:|---:|---|
| 1 | lib: `__tests__`, autopilot, command-center, dailyBriefing, decision-engine, decision-review, opportunity-engine, portfolio-mode | 21 | 297 | ✅ |
| 2 | `lib/paper-trading` (incl. `liveIsolation.test.ts`) | 11 | 155 | ✅ |
| 3 | `lib/portfolio`, `lib/portfolio-intelligence`, `lib/portfolio-mode`, `lib/portfolioHealth`, `lib/portfolioReview` | 26 | 423 | ✅ |
| 4 | `lib/position-snapshot`, `lib/positionValuation`, `lib/priorityScore`, `lib/todaysPriorities`, `lib/tradeLog` | 5 | 70 | ✅ |
| 5 | `app/api`, `components/command-center`, `components/opportunity-engine`, `components/paper-trading`, `components/portfolio-mode` | 10 | 63 | ✅ |
| 6 | `features/portfolio/briefing`, `features/portfolio/components` | 7 | 78 | ✅ |
| 7 | `features/portfolio/dailyBriefing`, `decisionReview`, `priorities` | 4 | 54 | ✅ |
| 8 | `features/portfolio/intelligence`, `review` | 4 | 34 | ✅ |

Batches 1 and 3 both include `lib/portfolio-mode` due to directory-prefix glob overlap (`lib/portfolio` matches `lib/portfolio-mode`); every file ran successfully at least once, several ran twice, none failed either time.

### 6.5 TypeScript / diff-check results

- `npx tsc --noEmit` — clean, no errors.
- `git diff --check -- . ':!tsconfig.tsbuildinfo'` — clean, exit 0.

### 6.6 Lint / build

No repository-configured `npm run lint` script exists (consistent with every prior ticket in this sandbox). Production build (`next build`) is a documented, pre-existing sandbox limitation (hangs at the initial Next.js banner) — not attempted, consistent with every prior ticket's validation record; `tsc --noEmit` and the full test suite are the independent substitutes used throughout this project.

## 7. Known limitations, disclosed

**Corrective-round note:** item 1 below described the original (rejected) round, in which the global indicator's PAPER control was enabled. As of the corrective round (§9), no control in the indicator can select PAPER — this item is retained for historical accuracy of what §1–§6 originally described, but no longer reflects current behavior. See §9 for the corrected behavior.

1. ~~No screen consumes the new mode or adapters yet. Selecting PAPER in the global indicator persists the choice and is visible, but `/dashboard`, `/portfolio`, `/paper-trading`, and every other route continue to render exactly what they rendered before this ticket~~ — **superseded by §9**: PAPER can no longer be selected via the indicator at all in this round. `/dashboard`, `/portfolio`, `/paper-trading`, and every other route still render exactly what they rendered before this ticket, and none of them call `usePortfolioMode()`, `useLivePortfolioModeAdapter()`, or `usePaperPortfolioModeAdapter()` — the explicit PT-0002A/PT-0002B scope boundary (Implementation Directive: "Do not force full application-wide behavioral integration"), not an oversight.
2. **Guardrails are not wired to any real call site.** `assertLiveContext`/`assertPaperContext` are tested and ready, but no broker-submission or paper-mutation function calls them yet — today's isolation is still enforced the same way it always was (PT-0001's structural inability to import the broker module), not by these new guardrails. Wiring them is PT-0002B work.
3. **`/screener`, `/performance`, `/trade-log`, and Decision/Opportunity Engine inputs were inventoried but not touched.** None of them currently consume `PortfolioDataProvider` at all (§4.7), so they are unaffected by, and unrelated to, this ticket regardless of mode.
4. **First-use LIVE default cannot be distinguished, after the fact, from an explicit LIVE choice.** Both persist the identical `'LIVE'` value under the same key — this is intentional per the design doc (first-use is documented initialization, not a decision requiring its own audit trail) but is worth naming explicitly.
5. **No visual/screenshot QA**, consistent with every prior ticket in this sandbox (documented pre-existing environment limitation, not a regression).

## 8. Deferred to PT-0002B (explicitly, per the Directive's required separation)

- Wiring `/dashboard` and `/portfolio` to read `usePortfolioMode()` and switch between `useLivePortfolioModeAdapter()`/`usePaperPortfolioModeAdapter()`.
- Wiring `assertLiveContext`/`assertPaperContext` at the actual `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete`/`cancelOrder` call sites and at PT-0001's mutation entry points.
- Deciding whether `/paper-trading` itself should read the global mode, or remain its own dedicated route (today it is unaffected by the global mode either way).
- **Activating the global mode selector itself** — i.e., re-enabling a working PAPER control once screens actually respond to mode (moved here from an implicit assumption in the original round to an explicit deferred item, per the corrective directive's requirement 6).
- Execution-like confirmation copy displaying the active mode (Mandatory Invariant 6) — meaningless until a screen actually renders mode-aware execution UI.
- Any decision about `/screener`, `/performance`, `/trade-log`, or Decision/Opportunity Engine input mode-awareness.

## 9. Corrective Round Addendum

### 9.1 Why this round was rejected

The Product Owner rejected §1–§8 above on one specific, safety-relevant defect: `PortfolioModeIndicator` let the application **display** "PAPER" — the one global, unmistakable mode signal the design doc itself required — while every existing portfolio-dependent screen kept silently rendering real LIVE data, because (per this ticket's own explicit scope boundary) no screen was wired to respond to mode at all. A trader could select PAPER, see "PAPER" in the corner, and be looking at real broker positions the entire time. This is precisely the ambiguous-context failure Mandatory Invariant 5 exists to prevent. The architecture underneath — `PortfolioModeProvider`, versioned persistence, the LIVE/PAPER adapters, the canonical contract, the isolation tests, the guardrails — was explicitly approved as correct and preserved unchanged; only the indicator's UI exposure was the defect.

### 9.2 What changed

`components/portfolio-mode/PortfolioModeIndicator.tsx` is the only file with a production behavior change:

1. The `ready`/LIVE state's "Switch to PAPER" button is now a `disabled` control reading "PAPER — available after application integration," with no way to trigger `setMode('PAPER')`.
2. The `invalid`-state forced-choice prompt's PAPER option is disabled the same way — resolving a corrupted value can only resolve to LIVE through this UI now.
3. If `PortfolioModeProvider` ever resolves to `mode: 'PAPER'` (only possible via a value persisted before this corrective round — nothing in the current UI can write it), the indicator renders a full-viewport blocking dialog instead of a badge: it explains PAPER isn't yet supported application-wide and offers exactly one action, "Return to LIVE." Nothing auto-resolves this state.
4. `/paper-trading` is exempted from the block (via `usePathname()`), since it never reads this context and is unaffected either way — blocking it would serve no safety purpose and would contradict preserving it as an explicitly paper-only route.

`PortfolioModeProvider`, the persistence module, both adapters, the contract, the guardrails, and every one of their existing tests are byte-for-byte unchanged.

### 9.3 Why this satisfies "portfolio context never ambiguous"

After this change, the global indicator can only ever be in one of three states a trader can actually see: a neutral loading placeholder, an unmistakable LIVE badge (the only mode any control can currently select), or a full-screen block explicitly stating PAPER is selected-but-unsupported and blocking further interaction until LIVE is restored. There is no reachable state in which the indicator shows "PAPER" as if it were an active, normal, working mode while a live-data screen renders underneath — the block and the badge are mutually exclusive and the block always wins when mode is PAPER outside `/paper-trading`.

### 9.4 Revalidation

`PortfolioModeIndicator.test.tsx` grew from 7 to 18 tests. Full regression suite (82 files) re-run and passing; `tsc --noEmit` clean; `git diff --check` clean. Full detail in `docs/reviews/PT-0002A-Implementation-Report.md` §13.

No commit, push, merge, or deploy has been made. This remains a review package for Product Owner approval.
