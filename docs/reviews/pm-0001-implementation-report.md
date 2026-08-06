# PM-0001 — Portfolio Position Metrics Correctness — Implementation Report

**Branch:** `fix/portfolio-metrics-correctness`
**Type:** calculation repair, not a UI redesign. TE-0002's stop-loss policy module and ES-0001's close-order safety module are untouched and are not imported by any new code in this ticket.

## 1. New module: `lib/portfolio/positionMetrics.ts`

`calcPositionPop()` and its helpers previously lived as unexported functions inside `loadPositions()`'s closure in `lib/portfolio-data/acquisition.ts` — untestable without exercising the entire live TastyTrade acquisition pipeline. Per the ticket's "extract pure calculation helpers" requirement, all POP/breakeven/buffer/quote-resolution/color-direction math has been moved into a new pure, framework-free module and is imported back into `acquisition.ts` and `app/portfolio/page.tsx`. Nothing in the new module does I/O.

## 2. POP unit fix

**Before** (`calcPositionPop`, inline in `loadPositions()`):
```ts
const creditPerShare = Math.abs(creditReceived) / 100;
```
`creditReceived` is the whole-position dollar total across every contract — dividing only by `100` (never by quantity) meant a 5-lot position's per-contract credit was computed as **5× too high**.

**After** (`computeCreditPerContract`, `lib/portfolio/positionMetrics.ts`):
```ts
export function computeCreditPerContract(totalCreditReceived, canonicalQuantity, contractMultiplier = CONTRACT_MULTIPLIER) {
  ...
  return Math.abs(totalCreditReceived) / (canonicalQuantity * contractMultiplier);
}
```
`canonicalQuantity` is `pos`'s ES-0001 canonical quantity (`identity.quantity`), computed once earlier in `loadPositions()` and passed in explicitly — never re-derived from an arbitrary leg.

**Regression numbers (computed with the actual formula, not by hand):**

| | Old (buggy) | New (fixed) |
|---|---|---|
| NKE credit/contract | $2.25 | **$0.45** |
| NKE breakeven (strike $40.50) | $38.25 | **$40.05** |
| NKE POP (stock $42.26, IV 34%, 8 DTE) | 97.47% | **85.13%** |
| MU credit/spread | $12.60 | **$2.52** |
| MU breakeven (strike $800) | $787.40 | **$797.48** |
| MU POP (stock $876.40, IV 66%, 29 DTE) | 68.53% | **66.06%** |

The old bug systematically **overstated** POP for every multi-lot CSP/BPS/BCS position — the breakeven was pushed artificially far from the strike, making the position look safer than it actually was. The NKE case (5 contracts, tight 8-DTE window) shows the largest distortion: 97.5% vs. the corrected 85.1%.

**Quantity invariance verified:** a 1-contract MU BPS at $252 credit and a 5-contract MU BPS at $1,260 credit both compute `creditPerContract = 2.52` exactly (`1-lot=2.52, 5-lot=2.52, equal: true`) — confirmed by both the `worked_examples.mjs` script and the `quantity invariance` describe block in `positionMetrics.test.ts`.

## 3. Iron-condor breakeven fix

**Before:**
```ts
const putBreakeven = shortPut.strikePrice - creditPerShare / 2;
const callBreakeven = shortCall.strikePrice + creditPerShare / 2;
```

**After** (`computeIcBreakevens`):
```ts
return {
  lowerBreakeven: shortPutStrike - creditPerCondor,   // full credit, not halved
  upperBreakeven: shortCallStrike + creditPerCondor,
};
```

**Regression fixture** (symmetric IC: stock 100, 95P/90P short-put wing, 105C/110C short-call wing, $2.00/condor credit, 30 DTE, 25% IV):

| | Old (halved credit) | New (full credit) |
|---|---|---|
| Breakevens | 94 / 106 | **93 / 107** |
| IC POP | 59.80% | **67.21%** |

