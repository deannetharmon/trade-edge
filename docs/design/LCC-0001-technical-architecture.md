# LCC-0001 — Master Technical Architecture
Equity-Aware LEAPS, Covered Call, and PMCC Lifecycle

**Status:** Draft for team review (Dane)
**Traces to:** LCC-0001 epic, execution sequence, tickets A–E, PMCC_SPECIFICATION.md,
`tradeedge-integrated-leaps-flow.html`, `tradeedge-equity-portfolio-revision.html`
**Does not implement application code.**

---

## 1. Executive summary

TradeEdge currently has two independent, disagreeing interpretations of what the user owns:
Portfolio (`loadPositions()`) only ever sees `Equity Option`/`Index Option` instruments, and Covered
Call capacity (`buildCoveredCallCapacityReport()`) separately re-reads raw broker positions and
working orders to compute share capacity. Neither module knows about the other, and neither retains
a durable relationship between a short call and whatever supports it.

This document defines a **canonical, account-scoped Portfolio Snapshot** that both consumers read
from, a **Coverage Allocation** model that gives every short call an explicit, auditable foundation
(shares or a long call), and a **derived Strategy** layer that turns those facts into the labels
users see (Stock Only, LEAPS/Long Call Only, Stock Covered Call, PMCC, Ready for Next Call, Action
Needed, Coverage Unresolved, Closed). It also defines the lifecycle state machine for short-call
cycles, the reconciliation/migration approach for existing PMCC records, and how the Screener's four
launchers (Find LEAPS, Find Covered Calls, Find PMCCs, Calls Against My Positions) consume the same
snapshot instead of inventing a third view.

The existing option-only `Position`/`positionMetrics.ts`/`closeOrderSafety.ts` machinery is **not**
replaced. It becomes one adapter behind the canonical snapshot. This keeps ~9,900 lines of
`app/portfolio/page.tsx` and its close-order safety gates untouched during LCC-0001A/B, and lets
LCC-0001C/D/E build the new equity- and relationship-aware surfaces incrementally, behind flags, with
shadow-mode parity checks against the existing Covered Call capacity numbers before cutover.

---

## 2. Current-state architecture (as found in the repo)

### 2.1 Acquisition split (the root problem)

- `lib/portfolio-data/acquisition.ts::loadPositions()` (line ~952) fetches
  `/accounts/{account}/positions` and immediately filters to
  `p['instrument-type'] === 'Equity Option' || 'Index Option'`. Equity (stock) rows are discarded
  before any downstream code ever sees them. This single filter is the entire root cause named in
  LCC-0001A.
- `lib/scans/covered-call-capacity.ts::buildCoveredCallCapacityReport()` is a separate, pure,
  well-isolated module (`normalizeEquityHoldings`, `normalizeShortCallExposure`,
  `normalizeWorkingCallReservations`) that re-fetches/re-normalizes raw positions and working orders
  independently of `acquisition.ts`. It already implements good fail-closed behavior
  (`UNATTRIBUTABLE_EXPOSURE_REASON`, `status: 'unavailable'`) and a `costBasisComplete` gate — this
  is the best existing model for LCC-0001A's snapshot semantics, but it is currently invoked from a
  second, disconnected acquisition path (its own `/api` route), not from `PortfolioDataProvider`.
- Consequence: Portfolio (options only) and Covered Call scanning (unfiltered positions + orders) can
  and do disagree about the same account at the same instant — exactly the "two incomplete views"
  problem in the epic.

### 2.2 Option-only Position model

- `lib/portfolio-data/types.ts::Position` is entirely option-structure-shaped: `legs: PositionLeg[]`,
  `expDate`, `dte`, `strategy`, `identity: CanonicalCloseIdentity | null`. There is no equity holding
  shape anywhere in this file.
- `identity` (built by `lib/portfolio/closeOrderSafety.ts::analyzePositionStructure` +
  `buildCanonicalCloseIdentity`) is the single source of truth every close/roll/stop-loss action must
  check before proceeding. `structureAmbiguous` hard-blocks all actions on a position rather than
  guessing. This pattern is the correct model to extend to coverage allocations (fail closed on
  ambiguity, never silently proceed).
- `lib/portfolio/positionLifecycle.ts` already has partial classification logic —
  `isPmccPosition()`, `isCoveredCall()`, `isAssignedStock()`, `classifyPositionLifecycle()` — but it
  operates only on the option legs already loaded into a `Position`; it has no concept of an equity
  holding or a durable relationship record, and it re-derives classification from leg shape on every
  render rather than from a persisted allocation.

### 2.3 PMCC pipeline

- `lib/scans/pmccChainAdapter.ts` → `lib/scans/pmccPairing.ts` (pure pairing/eligibility engine,
  `PmccFailureCode`-driven rejection reasons) → `lib/scans/pmccScore.ts` (composite ranking) →
  `lib/scans/pmccProduction.ts` (orchestration) → `app/screener/page.tsx` (PMCC modal / result cards).
- **`lib/scans/pmccScore.ts` (live, production) is a 2-factor + earnings-deduction model**: ROI (0–60
  pts, benchmarked against a fixed 60% annualized target, explicitly *not* a per-scan percentile) and
  worse-of-two-legs Liquidity (0–30 pts), with an opt-out binary earnings deduction (−10). Trend is
  explicitly excluded as a score input by prior Ian/Paul sign-off (kept as a card-level gate/warning
  only).
