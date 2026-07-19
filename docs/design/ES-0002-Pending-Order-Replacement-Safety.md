# ES-0002 — Pending-Order Replacement Safety

Status: **PRODUCT OWNER REVIEW APPROVED.** Complete on branch `feature/pending-order-replacement-safety`, created from `main` at `d2a3797`. Not yet merged into `main`. See `docs/reviews/ES-0002-Implementation-Report.md` for exact git state and validation results.

Closes ES-0001 Closeout Technical Debt TD-1 (`docs/reviews/ES-0001-Closeout-Report.md`, Technical Debt Register): the one live, user-reachable order-submission path the ES-0001 closeout review found still bypassing that ticket's safety architecture entirely.

## Problem statement

ES-0001 (`docs/design/ES-0001-Live-Close-Order-Safety.md`, `docs/reviews/ES-0001-Closeout-Report.md`) built a hard-blocking safety boundary for every live close, roll, and stop-loss order submission in `app/portfolio/page.tsx`, and proved by inspection and by broker-mock tests that none of those six call sites can reach `ttPost`/`ttPostComplex` without first passing `guardAgainstAmbiguousStructure` and `runLiveCloseOrderSafetyGate`. The ES-0001 closeout review's architectural audit (`docs/reviews/ES-0001-Closeout-Report.md` §1, Technical Debt Register item TD-1) found a seventh live-order path outside that boundary entirely: `replacePendingOrder` (`app/portfolio/page.tsx`, wired to the Pending Orders card's Replace button), which reprices an already-placed pending GTC/stop entry order by cancelling it (`ttDelete`) and resubmitting a plain order at a caller-supplied new price (`ttPost`) — with no tick validation, no leg-identity check, no quantity check, and no cross-check between what was intended and what was actually submitted.

## Current failure path (pre-ES-0002)

1. The operator types a new limit price into the Pending Orders card and clicks Confirm Replace. The only validation was UI-level (`parsedNewPrice > 0`, not equal to the current price) — nothing checked tick granularity, leg identity, or price effect.
2. `replacePendingOrder(order, newPrice)` calls `ttDelete` on the existing complex order immediately, with no pre-cancel validation of `newPrice` beyond what the UI already allowed through.
3. `buildReplaceOrder(order, newPrice)` builds a plain order body from `order`'s broker-sourced legs at `newPrice`, defaulting `price-effect` to `'Credit'` if the original order's price effect was ever missing (`(order.priceEffect as 'Debit' | 'Credit') ?? 'Credit'`) — a silent, unvalidated fallback.
4. That order body is passed directly to `ttPost`, with no cross-check that the object actually posted matches anything that was validated (nothing was validated).
5. If the replacement `ttPost` throws after the cancel already succeeded, the recovery path resubmitted `buildReplaceOrder(order, order.limitPrice ?? newPrice)` — silently substituting the failed replacement's `newPrice` for the original price if `order.limitPrice` was ever missing, which could resubmit an order at a price the operator never intended and never approved.

None of this touches `analyzePositionStructure`, `runLiveCloseOrderSafetyGate`, or `submitCloseOrderIfSafe` — it long predates ES-0001 and was never in that ticket's scope.

## Evidence available to pending-order replacement

A `PendingOrder` (`app/portfolio/page.tsx`) is a broker-sourced, **unfilled opening order** — the trigger leg of an OTOCO/OCO that has not filled yet. It carries:

- `id` (the complex-order id), `accountNumber`, `symbol` (underlying, diagnostics only);
- `legs: PendingOrderLeg[]` — `symbol`, `action` (e.g. `'Sell to Open'`), `quantity`, each broker-sourced;
- `limitPrice: number | null` and `priceEffect: string | null` — the order's own original values;
- `orderType`, `timeInForce`, `status`, `createdAt`.

It has **no `avgOpenPrice`, no fill, and no realized-P/L economics** — there is nothing to compute a credit/debit entry identity from, because nothing has been entered into yet.

## Why this is not automatically a CanonicalCloseIdentity workflow

