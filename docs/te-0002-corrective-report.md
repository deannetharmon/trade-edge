# TE-0002 Corrective Round — Implementation Report

**Branch:** `fix/stop-loss-canonical-policy`
**Commit:** `2cad576` (on top of `eac2f46`, the original TE-0002 canonical-model commit)
**Scope:** Three focused corrections to the existing canonical `StopLossPolicy` model. No redesign — the six-state classification, breach-confirmation state machine, and pure/wiring/UI layering from the original implementation are unchanged.

## 1. OCO broker identity

**Defect.** The OCO submission handler persisted the parent complex-order envelope id as `StopLossPolicy.brokerOrderId`. Reload-time matching (`classifyPositionStopLoss`) compares against `GtcOrder.id`, which `mapGtcOrder` always populates from the *nested* stop leg's own id, never the parent's. Every OCO-submitted stop therefore failed its identity check on reload and fell to `UNKNOWN_PROVENANCE`/`TOO_TIGHT`, even when TradeEdge had just created it.

**Fix.**
- `StopLossPolicy` gained a second identity field, `complexOrderId: string | null`.
- `resolveOcoStopOrderId(complexOrderSubmissionResult)` (new, `lib/portfolio-data/acquisition.ts`) extracts both the parent complex-order id and the nested stop order's own id from a raw OCO submission response, using the *same* `collectRawOrders`/`mapGtcOrder`/`isStopOrder` parsing the reload path already applies to `GET /complex-orders` — so submit-time and reload-time identity resolution can never drift apart into two independently-guessed heuristics. Returns `stopOrderId: null` (never fabricated) if extraction fails.
- `matchesStopOrderIdentity(policy, liveOrder)` (new, `lib/portfolio/stopLossPolicy.ts`, pure): tries an exact match on the nested order's own id first; only falls back to a shared `complexOrderId` match if that fails. Both branches are real identity checks — a replacement order made outside TradeEdge has a different order id *and* a different complex-order id, so neither branch can accept it.
- `classifyPositionStopLoss` now calls `matchesStopOrderIdentity` instead of the old direct `brokerOrderId === match.id` comparison.
- `app/portfolio/page.tsx`'s OCO success handler now resolves and persists both ids via `resolveOcoStopOrderId`, threading an explicit `StopOrderIdentity { orderId, complexOrderId }` through `buildSubmittedStopPolicy`/`persistStopPolicy`.

**Stale-policy protection is unweakened** — matching still requires an exact id match on one of the two fields; no fallback accepts "any" order.

## 2. Real quote-quality detection

**Defect.** `pnlReliable && closeValue != null` only proved a marketable print was computable (bid and ask existed for every leg), not that the spread was narrow. A $3–5-wide leg market (the reported MU condition) satisfied this and was treated as `RELIABLE`, letting a single wide-market marketable observation count toward breach confirmation.

**Fix.**
- New `QuoteWidthEvidence` type and `Position.quoteWidthEvidence` field: per-leg bid/ask width in dollars, net combo width in dollars, net width as % of position mid, and a `crossed` flag. Computed during `loadPositions` from the same `currentBids`/`currentAsks`/`oneSidedSymbols` data already fetched — no new network calls.
- `classifyQuoteQuality(evidence)` (pure, `lib/portfolio/stopLossPolicy.ts`): `DEGRADED` if crossed; `UNKNOWN` if width evidence is unavailable; otherwise `RELIABLE` only if **both** thresholds hold:
  - `maxNarrowLegWidthDollars: 0.50` — every leg's bid/ask width ≤ $0.50/contract
  - `maxNarrowNetWidthPctOfMid: 0.15` — net combo width ≤ 15% of the position's mid value
- `derivePositionQuoteQuality` rewritten to call `classifyQuoteQuality(pos.quoteWidthEvidence)` instead of the old existence check.

A wide two-sided market can no longer become `RELIABLE` merely because a marketable print exists.

## 3. Genuine confirmation window

**Defect.** Daily snapshots only ever had date-only granularity. Combining one such snapshot with the current live read trivially satisfied `requiredConfirmations = 2` regardless of actual temporal spacing or freshness.