- **`PMCC_SPECIFICATION.md` (checked in at repo root) describes a different, unimplemented 4-pillar
  model** (Structural Safety/WMD 35%, Yield/ROI-cap 25%, Volatility/Event Risk 20%,
  Technical/Liquidity 20%) with a 3% WMD hard-gate, a 0.78–0.88 LEAPS delta band, 270–400 DTE, and an
  RSI filter. None of this exists in `pmccScore.ts` today. This is a **direct, unresolved conflict**
  between a checked-in spec and the shipped, sign-off'd scoring engine — see §14 (Open questions).
- `lib/autopilot/decision/screenerCandidateAdapter.ts` intentionally excludes PMCC/CC from Best
  Opportunities (`screenerCandidateAdapter.ts` line 8 comment: "a separate, not-yet-built feature...
  a separate, still-undecided product question"). This exclusion is by design, not a bug, and LCC-0001
  does not change it (Dean has not decided whether to extend Autopilot/Best Opportunities scope to
  PMCC/CC — explicitly out of scope here per standing notes).

### 2.4 Screener shell

- `app/screener/page.tsx` (9,642 lines) owns the unified strategy launcher, Opportunity Universe,
  canonical scan sessions (`lib/screener/scanSession.ts`, `scanSessionCache.ts`,
  `screenerJobStore.ts`), and result-card rendering for every strategy including PMCC and CC.
- `lib/scans/covered-call-finder.ts` already exists (confirmed via `screenerCandidateAdapter.ts`'s own
  comment trail) and runs through the same `runCcScan`/`ScreenResult`/`bestCandidate` pipeline as
  every other strategy. Find Covered Calls (LCC-0001E) is a reframing of an existing pipeline, not new
  discovery infrastructure.
- There is currently no "Find LEAPS" launcher and no durable notion of "a long call the user already
  owns, standing alone, eligible for a short call to be added later."

### 2.5 Other load-bearing modules relevant to the target design

| Concern | File |
|---|---|
| Position valuation (mid/marketable) | `lib/positionValuation/` |
| Portfolio health/recommendation scoring | `lib/portfolio-intelligence/` (health/, objectives/, policies/) |
| Stop-loss policy & provenance | `lib/portfolio/stopLossPolicy.ts` |
| Close-order safety gate | `lib/portfolio/closeOrderSafety.ts` |
| Canonical recommendation authority | `lib/portfolio/canonicalRecommendationPresentation.ts` |
| PMCC leg economics / quote freshness | `lib/portfolio/pmccLegEconomics.ts`, `pmccLegQuote.ts` |
| Snapshot/history engine (daily, unrelated concept) | `lib/position-snapshot/` |
| Portfolio page (UI) | `app/portfolio/page.tsx` (8,800+ lines) |

---

## 3. Current-state gaps (mapped to epic's "Problem" section)

1. Two acquisition paths, two truths — §2.1.
2. No equity holding type anywhere in the option-shaped `Position`/`types.ts` — §2.2.
3. PMCC discovery/pairing assumes long+short open together; no standalone-long-call/LEAPS-only
   concept exists in Screener or Portfolio.
4. No persisted relationship between a short call and its foundation — `positionLifecycle.ts`
   re-derives from leg shape every render; nothing survives a roll, an assignment, or a foundation
   replacement.
5. No lifecycle state machine — `classifyPositionLifecycle()` is a snapshot classifier, not a
   transition-aware state machine; rolls/assignment/partial fills have no formal representation.
6. Checked-in `PMCC_SPECIFICATION.md` is unreconciled with shipped `pmccScore.ts` (§2.3) — this
   predates LCC-0001 but blocks any LCC-0001E scoring change from proceeding safely until resolved.

---

## 4. Proposed architecture

### 4.1 Layering

```
Broker (TastyTrade)
   │
   ▼
Canonical Portfolio Snapshot  (LCC-0001A)  — lib/portfolio-snapshot/
   │  (equities, options, working orders, one account-scoped read)
   ▼
Coverage Allocation Ledger    (LCC-0001B)  — lib/coverage/
   │  (durable, auditable short-call ↔ foundation relationships)
   ▼
Strategy Composition (derived)(LCC-0001B)  — lib/strategy/
   │  (Stock Only / LEAPS Only / Stock CC / PMCC / Ready for Next Call / ...)
   ▼
   ├── Position Entry & Management workflows (LCC-0001C) — lib/position-entry/
   ├── Lifecycle / Reconciliation / Migration  (LCC-0001D) — lib/lifecycle/, lib/migration/
   └── Scanner Reframing                        (LCC-0001E) — app/screener/*, lib/scans/*
                                                        │
                                             consumes the same snapshot + allocation ledger,
                                             does not re-derive holdings independently
```

Existing option-only `Position`, `positionMetrics.ts`, and `closeOrderSafety.ts` remain **inside**
the snapshot layer as the option-instrument adapter (§4.3). They are not deleted or rewritten in
LCC-0001A/B.

### 4.2 New module: `lib/portfolio-snapshot/` (LCC-0001A)

Single acquisition boundary, replacing the two independent reads described in §2.1.

```
lib/portfolio-snapshot/
  types.ts        // PortfolioSnapshot, EquityHolding, OptionPosition (adapter wrapper), WorkingOrder
  acquire.ts       // one authenticated fetch of positions + orders per account
  normalizeEquity.ts   // supersedes covered-call-capacity.ts's normalizeEquityHoldings
  normalizeOptions.ts  // thin wrapper delegating to existing acquisition.ts option grouping
  dataQuality.ts    // stale/unavailable/unattributable status, ported from
                     // covered-call-capacity.ts's UNATTRIBUTABLE_EXPOSURE_REASON pattern
```

`PortfolioDataProvider` (the existing single runtime call site for `loadPositions()`) is extended to
also request the snapshot; `app/portfolio/page.tsx` continues to render `Position[]` unchanged during
LCC-0001A, plus the new equity rows.

`buildCoveredCallCapacityReport()` (lib/scans/covered-call-capacity.ts) is **adapted, not deleted**:
its three normalizer functions become the reference implementation ported into
`normalizeEquity.ts`/`dataQuality.ts`, and the public function is re-pointed to consume the shared
snapshot instead of re-fetching. This directly satisfies LCC-0001A's "Portfolio/Screener parity"
acceptance criterion (same snapshot timestamp, same share count) without a rewrite of its
already-hardened fail-closed logic.

### 4.3 Existing option adapter (unchanged surface, new home)

`Position` (types.ts), `positionMetrics.ts`, and `closeOrderSafety.ts` keep their current contracts.
`normalizeOptions.ts` is a thin call-through to the existing `loadPositions()` option-grouping code so
that `identity`/`structureAmbiguous`/canonical close behavior is untouched. This satisfies the
ticket's explicit allowance: "Existing option-specific Position model behind an adapter."

### 4.4 New module: `lib/coverage/` (LCC-0001B)

```
lib/coverage/
  types.ts          // CoverageAllocation, AllocationStatus, AllocationSource
  invariants.ts      // over-allocation, deliverable compatibility, short-stock exclusion,
                      // PMCC expiration ordering — pure functions, no I/O
  deriveStrategy.ts  // projects allocations + snapshot -> derived Strategy label (§5.4)
  inference.ts       // single-eligible-foundation preselect; else requires confirmation
  store.ts           // persistence (Redis, matching existing stopPolicyStore.ts pattern)
```

Allocations are the **only** new persisted domain state introduced by LCC-0001B. Strategy labels are
never persisted as primary truth — `deriveStrategy.ts` is a pure projection, testable against fixture
snapshots+allocations, matching the ticket's explicit non-goal ("do not manually persist as the
primary truth").

### 4.5 New modules: `lib/position-entry/`, `lib/lifecycle/`, `lib/migration/` (LCC-0001C/D)

- `lib/position-entry/` — discovery→planning→execution-evidence→tracking boundary (§8); manual
  record and broker-match paths; never writes a Position/allocation from a plan alone.
- `lib/lifecycle/` — the short-call and roll state machines (§7), expiration/assignment handling.
- `lib/migration/` — PMCC-record migration (§10): dry-run, ambiguity report, idempotent apply,
  rollback.

### 4.6 Scanner reframing (LCC-0001E)

No new discovery infrastructure. `app/screener/page.tsx`'s launcher, Opportunity Universe, and scan
session cache are reused as-is (per the ticket's explicit "Existing code preservation" list).
Find Covered Calls and Calls Against My Positions are re-pointed to read from
`lib/portfolio-snapshot/` + `lib/coverage/` instead of their own capacity computation. Find LEAPS and
Find PMCCs gain "proposal, not position" boundaries via `lib/position-entry/`.

---

## 5. Target domain model

### 5.1 Canonical Portfolio Snapshot

```ts
interface PortfolioSnapshot {
  accountNumber: string;
  asOf: string;              // snapshot timestamp
  quoteAsOf: string | null;  // quote timestamp, may differ from asOf
  equities: EquityHolding[];
  options: OptionPosition[]; // existing Position[], adapted (§4.3)
  workingOrders: WorkingOrder[];
  dataQuality: {
    status: 'ok' | 'unavailable';
    unavailableReason?: string;     // e.g. UNATTRIBUTABLE_EXPOSURE_REASON successor
    staleQuotes: boolean;
    warnings: string[];
  };
}

interface EquityHolding {
  accountNumber: string;
  symbol: string;
  direction: 'Long' | 'Short';       // short stock never supports coverage (invariant)
  quantity: number;
  settledQuantity: number | null;
  basis: number | null;
  basisComplete: boolean;             // ported from EquityHolding.costBasisComplete
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  quoteAsOf: string | null;
  staleQuote: boolean;
  deliverable: 'standard' | 'adjusted';
  dataQualityWarnings: string[];
}
```

`OptionPosition` = the existing `Position` type, unmodified, tagged into the snapshot.

### 5.2 Coverage Allocation

```ts
interface CoverageAllocation {
  id: string;                        // stable identity, survives rolls (new id per cycle, see §7)
  accountNumber: string;
  underlying: string;
  shortCallPositionKey: string;      // Position.key of the short call
  shortCallQuantity: number;
  foundationType: 'equity' | 'longCall';
  foundationPositionKey: string;     // EquityHolding symbol+account, or Position.key of long call
  allocatedQuantity: number;         // shares, or contracts (1:1 for long-call foundation)
  contractMultiplier: number;        // 100 standard; actual for adjusted deliverables
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'proposed' | 'active' | 'released' | 'unresolved' | 'corrected';
  source: 'inferred' | 'userConfirmed' | 'imported' | 'migrated';
  // PMCC-only; null for equity foundations. Audit metadata, not a strategy
  // classifier — see §5.4/§15.0.
  origination: 'CREATED_TOGETHER' | 'ADDED_TO_EXISTING_LONG_CALL' | null;
  audit: AuditEvent[];
}
```

### 5.3 Invariants (enforced in `lib/coverage/invariants.ts`, pure, unit-testable)

Directly ported from the epic's cross-ticket invariant list (§ "Cross-ticket invariants", items 2–7,
9, 13, 15) plus LCC-0001B's allocation rules:

1. `sum(active allocations against a foundation) <= foundation.availableQuantity` (standard: floor to
   100-share/1-contract units; adjusted: actual deliverable).
2. `EquityHolding.direction === 'Short'` → zero coverage contribution, always.
3. One long call → at most one simultaneous active standard short-call allocation.
4. PMCC: `longCall.expiration > shortCall.expiration`, same underlying, compatible deliverable.
5. Closing/reducing a foundation with an active allocation is unconditionally blocked unless the
   linked short call is first closed, rolled, expired, assigned, or explicitly unlinked/reallocated.
   There is no override for the initial release (see §15.0).
6. Working sell-to-open orders create `status: 'proposed'` reservations, never `'active'`, until a
   fill event promotes them.
7. Unresolvable coverage (unattributable exposure, unknown deliverable, unresolved account identity)
   → fail closed; no new `'active'` allocation is created, existing holdings remain visible.

### 5.4 Derived Strategy (projection only, `lib/coverage/deriveStrategy.ts`)

Input: one underlying's equities + options + active/proposed allocations.
Output: one of `StockOnly | LongCallOnly | StockCoveredCall | PmccLongCallDiagonal |
ReadyForNextCall | ActionNeeded | CoverageUnresolved | Closed`.

Distinguishing rule (directly answers the four cases named in this ticket):

| Case | Signal |
|---|---|
| **Standalone LEAPS** | Long call position, no active/proposed allocation referencing it as a foundation → `LongCallOnly`. |
| **Stock-covered call** | Active allocation, `foundationType: 'equity'` → `StockCoveredCall`. |
| **PMCC created together** | Two positions opened from one `position-entry` execution-evidence event (§8) with `foundationType: 'longCall'`, `source: 'userConfirmed'` at creation, single roll cycle count 0 → `PmccLongCallDiagonal`. |
| **Call later written against existing LEAPS** | Long call position pre-dates the allocation and `foundationType: 'longCall'` → still classifies as `PmccLongCallDiagonal` for strategy grouping (per epic terminology: PMCC is a configuration, not an origination story), but is tagged `origination: 'ADDED_TO_EXISTING_LONG_CALL'` for audit/UI distinction only — **this is a presentation/audit distinction, not a different strategy enum value**, since Diane's mockups (Add Short Call to existing long call) route to the same PMCC detail surface as a freshly-opened PMCC. |

**Confirmed product decision (§15.0):** origination is persisted as audit metadata on the
`CoverageAllocation`/strategy history record using the enum `PmccOrigination = 'CREATED_TOGETHER' |
'ADDED_TO_EXISTING_LONG_CALL'`. It is shown in strategy detail and history views. A portfolio-level
filter by origination is not required for the initial release.

This resolves the four-way distinction requested without multiplying the Strategy enum — origination
is metadata, not a fifth strategy type, since none of the approved tickets ask for a fifth top-level
grouping and the mockups show one PMCC detail surface regardless of origination.

---

## 6. Portfolio snapshot & broker reconciliation architecture

- **Acquisition**: one fetch per account per Provider refresh (`/accounts/{n}/positions`,
  `/accounts/{n}/orders` for working orders) — no change to fetch cadence, only to what's kept.
- **Source-of-truth hierarchy** (ported verbatim from LCC-0001A "Source-of-truth rules" and the epic's
  broader hierarchy): broker executions > broker position snapshots > working orders (reservation
  only) > user-confirmed relationships > TradeEdge-derived classifications > market data (valuation
  only). Documented once in `lib/portfolio-snapshot/README.md` and referenced by every consumer rather
  than restated.
- **Reconciliation** (detailed state machine in LCC-0001D, §7.3 below) operates against the snapshot's
  `dataQuality` block: any unattributable short-option exposure fails the **entire account's**
  coverage report closed (porting `covered-call-capacity.ts`'s existing "final corrective pass"
  behavior forward), never partially.
- **Idempotency**: snapshot acquisition is read-only and naturally idempotent (it re-derives, never
  accumulates). Allocation creation from broker fills must be keyed on broker execution/order id to
  prevent duplicate allocations on repeated sync (LCC-0001D acceptance criterion).

---

## 7. Coverage-capacity, allocation, and lifecycle rules

### 7.1 Capacity computation

Directly generalizes `computeCoveredCallCapacity()` (lib/scans/covered-call-capacity.ts:320) from
equity-only to equity-or-long-call foundations:

```
grossCapacity(foundation) =
  foundation.type === 'equity' ? floor(shares / 100)
                                : 1   // one long call standard capacity = 1 short-call contract
available = grossCapacity - sum(active allocations) - sum(proposed/working allocations)
```

Oversubscription, unclassified-exposure, and `costBasisComplete`/`basisComplete` semantics are ported
unchanged from the existing module.

### 7.2 Short-call lifecycle state machine (`lib/lifecycle/shortCallCycle.ts`)

Transitions exactly as specified in LCC-0001D, implemented as an explicit state machine with a
transition-table guard (illegal transitions throw / are rejected, not silently coerced):

```
Proposed → Pending → Open
Pending  → Cancelled | Rejected | PartiallyFilled
Open     → ClosingPending → Closed
Open     → Expired | Assigned | ReconciliationRequired
```

### 7.3 Roll

A roll is **never** an in-place mutation of a `CoverageAllocation` or `Position`. It is three
operations, each independently identifiable per invariant 7 (epic) / LCC-0001D acceptance criterion:

```
1. old shortCallCycle: Open → Closed (closingReason: 'Rolled')
2. RollEvent created, linking old.id → new.id (foreign keys only, no data copy)
3. new shortCallCycle: Pending → Open, new CoverageAllocation created against the same foundation
```

`RollEvent` stores closing cost, opening credit, net credit/debit — computed, not re-derived from
linked cycles at render time, so historical roll economics survive later corrections to either leg.

### 7.4 Assignment

- **Stock covered call**: reduce `EquityHolding.quantity` by confirmed called-away quantity, release
  the corresponding `CoverageAllocation` (`status: 'released'`), recompute capacity. Realized result
  requires `basisComplete === true` on the assigned lot; otherwise the cycle enters
  `ReconciliationRequired` rather than reporting a fabricated realized number (epic invariant 15,
  fail-closed).
- **PMCC**: assignment does **not** assume long-call exercise. The short-call cycle transitions to
  `Assigned`; a `ReconciliationItem` of type `unresolvedShortShareState` is created and requires one of:
  long-call exercise evidence, long-call sale + separate share purchase evidence, or a broker
  correction, before the strategy re-derives past `ActionNeeded`.

### 7.5 Foundation replacement

Close original foundation (preserve realized P/L on it), open replacement, **revalidate every active
allocation** against the replacement (invariants re-run), ask the continuity question from the
mockup ("Review foundation replacement"), retain both foundations in history permanently.

### 7.6 Unlinking / correction

Relationship (allocation) edits create `AuditEvent`s and are structurally incapable of writing to
`Position`/transaction fields — enforced by `invariants.ts` only accepting `CoverageAllocation` writes,
never `Position` writes. This is a type-level guarantee, not just a convention (§12).

---

## 8. Position entry & management workflow boundary (LCC-0001C)

Four stages, kept as distinct persisted-or-not states per the ticket:

| Stage | Persisted? | Example artifact |
|---|---|---|
| Discovery | No | Scanner `ScreenResult` |
| Planning | Optional (user "Save") | `SavedPlan` — legs, assumptions, timestamp; never an allocation |
| Execution evidence | Yes | `ExecutionRecord` — manual entry or broker-matched fill(s) |
| Tracking | Yes | `Position` + `CoverageAllocation`, created **only** from execution evidence |

A `CoverageAllocation` is created exclusively by an `ExecutionRecord` reaching a filled state — never
by a `SavedPlan`. This is the direct implementation of "A scanner result or saved plan is never an
open position" and of the "Partial PMCC" acceptance criterion (long fills, short cancelled → position
is `LongCallOnly`, no relationship fabricated).

