# ES-0002 — Pending-Order Replacement Safety — Implementation Report

Status: **PRODUCT OWNER REVIEW APPROVED.** Complete on branch `feature/pending-order-replacement-safety`. Not yet merged into `main`.

## 0. Pre-flight verification

- Current branch: `feature/pending-order-replacement-safety`.
- `HEAD` (`d2a3797`) and `main` (`d2a3797`) are identical — this branch has no commits beyond `main`'s tip yet; all ES-0002 work exists as uncommitted working-tree changes.
- Working tree was clean before any edit (`git status` confirmed "nothing to commit, working tree clean" prior to this session's changes).
- `main` at branch creation is `d2a3797` ("docs: remove obsolete autopilot project status"), matching the required starting point.
- All required pre-flight reading completed: `docs/design/ES-0001-Live-Close-Order-Safety.md`, `docs/reviews/ES-0001-Closeout-Report.md`, `docs/reviews/ES-0001-Implementation-Report.md`, `lib/portfolio/closeOrderSafety.ts`, `lib/portfolio/closeOrderSubmission.ts`, both ES-0001 test files, the `PendingOrder`/`PendingOrderLeg` types, `buildReplaceOrder`, `replacePendingOrder`, the `PendingOrderCard`/`PendingOrdersSection` UI, and a repository-wide `grep` of every `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete` call site (see `docs/reviews/ES-0002-Broker-Submission-Inventory.md`).
- Note: `.git/index.lock` (a stale, zero-byte, unremovable-by-this-session artifact) was present but did not block any `git` read command used during pre-flight or validation; no `git` write operation was attempted at any point in this session (per the "do not push/commit/merge unless authorized" instruction).

## 1. Architecture summary

Two new framework-free library modules, matching ES-0001's discipline but modeling a deliberately different evidence shape (a pending order has no fill economics, so this is not a `CanonicalCloseIdentity` workflow — see the design doc's rationale):

