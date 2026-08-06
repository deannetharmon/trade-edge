# TE-0007C — Implementation Report

**Branch:** `feature/te-0007c-covered-call-screener`

## 1. Holdings source

New route `app/api/covered-call-capacity/route.ts` fetches RAW (unfiltered)
`/accounts/{account}/positions` and `/accounts/{account}/orders/live`, then
delegates all math to `lib/scans/covered-call-capacity.ts`. This deliberately
does NOT reuse `/api/positions`, which filters to `Equity Option`/`Index
Option` instrument types and discards equity share rows entirely.

## 2. Capacity formula

```
grossCoveredContracts = floor(sharesOwned / 100)
availableCoveredContracts =
  max(0, grossCoveredContracts − existingShortCallContracts − workingShortCallContracts)
oversubscribed = (grossCoveredContracts − existing − working) < 0
```

Implemented in `computeCoveredCallCapacity()`. Never counts short stock,
non-positive quantities, short puts, or long calls as coverage/exposure.

## 3. Treatment of working orders

Only orders with status `Live` or `Working` reserve capacity. Only `Sell to
Open` call legs reserve NEW capacity — `Buy to Close` legs (closing an
existing short call) never do. Filled/Cancelled/Rejected/Expired orders are
excluded entirely (`normalizeWorkingCallReservations()`).

## 4. Cost basis source and missing-data behavior

Quantity-weighted average of `average-open-price` across all long equity lots
for a symbol (`normalizeEquityHoldings()`). When no lot has a usable cost
(`null`/`0`/negative), `costBasis` is `null` — never substituted with current
price. A `null` cost basis does not by itself suppress a candidate (a strike
safely above current price can still qualify), but the returned candidate
carries `ccAssignmentWarning: 'Cost basis unavailable...'` and
`ccStrikeVsCostBasisPct`/`ccMaxUpsideIfCalledAway` stay `null` rather than
computing off a fabricated basis.

If holdings or working-order data can't be loaded, `buildCoveredCallCapacityReport()`
returns `status: 'unavailable'` with an EMPTY `bySymbol` map — never a
zero-filled map that would look like "verified, zero shares."

## 5. Contract-selection reuse

`findBestCoveredCall()` (`lib/scans/covered-call-finder.ts`) calls
`findBestWheelContract(..., 'own-writing-cc', ...)` from
`lib/wheel/chainSearch.ts` — the same delta/DTE search Wheel already uses. No
second implementation of that search algorithm exists. On top of that search,
this module adds CC-specific hard gates (each of which returns `null`, never
a downgraded/fabricated candidate):

- capacity <= 0
- earnings within the expiry window
- open interest below `OI_MIN`
- unusable quote (bid and ask both <= 0) or crossed market (ask < bid)
- bid/ask spread above `BID_ASK_MAX`
- strike below current stock price (no ITM by default)
- strike below known cost basis

Quantity is always `capacity.availableCoveredContracts` — never a caller-
supplied, unchecked value.

## 6. Shared-model/UI changes

- `lib/scans/constants.ts`: added `DEFAULT_CC_RULES`/`CcRulesType` (delta
  0.20-0.35, DTE 21-45, OI >= 100, bid/ask <= 0.20 — configurable, no
  hard-coded thresholds scattered through the page).
- `lib/scans/types.ts`: added 17 `cc*`-prefixed optional fields to
  `SpreadCandidate`. Reused existing shared fields (`shortStrike`,
  `shortDelta`, `shortOI`, `shortBid`/`shortAsk`, `credit`, `roc`,
  `annualizedRoc`, `pop`) rather than duplicating them under a `cc` prefix,
  to keep the shared result-card row logic working with minimal branching.
- `app/screener/page.tsx`: `runCcChecklist()` (mirrors `runCspChecklist()`),
  `runCcScan()` (mirrors `runCspScan()` but sources its universe from
  `/api/covered-call-capacity` instead of a ticker-list state string),
  `StrikesDisplay` CC branch, strategy badge color (cyan), summary-row
  Premium/Ann. Yield labeling extended from CSP-only to CSP-or-CC, expanded
  CC detail block (capacity breakdown, cost basis, strike-vs-basis, max
  upside, warnings), and Action Buttons row updated so CC — like CSP — never
  renders `TRADE THIS` / `FIND BETTER`.

## 7. Why naked calls are impossible

Every path that returns a CC candidate passes through
`findBestCoveredCall()`, which hard-gates on `capacity.availableCoveredContracts
<= 0` as its FIRST check, before any chain search runs. Capacity itself is
computed exclusively from verified broker holdings data (§1-2) — there is no
code path that constructs a CC candidate or reserves quantity independent of
a `CoveredCallCapacity` object. `runCcScan()`'s scan loop only ever iterates
over symbols the capacity API reported as eligible (`ccEligibleHoldings`,
further only-narrowable by the hide-only `toggleCcSymbol` filter) — it cannot
add an unverified symbol.

## 8. Test totals

- `lib/scans/__tests__/covered-call-capacity.test.ts`: 18 tests (14 ticket
  cases + 4 supporting end-to-end wiring cases), run in isolation against a
  harness mirroring the real `lib/wheel/chainSearch.ts` — **all passing**.
- `lib/scans/__tests__/covered-call-finder.test.ts`: 12 tests (10 ticket
  cases + 2 supporting cases), same harness — **all passing**.