Partial/unequal/multi-fill handling: `ExecutionRecord` retains every individual fill; weighted
economics are computed from the fill list, never overwritten in place (mirrors the roll non-mutation
principle in §7.3).

---

## 9. Proposed API, persistence, service, and UI boundaries

### 9.1 Service boundaries

```
lib/portfolio-snapshot/   → pure normalization + one acquisition call; no persistence
lib/coverage/              → invariants (pure) + store.ts (Redis persistence) + deriveStrategy (pure)
lib/position-entry/        → workflow orchestration; calls lib/coverage/store to create allocations
lib/lifecycle/              → state machines (pure) + event log persistence
lib/migration/              → one-shot/report-only scripts, calls lib/coverage/store
lib/scans/                  → unchanged pairing/scoring; covered-call-capacity.ts logic absorbed into
                                lib/portfolio-snapshot/normalizeEquity.ts (re-exported for compat during
                                transition, see §11)
```

### 9.2 Persistence

Existing pattern: Redis via `stopPolicyStore.ts`'s convention (`REDIS_URL`/ioredis, key-per-account
scoping). `CoverageAllocation`, `RollEvent`, `AuditEvent`, `ReconciliationItem`, and migration records
follow the same store shape — no new datastore introduced.

### 9.3 API routes (additive, mirroring existing `/api/position-*` naming)