**Fix.**
- `BreachObservation.preciseTimestamp: boolean` (new, required field): true only when `at` is a genuine capture timestamp, not a reconstructed midnight/date-only placeholder.
- `PositionSnapshot.capturedAt?: string | null` (new, optional): populated going forward at first daily capture (`captureSnapshotsIfNeeded` in `app/portfolio/page.tsx`); absent on pre-existing snapshots.
- `buildStopBreachObservations` sets `preciseTimestamp: true` only for observations with a real `capturedAt`/current-read timestamp; historical snapshots without one get `preciseTimestamp: false`.
- `evaluateStopBreach` rewritten:
  1. Drops any observation with an unparseable timestamp entirely (freshness/ordering validation).
  2. Restricts the **confirmation streak** to `preciseTimestamp: true` observations only — imprecise ones remain valid contextual evidence for `NOT_BREACHED` messaging but can never themselves satisfy `requiredConfirmations`.
  3. Deduplicates: two precise observations within `minConfirmationIntervalMs` (default 5 minutes, `DEFAULT_MIN_CONFIRMATION_INTERVAL_MS`) of each other collapse into one.
  4. Existing hysteresis-band retreat logic (unchanged) still resets the streak.
  5. Broker-reported `TRIGGERED` status remains checked first and is immediately authoritative, independent of all observation/timestamp logic.

## Regression tests added

`lib/portfolio/__tests__/stopLossPolicy.test.ts` — `evaluateStopBreach` describe block, 6 new tests:
- `counts a current read duplicated in today's snapshot once, not twice`
- `counts two readings inside the minimum confirmation interval once`
- `confirms breach from two properly spaced, fresh, reliable, precisely-timed crossings`
- `resets the streak after a hysteresis retreat even with otherwise well-spaced precise observations`
- `never combines an old imprecise daily snapshot with one current tick to fabricate confirmation`
- `treats a broker-reported trigger/fill as immediately authoritative regardless of observation freshness`

`lib/portfolio-data/__tests__/stopLossWiring.test.ts`:
- `derivePositionQuoteQuality (real spread-width evidence)` describe block, 5 tests including the MU regression fixture (`is DEGRADED for the reported MU condition ($3-5-wide leg markets) even though a marketable value exists`).
- `OCO broker identity: submit -> persist -> reload (end-to-end)` describe block, 1 fixture test covering all 5 required assertions: OCO response with parent + nested ids → identity persisted via `resolveOcoStopOrderId` → orders reconstructed via `collectRawOrders`/`mapGtcOrder` (same path as a real reload) → reload classification `ALIGNED` → a replacement made outside TradeEdge (new order id and new complex-order id) still classifies `UNKNOWN_PROVENANCE`.

## Validation

- `npx tsc --noEmit` — clean, zero errors.
- `npx vitest run` — 98 test files, 1332 tests, all passing.
- `npx next build` — succeeds, 52/52 static pages generated.

## Merge status (original corrective round)

All three corrections implemented, tested, and validated. Branch `fix/stop-loss-canonical-policy` was merged to `main` at `6f962c8`.

---

# Round 3 — Stop Display Policy Must Not Become an Enforcement Policy

**Branch:** `fix/te-0002-stop-trust-boundary`
**Original commit:** `fe64ad3`, based on `main` @ `6f962c8` — **superseded**, see Rebase note below.
**Post-rebase code tree:** validated at commit `a68c17a`, based on `main` @ `195f324` (which includes the merged PM-0001 branch — position-metrics correctness, base + corrective round + corrective round 2 debit P/L gate). `a68c17a` is not the final commit for this round: it was subsequently amended once already (to fold in this report) and is amended again by this report-only update. The final commit hash is not embedded in this document — it is supplied externally in the implementation-report response accompanying each amendment.
**Scope:** One focused defect — an untrusted/display-only stop policy could reach the breach-enforcement path and produce a false `CUT_LOSSES`. No redesign of the six-state classification, breach-confirmation state machine, or `evaluateStopBreach`/`classifyStopLossPolicy` themselves — both are unchanged. This round adds a trust boundary in how their outputs are *consumed*, not in how they're computed.

