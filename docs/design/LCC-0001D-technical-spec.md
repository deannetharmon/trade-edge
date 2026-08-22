# LCC-0001D — Technical Specification
Lifecycle, Reconciliation, and Migration

**Status:** Draft for team review (Dane)
**Depends on:** LCC-0001A (published `ad7bf07`), LCC-0001B (published `0a42cdc`, staleness decision
recorded), LCC-0001C (corrected, published `3365657`)
**Blocks:** LCC-0001E production completion
**Traces to:** LCC-0001 epic, LCC-0001D ticket, corrected master architecture
(`docs/design/LCC-0001-technical-architecture.md`), architecture review
(`docs/design/LCC-0001-architecture-review.md`), LCC-0001A/B/C technical specifications, execution
sequence, both approved mockups, and the current repository implementation cited throughout.
**Does not implement application code. Does not begin LCC-0001E.**

---

## 1. Objective

Support the complete lifecycle of short-call cycles and foundations (roll, expiration, assignment,
foundation replacement), reconcile broker events safely, and migrate existing PMCC history into the
new coverage-allocation model — without ever overwriting a prior cycle's history or fabricating cash
flow. This is the direct implementation of master architecture §4.5 (`lib/lifecycle/`,
`lib/migration/`) and §7.2–7.6, §10.

---

## 2. Exact affected files, functions, types, and components

### 2.1 New modules (this ticket's primary deliverable)

| File | Contents |
|---|---|
| `lib/lifecycle/types.ts` | `ShortCallCycle`, `CycleStatus`, `RollEvent`, `ReconciliationItem`, `CorrectionEvent` (§4) |
| `lib/lifecycle/transitions.ts` | State-machine guard for `CycleStatus` (§5) |
| `lib/lifecycle/roll.ts` | Roll orchestration — three-operation sequence (§6) |
| `lib/lifecycle/expiration.ts` | OTM/ITM expiration handling (§7) |
| `lib/lifecycle/assignment.ts` | Stock and PMCC assignment reconciliation (§8) |
| `lib/lifecycle/foundationReplacement.ts` | Foundation replacement workflow (§9) |
| `lib/lifecycle/reconciliation.ts` | Reconciliation-queue detection and item creation (§10) |
| `lib/lifecycle/corrections.ts` | Correction/reversal event handling (§11) |
| `lib/lifecycle/store.ts` | Client-side fetch/post helpers, follows LCC-0001B/C pattern (§13.2) |
| `lib/migration/pmccPairing.ts` | Existing-PMCC candidate detection via cross-bucket pairing (§12.1) |
| `lib/migration/dryRun.ts` | Dry-run orchestration, ambiguity report, before/after P/L diff (§12.2) |
| `lib/migration/apply.ts` | Idempotent apply from an accepted dry-run (§12.3) |
| `lib/migration/rollback.ts` | Staging-area rollback (§12.4) |
| `lib/lifecycle/__tests__/*`, `lib/migration/__tests__/*` | Test suite (§16) |
| `app/api/lifecycle/roll/route.ts`, `.../expire/route.ts`, `.../assign/route.ts`, `.../replace-foundation/route.ts`, `.../correct/route.ts` | One route per lifecycle transition (§13.1) |
| `app/api/reconciliation-queue/route.ts` | GET reconciliation items (§13.1) |
| `app/api/migration/lcc-0001/dry-run/route.ts`, `.../apply/route.ts`, `.../rollback/route.ts` | Migration control (§13.1) |

### 2.2 Existing files consumed, unmodified

| File | Role |
|---|---|
| `lib/coverage/types.ts`, `invariants.ts`, `store.ts` (LCC-0001B) | `CoverageAllocation` is the relationship record a roll/assignment/replacement revalidates against — this ticket calls LCC-0001B's `canCloseFoundation`, `validatePmccCompatibility`, and the release endpoint; it does not reimplement allocation logic. |
| `lib/position-entry/types.ts`, workflows (LCC-0001C) | `ExecutionRecord` is the evidence a roll's "new cycle opens" step reuses (a roll's new leg is recorded via the same `ExecutionFill` shape LCC-0001C already defined, not a new fill type). |
| `lib/portfolio/positionLifecycle.ts` (`isAssignedStock`, `isCoveredCall`, `classifyPositionLifecycle`) | **Not reused for lifecycle-state detection.** `isAssignedStock()` (line 150) is a weak heuristic (`shares present, no option legs → assigned`) with no broker-event backing — it cannot distinguish "stock arrived via assignment" from "stock was simply bought outright with no options ever involved." This ticket's assignment detection (§8) is evidence-driven (broker transaction/execution matching), not legs-shape inference. These functions remain in place, unmodified, for whatever pre-LCC-0001 callers use them for. |
| `app/portfolio/page.tsx`'s `RollSuggestion`/`findRollCandidates`/`fetchRollSuggestion` (lines ~529–650, ~1309) | **Not reused, not extended.** This is an existing, hardcoded **two-leg vertical-spread roll finder** (BPS/BCS/IC only) — `findRollCandidates` returns `[]` immediately if either a short or long leg at the *same* expiration isn't found on the position (line 571: `if (!origShort \|\| !origLong) return []`). It cannot represent a single-leg short-call roll (stock covered call) or a cross-expiration PMCC short-leg roll — its whole model assumes both legs share one expiration, which a PMCC's short leg never does relative to its long-call foundation. This ticket's roll logic (§6) is new, not an extension of this function. |
| `app/portfolio/page.tsx`'s `ttPost`/`ttValidateOrder`/`ttPostComplex` (ES-0001/ES-0002 safety-gated) | **Not reused, not extended by this ticket's core lifecycle logic.** These remain the mechanism for TradeEdge-initiated broker order submission generally; if/when a future ticket wires actual roll/close order placement to this ticket's lifecycle state machine, it will call through this existing gated path — but placing that order is not this ticket's own scope (§17). This ticket defines and persists the *lifecycle record* of a roll/close/assignment, evidenced the same way LCC-0001C's execution evidence is (manual entry or broker match), not by initiating the order itself. |
| `lib/position-snapshot/*` (unrelated daily-history engine) | Distinct concept (position performance history over time for Trade Evolution), not reused or conflated with this ticket's lifecycle/reconciliation state. |