`closeOrderSafety.ts`'s `CanonicalCloseIdentity`/`ClosePlan` model is built entirely around **closing an existing filled position**: signed entry economics (`entryPricePointsPerUnit`, `entryPriceEffect`), a break-even mirror, and an expected realized P/L cross-checked against a live quote. A pending order has none of that evidence — forcing it through that model would require inventing an entry price, a price-effect-vs-P&L relationship, and (per ES-0001's required quote evidence) a bid/ask quote acquisition this workflow does not perform and has no established convention for on an *unfilled* multi-leg entry order. Fabricating any of that to reuse `runLiveCloseOrderSafetyGate` would violate the sprint's explicit prohibition on manufactured identity or quote evidence, and would validate the wrong thing: a pending-order Replace is not a close, it is a **repricing of a resting entry order**, and the correct safety question is "does the broker payload exactly match what was intended," not "does this realize the correct P/L."

ES-0002 therefore introduces the smallest truthful safety model for the evidence this workflow actually has.

## Chosen architecture

Two new framework-free modules, matching ES-0001's discipline (deterministic plan builder → hard-blocking gate → thin broker-boundary wrapper), deliberately independent of `closeOrderSafety.ts`/`closeOrderSubmission.ts`:

- **`lib/portfolio/pendingOrderReplacementSafety.ts`** — `PendingOrderEvidence` (the broker-sourced order, mapped from `PendingOrder`), `buildPendingOrderReplacementPlan(evidence, requestedPrice)`, `buildPendingOrderRestorePlan(evidence)`, `runPendingOrderReplacementSafetyGate(input)`, `runPendingOrderRestoreSafetyGate(input)`. 16 stable rule IDs, all `severity: 'block'`.
- **`lib/portfolio/pendingOrderReplacementSubmission.ts`** — `submitPendingOrderReplacementIfSafe(gateInput, submitToBroker)`, `submitPendingOrderRestoreIfSafe(gateInput, submitToBroker)` (the broker-boundary wrappers), and `runPendingOrderReplacementWorkflow(evidence, requestedPrice, deps)` — the full cancel/replace/restore orchestration, extracted from `app/portfolio/page.tsx`'s `replacePendingOrder` so its ordering guarantees are independently unit-testable with mocked cancel/post functions rather than verified only by inspection.
- `app/portfolio/page.tsx`'s `replacePendingOrder` is now a thin adapter: it supplies the real `ttDelete`/`ttPost`/`buildReplaceOrder` implementations as `deps` to `runPendingOrderReplacementWorkflow` and maps the returned discriminated result onto `setError`/`fetchPositions`/UI state. Two small pure adapters, `toPendingOrderEvidence` and `toActualReplacementEvidence`, map `page.tsx`'s own `PendingOrder`/`OrderBody` types into the library's plain interfaces (matching `closeOrderSubmission.ts`'s `AmbiguityGuardInput` pattern of not importing page-level types into the library).

## Safety rules