- `GET /api/portfolio-snapshot` — canonical snapshot (supersedes ad hoc capacity-report route).
- `GET|POST /api/coverage-allocations` — list/create/confirm allocation.
- `POST /api/coverage-allocations/[id]/release` — explicit unlink/close-related release.
- `POST /api/position-entry/executions` — record manual execution or broker match.
- `POST /api/lifecycle/roll`, `/api/lifecycle/assign`, etc. — one route per lifecycle transition,
  each validated against §7.2's transition table server-side (never trust client-supplied state).
- `GET /api/reconciliation-queue` — LCC-0001D reconciliation items.
- `POST /api/migration/lcc-0001/dry-run`, `/apply`, `/rollback` — LCC-0001D migration control.

### 9.4 UI boundaries

`app/portfolio/page.tsx` gains new sections (equity rows, allocation summary, strategy grouping)
additively; existing option-card rendering, close-order modals, and recommendation surfaces are not
restructured. `app/screener/page.tsx` gains a Find LEAPS launcher and re-points Find Covered
Calls/Calls Against My Positions to the new snapshot; Find PMCCs' UI shell is unchanged, only its data
source for capacity/foundation-eligibility checks changes.

---

## 10. Migration and backward-compatibility approach

Per LCC-0001D:

1. **Dry-run/report-only mode** (`/api/migration/lcc-0001/dry-run`): reads existing PMCC positions
   (identified via `positionLifecycle.ts::isPmccPosition()`, the current best-available detector),
   proposes the split into independent long-call foundation + short-call cycle + `CoverageAllocation`
   (`source: 'migrated'`), and produces an **ambiguity report** for anything that doesn't map
   cleanly (missing execution history, unclear roll chains, adjusted contracts).
