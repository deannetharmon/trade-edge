# ES-0001 — Live Close-Order Identity and Break-Even Safety

Status: Implemented on `feature/live-close-safety`, not merged. Stopping for Product Owner review per sprint instructions — this ticket does not mark itself complete or select the next sprint.
Branch: `feature/live-close-safety`

## Problem

A real, live "Snap to Break Even" close-order action on the Portfolio page resulted in an actual financial loss. The approved investigation hypothesis was that this was caused by position grouping too broad to distinguish economically distinct spreads (symbol + expiration only, no strike/direction/quantity discriminator), letting two independently-opened spreads merge into one displayed `Position`, with break-even computed from the merged group's aggregate economics rather than either spread's true economics.

## Investigation — confirmed root cause

Read directly (not delegated) against `app/portfolio/page.tsx` as it existed on `main` before this ticket:

1. **Grouping key was too broad.** `loadPositions()` grouped raw broker positions with:
   ```ts
   const key = `${pos['underlying-symbol']}::${pos['expires-at']?.slice(0, 10) ?? 'unknown'}`;
   ```
   Symbol + expiration only. Two independently-opened spreads sharing both — differing only in strike and/or quantity — were merged into one `Position`, one card, one `creditReceived`.

2. **`creditReceived` on a merged group is a single aggregate dollar figure** (`calculateSpreadCredit`), summing every leg's entry economics with no per-spread breakdown retained.

3. **A systemic secondary defect compounded (1) and (2), and turned out to be broader than the original hypothesis anticipated.** At least seven independent call sites needed a "per contract" number and each independently re-derived a stand-in "quantity" by picking a single arbitrary leg — `pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1`, and in one case (roll sizing) the even less discriminating `pos.legs[0]?.quantity ?? 1` (not even filtered by direction) — then divided the AGGREGATE `creditReceived` by that one leg's quantity. When a group was actually two spreads, this produced a per-contract number with no coherent economic meaning:
   - `classifyPositionStopLoss` (stop-loss classification against GTC orders)
   - `fetchCloseLimit` / `fetchCloseQuote` (the "balanced" close-limit optimizer and the live quote used by the profit-capture scale)
   - `evaluateAction`'s stop-loss-breach checks (`CUT_LOSSES` gating, twice)
   - `BatchConfirmModal`'s `enrich()` (`creditPerContract`, `freshPerContract` — feeds the DEFAULT limit price submitted to the broker)
   - `BatchConfirmModal`'s live P&L renderer and its `TakeProfitScale` prop (feeds "Snap to breakeven")
   - `BatchConfirmModal`'s `submitAll()` pre-submit price-drift check
   - the Roll workflow's new-spread quantity sizing
   - audit-entry quantity recording
   - `SetStopLossButton` (GTC/stop price bounds and the AI-suggestion prompt)
   - two card-display sites

   `TakeProfitScale`'s "Snap to breakeven" button (`onChange(Math.max(span, 0.01))`, where `span = Math.max(creditPerContract, 0.01)`) is simply the most direct manifestation: one click sets the live order's limit price straight to this mis-attributed number.

4. **Order construction itself (`buildCloseOrder`, `buildOpenSpreadOrder`, the OCO leg builder in `SetStopLossButton`) is per-leg-correct** — every leg keeps its own true quantity in the actual broker payload. The defect is entirely upstream, in grouping and per-contract economics attribution, not in leg/quantity construction of the submitted order. This matches the sprint's own framing exactly: legs were structurally fine; the price attached to them was computed from the wrong economics.

## Stop-condition decision: PROCEED

`BatchConfirmModal` and `TakeProfitScale` exist exactly where and as the sprint's premise assumed (real, unexported local functions in `app/portfolio/page.tsx`). The actual root cause is broader than the single hypothesis stated (a systemic "arbitrary leg quantity" idiom repeated ~7 times, not just the grouping key alone) but is squarely the kind of "different but in-scope root cause" the sprint pre-authorized implementing. No architecture-stop condition was triggered.

## Design

### Canonical module: `lib/portfolio/closeOrderSafety.ts`

Framework/React-free, independently unit-testable. Exports:

- **`groupEconomicLegs(underlying, expiration, legs)`** — splits legs sharing a symbol+expiration into groups where every leg in a group shares one common quantity. No single coherent multi-leg strategy (vertical spread, iron condor) legitimately has mismatched leg quantities, so a quantity mismatch is proof of two-or-more independent trades, never a false split of a genuine position. Preserves the legacy `${symbol}::${expiration}` key exactly when there is only one quantity present (the common, previously-correct case — existing persisted position-intent overrides, profit targets, and roll inputs keyed by the old format keep working). Only mints a new `${symbol}::${expiration}::${quantity}`-suffixed key when a genuine split occurs, which cannot collide with any pre-existing persisted state (that state never existed for this newly-separated shape).

- **`buildCanonicalCloseIdentity(group, creditReceived)`** — produces the one `CanonicalCloseIdentity` object (`key`, `underlying`, `expiration`, `quantity`, `legs`, `creditReceived`, `creditPerContract`). `creditPerContract` is safe to compute as `creditReceived / (quantity * 100)` specifically because grouping guarantees every leg shares `quantity` — no more arbitrary-leg picking.