Notably, **this defect pushed in the opposite direction from the CSP/BPS unit-mismatch bug** — halving the credit narrowed the breakeven range, which *understated* IC POP (made positions look riskier than they are), while the CSP/BPS per-share bug overstated POP. Both are now fixed independently and correctly.

POP for the joint-range probability is computed as `popAbove(lowerBreakeven) + popBelow(upperBreakeven) - 100`, then clamped to `[0, 100]` via `clampPct()` — this floor/ceiling protects against extreme low-IV/short-DTE inputs pushing the raw inclusion-exclusion sum slightly outside a valid probability range.

## 4. Side-specific IC buffer

**Before** (`buffer`, inline in `loadPositions()`):
```ts
const shorts = legs.filter((l: any) => l['quantity-direction'] === 'Short');
if (!shorts[0]) return null;
```
Used whichever short leg happened to be first in the broker's raw leg array — for an IC (two short legs), this only ever reflected one side.

**After:** `Position` gained two new fields, `putBufferPct: number | null` and `callBufferPct: number | null` (`lib/portfolio-data/types.ts`), computed via:
```ts
computeSideBuffers(stockPrice, shortPutStrike, shortCallStrike)   // both sides independently
computeCanonicalBuffer(strategy, putBufferPct, callBufferPct)     // collapsed value for the card
```
`computeCanonicalBuffer`: IC uses `Math.min(putBufferPct, callBufferPct)` (breached the moment *either* side is), put-only strategies use the put side, call-only strategies use the call side. Both short legs are resolved via `positionLegs.find(l => l.optionType === ... && l.direction === 'Short')`, not `legs[0]`/`shorts[0]` — leg-array order is irrelevant by construction (verified in tests by calling the function with the same resolved values regardless of hypothetical leg order).

**Regression cases verified:** put safe + call breached → IC breached (`min <= 0`); call safe + put breached → IC breached; both safe → displayed buffer is the smaller cushion; a caught bug in my own first draft (`computeCanonicalBuffer` wasn't actually branching on `strategy` for the call-only case, so a stray put value could leak through) was caught by the call-only regression test and fixed before merge.

## 5. Stop fabricating prices from missing quotes

**Option legs — before:**
```ts
currentPrices[sym] = twoSided ? mid : mark > 0 ? mark : 0;   // fabricated 0
```
`currentValue`'s loop already checked `if (price == null) hasCurrentPrices = false` — but since the map always stored a number (never `null`), that check could never fire for a genuinely unpriceable leg.

**After:**
```ts
const resolvedPrice = resolveOptionLegPrice(bid, ask, mark);   // null when neither exists
currentPrices[sym] = resolvedPrice;
if (resolvedPrice == null) unpriceableSymbols.add(sym);
```
This is a **population-site fix only** — `currentValue`'s existing `price == null` gate, and `pnl`/`pnlPct`/`hitTarget`'s existing `hasCurrentPrices` gate, already propagate the null correctly once it's an honest `null` instead of a fabricated `0`. No downstream branch needed to change. `currentBids`/`currentAsks` (used by "Close now (marketable)" and quote-width evidence) got the same `null`-instead-of-`0` fix for consistency; their consumers already used `== null` checks that were previously dead code against a map that could never actually contain `null`.

**Underlying — before:**
```ts
stockPrices[item.symbol] = mid > 0 ? mid : mark > 0 ? mark : 0;
```
`mid = (bid+ask)/2` was computed and used even when `bid === 0` (so `mid = ask/2`, a fabricated half-price) or when the market was crossed (`ask < bid`).

**After** (`resolveUnderlyingPrice`):
```ts
const twoSidedNonCrossed = bid > 0 && ask > 0 && ask >= bid;
return twoSidedNonCrossed ? (bid + ask) / 2 : (mark > 0 ? mark : null);
```

**Regression cases verified:** bid 0/ask positive/valid mark → uses mark; bid 0/ask positive/no mark → `null` (never `ask/2`); crossed market → uses valid mark or `null`; fully unavailable quote → `null`, never `$0.00`.

## 6. Trade Evolution colors

**POP** — before: `entryChangeColor(popAtEntry, popNow, true, ...)` (`goodWhenDown=true`, i.e. a *declining* POP was colored favorable/green — backwards). After: `goodWhenDown=false` — POP increasing is now green, decreasing is now red.

**Delta** — before: raw signed values passed directly with a universal `goodWhenDown=true` rule, so e.g. delta moving from `+0.20` to `-0.40` (a large swing) could be miscategorized by a rule meant for magnitude, not direction. After: both entry and current are wrapped in `Math.abs()` before comparison (matching the existing Gamma/Vega row pattern) — this is an **exposure-risk signal** (shrinking magnitude = favorable, growing magnitude = unfavorable), explicitly not a directional-thesis judgment, per the ticket's scope note.

The favorable/unfavorable decision itself was extracted into a new pure, exported function, `computeEntryChangeTone()`, in `positionMetrics.ts` — `page.tsx`'s `entryChangeColor()` is now a thin wrapper that maps the returned `'good'|'bad'|'neutral'` tone to a CSS class. (`page.tsx` can only re-export a small fixed set of Next.js route-contract symbols, per TC-0001's prior finding, so the CSS mapping had to stay in `page.tsx`, but the actual judgment is now independently testable.)

