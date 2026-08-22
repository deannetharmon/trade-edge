# LCC-0001B — Technical Specification
Coverage Allocations and Strategy Composition

**Status:** Draft for team review (Dane)
**Depends on:** LCC-0001A (published `ad7bf07`)
**Blocks:** LCC-0001C, LCC-0001D, LCC-0001E
**Traces to:** LCC-0001 epic, LCC-0001B ticket, corrected master architecture
(`docs/design/LCC-0001-technical-architecture.md`), architecture review
(`docs/design/LCC-0001-architecture-review.md`), LCC-0001A technical specification
(`docs/design/LCC-0001A-technical-spec.md`, commit `ad7bf07`), execution sequence, both approved
mockups, and the current repository implementation cited throughout.
**Does not implement application code. Does not begin LCC-0001C.**

---

## 1. Objective

Add durable, auditable support relationships (`CoverageAllocation`) between short calls and their
foundations (shares or a long call), and derive the user-facing Stock/LEAPS/Covered-Call/PMCC
strategy groupings from those relationships plus the LCC-0001A `PortfolioSnapshot`. This is the
direct implementation of master architecture §4.4 (`lib/coverage/`), §5.2–5.4, and §7.1.

---

## 2. Exact affected files, functions, types, and components

### 2.1 New modules (this ticket's primary deliverable)

| File | Contents |
|---|---|
| `lib/coverage/types.ts` | `CoverageAllocation`, `AllocationStatus`, `AllocationSource`, `PmccOrigination`, `AuditEvent`, `DerivedStrategy` |
| `lib/coverage/invariants.ts` | Pure invariant checks (§6) |
| `lib/coverage/deriveStrategy.ts` | Pure strategy projection (§8) |
| `lib/coverage/inference.ts` | Single-eligible-foundation preselect / confirmation-required logic (§7) |
| `lib/coverage/store.ts` | Client-side fetch/post helpers, mirrors `stopPolicyStore.ts` exactly (§10.2) |
| `lib/coverage/__tests__/*` | Test suite (§15) |
| `app/api/coverage-allocations/route.ts` | GET/POST, mirrors `app/api/position-stop-policies/route.ts` (§10.1) |
| `app/api/coverage-allocations/[id]/release/route.ts` | POST, explicit unlink (§9) |

### 2.2 Existing files consumed, unmodified

| File | Role |
|---|---|
| `lib/portfolio-snapshot/types.ts` (`PortfolioSnapshot`, `EquityHolding`) | Input to allocation eligibility and strategy derivation — LCC-0001A, unmodified. |
| `lib/portfolio-data/types.ts` (`Position`) | Long-call/short-call foundation and dependent identity — unmodified. |
| `lib/scans/financials.ts` (`resolveOptionContractMultiplier`, `STANDARD_EQUITY_OPTION_MULTIPLIER`) | Adjusted-deliverable multiplier resolution for `CoverageAllocation.contractMultiplier` — reused per corrected master architecture §15.2. |
| `lib/optionSymbol.ts` (`parseOccSymbol`) | Underlying/expiration extraction for compatibility checks (§6.4). |
| `lib/portfolio/positionLifecycle.ts` (`isPmccPosition`, `isCoveredCall`, `isAssignedStock`) | **Not reused for derivation.** Per the architecture review's Finding A, these operate on legs within one already-bucketed `Position` and cannot see a PMCC's two (different-expiration) legs together. `deriveStrategy.ts` (§8) is new logic operating across positions, not a wrapper around these functions. They remain in place, unmodified, for whatever their current (pre-LCC-0001) callers use them for. |
| `lib/portfolio/closeOrderSafety.ts` | Unmodified. Its `runLiveCloseOrderSafetyGate`/`SafetyRuleId` set governs **option** close orders only — verified no equivalent gate exists for equity share-sell orders anywhere in the current codebase (`app/portfolio/page.tsx` has no equity-sell order path today). This ticket does not add one either (order submission is LCC-0001C/D scope) — see §9's scope boundary. |

### 2.3 Existing files extended (additive)

| File | Change |
|---|---|
| `components/portfolio-data/PortfolioDataProvider.tsx` | Extended to also fetch and expose the user's `CoverageAllocation[]` alongside the LCC-0001A `snapshot` field, following the same fetch-on-mount/refresh pattern `fetchStopPolicies()` already uses. |
| `app/portfolio/page.tsx` | Additive: allocation summary, strategy grouping rendering (§11), coverage-choice dialog trigger. No changes to existing option-card rendering or close-order modals. |

---

## 3. Reuse / extend / refactor / replace classification

