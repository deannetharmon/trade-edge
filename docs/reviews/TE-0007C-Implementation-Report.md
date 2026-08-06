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

## 14. Merge status (superseded by §15 corrective round below)

Implemented, rebased onto current `main`, and validated on `feature/te-0007c-covered-call-screener` at commit `9f73af3`. **Not merged yet** — awaiting instruction, per this round's explicit "do not merge yet."

## 15. Corrective round — real broker coverage evidence and candidate eligibility

Commit `3e0ca46` was NOT merged. Final code review found that §1-14 above validated correct *logic* against idealized test fixtures that always supplied fields real broker responses do not reliably provide (a trustworthy `option-type` string, complete cost-basis on every lot, always-two-sided quotes). This round corrects five safety gaps those fixtures hid, all confined to `lib/scans/covered-call-capacity.ts` and `lib/scans/covered-call-finder.ts` plus one new shared module.

### Original fixture/schema assumption vs. corrected broker normalization

1. **Short-call/working-order classification.** Original fixtures always set `p['option-type'] === 'C'`. Real TastyTrade `/positions` and `/orders/live` legs cannot be assumed to carry a reliable `option-type` field — TradeEdge's own position processing (`lib/portfolio-data/acquisition.ts`) already derives call/put from the OCC symbol for this reason. Corrected: new `lib/optionSymbol.ts` exports a pure, framework-free `parseOccSymbol()`/`resolveOptionType()`/`resolveUnderlyingSymbol()` (kept out of `lib/portfolio-data/acquisition.ts` deliberately — `lib/scans/*` must stay decoupled from that larger, side-effectful module). `normalizeShortCallExposure()` and `normalizeWorkingCallReservations()` now trust an explicit valid field first, fall back to OCC-symbol parsing, and — critically — when a short option's type is genuinely undeterminable, conservatively fold it into exposure as if it were a call (it can only ever understate available capacity, never cause a naked-call recommendation) while flagging it via a new `unclassifiedSymbols` set surfaced as `CoveredCallCapacity.hasUnclassifiedExposure`.
2. **Working order status/action matching.** Original fixtures always used exact-case `'Live'`/`'Sell to Open'`. Real broker values vary in casing/whitespace. Corrected: `normalizeToken()` does case/whitespace-insensitive matching without expanding the semantic set of accepted statuses/actions — matching robustness changed, not meaning. Buy-to-close legs never reserve new capacity.
3. **Cost basis completeness.** Original `normalizeEquityHoldings()` averaged only lots with a valid basis and silently applied that partial average to ALL shares. Corrected: tracks `anyLotMissingBasis`; `costBasis` is `null` unless every contributing lot has a valid, positive basis; new `EquityHolding.costBasisComplete` / `CoveredCallCapacity.costBasisComplete` fields make the completeness state explicit and prevent basis-derived calculations (`ccStrikeVsCostBasisPct`, `ccMaxUpsideIfCalledAway`) from running against a partial average.
4. **One-sided quotes.** Original `findBestCoveredCall()` rejected only when BOTH bid and ask were non-positive, accepting e.g. bid=0/ask>0 and computing a midpoint from it. Corrected: `isEligibleCcLeg()` requires `Number.isFinite(bid)`, `Number.isFinite(ask)`, `bid > 0`, `ask > 0`, `ask >= bid` — a one-sided, crossed, missing, or non-finite quote is never eligible.
5. **Select-then-validate architecture.** Original flow filtered strikes below stock/cost-basis, picked the single delta-closest contract via `findBestWheelContract`, THEN applied liquidity/quote checks — returning null if that one pick failed even when another eligible contract existed. Corrected: new `selectBestEligibleCcContract()` filters the FULL candidate universe for every hard gate (call leg, DTE range, delta range, strike at/above stock price and complete cost basis, finite two-sided non-crossed quote, bid/ask width, minimum OI) first, then picks the best remaining candidate by delta-distance with documented deterministic tie-breakers (open interest, then bid/ask width, then DTE). `chainSearch.ts` itself and `findBestWheelContract` are unmodified (shared with Wheel/CSP, out of scope) — this module now owns its own selection loop instead of calling that single-shot function.

### New tests (all 15 ticket-required scenarios plus a realistic end-to-end fixture)