### 2.3 Existing files extended (additive)

| File | Change |
|---|---|
| `components/portfolio-data/PortfolioDataProvider.tsx` | Extended to expose `ShortCallCycle[]`, `ReconciliationItem[]` alongside existing context fields. |
| `app/portfolio/page.tsx` | Additive: "Review roll," "Resolve assignment," "Review foundation replacement" surfaces (mockup-aligned, §14); a "Today's priorities" reconciliation-queue summary. |

---

## 3. Reuse / extend / refactor / replace classification

| Component | Classification |
|---|---|
| `lib/portfolio-snapshot/*`, `lib/coverage/*`, `lib/position-entry/*` (LCC-0001A/B/C) | **Reuse, unmodified** — this ticket's every workflow is a caller of these, not a reimplementation. |
| `positionLifecycle.ts`'s classifiers | **Not reused for lifecycle-state detection** — see §2.2. Left in place unmodified. |
| `RollSuggestion`/`findRollCandidates` (vertical-spread roll finder) | **Not reused, not extended** — architecturally incompatible with single-leg/cross-expiration short-call rolls (§2.2). |
| `ttPost`/`ttValidateOrder`/`ttPostComplex` | **Not touched, not extended by this ticket's core scope** — order-placement wiring, if any, is deferred (§17). |
| `position-entry-executions`/`coverage-allocations` persistence pattern | **Reuse (pattern only)** — new stores/routes follow it, do not import it. |
| `PortfolioDataProvider.tsx`, `app/portfolio/page.tsx` | **Extend** — additive context fields and UI surfaces only. |

---

## 4. Formal lifecycle: ShortCallCycle, RollEvent, ReconciliationItem, CorrectionEvent

```ts
// lib/lifecycle/types.ts

export type CycleStatus =
  | 'proposed' | 'pending' | 'open'
  | 'cancelled' | 'rejected' | 'partiallyFilled'
  | 'closingPending' | 'closed'
  | 'expired' | 'assigned' | 'reconciliationRequired';

export type ClosingReason = 'userClosed' | 'rolled' | 'expired' | 'assigned' | 'corrected';

export interface ShortCallCycle {
  id: string;
  allocationId: string;              // the CoverageAllocation (LCC-0001B) this cycle's coverage
                                       // relationship belongs to. A roll creates a NEW cycle id but
                                       // may reference either the SAME allocation (foundation
                                       // unchanged) or, after a foundation replacement (§9), a new
                                       // allocation id.
  shortCallPositionKey: string;      // Position.key (LCC-0001A)
  status: CycleStatus;
  openedAt: string;
  closedAt: string | null;
  closingReason: ClosingReason | null;
  realizedPnl: number | null;        // set only when status reaches a terminal state with verified
                                       // economics; null while open or when unresolved (§8)
  // Present only when this cycle is a roll's replacement or predecessor -- see RollEvent for the
  // authoritative link. Carried here too purely for fast lookup without joining RollEvent.
  precededByRollEventId: string | null;
  succeededByRollEventId: string | null;
}

export interface RollEvent {
  id: string;
  oldCycleId: string;
  newCycleId: string;
  closingCost: number | null;        // buy-to-close cost on the old cycle
  openingCredit: number | null;      // sell-to-open credit on the new cycle
  netRollCredit: number | null;      // openingCredit - closingCost (signed; negative = net debit)
  createdAt: string;
  source: 'manual' | 'brokerMatched'; // same ExecutionSource convention as LCC-0001C
}

export type ReconciliationItemType =
  | 'missingOpeningEvent' | 'missingClosingEvent' | 'duplicateExecution'
  | 'correctedOrReversedExecution' | 'assignmentExercise' | 'stockCreatedViaAssignment'
  | 'stockRemovedViaAssignment' | 'snapshotHistoryDisagreement' | 'adjustedContract'
  | 'ambiguousCoverage' | 'manualThenBrokerMatched';

export interface ReconciliationItem {
  id: string;
  type: ReconciliationItemType;
  accountNumber: string;
  underlying: string;
  relatedCycleId: string | null;
  relatedAllocationId: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
  detail: string;                    // human-readable, never used for calculation
}

export interface CorrectionEvent {
  id: string;
  targetType: 'cycle' | 'allocation' | 'rollEvent';
  targetId: string;
  reason: string;
  correctedAt: string;
  actor: 'user' | 'system' | 'migration';
  // A correction NEVER carries a cash-flow delta field -- by construction, this type cannot
  // represent a fabricated cash flow (epic invariant 9). If a correction implies a real economic
  // change, that change must be represented as a new, independently-evidenced fact (a new
  // ExecutionFill, a new cycle), never as a field on this event.
}
```

**Deliberately excluded from `ShortCallCycle`:** anything about the foundation itself — this type
tracks the short-call side of the lifecycle only. Foundation-side state (equity holding quantity,
long-call position) lives in the LCC-0001A snapshot and is read, not duplicated, by `assignment.ts`
and `foundationReplacement.ts`.

---

## 5. Short-call lifecycle state machine

`lib/lifecycle/transitions.ts` — pure guard, matching LCC-0001D ticket's transition table and the
corrected master architecture §7.2 exactly:

```ts
const ALLOWED_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  proposed: ['pending'],
  pending: ['open', 'cancelled', 'rejected', 'partiallyFilled'],
  partiallyFilled: ['open', 'cancelled'],   // a partial fill can still complete to open, or the
                                              // remainder can be cancelled -- not in the ticket's
                                              // literal table but required for partial-fill
                                              // consistency with LCC-0001C §11; see §17 open item
  open: ['closingPending', 'expired', 'assigned', 'reconciliationRequired'],
  closingPending: ['closed', 'reconciliationRequired'],
  cancelled: [],
  rejected: [],
  closed: [],
  expired: [],
  assigned: [],
  reconciliationRequired: ['open', 'closed', 'expired', 'assigned'],  // reconciliation resolves
                                                                        // INTO the state the
                                                                        // evidence actually
                                                                        // supports, never bypasses
                                                                        // evidence
};

export function canTransition(from: CycleStatus, to: CycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function applyTransition(
  cycle: ShortCallCycle,
  to: CycleStatus,
  context: { closingReason?: ClosingReason; realizedPnl?: number | null },
): { ok: true; cycle: ShortCallCycle } | { ok: false; reason: string } {
  if (!canTransition(cycle.status, to)) {
    return { ok: false, reason: `Illegal transition: ${cycle.status} -> ${to}` };
  }
  // ... construct the updated cycle, never mutating the input in place
}
```

Every terminal state (`cancelled`, `rejected`, `closed`, `expired`, `assigned`) has **zero** outgoing
transitions except through `reconciliationRequired`, which is the sole path for correcting a
previously-recorded terminal state — and even then, only by moving to a *different*, evidence-backed
terminal state, never by "reopening" the same cycle for further activity (a roll always creates a
**new** cycle, §6; it never reopens an old one).

---

## 6. Roll workflow

`lib/lifecycle/roll.ts` — implements the three-operation sequence from the corrected master
architecture §7.3 exactly, as three independently-persisted writes, never a single mutation:

```ts
export async function executeRoll(
  oldCycle: ShortCallCycle,
  newCycleFills: ExecutionFill[],   // LCC-0001C's existing fill shape, reused
  economics: { closingCost: number | null; openingCredit: number | null },
): Promise<{
  oldCycle: ShortCallCycle;   // now status: 'closed', closingReason: 'rolled'
  rollEvent: RollEvent;
  newCycle: ShortCallCycle;  // status: 'pending' then 'open' once fills confirm
}>
```

Sequence (each step is a separate, auditable write — never combined):

1. `applyTransition(oldCycle, 'closingPending', {})` → `applyTransition(..., 'closed', {
   closingReason: 'rolled', realizedPnl: <computed from oldCycle's own fills + closingCost> })`.
   The old cycle's realized P/L is computed and **frozen** here — nothing downstream ever recomputes
   it retroactively.
2. `RollEvent` created, linking `oldCycleId → newCycleId`, `netRollCredit = openingCredit -
   closingCost`. This is a foreign-key-only link (§4) — it never copies old-cycle fields onto itself.
