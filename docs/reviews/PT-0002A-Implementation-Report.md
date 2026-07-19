# PT-0002A — Global Portfolio Mode Foundation — Implementation Report

Status: **CORRECTIVE ROUND COMPLETE, AWAITING PRODUCT OWNER REVIEW.** Complete on branch `feature/global-portfolio-mode-foundation`. Not committed, not pushed, not merged. The original round (§1–§12) was rejected — see §13 for the corrective round. This report, together with `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` and `PT-0002A-corrective-review.diff`, is the review package.

## 1. Executive summary

PT-0002A adds a single, application-wide `PortfolioMode` (`LIVE | PAPER`) abstraction: a hydration-safe provider with versioned persistence, an unmistakable global mode indicator, a canonical mode-aware contract, and two thin adapters (LIVE wraps the existing `usePortfolioData()`; PAPER wraps the existing PT-0001 API route) — plus tested, unwired execution/mutation guardrails. No existing screen was changed to consume any of this yet; that integration is explicitly deferred to PT-0002B per the Implementation Directive's required separation. LIVE production behavior is provably unchanged: the only production file touched is `app/providers.tsx` (two additive mounts), and the full 82-file regression suite passes unchanged.

**Corrective round (§13):** the original round was rejected because its global indicator exposed a fully working "Switch to PAPER" control while no screen was wired to actually change what it displayed — the shell could say "PAPER" while every page kept rendering live data. The fix, entirely contained to `PortfolioModeIndicator.tsx` and its tests: no control in this round can ever set mode to PAPER (a disabled control explains it's available after PT-0002B integration); a legacy-persisted PAPER value blocks the shell with a full-screen warning requiring an explicit return to LIVE, rather than being silently coerced or quietly displayed; `/paper-trading` is exempted since it is unaffected either way. The provider, persistence, adapters, contract, guardrails, and their tests are all unchanged.

## 2. Pre-flight repository state

```
git status                    -> dirty (5 uncommitted TC-0001 doc touch-ups, resolved per PO direction)
git branch --show-current     -> feature/trade-command-center
git log --oneline -3          -> 3385d23 feat(dashboard): introduce Trade Command Center
                                  424e068 Merge branch 'feature/pending-order-replacement-safety'
git fetch origin               -> failed: sandbox has no git network credentials (pre-existing,
                                   documented limitation, not a repo issue)
git rev-parse HEAD             -> 3385d23... (before the doc commit below)
git rev-parse origin/main      -> 424e068...
```

**Stop condition triggered and resolved before proceeding:** the working tree was dirty (5 modified docs files — the TC-0001 status-line corrections made after the TC-0001 push, left uncommitted pending Product Owner direction). Per the Directive's explicit instruction, work stopped and the state was reported rather than guessed past. Product Owner direction: reviewed the 5 diffs (confirmed doc-only, no PT-0002A work), committed them (`docs: finalize TC-0001 status documentation`, `2827ad9`), pushed to `origin/feature/trade-command-center`.

**Post-resolution state:**

```
HEAD                           -> 2827ad9 (docs: finalize TC-0001 status documentation)
                                   containing 3385d23 (feat(dashboard): introduce Trade Command Center)
origin/feature/trade-command-center -> 2827ad9 (pushed, confirmed by user)
origin/main                    -> 424e068 (untouched)
Working tree                   -> clean
```

`feature/global-portfolio-mode-foundation` did not already exist. Created via `git switch -c feature/global-portfolio-mode-foundation` from `2827ad9` — the approved TC-0001 base commit, not an assumed `main` state, per the Directive's Critical Safety Rule.

## 3. Architecture investigation

Full investigation in `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` §4. Summary of findings:

- Root provider hierarchy: `SessionProvider > TaskProvider > CommandProvider > PortfolioDataProvider (TC-0001)`.
- `PortfolioDataProvider` is the one runtime call site for `loadPositions()`/`loadAccountBalances()`, shared by `/portfolio` and `/dashboard`.
- PT-0001's ledger (`lib/paper-trading/`) is already structurally isolated from the broker module, enforced by an existing source-scan test (`liveIsolation.test.ts`).
- Only `/dashboard` and `/portfolio` consume `PortfolioDataProvider` today; `/screener`, `/performance`, `/trade-log`, and Decision/Opportunity Engine inputs all have independent data paths, unrelated to this ticket.
- Existing persistence convention: unversioned `hunter-*` localStorage keys that silently default on corruption — intentionally not followed here, since the design doc requires visible failure on ambiguity.
- No architecture conflict, provider cycle, required rewrite of existing behavior, or Autopilot-activation risk was found. No stop condition from the Directive's list was triggered.

## 4. Files changed

**Corrective-round correction:** the version of this section originally delivered mislabeled its own file count ("Added (16 files)" while actually enumerating 18) and omitted `docs/roadmap/ROADMAP.md` and `planning/SPRINT_STATUS.md` from the modified list entirely, even though both were changed and included in the review diff. This is the corrected, verified accounting — cross-checked directly against `git status --short` and `git diff --stat` rather than hand-counted.

**Added (18 files):**
- `lib/portfolio-mode/types.ts`, `persistence.ts`, `guardrails.ts`, `contract.ts`, `liveAdapter.ts`, `paperAdapter.ts` (6)
- `lib/portfolio-mode/__tests__/types.test.ts`, `persistence.test.tsx`, `guardrails.test.ts`, `adapterIsolation.test.ts`, `liveAdapter.test.tsx`, `paperAdapter.test.tsx` (6)
- `components/portfolio-mode/PortfolioModeProvider.tsx`, `PortfolioModeIndicator.tsx` (2)
- `components/portfolio-mode/__tests__/PortfolioModeProvider.test.tsx`, `PortfolioModeIndicator.test.tsx` (2)
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` (1)
- `docs/reviews/PT-0002A-Implementation-Report.md` (this file) (1)

**Modified (5 files):**
- `app/providers.tsx` — mounts `PortfolioModeProvider` (wrapping the existing, unchanged `PortfolioDataProvider`) and `PortfolioModeIndicator` (alongside the existing global overlays). No existing provider's props, nesting relative to each other, or behavior changed.
- `vitest.config.ts` — added `lib/**/__tests__/**/*.test.tsx` to `include` (this ticket's own `.tsx` tests under `lib/portfolio-mode/__tests__/` would otherwise silently never run, the same trap the OE-0001/PT-0001 tickets' own comments in this file document hitting before for `components/` and `app/`).
- `docs/roadmap/ROADMAP.md` — adds a PT-0002A entry to the Current Branch and Near-Term Roadmap sections.
- `planning/SPRINT_STATUS.md` — adds PT-0002A to the Next Sprint Decision Gate and renumbers the candidate next-sprint list to include PT-0002B.
- `tsconfig.tsbuildinfo` — auto-regenerated by `tsc --noEmit`, not a substantive change, consistent with every prior ticket's report.

**Total: 23 files touched (22 in the review diff, `tsconfig.tsbuildinfo` excluded by convention).**

**Not modified (confirmed via `git diff`):**
- `app/portfolio/page.tsx`, `app/dashboard/page.tsx`, `components/portfolio-data/PortfolioDataProvider.tsx`, `lib/portfolio-data/acquisition.ts`, `lib/tastytrade.ts`, `lib/tastytrade/client.ts` — zero lines touched.
- `lib/portfolio/closeOrderSafety.ts`, `closeOrderSubmission.ts`, `pendingOrderReplacementSafety.ts`, `pendingOrderReplacementSubmission.ts` (ES-0001/ES-0002) — zero lines touched.
- `lib/paper-trading/*` (PT-0001) — zero lines touched.
- Every other existing route/component in the repository.

## 5. Diff statistics

Corrected — this is `git diff --stat -- . ':!tsconfig.tsbuildinfo'` run directly against the final corrective-round state, not a stale pre-documentation snapshot:

```
 app/providers.tsx                                  |  25 ++-
 components/portfolio-mode/PortfolioModeIndicator.tsx      | 153 ++++++++++++++
 components/portfolio-mode/PortfolioModeProvider.tsx       | 105 ++++++++++
 components/portfolio-mode/__tests__/PortfolioModeIndicator.test.tsx  | 230 ++++++++++++++++++++
 components/portfolio-mode/__tests__/PortfolioModeProvider.test.tsx   | 138 ++++++++++++
 docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md  | 232 +++++++++++++++++++++
 docs/reviews/PT-0002A-Implementation-Report.md             | 156 ++++++++++++++
 docs/roadmap/ROADMAP.md                                    |  14 +-
 lib/portfolio-mode/__tests__/adapterIsolation.test.ts      |  73 +++++++
 lib/portfolio-mode/__tests__/guardrails.test.ts             |  57 +++++
 lib/portfolio-mode/__tests__/liveAdapter.test.tsx            |  52 +++++
 lib/portfolio-mode/__tests__/paperAdapter.test.tsx            |  80 +++++++
 lib/portfolio-mode/__tests__/persistence.test.tsx             |  93 +++++++++
 lib/portfolio-mode/__tests__/types.test.ts                    |  44 ++++
 lib/portfolio-mode/contract.ts                                 |  29 +++
 lib/portfolio-mode/guardrails.ts                               |  72 +++++++
 lib/portfolio-mode/liveAdapter.ts                              |  59 ++++++
 lib/portfolio-mode/paperAdapter.ts                              |  77 +++++++
 lib/portfolio-mode/persistence.ts                               |  86 ++++++++
 lib/portfolio-mode/types.ts                                     |  33 +++
 planning/SPRINT_STATUS.md                                        |  21 +-
 vitest.config.ts                                                  |   6 +
 22 files changed, 1815 insertions(+), 20 deletions(-)
```

## 6. Test results

**New PT-0002A tests (post-corrective-round): 88 across 8 files, all passing** (77 from the original round + 11 new/changed assertions in `PortfolioModeIndicator.test.tsx` covering the corrective fix — see §13). Full breakdown in the design doc §6.4 and §13.4.

**Full repository regression: 82 files, all passing**, run in 8 batches (this sandbox's per-command execution-time ceiling requires batching). Full batch-by-batch breakdown in the design doc §6.4. Includes explicit reconfirmation of `lib/paper-trading/__tests__/liveIsolation.test.ts` (29 tests) and all four ES-0001/ES-0002 safety-gate suites (123 tests combined). Rerun in full again after the corrective round (§13.4) — zero regressions.

**TypeScript:** `npx tsc --noEmit` — clean, no errors.

**Diff check:** `git diff --check -- . ':!tsconfig.tsbuildinfo'` — clean, exit 0.

**Lint/build:** no `npm run lint` script configured (unchanged from every prior ticket); production build is a documented, pre-existing sandbox limitation, not attempted, consistent with prior practice.

## 7. Explicit proof that LIVE behavior is preserved

1. `git diff --stat` shows zero changes to `app/portfolio/page.tsx`, `app/dashboard/page.tsx`, `components/portfolio-data/PortfolioDataProvider.tsx`, `lib/portfolio-data/acquisition.ts`, or `lib/tastytrade{.ts,/client.ts}`.
2. The only production file touched, `app/providers.tsx`, adds two new provider/component mounts (`PortfolioModeProvider`, `PortfolioModeIndicator`) without changing any existing provider's props or the nesting order of `SessionProvider > TaskProvider > CommandProvider > PortfolioDataProvider > {children}`.
3. `loadPositions()`/`loadAccountBalances()` still have exactly one runtime call site each, inside the unmodified `PortfolioDataProvider` — confirmed by both the diff and `adapterIsolation.test.ts`'s assertion that `liveAdapter.ts` reaches live data only through `usePortfolioData()`.
4. Full regression suite (82 files) passes with the exact same per-file test counts as the TC-0001 corrective-round baseline for every pre-existing file, plus the 8 new PT-0002A files — no pre-existing test's behavior changed.
5. `PortfolioModeIndicator` is the only new visible UI element; it is a small, fixed-position overlay that renders independently of every existing page's own layout and does not alter any existing page's DOM.

## 8. Explicit proof that PAPER cannot touch LIVE broker/account paths

1. `lib/portfolio-mode/__tests__/adapterIsolation.test.ts` source-scans `paperAdapter.ts` and asserts, by regex against the actual file content, that it does not import `lib/tastytrade.ts`, `lib/tastytrade/client.ts`, `lib/portfolio-data/acquisition.ts`, or `PortfolioDataProvider`, and does not reference `loadPositions`, `loadAccountBalances`, `ttFetch`, `getAccessToken`, `placeOrder`, or `usePortfolioData` by name (8 assertions, all passing).
2. The same suite asserts `paperAdapter.ts` reaches data only via `fetch('/api/paper-trading/account')` — the existing PT-0001 read route.
3. `lib/paper-trading/__tests__/liveIsolation.test.ts` (pre-existing, unmodified, 29 tests) independently reconfirms the entire `lib/paper-trading` domain, its API routes, and its UI components never import `lib/tastytrade.ts` or reference `placeOrder`/the order-builder functions.
4. `lib/portfolio-mode/__tests__/paperAdapter.test.tsx` behaviorally confirms the adapter's only network call is `fetch('/api/paper-trading/account')`, exactly once per `refresh()`.
5. `lib/portfolio-mode/__tests__/adapterIsolation.test.ts` separately proves the inverse: `liveAdapter.ts` never imports anything under `lib/paper-trading` or `app/api/paper-trading`, and never references `getPaperTradingLedger`, `openPaperPosition`, `closePaperPosition`, or the paper-trading account route.
6. `components/portfolio-mode/__tests__/PortfolioModeProvider.test.tsx` and `PortfolioModeIndicator.test.tsx` both assert `global.fetch` is never called by mode selection/switching itself (Mandatory Invariant 3) — spied and asserted not-called across every `setMode()` interaction path, including the invalid-state resolution path.

## 9. Known limitations

See the design doc §7 for the full, disclosed list. Headline: no existing screen consumes the new mode or adapters yet (explicit PT-0002A/PT-0002B boundary), and the guardrail utilities are tested but not wired to any real call site yet.

## 10. Deferred PT-0002B work

See the design doc §8 for the full list: screen integration for `/dashboard` and `/portfolio`, guardrail wiring at real broker-submission/paper-mutation call sites, a decision on whether `/paper-trading` itself should read the global mode, and execution-confirmation copy displaying the active mode.

## 11. Commands run

```
git status / git status --short
git branch --show-current
git log --oneline --decorate -10
git fetch origin              (failed -- sandbox network limitation, documented)
git rev-parse HEAD
git rev-parse origin/main
git branch -vv
git switch -c feature/global-portfolio-mode-foundation
npx tsc --noEmit
npx vitest run <8 batches by directory, listed in the design doc §6.4>
git diff --check -- . ':!tsconfig.tsbuildinfo'
git add -N -- <new PT-0002A paths>
git diff --binary -- . ':!tsconfig.tsbuildinfo' > PT-0002A-review.diff
```

## 12. Deliverables (original round)

- This report.
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md`.
- `PT-0002A-review.diff` — full patch (binary-safe, `tsconfig.tsbuildinfo` excluded), covering all 22 changed/added files listed in §4 (corrected count — see §4's correction note).
- Updated `docs/roadmap/ROADMAP.md`, `planning/SPRINT_STATUS.md`.

No commit, push, merge, or deploy has been made. This package was submitted for Product Owner review and was **rejected** — see §13.

---

## 13. Corrective Round Addendum

### 13.1 Why this round was rejected

The Product Owner rejected the original PT-0002A round on a single, specific safety defect: `PortfolioModeIndicator`'s "Switch to PAPER" control was fully enabled, letting the application **display** "PAPER" in its one global, unmistakable indicator while every existing portfolio-dependent screen (`/dashboard`, `/portfolio`) kept silently rendering real **LIVE** data underneath — because, per this round's own explicit, disclosed scope boundary (§9/§10 above), no screen was wired to read the new mode at all. A trader could select PAPER, see "PAPER" in the corner badge, and be looking at real broker positions and balances the whole time. This is exactly the kind of ambiguous portfolio context Mandatory Invariant 5 exists to prevent — the architecture (provider, persistence, adapters, contract, guardrails, isolation tests) was correct and is unchanged; the indicator's UI exposure was not.

### 13.2 What changed

**`components/portfolio-mode/PortfolioModeIndicator.tsx`** — the only production behavior change in this round:

1. **No enabled global PAPER switch.** The `ready`/`mode === 'LIVE'` state's "Switch to PAPER" button is replaced with a `disabled` control labeled "PAPER — available after application integration," carrying no `onClick` capable of calling `setMode`. There is no path, anywhere in this component, for a user action to set mode to PAPER.
2. **Unmistakably LIVE.** The LIVE badge itself is unchanged — still the only active, working mode indicator this round can produce.
3. **The `invalid`-state forced-choice prompt's PAPER option is also now disabled**, for the same reason — resolving a corrupted persisted value can only ever resolve to LIVE through this UI in this round.
4. **A legacy-persisted PAPER value is never silently coerced.** If `PortfolioModeProvider` resolves `status: 'ready', mode: 'PAPER'` (only reachable via a value stored before this corrective round — there is no way to write it going forward), the indicator renders a full-viewport, pointer-capturing blocking dialog (`role="alertdialog"`) instead of any normal badge. It states that PAPER is not yet supported application-wide and offers exactly one action, "Return to LIVE," which calls `setMode('LIVE')`. Nothing auto-dismisses this state or writes to persistence on its own.
5. **`/paper-trading` is explicitly exempted** from the blocking dialog (via `usePathname()`), since that route never reads `PortfolioDataProvider` or this context at all and is unaffected either way — blocking it would have obstructed the one legitimate, already-safe paper-only destination for no safety benefit, contradicting the corrective directive's explicit instruction to preserve it.

**Not changed:** `components/portfolio-mode/PortfolioModeProvider.tsx`, `lib/portfolio-mode/{types,persistence,guardrails,contract,liveAdapter,paperAdapter}.ts`, and their respective test files — all preserved exactly, per the corrective directive's explicit instruction. The provider's `setMode()` API still accepts `'PAPER'` (a capability future PT-0002B screen integration needs); only this component's UI no longer exposes a control that calls it with that value.

### 13.3 Files changed (corrective round)

**Modified:**
- `components/portfolio-mode/PortfolioModeIndicator.tsx`
- `components/portfolio-mode/__tests__/PortfolioModeIndicator.test.tsx`
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` (Corrective Round Addendum)
- `docs/reviews/PT-0002A-Implementation-Report.md` (this file — §4/§5 accounting correction, this addendum)

No other file changed in this round.

### 13.4 Revalidation

- **New/changed tests:** `PortfolioModeIndicator.test.tsx` grew from 7 to 18 tests (11 new), covering: the disabled PAPER control in the LIVE-ready state and that clicking it never calls `setMode`; the disabled PAPER option in the invalid-state prompt; the full-screen block rendering for a legacy PAPER mode on live-portfolio routes; that the block persists across re-renders (never self-clears); that "Return to LIVE" is the only interactive control and correctly calls `setMode('LIVE')`; the `/paper-trading` exemption; and an explicit requirement-7 sweep asserting no button, across every provider status, ever calls `setMode` with `'PAPER'`.
- **Full regression suite:** re-run in the same 8 batches — 82 files, all passing, zero regressions.
- **`npx tsc --noEmit`:** clean.
- **`git diff --check -- . ':!tsconfig.tsbuildinfo'`:** clean, exit 0.

### 13.5 Explicit proof: the shell cannot display PAPER while live-only content remains available

1. `PortfolioModeIndicator.test.tsx`'s "requirement 7" describe block renders every reachable provider status (`resolving`, `invalid`, `ready`/LIVE, `ready`/PAPER), clicks every enabled button in each, and asserts `setMode` is never called with `'PAPER'` — i.e., there is no sequence of user interactions with this component, in any state, that results in the application being told to switch to PAPER.
2. A second test in that block asserts that when the resolved mode is PAPER on a live-portfolio route, exactly one button exists in the entire render — "Return to LIVE" — so there is no interactive path from that render to viewing any other content while PAPER remains the resolved, displayed mode.
3. A dedicated test confirms the blocking dialog and the normal LIVE/PAPER badge (`data-testid="portfolio-mode-label"`) never render simultaneously — the block fully replaces the badge, it does not overlay a still-visible "PAPER" label.
4. A dedicated test confirms the block does not self-clear on re-render (simulating time passing with no user action) — it persists until the explicit "Return to LIVE" click, satisfying "never silently coerce."

### 13.6 Deliverables (corrective round)

- This addendum.
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md`'s Corrective Round Addendum.
- `PT-0002A-corrective-review.diff` — full patch (binary-safe, `tsconfig.tsbuildinfo` excluded) covering the complete, corrected PT-0002A state (all files from the original round plus the corrective changes in §13.3).

No commit, push, merge, or deploy has been made. This remains a review package for Product Owner approval.

No commit, push, merge, or deploy has been made. This package is for Product Owner review before any of those steps.