- **`computeBreakEvenLimitPrice(identity)`** — the per-contract entry credit, floored at $0.01. Same formula "Snap to breakeven" always used; the fix is that the input is now always safe.

- **`runCloseOrderSafetyGate(input)`** — typed validation gate with stable `SafetyRuleId`s and `'block' | 'warn'` severity:
  - `ZERO_OR_NEGATIVE_QUANTITY`, `EMPTY_LEG_SET`, `LEG_QUANTITY_MISMATCH`, `REQUESTED_QTY_MISMATCH`, `LIMIT_PRICE_NON_POSITIVE` — **block** (never just warn). These are exactly the failure shape that let a real order submit against the wrong economics.
  - `ONE_SIDED_QUOTE`, `STALE_QUOTE` (default 5-minute threshold, overridable) — **warn**, disclosed but non-blocking, consistent with the pre-existing PI-0014 policy of never silently substituting mid for a one-sided "closeValue" quote.

### Residual ambiguity (documented, not silently glossed over)

Two independently-opened spreads sharing symbol, expiration, AND quantity are still merged — this is inherent to broker position data (TastyTrade does not tag positions with an originating ticket ID) and cannot be resolved by grouping alone. This is mitigated, not eliminated, by the enhanced confirmation-modal disclosure below, which shows the exact legs/strikes/quantity being closed so a mismatch is visible before submission. This limitation is called out explicitly in the implementation report rather than left implicit.

### `Position.quantity`

`Position` gained a `quantity: number` field — the single canonical quantity for the position, populated once in `loadPositions()` from the now quantity-consistent leg group. Every one of the ~19 call sites that used to re-derive a stand-in quantity from an arbitrary leg now reads `pos.quantity` directly.

### Wiring into `app/portfolio/page.tsx`

- `loadPositions()`'s grouping loop now buckets by symbol+expiration first (unchanged raw shape), then calls `groupEconomicLegs` per bucket and flattens the canonical sub-groups back into the same `Record<string, any[]>` shape the rest of the function already consumes — the downstream `Object.entries(groups).map(...)` construction code is otherwise untouched.
- `BatchConfirmModal.enrich()` builds a `CanonicalCloseIdentity` per item and runs the safety gate against the order actually being built (`buildCloseOrder`'s output), storing both on the item.
- The `activeItems` memo re-runs the gate whenever an operator overrides the limit price — an override is re-checked by the same gate, not exempted from it.
- `submitAll()` re-runs the gate immediately before each submission (defense in depth against state drift between enrich and submit) and **hard-blocks** (throws, recorded as an `error` result) rather than warning on any block-severity issue.
- `SetStopLossButton.submit()` runs the same gate before constructing its OCO/stop order, since it shares the identical "one price across every leg" shape.
- The confirmation modal's per-item row gained a disclosure block: LIVE/DRY RUN badge, symbol/strategy/quantity, exact legs (strike/quantity/direction), entry credit vs. close limit vs. marketable ask, an explicit fee-exclusion note, and any safety-gate issues rendered with block/warn styling.
- The Roll workflow's new-spread sizing (`pos.legs[0]?.quantity`, previously not even filtered by direction) now uses `pos.quantity`. The roll's candidate-search, categorization, and 1/3-credit-rule validation logic were left untouched — validated, not redesigned, per scope.
- `writeAuditEntry`/`AuditEntry` (the existing `LS_AUDIT_LOG` mechanism) gained `groupKey`, `safetyGateOk`, and `safetyGateIssues` fields rather than a new audit mechanism being introduced.

## Explicitly out of scope (untouched)

PT-0002 (still queued/unapproved in `planning/SPRINT_STATUS.md`), paper-trading integration, new strategies, roll-recommendation/candidate-search logic, broker auth/API shape, Autopilot and `feature/autopilot` (branch not touched, not merged from), Portfolio Intelligence / Opportunity Engine scoring, market-data provider integration, broad UI/mobile redesign, lifecycle features, a commissions engine, live-order testing against a real account, and TakeProfitScale domain expansion beyond what this fix required.

## Testing

`lib/portfolio/__tests__/closeOrderSafety.test.ts` — 26 tests (exceeds the required 20) covering: grouping's no-regression case (single shared quantity keeps the legacy key), a genuine 4-leg iron condor staying merged, the confirmed danger case splitting on quantity mismatch (2-way and 3-way), sign/zero edge cases, canonical identity/break-even math (including a side-by-side reproduction of the OLD wrong "first Short leg" arithmetic vs. the NEW canonical per-spread numbers), and every safety-gate rule ID individually plus in combination. Includes one anonymized, synthetic failure-shape fixture explicitly documented as NOT a copy of any real account's data (no real transaction data exists in this repository to draw from).

See `docs/reviews/ES-0001-Implementation-Report.md` for the full requirements-to-code/test mapping, files changed, and validation results.