3. `newCycle` created fresh (`status: 'pending'`), fills recorded via the same `ExecutionRecord`
   shape LCC-0001C already defined, transitioned to `'open'` once fills confirm. Its
   `CoverageAllocation` reference (§4's `allocationId`) is the **same** allocation as the old cycle
   **unless** this roll is happening as part of a foundation replacement (§9), in which case a new
   allocation is created there instead and this roll references it.

**Partial quantities and multiple fills** (ticket requirement): `executeRoll` accepts a `newCycleFills`
array (not a single fill), reusing LCC-0001C's existing multi-fill retention pattern — weighted
economics for the new cycle are computed from that array, never collapsed to one value before
persisting.

**Display requirement** (closing cost, opening credit, net roll credit/debit, both independent
outcomes): `RollEvent`'s fields (§4) carry exactly these; the UI (§14) renders `oldCycle.realizedPnl`
and `newCycle`'s ongoing unrealized P/L as two separate, clearly-labeled figures, never summed into
one "roll P/L" that would obscure which leg produced which result.

---

## 7. Expiration handling

`lib/lifecycle/expiration.ts`:

```ts
export function classifyExpiration(
  cycle: ShortCallCycle,
  strikePrice: number,
  underlyingPriceAtExpiration: number | null,
  exerciseByExceptionThreshold: number,   // e.g. $0.01 ITM, broker-specific; configurable, not
                                            // hardcoded, since this varies by broker/contract
): 'otm' | 'itm' | 'nearItmAttentionRequired'
```

- **OTM expiration** (`underlyingPriceAtExpiration < strikePrice` for a call, with a safety margin
  below `exerciseByExceptionThreshold`) → `applyTransition(cycle, 'expired', { realizedPnl:
  <full premium retained> })`; the linked `CoverageAllocation` releases (calls LCC-0001B's release
  endpoint) — coverage is now available again, satisfying `ReadyForNextCall` (LCC-0001B §8.1 item 5).
- **ITM or near-ITM expiration** → `applyTransition(cycle, 'reconciliationRequired', {})`, creating a
  `ReconciliationItem` of type `assignmentExercise` — this ticket does **not** guess the outcome; it
  waits for confirming broker evidence (§8) before resolving into `assigned` or another terminal
  state.
- **Timezone/exercise-by-exception/after-hours/broker-cutoff handling**: `underlyingPriceAtExpiration`
  and the classification call are deliberately parameterized (not hardcoded to market-close-4pm-ET)
  so the caller supplies the correct evidence for whichever cutoff actually applies — this ticket
  defines the classification function's contract, not a fetch of "the" official expiration price,
  since no such single existing source was found in the repository (open item, §17).

---

## 8. Assignment reconciliation

`lib/lifecycle/assignment.ts` — two distinct paths per the ticket, both evidence-driven (broker
transaction/order matching, the same `brokerMatched`/`manual` convention as LCC-0001C), never
inferred from position-shape alone (per §2.2's explicit rejection of `isAssignedStock()`):

### 8.1 Stock covered call assignment

```ts
export function reconcileStockAssignment(
  cycle: ShortCallCycle,
  allocation: CoverageAllocation,
  confirmedCalledAwayQuantity: number,
  assignedLotBasis: { complete: boolean; value: number | null },
): {
  updatedCycle: ShortCallCycle;
  updatedAllocation: CoverageAllocation;   // reduced quantity or released
  realizedResult: number | null;           // null when assignedLotBasis.complete === false
}
```

- Reduces the equity holding's effective quantity by `confirmedCalledAwayQuantity` (the underlying
  `EquityHolding.quantity` itself is broker-derived per LCC-0001A and updates on next snapshot
  refresh — this function updates the **allocation's** `allocatedQuantity`, not the snapshot).
- Recalculates capacity (LCC-0001B's `computeCoveredCallCapacity`, unchanged, re-run against the
  post-assignment quantity).
- `realizedResult` uses `lib/position-entry/calculations.ts::calledAwayReturn()` (LCC-0001C, reused
  directly — **not reimplemented here**, avoiding the exact mistake corrected in LCC-0001C's own
  revision) — which itself already returns `null` when `basisComplete === false`. When null, the
  cycle transitions to `reconciliationRequired` rather than `assigned` with a fabricated result,
  satisfying epic invariant 15 (fail-closed) at the lifecycle layer as well as the calculation layer.

### 8.2 PMCC assignment

```ts
export function reconcilePmccAssignment(
  cycle: ShortCallCycle,
  allocation: CoverageAllocation,      // foundationType: 'longCall'
): { updatedCycle: ShortCallCycle; reconciliationItem: ReconciliationItem }
```

**Never assumes long-call exercise.** The short cycle transitions to `assigned`, and a
`ReconciliationItem` (`type: 'assignmentExercise'`) is created unconditionally, requiring one of:
long-call exercise evidence, long-call sale + separately-evidenced share purchase to cover, or a
broker correction — matching the ticket's exact acceptance criterion ("retains the long call and
creates an unresolved short-share state"). The reconciliation item's `detail` field includes the
warning that exercising the long call may forfeit extrinsic value (ticket requirement), sourced as
plain text here — **not** reusing `lib/help/optionsStrategyReference.ts`'s prose, since that module's
existing strings are pre-written for a different context (general strategy education) and are not a
drop-in match here; a new, narrowly-scoped warning string is more accurate than forcing a reuse that
doesn't quite fit. This is a deliberate, small departure from LCC-0001C's "reuse caveats" pattern,
justified because the fit is genuinely different (general educational prose vs. a specific
reconciliation-item warning), not an oversight.

---

## 9. Foundation replacement

`lib/lifecycle/foundationReplacement.ts`:

```ts
export async function replaceFoundation(
  originalAllocation: CoverageAllocation,
  replacementFoundation: EligibleFoundation,   // LCC-0001B's type, reused
  continuityIntent: 'continueHistory' | 'newHistory',   // the mockup's explicit question, answered
                                                          // by the user, not inferred
): Promise<{
  closedOriginalPositionKey: string;
  newAllocation: CoverageAllocation;
  revalidatedCycles: ShortCallCycle[];
}>
```

- Closes the original foundation (preserving its realized P/L via the existing option/equity P/L
  calculations — no new calculation introduced).
- Opens the replacement (via LCC-0001C's existing entry-workflow evidence path — this function is a
  **caller** of `applyLeapsExecution`-equivalent logic, not a duplicate of it).
- **Revalidates every active short call against the replacement** — calls LCC-0001B's
  `validatePmccCompatibility`/`validateCapacity` for each `ShortCallCycle` currently linked to
  `originalAllocation`; any that fail compatibility against the replacement (e.g., different
  expiration ordering no longer valid) transition to `reconciliationRequired` rather than being
  silently carried over.
- `continuityIntent` is recorded (not decided by the system) and both foundations remain in history
  permanently — the original allocation is never deleted, only released; the new allocation is a new
  record entirely (ticket requirement: "Retain both foundations in history").

---

## 10. Reconciliation

`lib/lifecycle/reconciliation.ts` — implements the ticket's full "Reconciliation" scope list as the
`ReconciliationItemType` enum (§4) plus detection functions, one per type, each a pure function over
`(snapshot, allocations, cycles, executionRecords)`:

| Type | Detection function | Trigger |
|---|---|---|
| `missingOpeningEvent` | `detectMissingOpeningEvents()` | A `Position` exists in the snapshot with no corresponding `ExecutionRecord` or migration-sourced cycle at all |
| `missingClosingEvent` | `detectMissingClosingEvents()` | A `ShortCallCycle` remains `open` in TradeEdge but the corresponding `Position` no longer appears in the snapshot |
| `duplicateExecution` | `detectDuplicateExecutions()` | Two `ExecutionRecord`s share the same `brokerFillId` (LCC-0001C) |
| `correctedOrReversedExecution` | `detectCorrections()` | A broker transaction feed entry references a prior transaction id as reversed/corrected — §11 |
| `assignmentExercise` | Created directly by §7/§8, not separately detected |
| `stockCreatedViaAssignment` / `stockRemovedViaAssignment` | `detectAssignmentDrivenEquityChange()` | Equity holding quantity changed between snapshots with no matching manual/broker-matched `ExecutionRecord` explaining the change |
| `snapshotHistoryDisagreement` | `detectSnapshotHistoryDisagreement()` | Current snapshot and the last-known state disagree in a way none of the above types explain |
| `adjustedContract` | `detectAdjustedContracts()` | `resolveOptionContractMultiplier()` (financials.ts, reused) returns non-standard for a position with no existing `deliverable: 'adjusted'` flag recorded |
| `ambiguousCoverage` | Reused directly from LCC-0001B §12 (ambiguous-import handling) — not reimplemented here, this ticket's queue surfaces LCC-0001B's existing items alongside its own |
| `manualThenBrokerMatched` | `detectManualThenBrokerMatch()` | A `manual` `ExecutionRecord` and a later `brokerMatched` one plausibly describe the same fill (symbol/quantity/approximate timestamp) |

All detection functions run as part of the snapshot-refresh cycle (`PortfolioDataProvider`'s existing
generation-gated refresh, §2.3) — not a separate polling job, consistent with LCC-0001A/B/C's
established pattern of deriving from the snapshot rather than maintaining independent background
state.

---

## 11. Corrections

`lib/lifecycle/corrections.ts` — implements the ticket's "Corrections" and "Broker correction"
acceptance criterion:

```ts
export function applyCorrection(
  target: ShortCallCycle | CoverageAllocation | RollEvent,
  correction: CorrectionEvent,
): { ok: true; corrected: typeof target } | { ok: false; reason: string }
```

A correction is structurally distinct from economic activity: `CorrectionEvent` (§4) has no cash-flow
field. When a broker reverses an assignment, `applyCorrection` does not "undo" the assignment
transition — it appends a new `ReconciliationItem` (type `correctedOrReversedExecution`) and a new
`CorrectionEvent`, and the affected `ShortCallCycle` moves through `reconciliationRequired` back to
whatever state the **new** evidence supports (per §5's transition table, `reconciliationRequired` can
transition to `open`/`closed`/`expired`/`assigned` — never silently back to its pre-reversal state
without going through this evidence-gated path). This satisfies the ticket's exact requirement:
"records a reversal event and reconciles state without deleting history" — nothing is deleted, the
original (now-reversed) events remain in the audit trail permanently.

---

## 12. Migration

### 12.1 PMCC candidate detection

`lib/migration/pmccPairing.ts::findMigrationCandidates()` — implements the correction already made in
the (corrected) LCC-0001A spec and carried into the master architecture: pairs across the existing
`underlying::expiration` position buckets (a far-dated long call + a near-dated short call, same
underlying, compatible deliverable — via LCC-0001B's `validatePmccCompatibility`, reused directly),
**not** via `positionLifecycle.ts::isPmccPosition()` (architecture review Finding A, already corrected
in LCC-0001A's spec; restated here since this is the ticket that actually implements the detector).

### 12.2 Dry-run

`lib/migration/dryRun.ts::runMigrationDryRun()`:

- For each candidate pair found by §12.1, proposes: one `CoverageAllocation`
  (`source: 'migrated'`, `origination: 'CREATED_TOGETHER'` unless the pairing evidence suggests
  otherwise — see the open item below), one `ShortCallCycle` (`status` inferred from the current
  `Position`'s open/closed state — no lifecycle history is fabricated for cycles that predate this
  ticket; a currently-open short call migrates to `status: 'open'` with `openedAt` taken from the best
  available broker execution/order data, not backfilled speculatively).
- **Ambiguity report**: any candidate that doesn't pair cleanly (missing execution history, unclear
  prior roll chains — since pre-migration rolls have no `RollEvent` records to reconstruct from,
  multiple plausible long-call matches for one short call, adjusted contracts) is listed separately,
  not silently paired with a best guess.
- **Before/after P/L comparison**: total strategy P/L computed once under the current (fused, no
  relationship) model and once under the proposed migrated model; any delta beyond floating-point
  rounding tolerance is flagged, not silently accepted — this reuses LCC-0001B's
  `sumTotalSymbolExposure()` for both computations, not two different P/L formulas.
- Output is **staged**, not written to the live `lib/coverage/store.ts`/`lib/lifecycle/store.ts`
  tables — a separate staging namespace (§12.4) holds proposed writes until acceptance.

### 12.3 Apply

`lib/migration/apply.ts::applyMigration()`:

- **Stable migration identity**: every migrated `CoverageAllocation`/`ShortCallCycle` id is derived
  deterministically from the original broker position/execution identifiers (a hash or direct
  composition, not a random UUID) — re-running `applyMigration()` against the same broker data
  produces the same ids, making the operation naturally idempotent (epic invariant 10, LCC-0001D
  "Migration rerun" acceptance criterion) rather than requiring a separate duplicate-check pass.
- **Duplicate prevention after broker sync**: migrated records are tagged `source: 'migrated'`
  (already in LCC-0001B's type) so that LCC-0001D's own §10 detection functions recognize an
  already-migrated position and do not raise a spurious `missingOpeningEvent` reconciliation item for
  it.
- Only applies records the dry-run explicitly marked non-ambiguous **and** that the operator has
  explicitly accepted (§12.2's ambiguity report requires human sign-off before `applyMigration()` runs
  against those specific candidates) — this ticket does not auto-apply anything from an ambiguity
  report.

### 12.4 Rollback

`lib/migration/rollback.ts::rollbackMigration()`:

- While staged (pre-accept), rollback is deletion of the staging namespace only — the live
  `lib/coverage/store.ts`/`lib/lifecycle/store.ts` data is never touched, so rollback here is trivial
  and safe by construction.
- Post-accept, rollback requires the migrated records' deterministic ids (§12.3) to locate and remove
  exactly the records this specific migration run created — this is only safe **before** the next
  live broker sync has had a chance to build anything on top of the migrated allocations (per the
  ticket's rollout note, "Keep rollback available until post-migration broker sync passes"). This
  ticket's `rollbackMigration()` checks for and refuses to proceed if any non-migration-sourced
  allocation/cycle now references a migrated record, rather than silently orphaning it.

---

## 13. API/service boundaries and persistence

### 13.1 API routes

One narrow route per lifecycle transition, mirroring LCC-0001B's narrow-endpoint design (§9.2 of that
spec) rather than one generic PATCH endpoint — this keeps the audit trail unambiguous about which
transition actually occurred:

```
POST /api/lifecycle/roll               → §6
POST /api/lifecycle/expire             → §7
POST /api/lifecycle/assign             → §8 (stock or PMCC, disambiguated by allocation.foundationType)
POST /api/lifecycle/replace-foundation → §9
POST /api/lifecycle/correct            → §11
GET  /api/reconciliation-queue         → §10, list of open ReconciliationItems
POST /api/migration/lcc-0001/dry-run   → §12.2
POST /api/migration/lcc-0001/apply     → §12.3
POST /api/migration/lcc-0001/rollback  → §12.4
```

Every route re-validates server-side against `lib/lifecycle/transitions.ts`'s guard and the relevant
LCC-0001B invariants, following LCC-0001B's established server-side-trust-boundary pattern (including
the same 60-second snapshot-staleness check where the transition depends on current capacity, e.g.
foundation replacement's revalidation step).

### 13.2 Persistence

Redis, `Record<string, T>` blob per user, same pattern as LCC-0001B/C: `short-call-cycles:{userId}`,
`roll-events:{userId}`, `reconciliation-items:{userId}`, `correction-events:{userId}`,
`migration-staging:{userId}` (separate namespace per §12.2/§12.4). No new persistence technology.

---

## 14. Portfolio UI integration (mockup-aligned)

Per Diane's [Integrated LEAPS, Covered Call, and PMCC Flow mockup](../tickets/mockups/tradeedge-integrated-leaps-flow.html)
and the execution sequence's LCC-0001D mockup-map row ("Roll, Assignment, Partial Execution, Import
Reconciliation, Replace Foundation"):

- **Review roll / Close current cycle / Open next cycle**: renders `RollEvent`'s closing
  cost/opening credit/net roll credit-debit as two clearly separated outcomes (§6's display
  requirement), not a single blended number.
- **Resolve AAPL assignment / Today's priorities**: the reconciliation-queue summary (§10) surfaces
  open `ReconciliationItem`s as actionable cards, matching the mockup's "Today's priorities" framing.
- **Choose the intended MSFT relationship**: PMCC assignment's unresolved-short-share state (§8.2)
  routes through the same "coverage choice" UI pattern LCC-0001B/C already established, not a new
  dialog design.
- **Review foundation replacement / Close original**: §9's `continuityIntent` question, asked
  directly, not inferred.
- Feature-flagged independently per ticket rollout requirement, consistent with A/B/C's pattern.

---

## 15. Error handling, auditability, and observability

- **Error handling**: every lifecycle function returns a typed `{ ok: false; reason }` for expected
  business-rule violations (illegal transition, capacity conflict on foundation replacement), never
  throws; API routes translate to 4xx with the reason surfaced to the UI, matching LCC-0001B/C's
  established convention.
- **Auditability**: `ShortCallCycle`/`RollEvent`/`ReconciliationItem`/`CorrectionEvent` are each
  append-only once created (only `status`/`resolvedAt`-equivalent narrow fields mutate, via the same
  narrow-endpoint pattern as LCC-0001B's release endpoint) — no lifecycle record is ever deleted or
  overwritten, satisfying epic invariant 7 (a roll cannot overwrite the prior cycle) structurally, not
  just by convention.
- **Observability**: reconciliation-queue depth by `ReconciliationItemType`, unresolved-assignment
  count, and migration dry-run/apply/rollback outcomes are dashboard-exposed metrics, per the ticket's
  rollout requirement ("operational dashboards for unresolved assignments and reconciliation
  failures"). This is the metric LCC-0001A/B's own observability sections anticipated without
  building (LCC-0001A §13.2, LCC-0001B §14) — this ticket is where that dashboard's data actually
  gets produced.

---

## 16. Unit, integration, and acceptance-test matrix

| Test | Type | Location | Traces to |
|---|---|---|---|
| `canTransition`/`applyTransition`: every allowed and prohibited transition in §5's table | Unit | `lib/lifecycle/__tests__/transitions.test.ts` | LCC-0001D "State-transition tests, including prohibited transitions" |
| `executeRoll`: three-operation sequence, old cycle's realized P/L frozen, new cycle independent, no field copied instead of linked | Unit + Integration | `lib/lifecycle/__tests__/roll.test.ts` | "Roll" acceptance criterion |
| `classifyExpiration`: OTM releases coverage, ITM/near-ITM routes to reconciliation | Unit | `lib/lifecycle/__tests__/expiration.test.ts` | Ticket "Expiration" scope |
| `reconcileStockAssignment`: 200 shares, 100 called away → 100 remain, capacity recalculates, `calledAwayReturn` reused not reimplemented | Integration | `lib/lifecycle/__tests__/assignment.test.ts` | "Stock assignment" acceptance criterion |
| `reconcilePmccAssignment`: never assumes exercise, creates unresolved short-share reconciliation item | Integration | Same | "PMCC assignment" acceptance criterion |
| `replaceFoundation`: both foundations retained in history, every active cycle revalidated | Integration | `lib/lifecycle/__tests__/foundationReplacement.test.ts` | "Foundation replacement" acceptance criterion |
| Every `detect*` reconciliation function (§10's table, one test per type) | Unit | `lib/lifecycle/__tests__/reconciliation.test.ts` | Quinn's full reconciliation trigger list |
| `applyCorrection`: broker reversal creates a reversal event, deletes nothing | Integration | `lib/lifecycle/__tests__/corrections.test.ts` | "Broker correction" acceptance criterion |
| `findMigrationCandidates`: cross-bucket pairing, not `isPmccPosition()` | Unit | `lib/migration/__tests__/pmccPairing.test.ts` | Architecture review Finding A, carried into this ticket's own implementation |
| `runMigrationDryRun`: simple, rolled (no `RollEvent` history to reconstruct — flagged ambiguous), partial, closed, ambiguous fixtures | Integration | `lib/migration/__tests__/dryRun.test.ts` | LCC-0001D "Validation" — Migration tests for simple/rolled/partial/closed/ambiguous |
| `applyMigration` rerun: same input twice, no duplicates (deterministic id derivation) | Integration | `lib/migration/__tests__/apply.test.ts` | "Migration rerun" acceptance criterion |
| `rollbackMigration`: pre-accept (staging deletion) and post-accept (guarded, refuses if built-upon) paths | Integration | `lib/migration/__tests__/rollback.test.ts` | LCC-0001D "Validation" — Migration rollback |
| Production-like dry-run with before/after P/L comparison, using `sumTotalSymbolExposure` for both sides | Integration | `lib/migration/__tests__/dryRun.test.ts` | LCC-0001D "Validation" |
| Reconciliation idempotency: repeated detection pass over unchanged data produces the same item set, no duplicate `ReconciliationItem`s | Integration | `lib/lifecycle/__tests__/reconciliation.test.ts` | LCC-0001D "Validation" — Reconciliation idempotency |
| Existing option/PMCC/coverage suites remain green (regression) | Existing suites, unmodified | `lib/portfolio/__tests__/closeOrderSafety.test.ts`, `lib/coverage/__tests__/*`, `lib/scans/__tests__/pmccPairing.test.ts` | Dependency integrity |
| `npx tsc --noEmit --incremental false` | Type check | CI | Standing convention |
| Full Vercel preview build | Build | Manual/CI per PR | Standing convention |
| `git diff --check` | Lint | CI | Standing convention |

**Golden fixtures requiring Alan's approval** (per epic release gate): realized roll P/L (old cycle
frozen), called-away realized result (via reused `calledAwayReturn`, same approval this needs
regardless of ticket), net roll credit/debit, and the migration before/after P/L comparison's
tolerance threshold for "beyond rounding."

---

## 17. Acceptance-criterion traceability

| LCC-0001D acceptance criterion | Implementing mechanism |
|---|---|
| Roll (old closes with realized P/L, new opens independently, roll event links without replacing history) | §6 `executeRoll` |
| Stock assignment (200 shares, 100 called away → 100 remain, cycle completes, capacity recalculates) | §8.1 `reconcileStockAssignment` |
| PMCC assignment (no exercise assumption, unresolved short-share state) | §8.2 `reconcilePmccAssignment` |
| Foundation replacement (both foundations remain, active relationship revalidated) | §9 `replaceFoundation` |
| Migration rerun (no duplicates) | §12.3, deterministic id derivation |
| Broker correction (reversal recorded, no deletion) | §11 `applyCorrection` |

All six acceptance criteria map to an explicit, named, testable mechanism.

**Open items surfaced by this ticket, requiring resolution before the affected PRs:**

1. **`partiallyFilled → open` / `partiallyFilled → cancelled` transitions (§5)** — the ticket's own
   literal transition table does not include a `partiallyFilled` intermediate state at all (its table
   goes `Pending → Cancelled | Rejected | Partially Filled` but never says what `Partially Filled`
   itself can transition to). This spec added `partiallyFilled → open`/`partiallyFilled → cancelled`
   to keep the state machine consistent with LCC-0001C's own partial-fill handling (§11 of that spec),
   but this is this ticket's own addition, not a literal restatement of the ticket text. Needs
   explicit confirmation this addition is correct rather than a misreading of the ticket's intent.
2. **Official expiration-price/cutoff data source (§7)** — no existing single source of "the official
   settlement price at expiration" was found in the repository; `classifyExpiration()`'s
   `underlyingPriceAtExpiration` parameter is deliberately caller-supplied rather than internally
   fetched. Confirm this is acceptable for the initial release, or identify the correct data source
   before implementation.
3. **Migrated allocation's `origination` value when pairing evidence is ambiguous (§12.2)** — this
   spec defaults migrated PMCCs to `origination: 'CREATED_TOGETHER'` "unless the pairing evidence
   suggests otherwise" without fully specifying what evidence would trigger the alternative
   (`ADDED_TO_EXISTING_LONG_CALL`). Since migrated records predate any workflow-asserted origination
   (LCC-0001B/C's mechanism, which only applies going forward), this may need its own small decision:
   is `origination` even meaningful for migrated records, or should migrated allocations carry a
   distinct `origination: null`-equivalent "unknown, pre-dates tracking" value instead of guessing?

---

## 18. Migration and rollout plan

Per the ticket's own "Rollout" section:

1. **PR 1** — `lib/lifecycle/types.ts`, `transitions.ts`, full unit coverage. No consumer wiring.
2. **PR 2** — `roll.ts`, `expiration.ts` (pending §17 item 2's data-source confirmation),
   `assignment.ts` (calling LCC-0001C's `calledAwayReturn` directly, not reimplementing it).
3. **PR 3** — `foundationReplacement.ts`, `reconciliation.ts`, `corrections.ts`.
4. **PR 4** — API routes (§13.1), `lib/lifecycle/store.ts`, `PortfolioDataProvider` wiring, behind a
   feature flag independent of A/B/C's flags.
5. **PR 5** — Portfolio UI (§14), flagged independently.
6. **PR 6** — `lib/migration/pmccPairing.ts`, `dryRun.ts`, run in **report-only mode first** against
   production-like data (ticket rollout requirement) — no live writes yet.
7. **PR 7** — `apply.ts`, `rollback.ts`, gated behind **explicit acceptance of the ambiguity report**
   (ticket rollout requirement) — this PR does not enable auto-apply for anything the dry-run flagged
   ambiguous.
8. **PR 8** — enable enforcement (blocking behavior becomes default) only after post-migration broker
   sync has been validated to pass cleanly, per the ticket's rollback-availability requirement.

Each PR touching `app/portfolio/page.tsx` requires a full Vercel preview build, per standing
convention.

---

## 19. Explicit exclusions — belongs to LCC-0001E

- **Scanner reframing, Find LEAPS/Find Covered Calls/Find PMCCs/Calls Against My Positions
  launchers** — LCC-0001E entirely. This ticket's lifecycle/reconciliation/migration machinery is
  consumed by LCC-0001E (a rolled/reconciled cycle affects what a "Calls Against My Positions" scan
  considers eligible), but building the launcher is not in this ticket.
- **PMCC scoring changes** — out of scope for this ticket and the epic generally, per the resolved
  product decision (master architecture §15.0); not applicable to this ticket's domain in the first
  place.
- **Dividend/early-assignment risk contract consumption in scanner surfaces** — LCC-0001C already
  built the reusable `assessDividendAssignmentRisk()` contract (LCC-0001C §8.1); wiring it into
  Screener transparency is LCC-0001E's job, not this ticket's.
- **Actual broker order placement for rolls/closes** — not added by this ticket (§2.2); if/when a
  future ticket wires TradeEdge-initiated roll/close order submission to this ticket's lifecycle
  state machine, that wiring goes through the existing `ttPost`/`ttValidateOrder`/`ttPostComplex`
  ES-0001/ES-0002-gated path, unmodified — this ticket only defines and persists the lifecycle
  *record*, evidenced the same way LCC-0001C's execution evidence already is.

---

## 20. Self-review against source material

- **Epic:** cross-ticket invariants 7 (roll cannot overwrite prior cycle), 9 (no fabricated cash
  flow), 10 (idempotent broker sync and migration), 15 (fail-closed on unresolved coverage) are each
  implemented structurally — §4's `CorrectionEvent` has no cash-flow field by design; §12.3's
  deterministic ids make migration idempotent by construction, not by a separate duplicate-check.
- **LCC-0001D ticket:** every scope item (formal lifecycle, roll workflow, expiration, assignment,
  foundation replacement, reconciliation, corrections, migration) and all six acceptance criteria map
  to an explicit mechanism — §17 traceability table. Non-goals (tax advice, automatic exercise/roll
  decisions, destructive rewriting of broker history) are respected throughout.
- **Corrected master architecture:** §4.5, §7.2–7.6, §10 are implemented without deviation. The
  three-operation, non-mutating roll representation (§6) matches §7.3 exactly.
- **Architecture review:** Finding A's correction (migration must pair across buckets, not use
  `isPmccPosition()`) is carried through directly into §12.1, this ticket's actual implementation of
  what LCC-0001A's spec only described at a summary level.
- **LCC-0001A/B/C technical specs:** every type and function this ticket calls
  (`CoverageAllocation`, `computeCoveredCallCapacity`, `validatePmccCompatibility`,
  `sumTotalSymbolExposure`, `calledAwayReturn`, `ExecutionFill`) is consumed exactly as those specs
  defined it. `calledAwayReturn` (LCC-0001C's own corrected calculation) is reused directly in §8.1
  rather than reimplemented — this ticket does not repeat the mistake LCC-0001C's own revision
  corrected.
- **Execution sequence / Gate D:** all four Gate D criteria (roll/expiration/assignment/replacement/
  correction transitions pass; migration dry run preserves history and P/L; reconciliation is
  idempotent; rollback and diagnostics are ready) map to §5–§9, §12.2, §10, and §12.4/§15
  respectively.
- **Mockups:** §14 explicitly maps every LCC-0001D mockup-map row to a concrete UI wiring point.
- **`PMCC_SPECIFICATION.md`:** not applicable to this ticket's scope; not touched.
- **Current code:** §2 verified every cited file/function against the repository at the synced
  commit, including two findings not previously documented anywhere in this epic's design
  documents: `positionLifecycle.ts::isAssignedStock()` is a weak, legs-shape-only heuristic unsuitable
  for real assignment detection (§2.2), and the existing `RollSuggestion`/`findRollCandidates`
  machinery in `app/portfolio/page.tsx` is hardcoded to two-leg, same-expiration vertical spreads and
  is architecturally incompatible with single-leg or cross-expiration short-call rolls (§2.2) — this
  ticket's roll logic is correctly specified as new, not an extension of that existing code.

**Three open items remain, requiring team confirmation before their respective PRs** (§17): the added
`partiallyFilled` sub-transitions not literally present in the ticket's transition table (item 1),
the expiration-price data source (item 2), and migrated-record origination semantics for ambiguous
pairing evidence (item 3). None of these are contradictions with approved requirements — they are
implementation-detail gaps the ticket text itself does not fully specify, flagged rather than silently
resolved. No contradiction with the epic, the ticket, the corrected architecture, the architecture
review, the LCC-0001A/B/C specs, the execution sequence, the mockups, or `PMCC_SPECIFICATION.md` was
found, and none of the three resolved product decisions from the master architecture's §15.0 are
reopened.