2. **Stable migration identity**: every migrated record gets a deterministic id derived from the
   original broker position/transaction identifiers, so re-running migration is a no-op for records
   already migrated (idempotency, epic invariant 10).
3. **Before/after P/L comparison**: dry-run output includes total strategy P/L computed under both the
   old (single fused Position) and new (split foundation+cycle) models; any delta beyond rounding is
   surfaced, not silently accepted.
4. **Duplicate prevention after broker sync**: migrated allocation records are tagged so that a
   subsequent normal broker-sync pass recognizes the already-migrated position and does not create a
   second allocation for the same short call.
5. **Rollback**: while migration is un-accepted, the dry-run's proposed writes are held outside the
   live allocation store (a staging table/key namespace) so rollback is deletion of staging data only
   — the live snapshot and existing option Positions are never touched until explicit acceptance.
6. **Acceptance criteria**: LCC-0001D's own acceptance list (migration rerun idempotency, broker
   correction reconciliation) doubles as the migration test plan.

---

## 11. Scanner reframing and reuse of existing Find PMCCs logic

- `pmccPairing.ts`, `pmccChainAdapter.ts`, `pmccProduction.ts`, and the PMCC modal in
  `app/screener/page.tsx` are **reused unchanged** for candidate discovery/pairing/ranking. LCC-0001E
  changes what a PMCC *result* connects to (proposal → execution evidence → position/allocation via
  `lib/position-entry/`), not how candidates are found or scored.