- `lib/__tests__/optionSymbol.test.ts` (11 tests): canonical OCC parser correctness and null-safety.
- `lib/scans/__tests__/covered-call-capacity.test.ts`: extended with a `TE-0007C corrective round` describe block covering ticket items 1-8 and 15 (OCC-only short call/working order consume/reserve coverage, combined subtraction, unclassifiable-option conservative reservation, status/action casing normalization, buy-to-close non-reservation, partial-basis nullification, basis-dependent field suppression, capacity-never-exceeds-verified-evidence), plus a realistic end-to-end fixture shaped exactly like real `/positions` + `/orders/live` responses (space-padded OCC symbols, no `option-type` field, order legs shaped as `{symbol, action, quantity}`, a Cancelled duplicate proving no double-reservation).
- `lib/scans/__tests__/covered-call-finder.test.ts`: extended with a `TE-0007C corrective round` describe block covering ticket items 9-14 (bid-0/ask-0/non-finite/crossed quote rejection, delta-closest-illiquid-but-second-eligible selection, delta-closest-one-sided-but-second-valid selection, no-candidate-when-all-fail, tie-break-by-OI).

### Validation

- `npx tsc --noEmit` — clean, zero errors (against real `tsconfig.json`/dependency graph in `~/build-workspace`).
- Targeted: `optionSymbol.test.ts` + `covered-call-capacity.test.ts` + `covered-call-finder.test.ts` — **64 tests, all passing** (11 + 30 + 23).
- Full suite: `npx vitest run --pool=threads --poolOptions.threads.maxThreads=4` — **102 test files, 1488 tests, all passing** (up from 101 files / 1456 tests in §13, reflecting this round's new tests plus the new `optionSymbol.test.ts` file).
- `npx next build` — succeeds.

### Scope discipline

Only `lib/optionSymbol.ts` (new), `lib/__tests__/optionSymbol.test.ts` (new), `lib/scans/covered-call-capacity.ts`, `lib/scans/covered-call-finder.ts`, `lib/scans/__tests__/covered-call-capacity.test.ts`, `lib/scans/__tests__/covered-call-finder.test.ts`, and this report were touched. No other TE-0007C files were modified beyond what §1-14 already covered. The rebase onto `main` @ `6586ef7` from §12 is preserved unchanged. Unrelated untracked files present in the working tree (`cc_zero_candidates_fix.sh`, `docs/reviews/portfolio-position-metrics-audit.md`, `mode_param_fix.sh`, `switch_to_filter_mode_fix.sh`, `te0007c_import_path_fix.sh`) were left untouched and excluded from this round's commit.

**Not pushed or merged**, per this round's explicit instruction. See final response for commit hash and changed-file list.

## 16. Final corrective pass — fail closed on unattributable exposure, surface conservative reservations

Commit `da65ca6` was NOT merged. §15 closed five safety gaps but left one boundary open and one disclosure gap: `normalizeShortCallExposure()` and `normalizeWorkingCallReservations()` still silently `continue`d past a short option/working order they could not attribute to ANY underlying at all, and `CoveredCallCapacity.hasUnclassifiedExposure` was computed but never surfaced in `app/screener/page.tsx`.

### Unclassified vs. unattributable — the categorical distinction

- **Underlying known, option type unknown** ("unclassified"): the position/leg IS attributed to a specific symbol via `resolveUnderlyingSymbol()`, but neither the broker's `option-type` field nor the OCC symbol could classify it as put/call. This is safe to handle per-symbol: reserve the quantity conservatively as a call (§15's existing behavior, unchanged) and set `hasUnclassifiedExposure: true` for that one symbol. The report stays `status: 'ok'` — only that symbol's disclosed, reduced capacity is affected.
- **Underlying unknown** ("unattributable"): `resolveUnderlyingSymbol()` itself returns `null` — no usable `underlying-symbol` field AND an absent/malformed/unparseable OCC symbol. There is no way to know which holding's capacity this short option or working order affects. No per-symbol fix is safe here, because the exposure could secretly belong to ANY symbol in the account. `normalizeShortCallExposure()`/`normalizeWorkingCallReservations()` now set `hasUnattributableExposure: true` and record a `warnings[]` entry instead of silently dropping the position/leg, and `buildCoveredCallCapacityReport()` fails the ENTIRE report closed (`status: 'unavailable'`, `bySymbol: {}`, `unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON`) — no holding is scanned while this is unresolved, not just the affected one.

