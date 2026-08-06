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

## Merge status

All three corrections implemented, tested, and validated. Branch `fix/stop-loss-canonical-policy` is ready for merge review.