**Verified test cases (exact ticket wording):**
- `+0.40 → +0.20` → favorable (`'good'`)
- `+0.20 → +0.40` → unfavorable (`'bad'`)
- `−0.40 → −0.20` → favorable (`'good'`)
- `−0.20 → −0.40` → unfavorable (`'bad'`)

## 7. Debit-trade safety guard

`calculateSpreadCredit()` still floors a net debit to `$0.00` for backward-compatible display (unchanged behavior — full debit-strategy support is explicitly out of scope). What's new: `computeSignedNetPremium()` (same per-leg math, **no flooring**) and `isNetDebitStructure()` (small epsilon-guarded `< -0.005` check) let `loadPositions()` detect the debit *before* it reaches credit-specific formulas:
```ts
const signedNetPremium = computeSignedNetPremium(positionLegs);
const isNetDebit = isNetDebitStructure(signedNetPremium);
...
pop: isNetDebit ? null : calcPositionPop(...),
targetPrice: isNetDebit ? 0 : Math.abs(creditReceived) * profitTarget,
hitTarget: !isNetDebit && hasCurrentPrices && pnl != null && pnl >= Math.abs(creditReceived) * profitTarget,
```
A debit structure's POP is now `null` (never computed off a fabricated $0 credit's breakeven, which would just equal the strike itself), and `hitTarget` can never fire off a $0 target. `targetPrice` stays a `number` (the `Position` type's existing non-nullable contract — widening it to `number | null` would ripple into every render site and is out of this ticket's scope), but is inert at `0` and can no longer trigger a spurious take-profit recommendation because `hitTarget` is force-false.

## 8. P/L null propagation into `getRecommendation`

No code change was needed here — `getRecommendation`'s `pnlPct` already falls back to `0` when `pnl` is `null`, and `0` never crosses any of the codebase's take-profit (`>= 30/40/target%`) or cut-loss (`<= -50/-100/-150/-200%`) thresholds, so a missing P/L can't spuriously fire either kind of hard action. `hitTarget` is independently forced `false` upstream. This was **verified**, not assumed — see the two new `P/L null propagation (PM-0001)` tests in `stopLossWiring.test.ts`.

## 9. Changed files

**New:**
- `lib/portfolio/positionMetrics.ts` — pure calculation module (POP, breakevens, side buffers, quote-price resolution, Trade Evolution color-direction).
- `lib/portfolio/__tests__/positionMetrics.test.ts` — 53 tests.