| Rule ID | Checks |
|---|---|
| `PENDING_ORDER_ID_MISSING` | Broker order id is present. |
| `ACCOUNT_NUMBER_MISSING` | Account number is present. |
| `REPLACEMENT_LEGS_MISSING` | At least one leg exists; every leg has a symbol and action. |
| `REPLACEMENT_QUANTITY_INVALID` | Every leg quantity is a positive integer (guards corrupted broker data). |
| `REPLACEMENT_PRICE_EFFECT_INVALID` | The order's original price effect is exactly `'Credit'` or `'Debit'` — **never defaulted**, unlike the pre-existing `buildReplaceOrder`'s `?? 'Credit'` fallback (see Deviation below). |
| `REPLACEMENT_LIMIT_PRICE_INVALID` | Requested price is finite and positive. |
| `REPLACEMENT_LIMIT_TICK_INVALID` | Requested price is cent-denominated (same convention as `closeOrderSafety.ts`'s `isTickValid`, duplicated rather than imported to keep this module independent). |
| `REPLACEMENT_LEG_IDENTITY_MISMATCH` | The actual broker payload's leg set (by OCC symbol, order-independent) exactly matches the plan — no missing, duplicated, or extra legs. |
| `REPLACEMENT_LEG_ACTION_MISMATCH` | A leg matched by symbol has the same broker action as the plan. |
| `REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH` | A leg matched by symbol has the same quantity as the plan. |
| `REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID` | The actual broker payload's limit price is missing, non-finite (`NaN`/`Infinity`), non-positive, or not cent-denominated — hard-blocks before any comparison is attempted, so a malformed price can never silently pass. |
| `REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH` | The actual payload's limit price, compared to the plan as integer cents (`Math.round(price * 100)`), matches **exactly** — no float tolerance. An exact one-cent difference is rejected, not accepted; this is also the check that catches a 100x unit defect. |
| `REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID` | The actual broker payload's price effect is missing, `null`, or anything other than exactly `'Credit'` or `'Debit'` — hard-blocks before comparison, so a missing price effect is never silently treated as a match or default. |
| `REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH` | The actual payload's price effect matches the plan exactly. |
| `RESTORE_PRICE_UNAVAILABLE` | The original order's own limit price exists and is valid — restore never substitutes any other value. |
| `RESTORE_PLAN_INVALID` | Wraps any other structural failure encountered while building a restore plan (missing legs/identity), distinguishing "price problem" from "evidence problem." |

Every rule is `severity: 'block'`. There is no warn-only path.

## Replacement lifecycle

1. Map the broker-sourced `PendingOrder` to `PendingOrderEvidence` (pure).
2. **Pre-cancel guard**: `buildPendingOrderReplacementPlan(evidence, newPrice)` — pure, synchronous, no network I/O. If this blocks, `ttDelete` is never called.
3. `ttDelete` cancels the existing complex order (cancellation-only, see below).
4. Build the exact broker order body once (`buildReplaceOrder`), read the actual-payload cross-check evidence back out of that same object, and pass both to `submitPendingOrderReplacementIfSafe`. The literal `ttPost` call exists only inside that function's guarded callback.
5. If the gate blocks, the callback never runs and `ttPost` is never reached.

## Restore lifecycle

Triggered only when the replacement submission fails **after** the cancel already succeeded. `buildPendingOrderRestorePlan(evidence)` always uses the original order's own `limitPrice` — never the failed replacement's `newPrice`, and never a silent substitution when the original price is missing or invalid (`RESTORE_PRICE_UNAVAILABLE` blocks instead, and the operator is told plainly that the order was cancelled and must be re-entered manually). Restoration is submitted through the identical `submitPendingOrderRestoreIfSafe` boundary — not a lesser-validated path.

## Cancellation risk (non-atomic cancel/recreate)

TastyTrade has no atomic order-replace. `ttDelete` is cancellation-only and is not itself economically validated — but this design ensures **all deterministic, no-network-I/O validation of the replacement runs before `ttDelete`**, so a known-invalid request never cancels a perfectly good resting order for nothing. The unavoidable risk that remains: between a successful cancel and a successful replacement/restore post, the account genuinely has no resting order at all. This is a pre-existing risk in the broker's own API shape, not something ES-0002 can eliminate — it is mitigated (not removed) by running the pre-cancel guard first and by the automatic, gated restore attempt.

## Payload identity guarantees

The exact object read for the actual-payload cross-check (`toActualReplacementEvidence`) is derived from the **same object literally passed to `ttPost`**, never a separately reconstructed approximation — matching the sprint's requirement that the validated object and the submitted object cannot be two different references.

## Points-versus-dollars discipline

This workflow only ever validates a single points-denominated limit price per submission; there is no per-contract/whole-position dollar computation anywhere in this model (unlike `closeOrderSafety.ts`, which must convert points to dollars for P/L). `REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH`'s literal-value test fixture (validated `0.30`, payload `30`) exists specifically to guard against a 100x conflation being introduced later, mirroring the exact defect class ES-0001 fixed.

## Quote-validation decision

**No quote evidence is required or acquired.** This workflow does not have, and this ticket does not build, a quote-acquisition convention for an unfilled multi-leg opening order (unlike `fetchCloseQuote`'s established bid/ask-netting convention for an already-open position). Per the sprint's explicit instruction not to fabricate quote requirements or pass synthetic quote data merely to satisfy a type shape, ES-0002 guarantees **payload identity and requested-price integrity** — the broker never receives a different price, price effect, leg set, or quantity than what was validated — but does **not** guarantee the requested price is currently marketable or fair value. That remains an explicit, disclosed non-goal.

## Explicit non-goals

- Redesigning the Pending Orders UI beyond what was already there (price input, Confirm/Back).
- Any quote/marketability check.
- Debit-opened position support (not applicable — a pending order has no entry fill).
- Branded `Points`/`Dollars` types (tracked separately as ES-0001 Closeout TD-3, not part of this ticket).
- Replacing TastyTrade APIs, changing live/paper mode, or touching Opportunity Engine/Portfolio Intelligence.
- Broad refactoring of `app/portfolio/page.tsx` beyond the extraction needed for independent testing.
- Deleting `calculateSpreadCredit` — direct inspection (`grep -rn calculateSpreadCredit`) found it is still referenced at `app/portfolio/page.tsx:2672` (a `Position.creditReceived` display computation, unrelated to this ticket), so removal is **not** demonstrably safe and was left untouched, per the sprint's explicit "only if zero references" condition.

## One intentional behavior change (documented, not silent)

The pre-existing `buildReplaceOrder`'s `(order.priceEffect as 'Debit' | 'Credit') ?? 'Credit'` fallback is **not** preserved as a safety-relevant default. `buildPendingOrderReplacementPlan`/`buildPendingOrderRestorePlan` hard-block (`REPLACEMENT_PRICE_EFFECT_INVALID`) before `buildReplaceOrder` is ever called for a real submission, so that fallback is unreachable dead code on any path this ticket's gate has already approved. A pending order whose original price effect cannot be determined can no longer be replaced or restored automatically — it must be handled manually at the broker. This is a deliberate hardening, not an oversight, and is called out here for Product Owner visibility since it changes user-facing behavior for that one edge case.

## Post-review corrective fix (before Product Owner approval)

A Product Owner code review found two blocking defects in the actual-broker-payload adapter/gate before approval was given, both now fixed:

1. **Price-effect defaulting.** `toActualReplacementEvidence` previously typed and could implicitly treat a missing broker payload price effect as `'Debit'`. It now passes the raw, unvalidated value (`string | null | undefined`) straight through, and the gate hard-blocks (`REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID`) anything that is not exactly `'Credit'` or `'Debit'` — a missing or garbage price effect can never be silently treated as a match.
2. **`NaN`-masking and float-tolerance price comparison.** `parseFloat` on a malformed or missing payload price can produce `NaN`, and the prior `Math.abs(actual - planned) > tolerance` comparison evaluates `false` for `NaN` inputs, silently passing a malformed price. The gate now explicitly validates the actual payload price is finite, positive, and cent-denominated (`REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID`) before any comparison runs, and price equality is now an exact integer-cent comparison (`Math.round(price * 100)`) rather than a float tolerance — an exact one-cent difference is rejected, not accepted.

Regression coverage for both fixes (missing price, malformed price, `NaN`/`Infinity` price, missing price effect on both Credit and Debit plans, invalid price effect, exact one-cent price drift) was added to `lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts` and `lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts`. See "Testing strategy" below for updated counts.

## Acceptance criteria

- An unsafe replacement cannot reach `ttPost` (proven with a broker mock).
- An unsafe restore cannot reach `ttPost` (proven with a broker mock).
- A valid replacement reaches `ttPost` exactly once.
- A valid restore reaches `ttPost` exactly once, only when replacement fails after a successful cancel.
- The actual broker payload is the payload that was validated (same object reference, not rebuilt).
- Price units remain points; a 0.35-point request never becomes 35 or 0.0035 anywhere in the payload.
- Leg identity/action/quantity, price, and price effect cannot drift between validation and submission.
- `ttDelete` remains cancellation-only; pre-cancel validation runs before it.
- No fabricated quote/identity evidence.
- No regression to ES-0001's close/roll/stop-loss paths (65/65 tests still passing, confirmed in the implementation report).

## Testing strategy

Literal-expected-value tests throughout (no re-derivation of the value under test), matching the ES-0001 house style: pure plan/gate tests in `lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts` (35 tests — valid-plan preservation, the exact 100x defect fixture, every hard-block rule including the corrective-round invalid-actual-payload-price and invalid-actual-payload-price-effect blocks, order-independent leg matching, restore-price-unavailable), broker-boundary tests with `vi.fn()` in `lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts` (23 tests — reachability/non-reachability for both replacement and restore, including the corrective-round invalid-actual-payload regression tests), and workflow-level orchestration tests in the same file against the extracted `runPendingOrderReplacementWorkflow` (pre-cancel rejection with the cancel mock never called, cancel-before-post ordering, restore-only-after-cancel-succeeds, no-restore-on-success, no-submission-when-cancel-fails). 58/58 passing. See `docs/reviews/ES-0002-Implementation-Report.md` for the full requirements-to-test mapping.