| Component | Classification |
|---|---|
| `lib/portfolio-snapshot/*` (LCC-0001A) | **Reuse, unmodified** — sole input to this ticket's eligibility/derivation logic. |
| `stopPolicyStore.ts` / `position-stop-policies/route.ts` persistence pattern | **Reuse (pattern only, not code)** — `lib/coverage/store.ts` and its API route are new files following this pattern exactly, not imports of the stop-policy module itself. |
| `positionLifecycle.ts` classifiers | **Not reused for LCC-0001B's derivation** — see §2.2. Left in place unmodified; superseding them for any of their existing callers is out of scope for this ticket. |
| `PortfolioDataProvider.tsx` | **Extend** — additive context field, no existing field's shape or timing contract changes. |
| `app/portfolio/page.tsx` | **Extend** — additive rendering only. |
| `resolveOptionContractMultiplier` (financials.ts) | **Reuse, unmodified.** |
| Equity-sell / foundation-close order submission | **Does not exist yet; not created by this ticket** — LCC-0001B defines the *invariant* that blocks it (§6.5) and the *check* a future order-submission path must call (§9), but does not implement order submission itself (LCC-0001C/D scope, per that ticket's explicit non-goal "Order entry or broker submission"). |

---

## 4. CoverageAllocation domain model and persistence contract

### 4.1 Type (extends master architecture §5.2 with implementation-level precision)

```ts
// lib/coverage/types.ts

export type AllocationStatus = 'proposed' | 'active' | 'released' | 'unresolved' | 'corrected';
export type AllocationSource = 'inferred' | 'userConfirmed' | 'imported' | 'migrated';
export type PmccOrigination = 'CREATED_TOGETHER' | 'ADDED_TO_EXISTING_LONG_CALL';
export type FoundationType = 'equity' | 'longCall';

export interface CoverageAllocation {
  id: string;                          // ULID/UUID; stable identity, survives rolls (new id per
                                         // cycle, per master architecture §7.3 — a roll creates a
                                         // NEW allocation, never edits this one's id)
  accountNumber: string;
  underlying: string;
  shortCallPositionKey: string;        // Position.key of the short call (existing Position identity)
  shortCallQuantity: number;
  foundationType: FoundationType;
  // For foundationType 'equity': EquityHolding.symbol (== underlying) + accountNumber is the
  // foundation identity (equity holdings have no separate Position.key — LCC-0001A does not
  // introduce one). For 'longCall': Position.key of the long call.
  foundationPositionKey: string;
  allocatedQuantity: number;           // shares (equity) or contracts (longCall, always 1 per
                                         // standard short-call allocation per invariant 3, §6.3)
  contractMultiplier: number;          // via resolveOptionContractMultiplier; 100 standard
  effectiveFrom: string;               // ISO timestamp
  effectiveTo: string | null;
  status: AllocationStatus;
  source: AllocationSource;
  origination: PmccOrigination | null; // null for foundationType 'equity'; required for 'longCall'
  audit: AuditEvent[];
}

export interface AuditEvent {
  at: string;                          // ISO timestamp
  actor: 'user' | 'system' | 'migration';
  action: 'created' | 'confirmed' | 'released' | 'corrected' | 'reallocated';
  detail: string;                      // human-readable, never used for calculation
  previousStatus: AllocationStatus | null;
  newStatus: AllocationStatus;
}
```

**Deliberately excluded from this ticket's persisted shape:** anything related to short-call
lifecycle transitions (`Proposed → Pending → Open → ...`, LCC-0001D), roll linkage, or reconciliation
items. `CoverageAllocation.status` in this ticket tracks the **relationship's** state (is this
foundation currently backing this short call), not the short call's own order/position lifecycle,
which LCC-0001D owns separately. This boundary is intentional and is restated in §16.

### 4.2 Persistence contract

Follows `position-stop-policies` exactly (§2.1 file list), not a new pattern:

- Redis, one JSON blob per authenticated user: `coverage-allocations:{userId}`.
- Store shape: `Record<string, CoverageAllocation>` keyed by `CoverageAllocation.id`.
- `GET /api/coverage-allocations` returns the full store for the session user.
- `POST /api/coverage-allocations` **upserts** (unlike stop policies' always-overwrite-by-key
  semantics, this upserts by `id` — a `CoverageAllocation` is a first-class auditable record, not a
  provenance cache that's disposable and re-derivable). Server-side, every POST is validated against
  `lib/coverage/invariants.ts` (§6) before being written — **the server never trusts a client-supplied
  `status` or `allocatedQuantity` without re-running invariant checks against the caller's own current
  snapshot-derived eligibility.** This is the concrete implementation of the master architecture's
  §13.1 security requirement ("Allocation writes are exclusively mediated by
  `lib/coverage/invariants.ts`").
- `POST /api/coverage-allocations/[id]/release` is a separate, narrower endpoint (not a generic PATCH)
  that only ever transitions `status` toward `'released'` and appends an `AuditEvent` — this
  intentionally narrow surface is what makes "an allocation edit cannot rewrite a transaction" a
  structural guarantee (master architecture §7.6/§12) rather than a convention: there is no API path
  that lets a client write to a `Position`'s fields via this route at all.

---

## 5. Stock and long-call foundation eligibility

Pure function, `lib/coverage/inference.ts::findEligibleFoundations()`:

```ts
export interface EligibleFoundation {
  type: FoundationType;
  positionKey: string;          // EquityHolding symbol+account, or Position.key
  availableQuantity: number;    // standard units (100-share lots, or 1 per long call)
  deliverable: 'standard' | 'adjusted';
}

export function findEligibleFoundations(
  snapshot: PortfolioSnapshot,
  underlying: string,
  existingAllocations: CoverageAllocation[],
): EligibleFoundation[]
```

Eligibility rules (directly implementing LCC-0001B ticket scope + epic invariants):

- **Equity foundation eligible** iff `EquityHolding.direction === 'Long'`, `quantity >= 100`
  (standard) or a valid adjusted-deliverable quantity, and `quantity - sum(active/proposed
  allocations against it) > 0` after applying the capacity formula from LCC-0001A §8
  (`floor(shares/100)` minus existing allocation).
- **Short equity is never eligible** — `direction === 'Short'` is filtered out unconditionally
  (epic invariant 5 / LCC-0001B rule "Short stock never provides covered-call support"). This is
  enforced here, at eligibility time, and again in `invariants.ts` (§6.2) as defense in depth — an
  allocation must never become possible against short stock even if a future caller bypasses
  `inference.ts`.
- **Long-call foundation eligible** iff the `Position` is a standalone long call (no existing short
  leg in the same `Position` — consistent with LCC-0001A's unmodified option grouping, where a long
  call with no paired short leg is its own `Position`) and it has **zero** active/proposed
  allocations against it already (invariant 3, §6.3 — one long call supports at most one simultaneous
  standard short call).
- **Adjusted-deliverable long calls or equity** are eligible but flagged `deliverable: 'adjusted'`,
  which forces `inference.ts`'s confirmation-required path (§7) rather than auto-preselection,
  per the ticket's explicit rule ("Require user confirmation when... contract deliverables are
  adjusted").

---

## 6. Capacity, reservation, allocation, and release invariants

`lib/coverage/invariants.ts` — pure, no I/O, directly implementing master architecture §5.3
(invariants 1–8, including the corrected invariant 8 from the architecture-review revision).

### 6.1 Capacity (invariant 1)

```ts
export function validateCapacity(
  foundation: EligibleFoundation,
  existingAllocations: CoverageAllocation[],
  requestedQuantity: number,
): { ok: true } | { ok: false; reason: string }
```

`sum(active + proposed allocations against this foundation) + requestedQuantity <=
foundation.availableQuantity`. Standard: floor to 100-share/1-contract units. Adjusted: actual
deliverable quantity from the position's adjusted-contract evidence, never assumed to be 100.

### 6.2 Short-stock exclusion (invariant 2)

`validateFoundationType(foundation)`: rejects any attempt to allocate against an `EquityHolding`
with `direction === 'Short'`, unconditionally, regardless of caller. Returns a typed rejection, never
throws — callers (API route, §4.2) turn this into an HTTP 422/400, not a 500.

### 6.3 Single long-call capacity (invariant 3)

`validateLongCallSingleUse(foundation, existingAllocations)`: for `foundationType: 'longCall'`,
rejects if any `active` or `proposed` allocation already references this `foundationPositionKey`.
No quantity math — this is a hard 0-or-1 rule, not a divisible capacity like equity.

### 6.4 PMCC compatibility (invariant 4)

```ts
export function validatePmccCompatibility(
  shortCall: Position,
  longCall: Position,
): { ok: true } | { ok: false; reason: string }
```

Checks, using `parseOccSymbol()` on both legs' OCC symbols:
- Same `underlyingSymbol`.
- `longCall.expDate > shortCall.expDate` (epic invariant 4 — long must expire after short).
- Deliverable compatibility: both standard, or both carrying matching adjusted-deliverable evidence
  (mismatched adjusted deliverables are rejected, not silently allowed).

### 6.5 Foundation-close block (invariant 5, corrected per architecture review §15.0)

```ts
export function canCloseFoundation(
  foundationPositionKey: string,
  allocations: CoverageAllocation[],
): { allowed: true } | { allowed: false; blockingAllocationIds: string[] }
```

**Unconditional block** — per the resolved product decision (master architecture §15.0), there is
**no override parameter, no "authorized uncovered" flag, no privileged bypass** anywhere in this
function's signature or callers. If any `active` or `proposed` allocation references this foundation,
closure is blocked, full stop. The only way past this function returning `allowed: false` is for the
allocation to first reach `'released'` status through the explicit unlink workflow (§9) — there is no
other code path. This function is the concrete artifact that a future order-submission flow
(LCC-0001C/D) must call before permitting any equity-sell or long-call-close order that would reduce
a foundation below what active allocations require; **this ticket defines and unit-tests the function,
it does not wire it into an order-submission path**, since no equity-sell order path exists yet
(§2.2) and option-close order submission is `closeOrderSafety.ts`'s domain, unmodified here.

### 6.6 Reservation-release invariant (invariant 8, added in the architecture-review revision)

`releaseProposedOnOrderTerminal(allocation, orderTerminalStatus)`: a `'proposed'` allocation
transitions to `'released'` (with an `AuditEvent`, `actor: 'system'`) when its backing working order
reaches a terminal non-fill state (cancelled, rejected, expired) — sourced from the LCC-0001A
`PortfolioSnapshot.workingOrders` on each refresh, not a separate poll. This is a pure function
(`invariants.ts`), called by `lib/coverage/store.ts`'s reconciliation pass (§13) each time a fresh
snapshot is obtained, comparing the previous and current `workingOrders` lists.

### 6.7 Double-allocation prevention (ticket-level requirement, composite of 6.1 + 6.3)

Explicitly named as its own requirement in the assignment; implemented as the conjunction of §6.1
(equity capacity) and §6.3 (long-call single-use) rather than a separate function — there is no
double-allocation scenario invariants 1 and 3 don't already jointly cover. Test matrix (§15) includes
a dedicated case exercising both together (allocate against shares, then attempt a second allocation
against the same shares beyond remaining capacity → rejected; allocate against a long call, then
attempt a second short call against the same long call → rejected regardless of quantity).

---

## 7. Short-call-to-foundation compatibility rules and inference/confirmation

`lib/coverage/inference.ts::inferOrRequireConfirmation()`:

```ts
export type InferenceResult =
  | { decision: 'preselected'; foundation: EligibleFoundation }
  | { decision: 'confirmationRequired'; eligible: EligibleFoundation[]; reason: string };

export function inferOrRequireConfirmation(
  eligible: EligibleFoundation[],
  context: { shortCallQuantity: number; deliverableKnown: boolean },
): InferenceResult
```

Directly implements LCC-0001B's "Inference and confirmation" scope:

- **Preselect** iff `eligible.length === 1` **and** that single foundation's quantity, underlying,
  expiration (for long-call), allocation, and deliverable rules are all unambiguous (i.e., the one
  eligible foundation passes every §6 invariant for the requested quantity with no adjustment needed).
- **Require confirmation** iff: shares and a long call are both eligible; multiple long calls/lots
  are eligible; quantities don't align exactly; deliverables are adjusted; broker history is
  incomplete (`EquityHolding.basisComplete === false` or `dataQualityWarnings` non-empty for the
  relevant holding); or an existing active allocation would be changed by this action.
- This function **never writes** — it is purely advisory, consumed by LCC-0001C's entry workflows
  (out of scope here, restated in §16) and by the "What supports this short call?" mockup dialog's
  data source when LCC-0001B's own Portfolio UI surfaces an unresolved/ambiguous allocation (§11).

---

## 8. Derived strategy projections

`lib/coverage/deriveStrategy.ts::deriveStrategy()` — pure, per-underlying projection, matching
master architecture §5.4 exactly, with implementation-level detail added.

```ts
export type DerivedStrategyType =
  | 'StockOnly' | 'LongCallOnly' | 'StockCoveredCall' | 'PmccLongCallDiagonal'
  | 'ReadyForNextCall' | 'ActionNeeded' | 'CoverageUnresolved' | 'Closed';

export interface DerivedStrategy {
  underlying: string;
  accountNumber: string;
  type: DerivedStrategyType;
  origination: PmccOrigination | null;   // present only when type === 'PmccLongCallDiagonal'
  contributingPositionKeys: string[];    // every Position.key / equity identity involved, for
                                          // P/L-deduplication (§8.1)
  activeAllocationIds: string[];
}

export function deriveStrategy(
  underlying: string,
  snapshot: PortfolioSnapshot,
  allocations: CoverageAllocation[],
): DerivedStrategy[]   // one underlying can have more than one concurrent strategy, e.g. shares
                        // AND an independent long call on the same symbol
```

### 8.1 Classification logic (deterministic, in priority order)

1. **`StockOnly`** — long equity holding exists for this underlying, no active/proposed allocation
   references it.
2. **`LongCallOnly`** — a standalone long-call `Position` exists, no active/proposed allocation
   references it as a foundation. (Directly answers "standalone LEAPS" — LCC-0001C's acceptance
   criterion: recording only the long-call execution shows `Foundation Only`/`LongCallOnly`.)
3. **`StockCoveredCall`** — an active allocation exists with `foundationType: 'equity'`.
4. **`PmccLongCallDiagonal`** — an active allocation exists with `foundationType: 'longCall'`.
   `origination` is copied directly from the allocation's own `origination` field (§4.1) — **not**
   re-derived from timing, per the corrected master architecture §5.4/§15.0.
5. **`ReadyForNextCall`** — a foundation (equity or long call) has a `released` allocation as its
   most recent allocation history entry, full available capacity, and no active/proposed allocation.
   Distinguished from `StockOnly`/`LongCallOnly` (which have never had an allocation) purely for UI
   framing (mockup: "Ready for Next Call" surfaces differently from a foundation that's never been
   used) — same underlying invariants apply to both.
6. **`ActionNeeded`** — a short-call `Position` exists (per LCC-0001A's option adapter) with **no**
   active or proposed `CoverageAllocation` referencing it at all. This is the direct implementation
   of LCC-0001C's "Short fills without sufficient foundation → Action Needed" acceptance criterion,
   projected here rather than computed ad hoc by the entry workflow.
7. **`CoverageUnresolved`** — an allocation exists with `status: 'unresolved'` (set by LCC-0001D's
   reconciliation logic in a later ticket, or by this ticket's own ambiguous-import handling, §12).
8. **`Closed`** — every position and allocation for this underlying is closed/released with no
   current holdings. Purely a display state; not separately persisted.

### 8.2 P/L deduplication (ticket-required acceptance criterion)

`deriveStrategy()` also exposes `contributingPositionKeys` specifically so that a symbol-level P/L
rollup (Portfolio UI, §11) can sum each contributing `Position`/`EquityHolding` **exactly once**
even when it participates in multiple derived-strategy entries for display purposes (e.g., a long
call showing under both its own `LongCallOnly` history entry and the `PmccLongCallDiagonal` it now
backs). The rollup function itself (`sumTotalSymbolExposure()`, same module) de-duplicates by
`Position.key`/equity identity before summing, never by strategy entry — this is the literal
mechanism satisfying the LCC-0001B acceptance criterion ("shares, a stock covered call, a long call,
and a PMCC short call... each instrument contributes exactly once").

---

## 9. Explicit link, unlink, and reallocation workflows

These are **API-level operations** this ticket defines and persists; the **UI entry points** that
call them belong partly to this ticket (the Portfolio-side "coverage choice" and "unlink" actions
shown in Diane's mockups) and partly to LCC-0001C (trade-entry-time linking, which happens as a
byproduct of recording an execution, not a standalone action). This ticket implements the API and the
Portfolio-side manual actions; LCC-0001C wires its own entry-workflow call sites into the same API.

### 9.1 Link (create allocation)

`POST /api/coverage-allocations` with `status: 'active'`, `source: 'userConfirmed'` (manual link from
Portfolio) or `'inferred'` (auto-preselected per §7, still requires the create call, just not a
confirmation dialog first). Server validates via `invariants.ts` (§4.2) before writing. This is the
mechanism behind the "What supports this short call?" mockup dialog and the "Choose the intended
MSFT relationship" ambiguity-resolution mockup state.

### 9.2 Unlink (explicit release, not the same as §6.6's automatic release)

`POST /api/coverage-allocations/[id]/release`, `actor: 'user'`. Requires the allocation to currently
be `'active'` or `'proposed'`; transitions to `'released'`. This is a **relationship** edit only — it
never touches the underlying `Position` or `EquityHolding`, and never fabricates a cash flow (epic
invariant 9), per §4.2's narrow-endpoint design. The short call itself remains open and now shows as
`ActionNeeded` (§8.1 item 6) until re-linked or closed through whatever lifecycle mechanism LCC-0001D
introduces.

### 9.3 Reallocation (unlink + link as one user-visible action)

Not a separate API endpoint — implemented client-side as an unlink call followed by a link call
against a different foundation, both against the real API, with the UI presenting it as one flow
("Choose the intended relationship" / foundation-replacement-adjacent mockup states). Kept as two
discrete, independently-auditable API calls (not a combined transaction endpoint) so the audit trail
always shows the explicit release before the explicit creation — consistent with the epic's
audit-history-over-convenience principle (invariant 9, "Relationship changes cannot rewrite
transactions or fabricate cash flow").

---

## 10. API/service boundaries

### 10.1 API routes

```
GET  /api/coverage-allocations             → { allocations: Record<string, CoverageAllocation> }
POST /api/coverage-allocations             → upsert one or more; validated server-side via
                                               lib/coverage/invariants.ts against the caller's
                                               current PortfolioSnapshot (fetched server-side or
                                               passed by the client and re-verified — see §13
                                               observability note on trusting client-supplied
                                               snapshots)
POST /api/coverage-allocations/[id]/release → narrow, release-only (§9.2)
```

Modeled exactly on `app/api/position-stop-policies/route.ts`: `getServerSession(authOptions)`,
`ioredis` client, `redisKey(userId)` helper, `Record<string, T>` blob shape. No new persistence
technology.

### 10.2 Client-side service module

`lib/coverage/store.ts` mirrors `stopPolicyStore.ts` exactly:

```ts
export function coverageAllocationKey(accountNumber: string, id: string): string // if needed for
                                                                                    // multi-account
                                                                                    // scoping later
export async function fetchCoverageAllocations(): Promise<Record<string, CoverageAllocation>>
export async function postCoverageAllocation(allocation: CoverageAllocation): Promise<...>
export async function releaseCoverageAllocation(id: string): Promise<...>
```

Same best-effort, non-blocking failure convention as `stopPolicyStore.ts` (a failed persist doesn't
corrupt local state; it's retried on next refresh) — **with one deliberate deviation**: unlike stop
policies (which are a disposable, re-derivable provenance cache), a `CoverageAllocation` is the
**primary record** of a user's coverage decision. A failed POST must surface as a visible error to
the user (not silently swallowed), since silently failing to persist a coverage link could leave the
UI showing a relationship the server never actually recorded. This is called out explicitly because
it is the one place this ticket's persistence pattern intentionally departs from its `stopPolicyStore`
template, and that departure should not be lost during implementation.

---

## 11. Portfolio UI integration (mockup-aligned)

Per Diane's [Equity-Aware Portfolio mockup](../tickets/mockups/tradeedge-equity-portfolio-revision.html)
and the execution sequence's LCC-0001B mockup-map row ("Mixed AAPL Position, Stock Holding Detail,
Working Reservation, Blocked Close"):

- **Mixed AAPL Position** (deferred from LCC-0001A, §18 of that spec): now implemented — Portfolio
  groups by underlying (§5.4/8.1's per-underlying `DerivedStrategy[]`), visibly separates the
  stock-backed strategy from the long-call-backed strategy per-underlying, keeps each instrument
  independently clickable/accessible, and shows allocated/reserved/available/remainder shares (the
  figure LCC-0001A explicitly deferred).
- **Stock Holding Detail**: equity row expands to show its `CoverageAllocation`s (active + released
  history) and the "Share allocation" breakdown from the mockup.
- **Working Reservation**: `'proposed'` allocations tied to a live sell-to-open order rendered
  distinctly from `'active'` ones, consistent with the mockup's "Related option" / reservation
  styling.
- **Blocked Close**: when a user attempts to close a foundation with an active allocation (via
  whatever close action exists today for that instrument type — option close via existing
  `closeOrderSafety.ts` UI, or, since no equity-sell path exists yet, this state is UI-only /
  informational in this ticket, not gating an actual order flow), `canCloseFoundation()` (§6.5)
  determines the blocking message, matching the mockup's "Blocked Close" copy pattern.
- **Total symbol exposure P/L**: rendered using `sumTotalSymbolExposure()` (§8.2).
- Feature-flagged independently from LCC-0001A's equity-display flag, per that ticket's established
  pattern — allocation display and strategy grouping can roll out after equity display is already
  stable.

**Not implemented in this ticket's UI** (LCC-0001C scope): any action button that *creates* a new
position from a plan (Sell Call Against Position, New PMCC entry, etc.) — this ticket's UI surfaces
existing allocations and lets a user manually link/unlink/reallocate against **already-held**
positions/shares, but does not add trade-entry flows.

---

## 12. Ambiguous imported-position handling

"Imported" here means: an existing option/equity position already present in the LCC-0001A snapshot
that has no `CoverageAllocation` yet, discovered on first load after this ticket ships (not
broker-sync reconciliation, which is LCC-0001D's `source: 'imported'`/`'migrated'` machinery run
against historical PMCC records specifically).

- On first Portfolio load after this ticket's rollout, for each underlying with both an eligible
  equity foundation and an eligible long-call foundation **and** an existing short call with no
  allocation, `inference.ts` returns `confirmationRequired` (§7) — the user sees the "Choose the
  intended relationship" dialog rather than TradeEdge silently guessing.
- If exactly one foundation is eligible and unambiguous, an `allocation` with `source: 'inferred'`
  is created automatically (§7 preselect rule) — **but only in suggestion-only mode initially**, per
  the ticket's rollout requirement ("First run inference in suggestion-only mode"): the inferred
  allocation is created with `status: 'proposed'` (not `'active'`) and surfaced for one-click
  confirmation rather than silently treated as active. This is a deliberate, ticket-mandated
  weakening of the normal `'proposed'` semantics (§4.1, normally reserved for working-order
  reservations) — restated explicitly here so implementation doesn't conflate "inferred-pending-
  confirmation" with "working-order-pending-fill"; both use `status: 'proposed'` but for different
  reasons, distinguished by `source`.
- A short call with **no** eligible foundation at all (LCC-0001A's data-quality gaps, or a genuinely
  uncovered naked position) classifies as `ActionNeeded` (§8.1 item 6) and creates no allocation —
  fail-closed, matching epic invariant 15.

---

## 13. Reconciliation implications

This ticket does **not** implement LCC-0001D's reconciliation queue. It does implement the one piece
of reconciliation-adjacent behavior explicitly in its own scope:

- §6.6's automatic release of `'proposed'` allocations on order-terminal-state (a narrow,
  snapshot-driven comparison, not a queue).
- `status: 'unresolved'` as a valid `CoverageAllocation` state (§4.1) that LCC-0001D's reconciliation
  logic will later populate and clear — this ticket defines the state and `deriveStrategy()`'s
  handling of it (§8.1 item 7), but does not implement any detection logic beyond §12's ambiguous-
  import case.
- **Server-side snapshot trust boundary** (referenced in §10.1): allocation-creation requests must be
  validated against a snapshot the server itself considers current, not one blindly trusted from the
  client, to prevent a stale/manipulated client state from creating an allocation that violates
  capacity. Given the existing browser-side-only TastyTrade constraint, the practical implementation
  is: the client includes its `PortfolioSnapshot.asOf` timestamp with the POST, and the server
  rejects (422) if that timestamp is older than a short staleness threshold, rather than the server
  re-fetching from TastyTrade itself (which would violate the existing IP-blocking constraint). This
  is a **new, ticket-specific decision** not present in the master architecture and is flagged as an
  open item for team confirmation, §17.

---

## 14. Error handling, auditability, and observability

- **Error handling**: every `invariants.ts` function returns a typed rejection (`{ ok: false; reason:
  string }`), never throws for an expected business-rule violation; the API routes translate these to
  4xx responses with the reason string surfaced to the UI (per LCC-0001B's own note: "TradeEdge
  requires a coverage choice" — the UI needs the reason text to explain *why*, not just that it
  failed).
- **Auditability**: every `CoverageAllocation` carries its full `AuditEvent[]` history, append-only.
  No API path ever removes an entry from this array — `release`/`reallocate` append, never rewrite.
- **Observability**: allocation-creation rejections (capacity exceeded, incompatible deliverable,
  etc.) are logged server-side with account identifiers redacted, following LCC-0001A's established
  `warnings[]` logging convention. A simple count of `status: 'unresolved'` allocations is exposed as
  a metric, anticipating LCC-0001D's fuller reconciliation dashboard without building it here.

---

## 15. Unit, integration, and acceptance-test matrix

| Test | Type | Location | Traces to |
|---|---|---|---|
| `validateCapacity`: exact-fit, over-allocation, adjusted deliverable | Unit | `lib/coverage/__tests__/invariants.test.ts` | LCC-0001B "Share allocation" acceptance criterion |
| `validateFoundationType`: short stock always rejected | Unit | Same | Epic invariant 5 |
| `validateLongCallSingleUse`: second allocation against same long call rejected | Unit | Same | LCC-0001B "Long-call allocation" acceptance criterion, epic invariant 3 |
| `validatePmccCompatibility`: underlying mismatch, expiration ordering, deliverable mismatch | Unit | Same | Epic invariant 4, ticket "PMCC legs must share underlying and compatible deliverables" |
| `canCloseFoundation`: unconditional block, no override path exists (type-level check: function signature has no bypass parameter) | Unit | Same | LCC-0001B "Blocked foundation close" acceptance criterion, corrected master architecture §15.0 |
| `releaseProposedOnOrderTerminal`: cancelled/rejected/expired order releases proposed allocation | Unit | Same | Architecture review correction (invariant 8) |
| Double-allocation prevention (equity capacity + long-call single-use combined) | Unit | Same | Ticket-level "Prevention of double allocation" requirement |
| `findEligibleFoundations`: equity/long-call/adjusted eligibility combinations | Unit | `lib/coverage/__tests__/inference.test.ts` | §5 |
| `inferOrRequireConfirmation`: single unambiguous → preselect; multiple/adjusted/incomplete-basis → confirmation required | Unit | Same | LCC-0001B "Ambiguous coverage" acceptance criterion |
| `deriveStrategy`: all 8 derived types, one per fixture combination | Unit | `lib/coverage/__tests__/deriveStrategy.test.ts` | Master architecture §5.4, LCC-0001B "Derived strategies" scope |
| `deriveStrategy`: PMCC origination correctly copied from allocation, never re-derived from timing | Unit | Same | Corrected master architecture §5.4/§15.0 |
| `sumTotalSymbolExposure`: P/L deduplication across shares + covered call + long call + PMCC | Unit | `lib/coverage/__tests__/pnl.test.ts` | LCC-0001B "P/L deduplication" acceptance criterion |
| `POST /api/coverage-allocations`: server-side invariant re-validation rejects a client-crafted violation | Integration | `app/api/coverage-allocations/__tests__/route.test.ts` | Master architecture §13.1 |
| `POST .../release`: narrow endpoint cannot mutate any field but status/audit | Integration | Same | §9.2, epic invariant 9 |
| Staleness-threshold rejection on stale client snapshot timestamp | Integration | Same | §13 open item — write test once team confirms the threshold value |
| `PortfolioDataProvider`: allocations fetched alongside snapshot, generation-gated same as `Position[]` | Integration | `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx` (extends LCC-0001A's) | Consistency with LCC-0001A's PI-0014C convention |
| Ambiguous import: existing uncovered short call with two eligible foundations surfaces confirmation, creates no allocation until confirmed | Integration | `lib/coverage/__tests__/ambiguousImport.test.ts` | §12 |
| Suggestion-only inferred allocation: created as `proposed`, not `active`, until user confirms | Integration | Same | §12, ticket rollout requirement |
| Portfolio composition: Mixed AAPL Position, Stock Holding Detail, Working Reservation, Blocked Close render correctly | Component | `app/portfolio/__tests__/PortfolioPage.test.tsx` (extended) | §11, execution sequence mockup map |
| Existing Portfolio close-order safety tests remain green (regression) | Existing suite, unmodified | `lib/portfolio/__tests__/closeOrderSafety.test.ts` | LCC-0001B validation requirement |
| `npx tsc --noEmit --incremental false` | Type check | CI | Standing convention |
| Full Vercel preview build | Build | Manual/CI per PR | Standing convention (page.tsx changes) |
| `git diff --check` | Lint | CI | Standing convention |

---

## 16. Acceptance-criterion traceability

| LCC-0001B acceptance criterion | Implementing mechanism |
|---|---|
| Share allocation (250 shares, one short call → 100 allocated, 1 additional unit available, 50 remainder) | §6.1 `validateCapacity`, §11 remainder display |
| Long-call allocation (one eligible long call, one short call linked → PMCC, zero remaining capacity) | §6.3 `validateLongCallSingleUse`, §8.1 item 4 |
| Action availability (fully allocated foundation → `Manage Short Call`, no new sell action) | §8.1 (derived strategy drives UI action visibility; exact button wiring is LCC-0001C/E scope, restated §18) |
| Ambiguous coverage (shares + long call both eligible → coverage choice required) | §7 `inferOrRequireConfirmation`, §9.1 link workflow |
| Blocked foundation close (active allocation → close blocked until resolved) | §6.5 `canCloseFoundation`, unconditional per §15.0 |
| P/L deduplication (shares + covered call + long call + PMCC short call, each counted once) | §8.2 `sumTotalSymbolExposure` |

All six acceptance criteria map to an explicit, named, testable mechanism.

---

## 17. Migration and rollout plan

No historical-PMCC migration in this ticket (that is LCC-0001D's `source: 'migrated'` scope). This
ticket's own rollout, per its "Rollout" section:

1. **PR 1** — `lib/coverage/types.ts`, `invariants.ts`, full unit coverage. No consumer wiring, no
   API route yet. Zero production behavior change.
2. **PR 2** — `lib/coverage/deriveStrategy.ts`, `inference.ts`, unit coverage against LCC-0001A
   snapshot fixtures. Still zero visible change.
3. **PR 3** — `app/api/coverage-allocations/route.ts` + `[id]/release/route.ts`, `lib/coverage/store.ts`.
   Server-side invariant re-validation and the staleness-threshold check (§13 open item — needs team
   confirmation before this PR, not after) land here.
4. **PR 4** — `PortfolioDataProvider` wiring, **inference running in suggestion-only mode** (§12),
   behind its own feature flag, independent of LCC-0001A's equity-display flag.
5. **PR 5** — Portfolio UI (§11): allocation display, coverage-choice dialog, blocked-close messaging.
   Flagged independently again, so allocation *data* can stabilize before allocation *UI* ships.
6. **PR 6** — enable enforcement (require confirmation for migrated/ambiguous relationships, per the
   ticket's rollout note) and surface the reconciliation-adjacent queue (§13) before any blocking
   behavior becomes the unconditional default experience for all users.

Each PR requires a full Vercel preview build for any change touching `app/portfolio/page.tsx`, per
standing convention.

---

## 18. Explicit exclusions — deferred to LCC-0001C through E

- **Order entry and broker submission** for any position (buying shares, buying/selling calls) —
  entirely LCC-0001C. This ticket only ever links/unlinks relationships between **already-held**
  positions and shares.
- **`Sell Call Against Position` / `New PMCC` / buy-write entry workflows** and their UI action
  buttons — LCC-0001C. This ticket's UI (§11) surfaces existing coverage state; it does not add the
  buttons that create new positions.
- **Execution-evidence-driven allocation creation** (an allocation created automatically as a
  byproduct of confirming a fill, per master architecture §8) — LCC-0001C wires its entry workflows
  to call this ticket's `POST /api/coverage-allocations`, but building those entry workflows is not
  in this ticket.
- **Short-call lifecycle state machine** (`Proposed → Pending → Open → ...`), rolls, expiration,
  assignment — LCC-0001D. This ticket's `CoverageAllocation.status` tracks the relationship only, not
  the short call's own order/position state.
- **Foundation replacement workflow** (close original, open replacement, revalidate every active
  allocation, retain both in history) — LCC-0001D, though this ticket's `canCloseFoundation` (§6.5)
  and the unlink/reallocate primitives (§9) are the building blocks LCC-0001D's replacement flow will
  call.
- **Historical PMCC migration** (`source: 'migrated'`, ambiguity reports, dry-run/rollback) —
  LCC-0001D, though `source: 'migrated'` and `origination` are already present in this ticket's type
  (§4.1) so LCC-0001D does not need a schema change to consume them.
- **Reconciliation queue and its full trigger list** (missing events, duplicate executions,
  corrected/reversed executions, snapshot/history disagreement, etc.) — LCC-0001D. This ticket only
  implements the narrow §6.6/§12 pieces explicitly in its own ticket scope.
- **Find LEAPS / Find Covered Calls / Find PMCCs / Calls Against My Positions scanner reframing** —
  LCC-0001E. This ticket's `findEligibleFoundations`/`inferOrRequireConfirmation` are designed to be
  directly reusable by LCC-0001E's "Calls Against My Positions" launcher, but wiring that launcher up
  is not in this ticket.
- **PMCC scoring** — out of scope for this ticket and the epic generally, per the resolved product
  decision (master architecture §15.0); not applicable to this ticket's domain in the first place.

---

## 19. Self-review against source material

- **Epic:** cross-ticket invariants 2, 3, 4, 5, 6, 8, 9 are each implemented by a named function in
  §6 with a corresponding unit test in §15; invariant 15 (fail-closed on unresolvable coverage) is
  implemented at §5 (eligibility exclusion) and §12 (no-eligible-foundation → `ActionNeeded`, no
  allocation created).
- **LCC-0001B ticket:** every scope item (allocation model, allocation rules, derived strategies,
  Portfolio composition, inference/confirmation) and all six acceptance criteria map to an explicit
  mechanism — §16 traceability table. Non-goals (order entry, lifecycle reconciliation beyond
  relationship correction, scanner ranking) are respected and restated in §18.
- **Corrected master architecture:** §4.4, §5.2–5.4, §7.1 are implemented without deviation. The
  corrected (unconditional) foundation-protection decision (§15.0) is implemented as a structural
  guarantee (§6.5's function signature has no bypass parameter), not just a documented convention.
  PMCC origination is workflow-asserted and copied, never re-derived from timing (§8.1 item 4),
  matching the corrected §5.4.
- **Architecture review:** Finding A (positionLifecycle's classifiers can't see both PMCC legs
  together) is respected — §2.2 explicitly does not reuse `isPmccPosition()` for derivation, avoiding
  repeating the same mistake in new code that the review found in old code.
- **LCC-0001A technical spec:** this ticket's every input (`PortfolioSnapshot`, `EquityHolding`,
  `WorkingOrder`) is consumed exactly as LCC-0001A defined it, with no assumed field not present in
  that spec's §4 type definitions. The one exception — needing `EquityHolding`'s per-symbol
  `availableQuantity` after existing allocations are subtracted — is computed here (§5), not assumed
  to already exist on the LCC-0001A type, correctly respecting that ticket's boundary ("LCC-0001A may
  initially show capacity derived from the existing conservative capacity logic while LCC-0001B adds
  durable allocations").
- **Execution sequence / Gate B:** all four Gate B criteria (allocation invariants pass, strategies
  derive correctly, fully-allocated actions safe, symbol-level P/L has no double counting, ambiguous
  linkage enters reconciliation) map to §6/§8/§12 respectively.
- **Mockups:** §11 explicitly maps every LCC-0001B mockup-map row (Mixed AAPL Position, Stock Holding
  Detail, Working Reservation, Blocked Close) to a concrete rendering mechanism, and explicitly
  excludes the trade-entry-triggering mockup states that belong to LCC-0001C.
- **`PMCC_SPECIFICATION.md`:** not applicable to this ticket; not touched.
- **Current code:** §2 verified every cited file/function against the repository at the synced
  commit; the persistence pattern (§4.2, §10.1) is a direct structural copy of the verified
  `position-stop-policies` route and store, not an assumed pattern.

**One new open item surfaced by this ticket, not present in any prior document:** §13's
server-side snapshot-staleness validation approach (rejecting allocation-creation requests against a
stale client-supplied `PortfolioSnapshot.asOf` timestamp, since the server cannot itself re-fetch
from TastyTrade under the existing browser-side-only constraint) is a new design decision this ticket
had to make to satisfy the master architecture's §13.1 security requirement concretely. It is
technically sound but the specific staleness threshold is a product/ops judgment call, not a pure
engineering one, and should be confirmed before PR 3 (§17) rather than defaulted silently during
implementation.

No contradiction with the epic, the ticket, the corrected architecture, the architecture review, the
LCC-0001A spec, the execution sequence, the mockups, or `PMCC_SPECIFICATION.md` was found. This spec
introduces no new product decision beyond the one flagged item above, and reopens none of the three
resolved in the master architecture's §15.0.