**Modified:**
- `lib/portfolio-data/acquisition.ts` — removed the inline `positionNormalCdf`/`positionPopAbove`/`positionPopBelow`/`calcPositionPop` closure; wired the new pure module in; fixed `currentPrices`/`currentBids`/`currentAsks`/`stockPrices` population to use `resolveOptionLegPrice`/`resolveUnderlyingPrice`; added the `putBufferPct`/`callBufferPct`/canonical-`buffer` computation; added the `isNetDebit` guard around `pop`/`targetPrice`/`hitTarget`; `calculateSpreadCredit` now delegates to `computeSignedNetPremium`.
- `lib/portfolio-data/types.ts` — added `putBufferPct: number | null` and `callBufferPct: number | null` to `Position`.
- `app/portfolio/page.tsx` — POP row's `goodWhenDown` flipped to `false`; Delta row now compares `Math.abs()` values; `entryChangeColor()` delegates to the new `computeEntryChangeTone()`.
- `lib/portfolio-data/__tests__/stopLossWiring.test.ts` — `makePosition` fixture updated with `putBufferPct`/`callBufferPct`; added `P/L null propagation (PM-0001)`, `debit-trade guard (PM-0001)`, and `acquisition-CSP messaging unchanged (PM-0001)` describe blocks (6 new tests).

**Not modified:** `lib/portfolio/stopLossPolicy.ts`, `lib/portfolio/closeOrderSafety.ts`, `lib/portfolio/closeOrderSubmission.ts`, and every ES-0001/ES-0002/TE-0002 test file — no new code in this ticket imports or touches any of them.

## 10. Test names and counts

`lib/portfolio/__tests__/positionMetrics.test.ts` (53 tests): `computeCreditPerContract` (5), `computeSignedNetPremium / isNetDebitStructure` (3), `computeSingleLegBreakeven` (2), `calcPositionPop: CSP` (3), `calcPositionPop: BPS / BCS` (2), `calcPositionPop: quantity invariance` (3), `computeIcBreakevens` (3), `calcPositionPop: IC` (4, including `clampPct`), `computeSideBuffers` (3), `computeCanonicalBuffer` (8), `resolveOptionLegPrice` (3), `resolveUnderlyingPrice` (8), `computeEntryChangeTone: POP direction` (3), `computeEntryChangeTone: absolute-delta direction` (4).

`lib/portfolio-data/__tests__/stopLossWiring.test.ts` (6 new): `getRecommendation: P/L null propagation (PM-0001)` (2), `debit-trade guard (PM-0001)` (3), `getRecommendation: acquisition-CSP messaging unchanged (PM-0001)` (1).

## 11. `Position` type additions

```ts
putBufferPct: number | null;
callBufferPct: number | null;
```

## 12. Validation

- `npx tsc --noEmit` — clean, zero errors.
- `npx vitest run` — **99 test files, 1391 tests, all passing** (up from 98 files/1332 tests before this ticket).
- `npx next build` — succeeds in a single pass, 52 static pages.
- **TE-0002 suites green:** `lib/portfolio/__tests__/stopLossPolicy.test.ts` (33 tests) and the stop-loss portions of `stopLossWiring.test.ts` all pass unchanged.
- **ES-0001/ES-0002 suites green:** `lib/portfolio/__tests__/closeOrderSafety.test.ts`, `closeOrderSubmission.test.ts`, `pendingOrderReplacementSafety.test.ts`, `pendingOrderReplacementSubmission.test.ts`, and `lib/recommendations/__tests__/RecommendationService.test.ts` all pass unchanged — none of them import `positionMetrics.ts`.

## 13. Confirmation

TE-0002's stop-loss policy behavior and ES-0001's order-safety protections are preserved exactly — no file either depends on was modified, and their full test suites pass unchanged as part of the 1391-test green run. This ticket is scoped to calculation correctness only: no Greek display units, risk thresholds, or Net Edge formula were touched, per the ticket's explicit exclusion.

---

## 14. Corrective round (before merge)