- `lib/portfolio/pendingOrderReplacementSafety.ts` — evidence types, `buildPendingOrderReplacementPlan`, `buildPendingOrderRestorePlan`, `runPendingOrderReplacementSafetyGate`, `runPendingOrderRestoreSafetyGate`, 16 stable rule IDs, all hard blocks.
- `lib/portfolio/pendingOrderReplacementSubmission.ts` — `submitPendingOrderReplacementIfSafe`, `submitPendingOrderRestoreIfSafe` (broker-boundary wrappers, mirroring `closeOrderSubmission.ts`'s `submitCloseOrderIfSafe` shape), and `runPendingOrderReplacementWorkflow` (the full cancel → pre-cancel-guard → replace → restore-on-failure orchestration, extracted from `page.tsx` so its ordering guarantees are independently testable with mocked cancel/post functions).
- `app/portfolio/page.tsx`'s `replacePendingOrder` is now a thin adapter supplying real `ttDelete`/`ttPost`/`buildReplaceOrder` as dependency-injected `deps` to `runPendingOrderReplacementWorkflow`, plus two small pure mapping helpers (`toPendingOrderEvidence`, `toActualReplacementEvidence`).

The literal `ttPost` call for both replacement and restore exists only inside the guarded callback passed to `submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe` respectively — there is no `ttPost` statement in the pending-order-replace path that sits outside that boundary. `ttDelete` remains cancellation-only, but a deterministic, no-network-I/O plan-build (`buildPendingOrderReplacementPlan`) runs before it, so a known-invalid request never cancels a good resting order for nothing.

## 2. Exact files changed

**Added:**
- `lib/portfolio/pendingOrderReplacementSafety.ts`
- `lib/portfolio/pendingOrderReplacementSubmission.ts`
- `lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts` (35 tests)
- `lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts` (23 tests)
- `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`
- `docs/reviews/ES-0002-Broker-Submission-Inventory.md`
- `docs/reviews/ES-0002-Implementation-Report.md` (this file)

**Modified:**
- `app/portfolio/page.tsx` — new imports (`PendingOrderEvidence`, `ActualReplacementOrderEvidence` types, `runPendingOrderReplacementWorkflow`); two new pure adapter functions (`toPendingOrderEvidence`, `toActualReplacementEvidence`) added immediately after `buildReplaceOrder`; `replacePendingOrder` rewritten to delegate to `runPendingOrderReplacementWorkflow` and map its discriminated result onto `setError`/`fetchPositions`/UI state. No other function in this file was touched. `buildReplaceOrder` itself is unchanged (its historical `?? 'Credit'` fallback is now unreachable dead code on any path the new gate has already approved — see the design doc's "One intentional behavior change" section).
- `planning/SPRINT_STATUS.md`, `docs/roadmap/ROADMAP.md`, `docs/HANDOFF.md` — status updates; at initial implementation these described ES-0002 as awaiting Product Owner review, later revised at closeout (see §12) to reflect Product Owner approval; no merge claim; ES-0001's historical status entries left unmodified.
- `tsconfig.tsbuildinfo` — auto-regenerated by `tsc --noEmit`; not a substantive change (same harmless 1-line diff noted in every prior ticket's report).

**Not modified (considered, decision recorded):**
- `calculateSpreadCredit` (`app/portfolio/page.tsx:1947`) — still referenced at `app/portfolio/page.tsx:2672`; deletion was optional and only permitted if zero references were proven, so it was left untouched.
- `app/rinse-repeat/page.tsx` — a second unguarded live-order submission path was discovered here during the mandatory repository-wide inventory (see `docs/reviews/ES-0002-Broker-Submission-Inventory.md`, item 11). Per the sprint's explicit stop condition, this is documented, not fixed, and not silently folded into this ticket's scope.

## 3. Requirements-to-code mapping

| Requirement | Implementation |
|---|---|
| Order identity (id/account/legs exist) | `validateEvidence` → `PENDING_ORDER_ID_MISSING`, `ACCOUNT_NUMBER_MISSING`, `REPLACEMENT_LEGS_MISSING` |
| Leg identity preservation, order-independent | `crossCheckLegs` in `pendingOrderReplacementSafety.ts` — symbol-keyed matching with a `consumed` set, independent of array order |
| Price validation (finite, positive, tick, points-only) | `validatePrice` → `REPLACEMENT_LIMIT_PRICE_INVALID`, `REPLACEMENT_LIMIT_TICK_INVALID`; `isTickValid` duplicated locally (not imported) to keep the module independent of `closeOrderSafety.ts` |
| Actual payload price validity (finite, positive, cent-denominated) | `REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID` hard-blocks a missing/`NaN`/`Infinity`/non-positive/sub-penny actual payload price *before* any comparison runs |
| Payload limit price exact match | `REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH` — exact integer-cent comparison (`Math.round(price * 100)`), no float tolerance; an exact one-cent difference is rejected |
| Price-effect preservation, never inferred from sign or defaulted | `REPLACEMENT_PRICE_EFFECT_INVALID` blocks a missing/garbage original effect instead of defaulting; `REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID` hard-blocks a missing/garbage actual payload price effect (never defaults to `'Debit'` or anything else) before comparison; `REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH` cross-checks the payload against the plan |
| Quantity integrity | `REPLACEMENT_QUANTITY_INVALID` (build-time, per leg) and `REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH` (cross-check) |
| Actual-payload cross-check, no separate rebuild | `toActualReplacementEvidence` reads evidence back out of the exact `OrderBody` object passed to `ttPost` |
| Replacement and restore separately validated; restore reuses original price only | `buildPendingOrderReplacementPlan` vs. `buildPendingOrderRestorePlan`; `RESTORE_PRICE_UNAVAILABLE` blocks rather than substituting `newPrice` |
| Restoration reuses the same safety boundary | `submitPendingOrderRestoreIfSafe` has the identical fail-closed shape as `submitPendingOrderReplacementIfSafe` |
| Cancellation semantics (pre-cancel validation before `ttDelete`) | `runPendingOrderReplacementWorkflow` calls `buildPendingOrderReplacementPlan` before `deps.cancelExistingOrder()` |
| Every failure is a hard block | `SafetyCheckIssue.severity` is typed as the literal `'block'` — no union, no warn path exists in the type system |
| No fabricated quote requirement | No quote field exists anywhere in this module's types — documented as an explicit non-goal in the design doc, not a silent omission |
| Broker-boundary requirement (`ttPost` only inside the callback) | `submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe`; `page.tsx`'s `postOrder` dependency is the only place `ttPost` is called for this path, and it is only ever invoked from inside those two functions |

## 3a. Corrective Round Addendum (post-review, pre-approval)

A Product Owner code review, conducted before approval, found two blocking safety defects in the actual-broker-payload adapter/gate:

1. `toActualReplacementEvidence` could implicitly default a missing broker payload price effect to `'Debit'`, masking a genuinely missing value as a false match or false mismatch instead of a hard block.
2. The prior price comparison used `parseFloat` (which can yield `NaN` for a malformed/missing price) and a float-tolerance mismatch check (`Math.abs(actual - planned) > tolerance`), which evaluates `false` — and therefore silently passes — when `actual` is `NaN`. The same tolerance-based approach also could not reject an exact one-cent drift, since a 1-cent difference sat inside the tolerance band.

Both were fixed: `ActualReplacementOrderEvidence.priceEffect` is now typed as the raw, unvalidated `string | null | undefined` (never assumed to be `'Credit'`/`'Debit'`), and the gate hard-blocks anything that is not exactly one of those two values (`REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID`) before checking for a mismatch. The actual payload price is now explicitly validated as finite, positive, and cent-denominated (`REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID`) before any comparison, and price equality is now an exact integer-cent comparison (`Math.round(price * 100)`) — no tolerance — so an exact one-cent difference is rejected, not accepted.

Ten new tests were added to `pendingOrderReplacementSafety.test.ts` (25 → 35) and eight to `pendingOrderReplacementSubmission.test.ts` (15 → 23), covering: missing price, malformed price, `NaN` price, `Infinity` price, missing price effect on both a Credit plan and a Debit plan (the critical case — proving no false pass), invalid/wrong-case price effect, and an exact one-cent price drift. All 58 ES-0002 tests and all 65 ES-0001 regression tests pass after the fix (reconfirmed again at closeout — see the Closeout Addendum below). No files were modified outside `lib/portfolio/pendingOrderReplacementSafety.ts` and the two ES-0002 test files during this corrective round.

## 4. Requirements-to-test mapping

All 17 required test scenarios from the sprint instructions are covered:

| # | Scenario | Test file / test name |
|---|---|---|
| 1 | Valid plan preserves exact legs/quantities/actions/effect, literal 0.35 | `pendingOrderReplacementSafety.test.ts` — "preserves exact legs, quantities, actions, and price effect..." |
| 2 | 0.35 stays 0.35, never 35/0.0035 | same file — "never scales, floors, or multiplies the requested price" |
| 3 | Rejects NaN/Infinity/zero/negative/bad-tick/missing-legs/zero-qty/fractional-qty/missing-identity | same file, "hard blocks" `describe` block (7 tests) |
| 4 | Hard-blocks payload mismatches incl. exact 100x fixture | same file, "actual-payload cross-check" `describe` block (9 tests, incl. the literal 30-vs-0.30 fixture) |
| 5 | Leg comparison correct with reordered-but-equivalent legs | same file — "leg comparison is order-independent" |
| 6 | Restore planning: literal original price, blocks on unavailable/invalid original | same file, "buildPendingOrderRestorePlan" `describe` block (4 tests) |
| 7 | Invalid replacement: broker mock not called | `pendingOrderReplacementSubmission.test.ts`, "submitPendingOrderReplacementIfSafe -- invalid input" (3 tests) |
| 8 | Valid replacement: broker mock called once with exact payload | same file, "submitPendingOrderReplacementIfSafe -- valid input" |
| 9 | Invalid restore: broker mock not called | same file, "submitPendingOrderRestoreIfSafe -- invalid input" (2 tests) |
| 10 | Valid restore: broker mock called once, original price/legs/effect | same file, "submitPendingOrderRestoreIfSafe -- valid input" |
| 11 | Exact 100x mismatch: broker mock not called | same file, "exact 100x mismatch reaches this boundary too" |
| 12 | Mutated payload after plan construction: broker mock not called | same file, "does not call the broker when the payload was mutated after plan construction" |
| 13 | Known-invalid `newPrice` rejected before cancellation | same file, workflow test "(13) rejects a known-invalid newPrice BEFORE cancellation" — asserts both the cancel mock and post mock were never called |
| 14 | Valid input: cancellation before replacement submission | same file, "(14) for valid input, cancellation happens before the replacement post" — asserts call order via a shared array |
| 15 | Replacement post fails after successful cancel → restore only through the boundary | same file, "(15)" and "(15b)" (restore succeeds; restore blocked when original price unavailable) |
| 16 | Replacement post succeeds → restore never attempted | same file, "(16) when the replacement post succeeds, restore is never attempted" |
| 17 | Cancellation fails → neither replacement nor restore post attempted | same file, "(17) when cancellation fails, neither the replacement nor the restore post is attempted" |

Every broker-boundary/workflow test uses a real `vi.fn()` mock and asserts `not.toHaveBeenCalled()` / `toHaveBeenCalledTimes(n)` — reachability is proven, not inferred from a helper's boolean return.

## 5. Broker inventory findings

See `docs/reviews/ES-0002-Broker-Submission-Inventory.md` for the full table. Summary: of 11 total `ttPost`/`ttPostComplex`/`ttValidateOrder`/`ttDelete` call sites repository-wide, the two this ticket targets (`replacePendingOrder`'s replacement and restore submissions) are now guarded; one new, unrelated, unguarded live submission path was discovered (`app/rinse-repeat/page.tsx`'s OTOCO entry submission) and is documented, not fixed, per the sprint's explicit stop condition on silently expanding scope.

## 6. Commands run

```
git branch --show-current
git status / git status --short
git fetch origin ...        (failed: no credentials in this sandbox -- expected, matches prior tickets)
git log --oneline -15
git merge-base --is-ancestor d2a3797 HEAD
git cat-file -t d2a3797
npx vitest run lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts
npx vitest run lib/portfolio/__tests__/closeOrderSafety.test.ts lib/portfolio/__tests__/closeOrderSubmission.test.ts
npx tsc --noEmit
npx vitest run <11 directory batches, listed below>
npm run build
git diff --check
git diff --stat
git status --short
```

## 7. Test counts

- **New ES-0002 targeted tests**: 58/58 passing (`pendingOrderReplacementSafety.test.ts` — 35; `pendingOrderReplacementSubmission.test.ts` — 23; includes the 18 corrective-round tests described in §3a).
- **ES-0001 regression check**: 65/65 passing, unchanged (`closeOrderSafety.test.ts` — 46; `closeOrderSubmission.test.ts` — 19).
- **Full repository suite**: run in 11 directory-batch shards at the time of initial implementation (this sandbox's ~45-second per-command execution ceiling is the same pre-existing, documented limitation noted in every prior ticket's report) — **66 test files, 984 tests, 0 failures.** This full-repo figure predates the 18 corrective-round tests added in §3a and was not independently re-run at closeout (closeout validation re-ran only the two ES-0002/ES-0001 targeted suites above, per the closeout procedure's exact scope — see `planning/SPRINT_STATUS.md` for the closeout's own validation record). Batch breakdown (as originally measured):

| Batch | Directories | Files | Tests |
|---|---|---|---|
| 1 | `app/api/paper-trading`, `components/paper-trading` | 2 | 27 |
| 2 | `features/portfolio/{briefing,dailyBriefing,decisionReview}` | 8 | 73 |
| 3 | `features/portfolio/components` | 2 | 35 |
| 4 | `features/portfolio/{intelligence,priorities,review}`, `components/opportunity-engine` | 6 | 73 |
| 5 | `lib/__tests__`, `lib/autopilot/{decision,scoring}`, `lib/dailyBriefing` | 6 | 86 |
| 6 | `lib/decision-engine`, `lib/decision-review`, `lib/opportunity-engine` | 7 | 130 |
| 7 | `lib/paper-trading` | 11 | 155 |
| 8 | `lib/portfolio-intelligence` | 13 | 197 |
| 9 | `lib/portfolioHealth`, `lib/portfolioReview`, `lib/position-snapshot` | 3 | 42 |
| 10 | `lib/positionValuation`, `lib/priorityScore`, `lib/todaysPriorities`, `lib/tradeLog` | 4 | 61 |
| 11 | `lib/portfolio/__tests__` (closeOrderSafety, closeOrderSubmission, pendingOrderReplacementSafety, pendingOrderReplacementSubmission) | 4 | 105 |
| **Total** | | **66** | **984** |

This total is not being reconciled against any single prior ticket's repo-wide figure (each prior ticket recorded its own count at its own point in time, e.g. ES-0001's 944, PT-0001's 879 — the codebase has grown since); it is reported as today's freshly-measured, zero-failure baseline.

## 8. Type-check / build results

- `npx tsc --noEmit` — **clean, 0 errors.**
- `npm run build` — attempted once. Output: Next.js prints its startup banner (`▲ Next.js 14.2.35 - Environments: .env.local`) and produces no further output before the 42-second cap elapsed — the identical, pre-existing "hangs at the initial banner" sandbox limitation documented in every prior ticket (PI-0014, OE-0001, PT-0001, ES-0001). **Not treated as a pass or a failure; not retried**, per the established convention that Vercel remains the authoritative build check for this repository.
- `git diff --check` — clean (no whitespace errors).

## 9. Known limitations

- The non-atomic cancel/recreate window (TastyTrade has no atomic order-replace) is an unavoidable, disclosed risk — see the design doc's "Cancellation risk" section. ES-0002 minimizes it (pre-cancel validation, gated restore) but cannot eliminate it.
- No quote/marketability validation exists for this workflow, by design (see "Quote-validation decision" in the design doc) — ES-0002 guarantees payload identity and requested-price integrity, not fair-value pricing.
- `app/rinse-repeat/page.tsx`'s unguarded OTOCO entry submission (broker inventory item 11) remains open and requires an explicit Product Owner scoping decision — not resolved by this ticket.
- `calculateSpreadCredit` remains in `app/portfolio/page.tsx`, still referenced once, unchanged from ES-0001's closeout finding (TD-2) — deletion remains out of scope until that reference is itself resolved.
- Local production build verification remains subject to the same pre-existing sandbox limitation as every prior ticket; Vercel is the authoritative check.

## 10. Deviations from the proposed design

- The sprint's "possible structure" suggested `lib/portfolio/pendingOrderReplacementSafety.ts` and `lib/portfolio/pendingOrderReplacementSubmission.ts` — both names were kept exactly as proposed.
- One addition beyond the minimum-suggested shape: `runPendingOrderReplacementWorkflow` (the full cancel/replace/restore orchestration) was extracted into `pendingOrderReplacementSubmission.ts` rather than left inline in `page.tsx`, specifically to make the workflow-level ordering requirements (tests 13–17) independently unit-testable with mocked cancel/post functions instead of requiring a much heavier React-component-level test harness for a 14,000-line client page. This is the "focused extraction from page.tsx when needed for independent unit testing" the sprint scope explicitly allows.
- One intentional, disclosed behavior change from the pre-existing code: `buildReplaceOrder`'s silent `?? 'Credit'` price-effect fallback and the pre-existing restore's silent `order.limitPrice ?? newPrice` fallback are both now unreachable/removed in practice, replaced by hard blocks (`REPLACEMENT_PRICE_EFFECT_INVALID`, `RESTORE_PRICE_UNAVAILABLE`). See the design doc's "One intentional behavior change" section for full rationale — this is required by the sprint's explicit prohibition on silent unsafe substitution, not an incidental side effect.

## 11. Statement

This work is complete as scoped. The corrective round in §3a addressed both blocking defects the Product Owner found in review. The Product Owner has since reviewed and **approved** ES-0002. Per the sprint's closeout procedure, the work is committed and pushed to `feature/pending-order-replacement-safety` but not yet merged into `main` — that remains a separate, explicit Product Owner merge decision.

## 12. Closeout Addendum

- Re-validated at closeout: `pendingOrderReplacementSafety.test.ts` + `pendingOrderReplacementSubmission.test.ts` — 58/58 passing; `closeOrderSafety.test.ts` + `closeOrderSubmission.test.ts` (ES-0001 regression) — 65/65 passing, unchanged; `npx tsc --noEmit` clean; `git diff --check` clean.
- The generated `tsconfig.tsbuildinfo` artifact was restored to its committed state (`git restore tsconfig.tsbuildinfo`) before commit, per standing repository convention of not committing this generated file's incidental diffs.
- Exactly 11 files were staged and committed: `app/portfolio/page.tsx`, `lib/portfolio/pendingOrderReplacementSafety.ts`, `lib/portfolio/pendingOrderReplacementSubmission.ts`, `lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts`, `lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts`, `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`, `docs/reviews/ES-0002-Broker-Submission-Inventory.md`, `docs/reviews/ES-0002-Implementation-Report.md`, `docs/HANDOFF.md`, `docs/roadmap/ROADMAP.md`, `planning/SPRINT_STATUS.md`.
- Committed and pushed to `origin/feature/pending-order-replacement-safety`. Not merged into `main`. Branch not deleted.