### Rebase note (post-approval)

Round 3 was originally built and committed (`fe64ad3`) against local `main` at `6f962c8`, which at the time did **not** contain PM-0001 (PM-0001's round-2 commit, `195f324`, had only been committed locally on a separate, unmerged branch, and was never pushed). Once PM-0001 was merged and became current local/remote `main` at `195f324`, `fe64ad3` was rebased onto it:

```
git rebase main   # replaying fe64ad3 onto 195f324
```

Four files overlap between PM-0001 and this round: `app/portfolio/page.tsx`, `lib/portfolio-data/acquisition.ts`, `lib/portfolio-data/types.ts`, and `lib/portfolio-data/__tests__/stopLossWiring.test.ts`. Of these, three (`page.tsx`, `acquisition.ts`, `types.ts`) merged automatically with no textual conflict — PM-0001's changes (POP/IC/buffer fixes, `entryPriceEffect`, the debit `pnl` gate) and Round 3's changes (`stopLossPolicy`/`stopLossDisplayPolicy` split, `getRecommendation()`'s advisory evaluation, `isActionRelevant()`'s raw-threshold removal) touch disjoint regions of each file. Verified directly post-rebase (not merely assumed from a clean auto-merge): `entryPriceEffect`, `computePositionPnl`, `isNetDebit`, `computeCanonicalBuffer`, and `resolveOptionLegPrice` (PM-0001) all still present in `acquisition.ts`, alongside `stopLossDisplayPolicy`, `untrustedWorkingStop`, `displayStopEvaluation`, and the gated `enforcementPolicy` (Round 3); `types.ts` carries both `entryPriceEffect`/`putBufferPct` and `stopLossDisplayPolicy`; `page.tsx` carries both the `entryPriceEffect` debit-display guard and the corrected `isActionRelevant` `CUT_LOSSES` formula (`breached || atExtremeLoss || rec.action === 'CUT_LOSSES'`, with `describeStopLossPolicy` reading `pos.stopLossDisplayPolicy`).

`lib/portfolio-data/__tests__/stopLossWiring.test.ts` did conflict (both sides append content after the same shared tail of the file) and was resolved manually, preserving **all** tests from both sides in sequence: the import block now pulls in both PM-0001's `positionMetrics` imports and Round 3's `buildUnknownProvenancePolicy`; the PM-0001 describe blocks (`P/L null propagation`, `debit-trade guard`, `full debit-structure acceptance (PM-0001 corrective round 2)`, `acquisition-CSP messaging unchanged`, `crossed-quote contract`) are unchanged and immediately followed by the `TE-0002 corrective round 3: stop display/enforcement trust boundary (MU production fixture)` describe block. No test from either side was dropped, weakened, or rewritten to accommodate the other.

## Production failure

MU 800/790 five-lot BPS put credit spread:

| Field | Value |
|---|---|
| Credit received | $1,260 total ($2.52/spread) |
| Canonical 2×-credit stop | $5.04/spread → $2,520 total |
| Working broker stop | $3.15/spread → $1,575 total |
| Stop classification | `TOO_TIGHT` |
| Provenance | `UNKNOWN` (broker order not created by TradeEdge) |
| Midpoint buyback | ~$1,750 total |
| Underlying | ~$862, safely above the $800 short put (buffer > 0, no strike breach) |

The canonical $2,520 threshold was never crossed. But because the $1,750 midpoint exceeded the *broker's own* $1,575 threshold, and enough distinctly-timed observations accumulated, the position eventually reached `CONFIRMED_BREACH` and both the Suggested Action text and the CUT_LOSSES button lit up — an incorrect recommendation rendered identically on both surfaces, not two independent bugs.

## Root cause: a display fabrication reused as an enforcement input

`classifyPositionStopLoss` (`lib/portfolio-data/acquisition.ts`) correctly classified the stop as `TOO_TIGHT`/`UNKNOWN_PROVENANCE`. For *display*, it also built a synthetic policy object via `buildUnknownProvenancePolicy()` so the UI could show a trigger price without a fabricated basis label — a legitimate, and already-documented, thing to do. The defect: that same display object was the *only* thing returned through `StopLossInfo.policy`/`Position.stopLossPolicy`, and `getRecommendation()` passed `pos.stopLossPolicy` straight into `evaluateStopBreach()` as the authoritative enforcement threshold, with no check that the policy behind it had ever been provenance-validated. The `Position.stopLossPolicy` doc comment *already said* this field should be null for an order TradeEdge doesn't recognize — the code just didn't implement that contract.

## Fix: split enforcement from display

**`lib/portfolio-data/types.ts`**
- `Position.stopLossPolicy` is now documented and enforced as an ENFORCEMENT-TRUST boundary: non-null *only* when `stopLossClassification` is `ALIGNED` or `TOO_LOOSE` — the two classifications reachable only when a recorded TradeEdge policy's identity *and* live price both verify against the broker order. Every other classification (`NO_STOP`, `TOO_TIGHT`, `UNKNOWN_PROVENANCE`, `INVALID`) leaves this field `null`, independent of whether a raw broker trigger price exists.
- New `Position.stopLossDisplayPolicy: StopLossPolicy | null` — always resolves to *some* policy object whenever a working stop exists (matched or the `buildUnknownProvenancePolicy()` fabrication), explicitly documented as display-only and never to be passed to `evaluateStopBreach()` as an authoritative threshold.
- `StopLossInfo` gained the matching `displayPolicy` field alongside the now-gated `policy` field.

**`lib/portfolio-data/acquisition.ts`**
- `classifyPositionStopLoss`: computes `enforcementPolicy = (classification === 'ALIGNED' || classification === 'TOO_LOOSE') && matchedPolicy ? matchedPolicy : null` and returns it as `policy`; the previous unconditional `matchedPolicy ?? buildUnknownProvenancePolicy(...)` fabrication moved to the new `displayPolicy` field only.
- `loadPositions()`'s Position construction: `stopLossPolicy: stopLoss.policy, stopLossDisplayPolicy: stopLoss.displayPolicy`.
- `getRecommendation()`:
  - `evaluateStopBreach({ policy: pos.stopLossPolicy, ... })` is unchanged in shape, but is now safe by construction — an untrusted policy can never reach it, so `evaluateStopBreach` can never confirm a breach off a threshold TradeEdge didn't set.
  - A second, *capped* advisory evaluation runs only when `pos.stopLossPolicy == null` and classification is `TOO_TIGHT`/`UNKNOWN_PROVENANCE` and a display policy exists — using `pos.stopLossDisplayPolicy` as the threshold. Its result is read only to decide whether to surface `MANAGE` ("Verify stop — ..."); it is never assigned to `stopLossConfirmedBreach`, so even a `CONFIRMED_BREACH`-shaped result from this advisory evaluation can only ever downgrade to `MANAGE`, never escalate to `CUT_LOSSES`.
  - Both hard-exit checks (`breached` on short-strike buffer, and the pre-existing `stopLossConfirmedBreach`) run exactly as before and are entirely untouched by this change — a genuine strike breach or a *trusted* confirmed stop breach still produces `CUT_LOSSES`.

**`app/portfolio/page.tsx`**
- `isActionRelevant`'s `CUT_LOSSES` branch previously ran its *own* independent `stopLossBreachedMid || stopLossBreachedMarketable` raw-threshold check against `pos.stopLossPrice`/`currentValue`/`closeValue` — entirely bypassing classification/provenance/confirmation logic. This was the second half of the production bug: even after fixing `getRecommendation()`, this button-relevance gate could still light up off the same untrusted $1,575 threshold on its own. Removed; the branch is now `breached || atExtremeLoss || rec.action === 'CUT_LOSSES'` — the identical, already-corrected canonical recommendation both surfaces now consume.
- `describeStopLossPolicy(...)`'s call site switched from `pos.stopLossPolicy` to `pos.stopLossDisplayPolicy` so the card still shows the observed broker basis/trigger for an untrusted stop instead of falling back to "No stop order" text.

## Decision-rule verification

| Rule | Behavior after fix |
|---|---|
| `UNKNOWN_PROVENANCE` | May display broker trigger (via `stopLossDisplayPolicy`). Produces `MANAGE`/"Verify stop" when the untrusted threshold shows breach evidence. Never reaches `CONFIRMED_BREACH`/`CUT_LOSSES` — `pos.stopLossPolicy` is null, so `evaluateStopBreach()`'s authoritative path never runs on it. |
| `TOO_TIGHT` | Same as above — `pos.stopLossPolicy` is null regardless of how tight the broker order is; the too-tight threshold can only ever produce a `MANAGE` advisory. |
| `ALIGNED` / `TOO_LOOSE` (provenance-matched) | `pos.stopLossPolicy` is the real matched policy; `evaluateStopBreach()` behavior — broker-fill authority, hysteresis, dedup, confirmation streak — is completely unchanged. |
| `NO_STOP` / `INVALID` | `pos.stopLossPolicy` is null (as it always was); `evaluateStopBreach()` returns `NO_STOP`; no stop-derived `CUT_LOSSES`. |
| Independent hard exits | `breached` (short-strike buffer ≤ 0) and `veryLargeLoss && trendAgainst` are untouched — a genuine strike breach still fires `CUT_LOSSES` regardless of stop trust state. |

## Regression tests added

`lib/portfolio-data/__tests__/stopLossWiring.test.ts`:
- Updated two existing `classifyPositionStopLoss` tests (`resolves an externally created stop with no TradeEdge metadata...`, `does not misattribute a recorded policy whose brokerOrderId no longer matches...`) to assert against the new `result.displayPolicy` for the fabricated/unmatched policy and `result.policy === null` for the enforcement field — locking the split contract at the classification layer.
- New `TE-0002 corrective round 3: stop display/enforcement trust boundary (MU production fixture)` describe block, using the exact production numbers (BPS, qty 5, credit $1,260/$2.52 per contract, short/long 800/790, stock $862, broker stop $3.15, canonical $5.04, `currentValue` $1,750, `pnl` −$490/−38.9%):
  - Fixture arithmetic sanity check against the reported numbers.
  - `classifyPositionStopLoss`-level check: `$3.15` stop remains visible, classification is `TOO_TIGHT`, `displayPolicy` is `UNKNOWN`-basis/`UNKNOWN`-source, and `policy` (enforcement) is `null`.
  - One observation above the untrusted $1,575 threshold does not produce `CUT_LOSSES`.
  - Multiple precise, >5-minutes-apart observations above the untrusted threshold still do not produce `CUT_LOSSES`.
  - A wide-market marketable-only observation above the untrusted threshold does not produce `CUT_LOSSES`.
  - The resulting recommendation is `MANAGE` with a `/Verify stop/`-matching explanation.
  - Even a broker-reported fill on the untrusted/unmatched stop does not escalate to `CUT_LOSSES` (conservative-by-design; documented as intentional — see "Scope notes" below).
  - A contract-lock test proving the button-relevance formula (`breached || atExtremeLoss || rec.action === 'CUT_LOSSES'`, i.e. `isActionRelevant`'s post-fix `CUT_LOSSES` branch, verified by direct code inspection since that function isn't exported/importable from `app/portfolio/page.tsx` — same limitation as `loadPositions()` itself, per TC-0001's established finding) evaluates to `false` for the same fixture — both surfaces agree.
  - **Controls:** a provenance-matched `ALIGNED` policy still confirms `CUT_LOSSES` after a valid observation streak; a broker-reported fill for a trusted `ALIGNED` policy remains authoritative; a genuinely breached short strike still produces its independent hard exit regardless of stop trust state.

## Scope notes / limitations

- The advisory (display-policy) evaluation in `getRecommendation()` uses `mapBrokerStopStatus(pos.stopLossOrderStatus)` for `brokerStopStatus`, same as the trusted path — so a genuine broker-reported fill on an *untrusted* stop still only ever surfaces as `MANAGE`/"Verify stop," never `CUT_LOSSES`. This is a deliberate, conservative choice: TradeEdge has no confirmed record of what that order represents, so it does not auto-treat even a real fill on it as a confirmed TradeEdge exit signal. Flagged here explicitly as a design decision, not an oversight, and is covered by its own regression test.
- `isActionRelevant` (`app/portfolio/page.tsx`) is not exported and lives in a large client component that can't be imported into the vitest/node environment — its post-fix contract is locked via a code-inspection-verified formula test rather than a direct function-level test, consistent with the `loadPositions()` precedent already established in TC-0001's implementation report.

## Validation (pre-rebase, superseded)

Run against `fe64ad3` on `main` @ `6f962c8` (without PM-0001) — recorded here for history, superseded by the post-rebase validation below:
- `npx tsc --noEmit` — clean, zero errors.
- `npx vitest run` (full suite) — 99 test files, 1409 tests, all passing.
- `npx next build` — succeeds.

## Validation (post-rebase, run against the `a68c17a` code tree, prior to this report-only amendment)

All checks below ran against the rebased code tree exactly as it stood at commit `a68c17a` — before this amendment, which changes `docs/te-0002-corrective-report.md` only and makes no code changes. No re-validation was run for this amendment; it is a documentation-only change on top of already-validated code.

Base sanity check first: `git merge-base --is-ancestor 195f324 a68c17a` confirmed PM-0001's round-2 commit is an ancestor of the rebased branch.

- `npx tsc --noEmit` — clean, zero errors.
- Targeted suites specified for this round:
  - `lib/portfolio/__tests__/positionMetrics.test.ts` — 66 tests, passing (PM-0001's pure-function suite, unchanged).
  - `lib/portfolio-data/__tests__/stopLossWiring.test.ts` — **48 tests, passing** (37 from PM-0001's `195f324` state + this round's ~11 net-new MU-fixture/contract tests — see Rebase note for the exact merge).
  - `lib/portfolio/__tests__/stopLossPolicy.test.ts` — 33 tests, passing, unchanged.
  - ES-0001 close-order safety suites — `lib/portfolio/__tests__/closeOrderSafety.test.ts` (46), `closeOrderSubmission.test.ts` (19), `pendingOrderReplacementSafety.test.ts` (35), `pendingOrderReplacementSubmission.test.ts` (23) — 123 tests total, all passing, unchanged.
- `npx vitest run` (full suite, `--pool=threads --poolOptions.threads.maxThreads=4`) — **99 test files, 1424 tests, all passing.**
  - Count check (per instruction, investigated rather than assumed): PM-0001's own reviewed baseline (`195f324` alone, before this round) was **99 files / 1413 tests**. This round added tests only to `stopLossWiring.test.ts` (37 → 48, +11) and no new test files. 1413 + 11 = 1424 — the combined total is exactly consistent with "all PM-0001 tests plus the new Round 3 tests," not a regression or a silently-dropped count.
- `npx next build` — succeeds.

## Post-rebase confirmation: enforcement/display separation intact

Directly verified in the rebased `acquisition.ts`/`types.ts`/`page.tsx` (not merely inferred from a clean auto-merge):
- `Position.stopLossPolicy` remains gated to `ALIGNED`/`TOO_LOOSE` only (`enforcementPolicy` in `classifyPositionStopLoss`, unchanged from the original Round 3 commit).
- `Position.stopLossDisplayPolicy` remains the always-resolved, display-only field, still the only thing `describeStopLossPolicy(...)` in `page.tsx` reads.
- `getRecommendation()`'s advisory (`displayStopEvaluation`/`untrustedWorkingStop`) still never feeds `stopLossConfirmedBreach`.
- `isActionRelevant`'s `CUT_LOSSES` branch is still `breached || atExtremeLoss || rec.action === 'CUT_LOSSES'`, with no reintroduced raw-threshold check.

## Merge status

Implemented, tested, and validated on `fix/te-0002-stop-trust-boundary`, rebased onto `main` @ `195f324` (which includes merged PM-0001). Code review of the rebased implementation has passed. This report was subsequently amended once to fold itself into the rebase commit, and is amended again by this documentation-only change — each amendment produces a new commit hash. Per instruction, this document does not embed its own resulting commit hash; the current final commit hash is supplied externally in the implementation-report response for each round of changes. **Not merged and not pushed** — awaiting further instruction.