A focused follow-up commit addressed four gaps found in review, on the same branch, before merge. No Greek units, Greek thresholds, Net Edge, TE-0002, or ES-0001 were touched.

### 14.1 Complete IC buffer evidence required

**Before:** `computeCanonicalBuffer('IC', ...)` returned whichever side was available when the other was `null` — an IC could be labeled "safe" or "breached" from only one side's evidence.

**After:**
```ts
if (strategy === 'IC') {
  if (putBufferPct == null || callBufferPct == null || !Number.isFinite(putBufferPct) || !Number.isFinite(callBufferPct)) {
    return null;
  }
  return Math.min(putBufferPct, callBufferPct);
}
```
An IC's canonical buffer is now `null` unless **both** sides are valid finite numbers — `getRecommendation`'s `buffer <= 0` breach check correctly treats `null` as "cannot classify," never as "safe by default."

**Tests added** (`positionMetrics.test.ts`): put present/call missing → `null`; call present/put missing → `null`; both present → minimum; both missing → `null`.

### 14.2 Crossed option quotes rejected

**Before:** `resolveOptionLegPrice` used the midpoint whenever `bid > 0 && ask > 0`, with no check that `ask >= bid` — a crossed (stale/bad) quote could produce a fabricated midpoint.

**After:**
```ts
export function resolveOptionLegPrice(bid, ask, mark) {
  const twoSidedNonCrossed = bid > 0 && ask > 0 && ask >= bid;
  if (twoSidedNonCrossed) return (bid + ask) / 2;
  return mark > 0 ? mark : null;
}
```
Same rule `resolveUnderlyingPrice` already applied to the underlying, now applied to option legs. In `acquisition.ts`, a genuinely crossed leg (`bid > 0 && ask > 0 && ask < bid`) is tracked in a new `crossedSymbols` set and is now also added to `oneSidedSymbols` — so it's excluded from `closeValue` (marketable) exactly like any other one-sided leg, and `closeValue` becomes `null` rather than being built from crossed bid/ask.