Both functions still only reach the attribution check for genuinely relevant records: an option-instrument, Short-direction, positive-quantity position (for short-call exposure), or a Live/Working, Sell-to-Open, option-shaped leg with positive quantity (for working reservations). A malformed cancelled/rejected/expired/filled order, a buy-to-close leg, or a non-option leg never reaches attribution and never blocks the report.

### New UI warnings (`app/screener/page.tsx`)

- **Account-level blocking message**: when `getCoveredCallCapacityReport()` returns `status: 'unavailable'` with `unavailableReason` set, the new `ccUnavailableReason` state renders `UNATTRIBUTABLE_EXPOSURE_REASON` verbatim in the CC eligible-holdings card (replacing the ordinary "no eligible holdings loaded yet" copy, which would misrepresent a data-integrity failure as an empty result) and in the shared error banner. `runCcScan()` returns immediately in this state — no market-data fetch, no symbol scanned.
- **Per-symbol conservative-reservation disclosure**: symbol chips with `hasUnclassifiedExposure: true` render with an amber style, a `⚠` marker, and a tooltip; a summary warning line ("Some option exposure could not be classified. Available covered-call capacity was reduced conservatively.") appears below the chip list whenever any eligible holding has this flag. The same warning is repeated in the expanded CC candidate detail card via a new `SpreadCandidate.ccHasUnclassifiedExposure` field (wired from `CoveredCallCapacity.hasUnclassifiedExposure` in `covered-call-finder.ts`), since a candidate card can be viewed independently of the holdings card. Neither warning restores capacity — the reduced `availableCoveredContracts` number is what's shown and what caps the scan.

### New tests (all 12 required scenarios)

- `lib/scans/__tests__/covered-call-capacity.test.ts`, new `TE-0007C final corrective pass: fail closed on unattributable exposure` describe block: tests 1-8 and 11 (unattributable short option blocks the report; unattributable working STO blocks the report; malformed cancelled/rejected/expired/filled order does not block; malformed buy-to-close does not block; malformed non-option order does not block; known-underlying/unknown-type still reserves conservatively and stays usable; multiple valid holdings plus one unattributable short option/working order fails the ENTIRE report closed with no holding scanned; the prior round's OCC-only realistic fixture still passes).
- `app/screener/__tests__/CcCapacityGate.test.tsx` (new file): tests 9-10, rendering the real `app/screener/page.tsx` component (wrapped in the app's actual `TaskProvider`/`CommandProvider`) with `lib/scans/tastytrade-client`'s network boundary mocked. Test 9 mocks an unavailable/unattributable capacity report, clicks "SCAN ELIGIBLE HOLDINGS FOR CC", and asserts the blocking message renders, the "no eligible holdings" copy does NOT render, and `getMarketMetrics` is never called (no holding scanned). Test 10 mocks an `ok` report with one symbol carrying `hasUnclassifiedExposure: true`, and asserts the disclosure warning renders while the symbol chip remains clickable and shows the reduced (not restored) available-contracts count.
- Test 12 (all prior cost-basis/quote-quality/full-universe-selection regression tests remain passing) is satisfied by the full-suite run below, which includes every test from §15 unchanged.

### Validation

- `npx tsc --noEmit` — clean, zero errors.
- Targeted (optionSymbol + capacity + finder + new UI wiring test): **75 tests, all passing** (11 + 39 + 23 + 2).
- Full suite: `npx vitest run --pool=threads --poolOptions.threads.maxThreads=4` — **103 test files, 1499 tests, all passing** (up from 102 files / 1488 tests in §15 — the one new file plus the new capacity tests and existing-suite growth accounted for).
- `npx next build` — succeeds.

### Scope discipline

Touched: `lib/scans/covered-call-capacity.ts`, `lib/scans/covered-call-finder.ts`, `lib/scans/types.ts`, `lib/scans/tastytrade-client.ts` (two `CoveredCallCapacityReport` literals updated for the new required `warnings` field — no behavior change), `app/screener/page.tsx`, `lib/scans/__tests__/covered-call-capacity.test.ts`, `app/screener/__tests__/CcCapacityGate.test.tsx` (new), and this report. No other files modified. Unrelated untracked files (`cc_zero_candidates_fix.sh`, `docs/reviews/portfolio-position-metrics-audit.md`, `mode_param_fix.sh`, `switch_to_filter_mode_fix.sh`, `te0007c_import_path_fix.sh`) remain untouched and excluded from this round's commit.

**Not pushed or merged.** See final response for commit hash and changed-file list.