- **Total new: 30 tests, all passing** against the isolated harness.

## 9. Manual acceptance results

**NOT executed** — requires a live TastyTrade account with the specific
holding shapes described in the ticket (NKE 100sh/no call, MU 500sh/two
calls, etc.). Deferred to Dean running against his own account after this
branch is pushed.

## 10. Validation gap (flagged explicitly, not hidden)

This ticket instructed running targeted CC tests, the full suite, `tsc
--noEmit`, and a production build, then returning validation totals — but
this delivery was produced without direct access to the actual repository
(no git credentials) and without the developer having local Node.js
available. What WAS validated:

- The 30 new tests above, run against an isolated Vitest harness built from
  the actual `chainSearch.ts` and `types.ts` file contents supplied for this
  ticket — not a mock.
- Every anchor-matched patch to `constants.ts`, `types.ts`, and
  `app/screener/page.tsx` was applied against copies of the ACTUAL uploaded
  file contents and confirmed to match exactly once before delivery; the
  patched `page.tsx` was confirmed brace-balanced after all three patch
  stages.

What was NOT validated: the existing CSP/PMCC/BPS/BCS/IC test suites, the
full project test suite, `tsc --noEmit` against the real project
`tsconfig.json` and its full dependency graph, and `next build`. These
require either pushing this branch (triggering a Vercel preview build, which
only runs `next build`, not `vitest`/`tsc`) or running commands against the
real cloned repository with Node available. Dean should run `npx vitest run`,
`npx tsc --noEmit`, and `npx next build` (or push for the Vercel build check)
before merging.

## 11. Deferred work (explicitly out of scope, per the ticket)

- Live order execution / auto trading for CC.
- Rolling existing covered calls.
- Tax-lot selection, tax consequences, dividend modeling.
- Early-assignment probability modeling beyond the existing warning text.
- PMCC redesign, TE-0007D.
- Unified TE-0007E refactor.
- Portfolio-wide opportunity ranking.
- Margin / naked-call support.

## 12. Rebase onto current `main` (post-push corrective)

`feature/te-0007c-covered-call-screener` had drifted behind `main`: it branched from `e42ba2e` (TE-0002 Round 4), but `main` subsequently advanced by two commits before this rebase:

- `ec869a9` "Fix: Add 'cc' to ScreenerJobKind" — a Vercel build fix that went wrong in delivery: the commit's diff shows `lib/screener/screenerJobStore.ts`'s entire TypeScript content replaced by the raw text of a shell script (a patch script's contents were pasted directly into the `.ts` file instead of being executed against it). This briefly left `main` with a non-functional `screenerJobStore.ts`.
- `6586ef7` "Repair main: restore screenerJobStore.ts, reapply 'cc' fix correctly" — restored the file from the last good commit and reapplied only the legitimate one-line change (adding `'cc'` to the `ScreenerJobKind` union).

Independently, this feature branch had its own commit making the identical legitimate fix: `150d09c` "TE-0007C fix: add 'cc' to ScreenerJobKind" (a clean one-line diff, never corrupted — this branch was not involved in the `main` incident).

**Rebase result.** Running `git rebase main` replayed this branch's 13 commits onto `main` @ `6586ef7`. Git's patch-id matching recognized that `150d09c`'s change was already present upstream (via `6586ef7`) and automatically dropped it as an empty/duplicate commit — no manual conflict resolution was needed for this file. Verified directly post-rebase:
- `lib/screener/screenerJobStore.ts` on the rebased branch is byte-for-byte identical to `main`'s repaired version (`git diff 6586ef7 HEAD -- lib/screener/screenerJobStore.ts` is empty) — correct TypeScript content, `'cc'` present exactly once in the `ScreenerJobKind` union, no shell-script remnants.
- The earlier `for (const symbol of Array.from(symbols))` fix in `lib/scans/covered-call-capacity.ts` (from the separate Vercel Set-iteration build failure) survived the rebase unchanged.

New commit after rebase: `9f73af3`, based on `main` @ `6586ef7`.

## 13. Combined validation (fills the gap flagged in §10)

Run against the rebased branch, with real repository access, Node, and the actual `tsconfig.json`/dependency graph — closing the validation gap §10 explicitly flagged as unexecuted:

- `npx tsc --noEmit` — clean, zero errors.
- `npx vitest run` (full suite, `--pool=threads --poolOptions.threads.maxThreads=4`) — **101 test files, 1456 tests, all passing.** This includes the 30 CC-specific tests from §8 (now running as part of the real suite, not only the isolated harness) plus every pre-existing suite (TE-0002 Round 3/4 stop-loss trust boundary, PM-0001 position metrics, ES-0001 close-order safety, and all others) unchanged.
- `npx next build` — succeeds. This is the same build step Vercel runs; it now passes cleanly including through `lib/screener/screenerJobStore.ts` and `lib/scans/covered-call-capacity.ts`, the two files implicated in the prior build failures.

§10's "what was NOT validated" list (existing suites, full project `tsc`, `next build`) is now fully validated. §9 (manual acceptance against a live TastyTrade account) remains explicitly deferred to Dean, unchanged.

## 14. Merge status

Implemented, rebased onto current `main`, and validated on `feature/te-0007c-covered-call-screener` at commit `9f73af3`. **Not merged yet** — awaiting instruction, per this round's explicit "do not merge yet."