Separately, a crossed leg now forces `pnl`, `pnlPct`, and `hitTarget` to be unavailable/false, even though the **observational** `currentValue`/mid may still use a mark fallback (matching the ticket's "midpoint observation uses mark" requirement) — a crossed quote's mark can be shown for display, but no decision-driving field may be computed from it:
```ts
const anyLegCrossed = legs.some(l => crossedSymbols.has(...));
const pnl = (hasCurrentPrices && !anyLegCrossed) ? ... : null;
const hitTarget = !isNetDebit && !anyLegCrossed && hasCurrentPrices && ...;
```
Because `pnlPct` derives from `pnl`, and `getRecommendation`'s `pnlPct` fallback (`0` when `null`) never crosses any take-profit/cut-loss threshold (the same property already verified for the debit guard in §8), a crossed quote cannot spuriously fire a take-profit or loss recommendation.

**Tests added:**
- `positionMetrics.test.ts` (pure): crossed bid/ask with valid mark → midpoint observation uses mark; crossed bid/ask without mark → `null`; crossed midpoint is never averaged even when the average would look plausible.
- `stopLossWiring.test.ts` (wiring contract — `loadPositions()` itself can't be unit-tested without a live session, same limitation TC-0001 already documented; these lock the Position shape `loadPositions()` must produce for a crossed leg): `computeMarketablePnlPct` is `null` when `closeValue` is `null`; `getRecommendation` never returns `TAKE_PROFIT`/`CUT_LOSSES` when `pnl`/`pnlPct` are `null`; `hitTarget` stays `false` and cannot be independently re-derived by `getRecommendation`.

### 14.3 Debit credit-metrics made explicitly unavailable

**New `Position` field:**
```ts
entryPriceEffect: 'Credit' | 'Debit' | 'Unknown';
```
Computed in `loadPositions()` from the same `isNetDebit` guard already introduced in the base commit: `positionLegs.length === 0 ? 'Unknown' : (isNetDebit ? 'Debit' : 'Credit')`. The ES-0001 canonical `identity` (signed entry economics) is unchanged — this field is purely an additional, honest display/decision tag alongside it.

**`pnl` is no longer computed as `-currentValue` for a debit structure.** Previously `pnl = |creditReceived| - |currentValue|`, and for a debit `creditReceived` floors to `0`, so `pnl` silently became `-|currentValue|` — exactly the fabrication the ticket named. `pnl` is now gated the same way `pop`/`targetPrice`/`hitTarget` already were:
```ts
const pnl = (hasCurrentPrices && !anyLegCrossed) ? Math.abs(creditReceived) - Math.abs(currentValue) : null;
```
Combined with the existing `isNetDebit` guard on `pop`/`targetPrice`/`hitTarget` from the base commit, a debit structure now has: POP `null`, target unavailable/inert, `hitTarget` forced `false`, `pnlPct` `null` (already gated on `creditReceived !== 0`, and a debit's floored `creditReceived` is `0`).

**Card display fix** (`app/portfolio/page.tsx`): the Credit metric now renders "Debit (unsupported)" instead of a dollar amount when `entryPriceEffect === 'Debit'`, so a debit structure's floored `$0.00` can never be read as a genuine zero-credit entry on the card itself.

**Tests added** (`stopLossWiring.test.ts`): the `isNetDebit`-to-`entryPriceEffect` mapping locks `'Debit'` for a detected debit and `'Credit'` for a genuine credit structure.

### 14.4 Leg-order invariance: real wiring test

**Before:** the "leg-order independent" test called `computeCanonicalBuffer('IC', 8.0, 3.0)` twice with the same pre-resolved arguments and asserted the results were equal to each other — a tautology (`a === a`) that never actually varied leg order and could not have caught an order-dependence bug.

**After:** a new exported pure function, `findShortLegStrikes(legs)`, resolves short put/call strikes via `.find(optionType/direction)` — this is the exact function `acquisition.ts`'s `loadPositions()` now calls (replacing its inline `.find()` calls), not a reimplementation. The new `leg-order invariance (wiring-level, via findShortLegStrikes)` describe block builds the same 4-leg IC in original broker order and in fully-reversed order, runs both through `findShortLegStrikes` → `computeSideBuffers` → `computeCanonicalBuffer`, and asserts identical `putBufferPct`/`callBufferPct`/`buffer`/breach result for two scenarios (both sides safe; put side breached).

### 14.5 Validation (corrective round)

- `npx tsc --noEmit` — clean, zero errors.
- `npx vitest run` — **99 test files, 1404 tests, all passing** (up from 99 files/1391 tests before this corrective round — 13 net new tests after replacing the one ineffective leg-order test).
- `npx next build` — succeeds (needed a second invocation to finish trace collection within the tool's time limit; webpack cache carried progress across both calls, same pattern as every prior build in this project).
- TE-0002 (`stopLossPolicy.test.ts`, 33 tests) and ES-0001/ES-0002 suites (`closeOrderSafety`, `closeOrderSubmission`, `pendingOrderReplacement*`, `RecommendationService`) all pass unchanged.

### 14.6 Corrected debit rendering behavior (summary)

| | Before corrective round | After corrective round |
|---|---|---|
| `Position.entryPriceEffect` | did not exist | `'Credit' \| 'Debit' \| 'Unknown'`, new field |
| `pnl` for a debit structure | `-currentValue` (fabricated) | `null` |
| Card Credit display for a debit | `$0.00` (indistinguishable from a real zero-credit trade) | "Debit (unsupported)" |
| IC buffer with one side missing | returned the available side | `null` |
| Crossed-leg midpoint | fabricated from crossed bid/ask | mark fallback only, or `null` |
| Crossed-leg `closeValue` | could be built from crossed bid/ask | `null` (leg is one-sided) |
| Crossed-leg `pnl`/`hitTarget`/recommendations | could fire off a mark-fallback mid | `null`/`false`/no P&L-driven action |