- `pmccScore.ts` ranking itself is explicitly **not** touched by LCC-0001E ("Preserve current
  production ranking behavior until changes are separately validated" / "Unvalidated changes to
  existing PMCC scoring" is a named non-goal). Per the resolved product decision (§15.0), the
  `PMCC_SPECIFICATION.md` conflict (§2.3) must be written up as its own prerequisite/product-decision
  ticket, outside LCC-0001, with its own approval and acceptance criteria — LCC-0001E must not
  silently replace or reconcile the production scoring model as a side effect of scanner reframing.
- Find Covered Calls re-points `lib/scans/covered-call-finder.ts`'s capacity check to
  `lib/portfolio-snapshot/` + `lib/coverage/` instead of its own re-derivation — this is the literal
  mechanism behind the "Covered Call capacity matches Portfolio" Gate E criterion.
- Find LEAPS is new ranking logic (duration/delta/intrinsic-extrinsic/trend/liquidity/valuation/exit
  inputs per the ticket) but reuses the existing scan-session/launcher/result-card infrastructure;
  no new scan pipeline shell.
- Calls Against My Positions is largely a UI entry point into
  `lib/coverage/inference.ts` (§4.4) — "which foundation(s) are eligible right now" — plus the
  existing single covered-call launch action already in the screener.

---

## 12. Failure states, partial fills, assignment, expiration, rolling, unlinking

Consolidated fail-closed contract, extending the pattern already proven in
`covered-call-capacity.ts`:

| Condition | Behavior |
|---|---|
| Positions or working orders fail to load | Coverage-dependent actions unavailable; existing holdings still render (LCC-0001A). |
| Unattributable short-option exposure | Entire account's coverage report `status: 'unavailable'` (ported verbatim from existing `UNATTRIBUTABLE_EXPOSURE_REASON` behavior). |
| Ambiguous foundation (shares + long call both eligible) | Blocks auto-inference; requires explicit user confirmation (`lib/coverage/inference.ts`). |
| Partial fill: long fills, short doesn't | `LongCallOnly`, no allocation created. |
| Partial fill: shares fill, short doesn't | `StockOnly`. |
| Short fills, no verified foundation | `ActionNeeded` — position exists, allocation is `unresolved`, never silently treated as covered. |
| Foundation close attempted while allocation active | Unconditionally blocked at the API layer (§9.3). No override exists in the initial release — the short call must first be closed, rolled, expired, assigned, or explicitly unlinked/reallocated. See §15.0. |
| Assignment, basis unverified | Realized result withheld; `ReconciliationRequired`, not a fabricated number. |
| Roll | Old cycle closed with realized P/L preserved; new cycle independent; see §7.3. |
| Unlink/correction | Audit event only; cannot mutate a transaction or fabricate cash flow (type-level: `invariants.ts` exposes no transaction-write path). |

---

## 13. Security, validation, observability, testing strategy

### 13.1 Security/validation

- All lifecycle-transition API routes re-validate the transition table server-side; the client is
  never trusted to assert a resulting state.
- Allocation writes are exclusively mediated by `lib/coverage/invariants.ts` — no direct store write
  path bypasses invariant checks (enforce via code review + a lint rule / module boundary if the repo
  has one, or a thin `store.ts` that only accepts pre-validated allocation objects).
- No PII/broker-credential handling changes; existing TastyTrade browser-side-only fetch pattern
  (`lib/tastytrade/client.ts`) is unchanged — snapshot acquisition happens client-side same as today.

### 13.2 Observability

- `dataQuality.warnings[]` on the snapshot is logged (existing `warnings: string[]` pattern from
  `covered-call-capacity.ts`) with account identifiers redacted, per LCC-0001A's rollout section.
- Reconciliation queue depth and unresolved-assignment counts are dashboard-exposed metrics per
  LCC-0001D rollout.
- Migration dry-run produces a structured before/after P/L diff report as its primary observability
  artifact.
- Shadow-mode parity logging: old `buildCoveredCallCapacityReport()` vs new snapshot-derived capacity,
  logged and diffed before the scanner cutover (LCC-0001A + LCC-0001E rollout requirement).

### 13.3 Testing strategy

Directly maps to each ticket's Validation section; consolidated matrix:

| Layer | Test type | Location |
|---|---|---|
| Equity/option normalization, basis completeness, accounts | Unit | `lib/portfolio-snapshot/__tests__/` |
| Allocation invariants (over-allocation, deliverable, expiration ordering, short-stock exclusion) | Unit | `lib/coverage/__tests__/invariants.test.ts` |
| Derived strategy projection (all 8 states + origination metadata) | Unit | `lib/coverage/__tests__/deriveStrategy.test.ts` |
| P/L deduplication | Unit | `lib/coverage/__tests__/pnl.test.ts` |
| Entry workflows (LEAPS-only, PMCC, CC, buy-write, partial/unequal/multi-fill) | Integration | `lib/position-entry/__tests__/` |
| Lifecycle transitions incl. prohibited transitions | Unit | `lib/lifecycle/__tests__/shortCallCycle.test.ts` |
| Roll, assignment (stock + PMCC), foundation replacement | Integration | `lib/lifecycle/__tests__/` |
| Migration: simple, rolled, partial, closed, ambiguous; rerun idempotency; rollback | Integration | `lib/migration/__tests__/` |
| Portfolio/Screener capacity parity | Integration | existing `CcCapacityGate.test.tsx` extended |
| Existing option close-order safety (regression) | Existing suite | `lib/portfolio/__tests__/closeOrderSafety.test.ts` — must stay green throughout |
| PMCC ranking regression (unchanged scoring) | Existing suite | `lib/scans/__tests__/pmccProduction.test.ts` |
| Accessibility (dialogs, coverage choice, confirmations) | Component | screener/portfolio `__tests__/` |

**Golden fixtures requiring Alan's approval** (per epic release gate "Calculation correctness"):
gross premium, short-call liability, realized/unrealized short-call and foundation P/L, net strategy
basis, called-away return, net roll credit/debit, assignment result (verified and unresolved basis
cases), and the PMCC net-debit-vs-strike-width check explicitly labeled as a risk signal, not a
profitability guarantee.

Standard verification per repo convention: `npx tsc --noEmit --incremental false` is insufficient
alone for anything touching `app/portfolio/page.tsx`; a full Vercel preview build is required before
any ticket in this epic is considered done.

---

## 14. Sequencing and dependency recommendations

Adopt the ticket package's own execution sequence and gates (LCC-0001-execution-sequence.md)
unchanged — it is already correctly ordered and internally consistent with the domain model above:

```
LCC-0001A → LCC-0001B → LCC-0001C → LCC-0001D → LCC-0001E
```

Recommended first PR (LCC-0001A): introduce `lib/portfolio-snapshot/types.ts` +
`normalizeEquity.ts` (ported from `covered-call-capacity.ts`'s normalizers) with full unit coverage,
**with no consumer wiring yet** — a pure, reviewable, low-risk addition. Second PR wires
`PortfolioDataProvider` to acquire the snapshot and render equity rows behind a feature flag. Third PR
re-points `buildCoveredCallCapacityReport()`'s call sites to the shared snapshot and stands up the
shadow-mode parity comparison required before Gate A closes.

LCC-0001E's Find-LEAPS ranking research may start in parallel with LCC-0001A/B per the execution
sequence's "safe parallel activities" list, provided no ranking output is wired into production state
until LCC-0001A ships.

---

## 15. Open questions, assumptions, risks, architecture decisions

### 15.0 Product Decisions Resolved After Architecture Review

The following were open questions in the original draft of this document and have since been
resolved by product review. They are recorded here as decisions, not options, and every affected
section below has been updated to match.

- **Foundation protection (resolves former §15.1.4, "authorized uncovered state" override).** For the
  initial release, TradeEdge does **not** support any privileged override that permits closing a
  foundation while a dependent short call remains active. A user must first close, roll, let expire,
  have assigned, or explicitly unlink/reallocate the dependent short call before its foundation can be
  closed. There is no "authorized uncovered state" path in LCC-0001D. Any future privileged override
  is out of scope for this epic and requires its own ticket with its own authorization model and audit
  requirements. See §7.6 and §12 for the corrected (unconditional) block behavior.
- **PMCC origination (resolves former §15.1.2).** Origination is persisted as audit metadata using an
  enum — `CREATED_TOGETHER` or `ADDED_TO_EXISTING_LONG_CALL` — on the `CoverageAllocation`/strategy
  history record. It does not create a fifth strategy type; `PmccLongCallDiagonal` remains the single
  strategy classification regardless of origination. Origination is shown in strategy detail and
  history views. A portfolio-level filter by origination is **not required** for the initial release
  (may be considered in a later ticket). See §5.4 for the updated enum name and §9.4/UI-boundary notes.
- **PMCC scoring conflict (resolves former §15.1.1).** LCC-0001E must not silently replace or
  reconcile the production scoring model. The discrepancy between `PMCC_SPECIFICATION.md` and the
  shipped `lib/scans/pmccScore.ts` is to be documented as a **separate prerequisite/product-decision
  ticket**, outside LCC-0001. LCC-0001E may reframe scanner workflow, launcher structure, and result
  presentation, but any change to PMCC scoring itself requires separate approval and its own
  acceptance criteria before it can be implemented. See §2.3, §11, and §15.1 below.

### 15.1 Open questions requiring product/team input

1. **PMCC_SPECIFICATION.md vs. live `pmccScore.ts` (§2.3, §11) — decision recorded, ticket not yet
   created.** Per §15.0, this is confirmed out of scope for LCC-0001E and must be tracked as its own
   prerequisite ticket. Remaining open item is administrative only: someone needs to actually file that
   ticket (owner: Paul/Dean) so the conflict doesn't silently sit undocumented outside this epic.
2. ~~Origination metadata granularity~~ — resolved, see §15.0.
3. **Autopilot/Best Opportunities PMCC/CC scope** — confirmed out of scope per standing project notes
   and the epic's non-goals list ("A global navigation or application-shell redesign" /
   `screenerCandidateAdapter.ts`'s own documented exclusion). Restating here only to confirm LCC-0001
   does not implicitly reopen it — no allocation/strategy work in this epic should be read as
   preparation for that decision.
4. ~~"Authorized uncovered state" override~~ — resolved, see §15.0. No override exists in initial
   release; §7.6/§12 updated accordingly.
5. **Multi-account aggregation** — explicitly disallowed by default (epic, LCC-0001A source-of-truth
   rule 6), but no ticket says whether an aggregate view is even on a future roadmap. Assumption below
   treats this as fully out of scope indefinitely, not just for this epic.

### 15.2 Assumptions made in this document

- `lib/portfolio/positionLifecycle.ts::isPmccPosition()` is an adequate detector for migration
  candidate identification (§10); it has not been audited against edge cases (adjusted contracts,
  multi-leg noise) as part of this architecture pass — LCC-0001D's ambiguity report is the intended
  safety net for whatever it misses.
- Redis (existing `stopPolicyStore.ts` pattern) is assumed to be the persistence layer for allocations
  and lifecycle events; no new datastore is proposed. If retention/query needs for reconciliation
  history exceed what Redis comfortably supports, this should be revisited before LCC-0001D.
- "Standard" contract multiplier is assumed to be exactly 100 with no proposed change to that
  constant; adjusted-deliverable handling is carried as a flag/override, not a parallel calculation
  path, consistent with existing `CONTRACT_MULTIPLIER` usage in `positionMetrics.ts`.

### 15.3 Principal risks

- **`app/portfolio/page.tsx` size (8,800+ lines).** Any equity-row/strategy-grouping addition risks
  SWC parser traps already documented in project learnings (inline union-literal return types, `as`
  assertions in `.tsx`) — mitigate with named type aliases from the start, and full Vercel build
  verification on every PR touching this file, not just `tsc --noEmit`.
- **Shadow-mode parity drift.** If the ported `normalizeEquity.ts` diverges even slightly from
  `covered-call-capacity.ts`'s existing (already-hardened) semantics, the parity check itself could
  mask real regressions. Recommend porting the existing module's unit tests verbatim as the first
  acceptance bar for the new module, not just writing new tests against the new shape.
- **Migration ambiguity volume.** Until a real dry-run runs against production-like PMCC data, the
  size of the ambiguity report is unknown; LCC-0001D's timeline risk is directly proportional to it.

### 15.4 Key architecture decisions (recorded for traceability matrix, §16)

- **AD-0:** No privileged "authorized uncovered state" override exists in the initial release. A
  foundation with an active allocation cannot be closed under any user-invoked path except first
  closing/rolling/expiring/assigning/unlinking the dependent short call. Confirmed by product review,
  §15.0; any future override is a separately-ticketed, separately-authorized feature.
- **AD-1:** Existing option-only `Position` model is kept and wrapped, not replaced (epic explicitly
  allows this; avoids destabilizing `closeOrderSafety.ts`'s canonical-identity guarantees).
- **AD-2:** Strategy labels are pure projections, never persisted as primary truth (LCC-0001B
  explicit requirement).
- **AD-3:** Rolls/corrections are append-only event sequences, never in-place mutations (epic
  invariant 7, LCC-0001D acceptance criteria).
- **AD-4:** PMCC origination (created-together vs. added-later) is UI/audit metadata
  (`PmccOrigination: 'CREATED_TOGETHER' | 'ADDED_TO_EXISTING_LONG_CALL'`), not a distinct strategy
  enum value (§5.4). Confirmed by product review, §15.0 — no portfolio filter required initially.
- **AD-5:** `covered-call-capacity.ts`'s existing fail-closed/unattributable-exposure pattern is the
  reference implementation for the new snapshot's `dataQuality` semantics, ported rather than
  redesigned.

---

## 16. Traceability (summary — full matrix is a separate deliverable per the assignment)

| Requirement source | Covered in this document |
|---|---|
| Epic problem statement | §2.1, §3 |
| Epic cross-ticket invariants (1–15) | §5.3, §7, §12 |
| LCC-0001A scope + acceptance criteria | §4.2, §5.1, §6, §12 |
| LCC-0001B scope + acceptance criteria | §4.4, §5.2–5.4, §7.1, §12 |
| LCC-0001C scope + acceptance criteria | §4.5, §8 |
| LCC-0001D scope + acceptance criteria | §4.5, §7.2–7.6, §10 |
| LCC-0001E scope + acceptance criteria | §4.6, §11 |
| Execution sequence + gates | §14 |
| Both approved mockups | §5.4 (strategy surfaces), §7.5 (foundation replacement), §8 (execution evidence) |
| PMCC_SPECIFICATION.md | §2.3, §11, §15.1.1 (flagged conflict, not resolved here) |

A full row-by-row traceability matrix mapping every individual acceptance criterion and invariant to
an owning ticket, component, persisted entity, API contract, test, mockup state, and release gate is
recommended as the next deliverable (`docs/design/LCC-0001-traceability-matrix.md`) per §17.

---

## 17. Recommended next deliverable

`docs/design/LCC-0001A-technical-spec.md` — the first per-ticket spec, since LCC-0001A blocks every
other ticket and this master document's §4.2/§6/§12 already establish its shape. It should expand:
canonical snapshot field-by-field contract, the ported normalizer implementation plan (with the exact
diff against `covered-call-capacity.ts`), Portfolio Intelligence impact (what changes when equities
enter `PortfolioFinancialContext`), and the shadow-comparison rollout mechanics referenced in §14.
