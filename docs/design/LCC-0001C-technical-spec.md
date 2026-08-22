# LCC-0001C — Technical Specification
Position Entry and Management Workflows

**Status:** Draft for team review (Dane)
**Depends on:** LCC-0001A (published `ad7bf07`), LCC-0001B (published `0a42cdc`)
**Blocks:** LCC-0001D, LCC-0001E
**Traces to:** LCC-0001 epic, LCC-0001C ticket, corrected master architecture
(`docs/design/LCC-0001-technical-architecture.md`), architecture review
(`docs/design/LCC-0001-architecture-review.md`), LCC-0001A technical specification
(`docs/design/LCC-0001A-technical-spec.md`), LCC-0001B technical specification
(`docs/design/LCC-0001B-technical-spec.md`, revised to record the 60-second, server-configurable
snapshot-staleness threshold), execution sequence, both approved mockups, and the current repository
implementation cited throughout.
**Does not implement application code. Does not begin LCC-0001D.**

---

## 1. Objective

Implement the user-facing workflows for standalone long calls/LEAPS, stock covered calls, buy-writes,
new PMCCs, and short calls sold against existing positions — keeping discovery, planning, execution
evidence, and tracking strictly distinct, and creating `CoverageAllocation` records (LCC-0001B) only
from confirmed execution evidence, never from a proposal or plan. This is the direct implementation
of master architecture §4.5 (`lib/position-entry/`) and §8.

---

## 2. Exact affected files, functions, types, and components

### 2.1 New modules (this ticket's primary deliverable)

| File | Contents |
|---|---|
| `lib/position-entry/types.ts` | `SavedPlan`, `ExecutionRecord`, `ExecutionFill`, `ExecutionSource` (§4) |
| `lib/position-entry/planStore.ts` | Client-side fetch/post helpers for `SavedPlan` (§9.2) |
| `lib/position-entry/executionStore.ts` | Client-side fetch/post helpers for `ExecutionRecord` (§9.2) |
| `lib/position-entry/workflows/leapsOnly.ts` | Standalone long-call/LEAPS entry (§6.1) |
| `lib/position-entry/workflows/newPmcc.ts` | New PMCC entry (§6.2) |
| `lib/position-entry/workflows/stockCoveredCall.ts` | Stock covered call entry (§6.3) |
| `lib/position-entry/workflows/buyWrite.ts` | Buy-write entry (§6.4) |
| `lib/position-entry/workflows/callAgainstPosition.ts` | Call against existing position (§6.5) |
| `lib/position-entry/calculations.ts` | Required-calculation functions (§7) |
| `lib/position-entry/pmccValidation.ts` | PMCC leg validation (§8) |
| `lib/position-entry/__tests__/*` | Test suite (§16) |
| `app/api/position-entry-plans/route.ts` | GET/POST for `SavedPlan` (§9.1) |
| `app/api/position-entry-executions/route.ts` | GET/POST for `ExecutionRecord` (§9.1) |

### 2.2 Existing files consumed, unmodified

| File | Role |
|---|---|
| `lib/portfolio-snapshot/*` (LCC-0001A) | Input to eligibility/capacity checks during entry — unmodified. |
| `lib/coverage/types.ts`, `invariants.ts`, `inference.ts`, `store.ts` (LCC-0001B) | Entry workflows call `POST /api/coverage-allocations` (LCC-0001B's route) at the moment execution evidence confirms a fill — this ticket's workflows are **callers** of LCC-0001B's API, not a reimplementation of it. |
| `lib/scans/pmccPairing.ts`, `pmccChainAdapter.ts`, `pmccScore.ts`, `pmccProduction.ts` | Candidate discovery/pairing/ranking — reused unchanged for the "Discovery" stage (§5) feeding into `newPmcc.ts`'s planning stage. **Ranking (`pmccScore.ts`) is not modified by this ticket**, consistent with the resolved product decision (master architecture §15.0) that PMCC scoring changes require separate approval. |
| `lib/portfolio/pmccLegEconomics.ts`, `pmccLegQuote.ts` | Existing leg-economics/quote-freshness helpers — reused for §7's calculation functions rather than reimplemented. |
| `lib/scans/financials.ts` (`calculatePmccCapital`, `resolveOptionContractMultiplier`) | Reused for net-debit/capital calculations (§7). |
| `lib/optionSymbol.ts` (`parseOccSymbol`) | Reused for leg identity parsing during execution matching (§10). |
| `lib/tastytrade/client.ts`, and `app/portfolio/page.tsx`'s private `ttPost`/`ttValidateOrder`/`ttPostComplex` (lines ~1113–1200) | **Not reused, not extended.** These implement TradeEdge-initiated order submission for existing option close/roll actions, ES-0001/ES-0002 safety-gated. This ticket's "Record Executed Trade" / "Import or Match Broker Activity" paths (§10) are evidence-recording only — they do not place broker orders. Automatic broker execution is an explicit LCC-0001C non-goal. |
| `app/api/position-entry-snapshots/route.ts` | Not modified; cited as the persistence-pattern template (upsert-without-overwrite, §9.1) since it is the closest existing analog to `ExecutionRecord`'s "write once, never silently overwrite a real fill" semantics. |

### 2.3 Existing files extended (additive)

| File | Change |
|---|---|
| `app/screener/page.tsx` | Additive: "Save Plan" / "Record Executed Trade" / "Import or Match Broker Activity" actions wired onto existing PMCC modal, LEAPS candidate cards (new, see LCC-0001E for the launcher itself — this ticket only needs *a* candidate card to attach these actions to for testing/incremental rollout, not a new launcher), and covered-call result cards. No changes to `pmccPairing.ts`/`pmccScore.ts`/ranking logic. |
| `app/portfolio/page.tsx` | Additive: `LongCallOnly`/`StockOnly` positions (from LCC-0001B's `deriveStrategy()`) gain a "Sell Call Against Position" entry point (§6.5); fully-allocated foundations show "Manage Short Call" instead (per LCC-0001B §16, wired here). |
| `components/portfolio-data/PortfolioDataProvider.tsx` | Extended to expose `SavedPlan[]`/`ExecutionRecord[]` alongside `snapshot` and `allocations`, same fetch-on-mount pattern. |

---

## 3. Reuse / extend / refactor / replace classification

| Component | Classification |
|---|---|
| `lib/portfolio-snapshot/*`, `lib/coverage/*` (LCC-0001A/B) | **Reuse, unmodified** — consumed as-is. |
| `pmccPairing.ts`, `pmccChainAdapter.ts`, `pmccScore.ts`, `pmccProduction.ts` | **Reuse, unmodified** — discovery/ranking untouched. |
| `pmccLegEconomics.ts`, `pmccLegQuote.ts`, `financials.ts` | **Reuse, unmodified** — calculation primitives. |
| `position-entry-snapshots` persistence pattern | **Reuse (pattern only)** — new routes/stores follow it, do not import it. |
| `app/screener/page.tsx`, `app/portfolio/page.tsx` | **Extend** — additive action wiring only. |
| `PortfolioDataProvider.tsx` | **Extend** — additive context fields. |
| TradeEdge-initiated order submission (`ttPost`/`ttValidateOrder`/`ttPostComplex`) | **Not touched, not extended** — explicitly out of scope (§2.2, §14). |
| `lib/coverage/store.ts`'s `POST /api/coverage-allocations` | **Reuse (called, not modified)** — this ticket's workflows are the primary new caller of an already-built LCC-0001B endpoint. |

---

## 4. Domain types: SavedPlan and ExecutionRecord

Implements the four-stage boundary from master architecture §8 with implementation-level precision.
Neither type is a `Position` or a `CoverageAllocation` — both are new, narrower types.

```ts
// lib/position-entry/types.ts

export type EntryWorkflowType =
  | 'leapsOnly' | 'newPmcc' | 'stockCoveredCall' | 'buyWrite' | 'callAgainstPosition';

// ── Planning stage ───────────────────────────────────────────────────────
// A SavedPlan is never a position and never creates a CoverageAllocation.
// It is historical planning context once superseded by an ExecutionRecord.
export interface SavedPlan {
  id: string;
  workflowType: EntryWorkflowType;
  accountNumber: string;
  underlying: string;
  createdAt: string;
  // Proposed legs, as scanned/priced at save time -- never mutated after
  // creation. A later "Record Executed Trade" against this plan creates a
  // NEW ExecutionRecord; it does not edit this SavedPlan.
  proposedLegs: ProposedLeg[];
  assumptions: PlanAssumptions;       // slippage/fee/volatility/dividend assumptions shown at
                                        // save time -- see LCC-0001E for the full transparency
                                        // field set this ticket's plans carry forward but does
                                        // not newly define
}

export interface ProposedLeg {
  role: 'long' | 'short' | 'equity';
  symbol: string;                     // OCC symbol for options, underlying for equity
  quantity: number;
  assumedPrice: number | null;        // never labeled as a fill -- ticket requirement
}

export interface PlanAssumptions {
  quoteAsOf: string | null;
  bid: number | null;
  ask: number | null;
  slippageAssumption: number | null;
  feeAssumption: number | null;
}

// ── Execution-evidence stage ─────────────────────────────────────────────
export type ExecutionSource = 'manual' | 'brokerMatched';
export type ExecutionCompleteness = 'complete' | 'partial' | 'unequal';

export interface ExecutionRecord {
  id: string;
  workflowType: EntryWorkflowType;
  accountNumber: string;
  underlying: string;
  source: ExecutionSource;
  savedPlanId: string | null;         // null if entered without a prior saved plan
  fills: ExecutionFill[];             // every individual fill retained, never overwritten in
                                        // place -- master architecture §8/§7.3 non-mutation
                                        // principle, applied here to fills as well as rolls
  completeness: ExecutionCompleteness;
  createdAt: string;
  // Set true only after the resulting Position(s)/CoverageAllocation (if
  // any) have been successfully created downstream. Lets the UI/store
  // distinguish "recorded but not yet processed" from "fully applied" --
  // relevant for partial-failure recovery (§14).
  applied: boolean;
}

export interface ExecutionFill {
  legRole: 'long' | 'short' | 'equity';
  symbol: string;
  quantity: number;
  price: number;                       // actual fill price -- never a planned/assumed price
  fees: number | null;
  filledAt: string;
  brokerFillId: string | null;         // present for brokerMatched, null for manual
}
```

**Design note on `applied`:** the ticket's acceptance criteria are stated as if execution evidence
atomically produces positions/allocations. In practice, this ticket's workflows perform two
API calls in sequence (record the `ExecutionRecord`, then call LCC-0001B's
`POST /api/coverage-allocations` if the workflow creates a relationship) — `applied` exists so a
failure between those two calls is visible and recoverable rather than silently inconsistent. This is
addressed in detail in §14.

---

## 5. Workflow boundary (discovery / planning / execution evidence / tracking)

Directly implementing the ticket's own "Workflow boundary" scope section:

| Stage | Type | Mutates `Position`/`CoverageAllocation`? |
|---|---|---|
| **Discovery** | `ScreenResult` (existing `lib/scans/types.ts`, unmodified) | No |
| **Planning** | `SavedPlan` | No |
| **Execution evidence** | `ExecutionRecord` | No, by itself — see §10 |
| **Tracking** | `Position` (LCC-0001A) + `CoverageAllocation` (LCC-0001B) | Yes — created **only** when an `ExecutionRecord` reaches a filled state and is explicitly applied (§10) |

A `SavedPlan` or a bare `ScreenResult` is structurally incapable of creating a `CoverageAllocation` —
neither type is accepted as an input anywhere in `lib/coverage/store.ts`'s API surface (LCC-0001B
§4.2/§10.1 only accept `CoverageAllocation` objects, which this ticket's workflows construct **from**
an applied `ExecutionRecord`, never from a plan). This is the literal implementation of "A scanner
result or saved plan is never an open position."

---

## 6. Entry workflows

Each workflow is a pure orchestration function (no direct fetch — calls injected store functions),
independently testable and independently feature-flaggable per the ticket's rollout requirement.

### 6.1 Standalone long call / LEAPS (`lib/position-entry/workflows/leapsOnly.ts`)

```ts
export function reviewLeapsCandidate(candidate: ScreenResult): SavedPlan // planning only
export async function recordLeapsExecution(
  plan: SavedPlan | null,
  fills: ExecutionFill[],
): Promise<ExecutionRecord>
export async function applyLeapsExecution(record: ExecutionRecord): Promise<{
  positionKey: string;   // the resulting long-call Position, per LCC-0001A's option adapter
}>
```

`applyLeapsExecution` does **not** call `lib/coverage/store.ts` — a standalone long call creates no
`CoverageAllocation` (there is nothing to link yet). LCC-0001B's `deriveStrategy()` classifies the
resulting position as `LongCallOnly` purely from the absence of any allocation referencing it — no
explicit "mark as standalone" call is needed, satisfying the "LEAPS only" acceptance criterion.

### 6.2 New PMCC (`lib/position-entry/workflows/newPmcc.ts`)

```ts
export function reviewPmccPlan(pair: PmccPairResult): SavedPlan // both proposed legs
export async function recordPmccExecution(
  plan: SavedPlan | null,
  fills: ExecutionFill[],       // may contain long-only, short-only, or both
): Promise<ExecutionRecord>
export async function applyPmccExecution(record: ExecutionRecord): Promise<{
  longPositionKey: string | null;
  shortPositionKey: string | null;
  allocationId: string | null;   // null unless BOTH legs filled
}>
```

Per the ticket's explicit note ("The proposed long leg is the predetermined support; do not ask an
unnecessary coverage question") and LCC-0001B's `inference.ts`: `applyPmccExecution` does **not**
call `inferOrRequireConfirmation()` when both legs fill from the same `newPmcc` workflow — it calls
`POST /api/coverage-allocations` directly with `foundationType: 'longCall'`,
`origination: 'CREATED_TOGETHER'` (per the corrected master architecture §5.4 — origination is
workflow-asserted, and this is the workflow that asserts `CREATED_TOGETHER`), `source: 'userConfirmed'`.
If only the long leg fills (short cancelled), `applyPmccExecution` creates only the long-call
`Position` and no allocation — `LongCallOnly` results, satisfying the "Partial PMCC" acceptance
criterion ("does not fabricate a PMCC relationship").

### 6.3 Stock covered call (`lib/position-entry/workflows/stockCoveredCall.ts`)

```ts
export async function findEligibleCalls(
  underlying: string,
  snapshot: PortfolioSnapshot,
  allocations: CoverageAllocation[],
): Promise<ScreenResult[]>   // delegates to existing covered-call-finder.ts, unmodified — see §2.2

export function reviewStockCoveredCallPlan(candidate: ScreenResult, foundation: EligibleFoundation): SavedPlan
export async function recordStockCoveredCallExecution(
  plan: SavedPlan | null,
  fill: ExecutionFill,
): Promise<ExecutionRecord>
export async function applyStockCoveredCallExecution(record: ExecutionRecord): Promise<{
  shortPositionKey: string;
  allocationId: string;
}>
```

Starts from an equity holding with **verified available capacity** — `findEligibleCalls` re-checks
`lib/coverage/inference.ts::findEligibleFoundations()` (LCC-0001B §5) immediately before returning
candidates, not from a cached figure, satisfying the ticket's "Disclose the exact quantity allocation"
requirement. `applyStockCoveredCallExecution` calls `POST /api/coverage-allocations` with
`foundationType: 'equity'`, `origination: null` (equity foundations never carry origination, per
LCC-0001B §4.1).

### 6.4 Buy-write (`lib/position-entry/workflows/buyWrite.ts`)

```ts
export async function recordBuyWriteExecution(
  sharesFill: ExecutionFill,
  shortCallFill: ExecutionFill,
  sharedOrderReference: string | null,   // ticket requirement: "shared order relationship"
): Promise<ExecutionRecord>
export async function applyBuyWriteExecution(record: ExecutionRecord): Promise<{
  equitySymbol: string;
  shortPositionKey: string | null;   // null if only shares filled
  allocationId: string | null;
}>
```

One `ExecutionRecord` carries both fills, linked by `sharedOrderReference` (a broker complex-order id
when broker-matched, or a client-generated correlation id when manual) — this is what the ticket
means by "a shared order relationship," implemented as a field on the record rather than a separate
join table, since both fills are already retained together in `fills[]`. **Coverage activates only
for actually filled quantities** (ticket requirement): if shares fill 200 but the short call fills
only 1 contract's worth of intended coverage, `allocatedQuantity` on the resulting allocation reflects
the filled short-call quantity, never the originally planned quantity.

### 6.5 Call against existing position (`lib/position-entry/workflows/callAgainstPosition.ts`)

```ts
export async function findEligibleFoundationsForSale(
  underlying: string,
  snapshot: PortfolioSnapshot,
  allocations: CoverageAllocation[],
): Promise<EligibleFoundation[]>   // delegates to lib/coverage/inference.ts, unmodified

export async function recordCallAgainstPositionExecution(
  foundation: EligibleFoundation | null,   // null if starting generically, not from one card
  fill: ExecutionFill,
): Promise<ExecutionRecord>

export async function applyCallAgainstPositionExecution(
  record: ExecutionRecord,
  foundation: EligibleFoundation,          // required at apply time -- see below
): Promise<{ shortPositionKey: string; allocationId: string }>
```

Implements the ticket's single shared action, `Sell Call Against Position`:

- **If the action begins from a specific eligible foundation** (e.g., user clicked the action from a
  `LongCallOnly` position card), that foundation is disclosed and pre-filled — `foundation` is
  non-null from the start, and `applyCallAgainstPositionExecution` proceeds directly.
- **If multiple foundations are eligible**, `findEligibleFoundationsForSale` returns more than one
  result and the UI must call `lib/coverage/inference.ts::inferOrRequireConfirmation()` (LCC-0001B
  §7) — this ticket's workflow does not duplicate that logic, it consumes it.
- **Fully allocated foundations never appear** in `findEligibleFoundationsForSale`'s results at all
  (LCC-0001B's `findEligibleFoundations` already excludes them) — this is the mechanism behind
  "Fully allocated foundations show `Manage Short Call`, not a new sell action": the action itself is
  simply unavailable for that foundation, not conditionally hidden by this ticket's own logic.

---

## 7. Required calculations

`lib/position-entry/calculations.ts` — implements the ticket's "Required calculations" list
field-by-field, closing the gap the LCC-0001B architecture review noted (master architecture §4,
item 2: this list was not previously mapped function-by-function).

| Calculation | Function | Source data |
|---|---|---|
| Gross premium received | `grossPremiumReceived(fills)` | Sum of short-call fill prices × quantity × multiplier, from `ExecutionRecord.fills` |
| Current short-call liability | `currentShortCallLiability(position, quote)` | Existing `positionMetrics.ts::resolveOptionLegPrice`/`computePositionValuation` (LCC-0001A adapter, unmodified) applied to the short leg |
| Realized/unrealized short-call P/L | `shortCallRealizedPnl(closedFills)` / `shortCallUnrealizedPnl(openFill, quote)` | Existing `computePositionPnl` (positionMetrics.ts), reused |
| Foundation realized/unrealized P/L | `foundationPnl(foundation, snapshot)` | For equity: `EquityHolding.unrealizedPnl` (LCC-0001A). For long call: existing option P/L via `positionMetrics.ts`. |
| Original transaction basis | `originalTransactionBasis(fills)` | Directly from `ExecutionFill.price`/`fees`, never re-derived |
| Net strategy basis (explicitly non-tax) | `netStrategyBasis(foundationBasis, allocation)` | `foundationPnl` basis minus cumulative realized short-call premium; UI label always includes "not a tax basis" per ticket requirement |
| Total strategy P/L (no double counting) | `totalStrategyPnl(strategy: DerivedStrategy)` | Delegates to LCC-0001B's `sumTotalSymbolExposure()` (LCC-0001B §8.2) restricted to `strategy.contributingPositionKeys` — reused, not reimplemented |
| Called-away return | `calledAwayReturn(foundation, assignedFill)` | New calculation, `(strike - basis + premiumReceived) / basis` — no existing implementation found in the repo; see §17 open item |
| Initial theoretical max loss (new 1:1 diagonal only) | `initialTheoreticalMaxLoss(netDebit)` | Existing `calculatePmccCapital` (financials.ts), reused. Explicitly **not** retained as a label after lifecycle changes — this function is only called at initial-entry display time, never re-invoked by any later lifecycle event (LCC-0001D scope) |

---

## 8. PMCC validation

`lib/position-entry/pmccValidation.ts` — the ticket's own "PMCC validation" list, implemented by
composing **existing** modules rather than new logic wherever one already exists:

| Check | Mechanism |
|---|---|
| Underlying/deliverable compatibility | LCC-0001B's `validatePmccCompatibility()` (LCC-0001B §6.4), reused directly |
| Long expiration after short expiration | Same function |
| Long strike below short strike | `pmccPairing.ts`'s existing pairing checks (`LONG_STRIKE_NOT_BELOW_SHORT` failure code), reused — this is discovery-stage validation already enforced before a candidate ever reaches planning |
| Long delta, intrinsic/extrinsic value | `pmccLegEconomics.ts`, reused |
| Net debit and strike width | `financials.ts::calculatePmccCapital`, reused |
| Liquidity and quote timestamps | `pmccQuoteQuality.ts::evaluatePmccQuoteQuality`, reused |
| Dividend and early-assignment exposure | **No existing implementation found.** Flagged as an open item, §17 — this ticket cannot claim to implement a check that doesn't exist yet without either building new logic (out of this ticket's file-budget as scoped) or explicitly deferring it. Recommend deferring to LCC-0001E, since scanner transparency (where dividend/assignment risk is meant to be surfaced per that ticket's scope) is the more natural home. |

**`initial net debit < strike width` is a warning signal, never a profitability guarantee** — this
ticket's UI copy for this check must say so explicitly wherever it's rendered (ticket requirement,
restated because it is a UI-copy requirement, not just a calculation one).

---

## 9. Persistence contract

### 9.1 API routes

Both follow the `position-entry-snapshots` upsert-without-overwrite pattern (§2.2), not the
always-overwrite `stopPolicyStore` pattern — a `SavedPlan` or `ExecutionRecord`, once written, is
historical fact and must never be silently replaced by a later write with the same key.

```
GET  /api/position-entry-plans        → { plans: Record<string, SavedPlan> }
POST /api/position-entry-plans        → upsert-without-overwrite by id; 409 if id exists with
                                          different content (defense against accidental double-save)

GET  /api/position-entry-executions   → { executions: Record<string, ExecutionRecord> }
POST /api/position-entry-executions   → upsert-without-overwrite by id; same 409 defense.
                                          A record's `applied` field IS mutable via a narrow
                                          PATCH-equivalent (a second, separate endpoint,
                                          mirroring LCC-0001B's narrow release endpoint design):
POST /api/position-entry-executions/[id]/mark-applied
                                        → sets applied: true only; no other field mutable
```

### 9.2 Client-side service modules

`lib/position-entry/planStore.ts` and `executionStore.ts` mirror `lib/coverage/store.ts`'s
established convention (LCC-0001B §10.2): best-effort for plans (disposable planning context, safe
to lose), but **not** best-effort for executions — same deliberate deviation LCC-0001B already
established for `CoverageAllocation` writes (a failed execution-record POST must surface as a visible
error, never silently swallowed), for the identical reason: an `ExecutionRecord` is the primary
record of a real fill.

---

## 10. Execution evidence: manual record vs. broker match

Directly implementing the ticket's "Execution evidence" scope — two distinct entry paths into the
same `ExecutionRecord` type:

- **`Record Executed Trade`** (manual): user enters fill price/quantity/timestamp directly.
  `source: 'manual'`, `brokerFillId: null` on every fill.
- **`Import or Match Broker Activity`**: reads recent broker transaction history (existing
  TastyTrade transaction/order endpoints, browser-side, same auth pattern as
  `acquisition.ts`/`covered-call-capacity.ts`) and matches candidate fills to the pending
  `SavedPlan`/workflow by symbol + approximate timestamp + quantity. `source: 'brokerMatched'`,
  `brokerFillId` populated from the matched broker record.

Both paths converge on the same `applyXExecution()` function per workflow (§6) — the workflow logic
does not branch on `source` beyond what's already captured in the `ExecutionFill` shape. This
directly satisfies "Retain actual fill quantity, price, fees, timestamps, and broker identifiers" and
"Do not label planned prices as fills" (a `SavedPlan.proposedLegs[].assumedPrice` and an
`ExecutionFill.price` are different fields on different types — there is no code path that could
display one as the other).

---

## 11. Partial execution handling

Directly implementing the ticket's "Partial execution" scope, as concrete branches within each
workflow's `apply*Execution` function (§6), not a separate generic handler:

| Case | Handling |
|---|---|
| Long fills, short doesn't (PMCC) | `applyPmccExecution` creates only the long `Position`; no allocation → `LongCallOnly` (§6.2) |
| Shares fill, short doesn't (buy-write) | `applyBuyWriteExecution` creates only the equity holding's visibility (already present via LCC-0001A once the broker reflects it); no allocation → `StockOnly` (§6.4) |
| Short fills without sufficient foundation | The relevant `apply*Execution` function still creates the short-call `Position` (it's a real broker fill, must be tracked) but the `POST /api/coverage-allocations` call either isn't made (no eligible foundation) or is rejected server-side by LCC-0001B's `validateCapacity` — either way, LCC-0001B's `deriveStrategy()` classifies the result as `ActionNeeded` (LCC-0001B §8.1 item 6), not silently ignored |
| Unequal quantities | Only the verified supported quantity is allocated — `applyStockCoveredCallExecution`/`applyBuyWriteExecution` pass `min(shortFillQuantity, availableFoundationQuantity)` as `allocatedQuantity`, never the originally planned quantity |
| Multiple fills | `ExecutionRecord.fills[]` retains every fill; §7's calculation functions compute weighted economics from the full array, never from a single collapsed value |

---

## 12. Portfolio/Screener UI integration (mockup-aligned)

Per Diane's [Integrated LEAPS, Covered Call, and PMCC Flow mockup](../tickets/mockups/tradeedge-integrated-leaps-flow.html)
and the execution sequence's LCC-0001C mockup-map row ("Screener Result, LEAPS Result, PMCC Plan,
Existing Coverage, Portfolio, Stock Covered Call"):

- **Screener Result / LEAPS Result / PMCC Plan**: `app/screener/page.tsx`'s existing result cards and
  PMCC modal gain "Save Plan" and "Record Executed Trade"/"Import or Match Broker Activity" actions
  (§2.3). No new launcher, no new card layout — additive actions on existing cards, consistent with
  LCC-0001E owning the actual launcher reframing.
- **Existing Coverage**: the "What supports this short call?" dialog (LCC-0001B's `inference.ts`
  confirmation-required path) is invoked from `callAgainstPosition.ts`'s workflow when multiple
  foundations are eligible (§6.5) — this ticket wires the dialog's trigger point; the dialog itself
  and its underlying data source are LCC-0001B deliverables.
- **Portfolio**: `LongCallOnly`/`StockOnly` position cards (LCC-0001B's `deriveStrategy()` output)
  gain the "Sell Call Against Position" entry point; fully-allocated foundations show "Manage Short
  Call" (a placeholder/no-op link for now, since actual short-call management — closing, rolling — is
  LCC-0001D scope; this ticket only needs the label/affordance to be correct, not functional beyond
  navigation).
- **Stock Covered Call**: the dedicated entry flow from an equity holding, per §6.3.
- Every workflow is feature-flagged independently per the ticket's rollout requirement ("Feature-flag
  each entry path").

---

## 13. Reconciliation implications

None introduced directly — this ticket creates `Position`/`CoverageAllocation` records from confirmed
fills, which is exactly the input LCC-0001D's reconciliation logic (a later ticket) will monitor. One
forward-compatibility note: `ExecutionRecord.fills[].brokerFillId` is deliberately carried so that
LCC-0001D's future broker-sync reconciliation can match a `brokerMatched` execution against the
canonical broker transaction feed without re-deriving identity from scratch — this ticket does not
implement that matching logic itself, only ensures the field exists for LCC-0001D to consume.

---

## 14. Error handling, auditability, and observability

- **Two-step apply consistency** (§4 design note): `apply*Execution` functions perform (a) mark the
  `ExecutionRecord` as being applied, (b) create the `Position`(s) via the existing broker-position
  refresh cycle (positions become visible once the broker reflects the fill and the next
  `PortfolioDataProvider` refresh picks it up — this ticket does **not** fabricate a `Position` from
  an `ExecutionRecord` directly, since `Position` identity is broker-derived per LCC-0001A), and (c)
  call `POST /api/coverage-allocations` if the workflow creates a relationship. If (c) fails after (a)
  succeeded, `applied` remains `true` (the fill is real) but no allocation exists — this surfaces
  identically to §11's "short fills without sufficient foundation" case (`ActionNeeded`), which is the
  correct, safe fallback: a failed allocation-creation call is indistinguishable, from the user's and
  the system's perspective, from a real coverage gap, and both get the same fail-closed treatment
  rather than a special-cased retry-loop.
- **Auditability**: every `ExecutionRecord` is immutable once created except for the narrow
  `applied` flag (§9.1); every allocation it triggers carries its own `AuditEvent[]` per LCC-0001B,
  referencing nothing about the `ExecutionRecord` beyond what's needed (no duplicated audit trail).
- **Observability**: failed allocation-creation calls from an applied execution are logged (account
  identifiers redacted) as a distinct event type from LCC-0001B's own rejection logging, so a future
  LCC-0001D reconciliation dashboard can distinguish "this short call was never linked because the
  entry workflow's allocation call failed" from "this short call was never linked because of an
  import-time ambiguity" (LCC-0001B §12) — same underlying `ActionNeeded` state, different root cause,
  worth keeping distinguishable in logs even though the UI treatment is identical.

---

## 15. Migration and rollout plan

No historical migration in this ticket. Rollout, per the ticket's own "Rollout" section ("Release
manual record and broker matching before any order-submission integration" — already satisfied,
since this ticket never adds order submission; "Feature-flag each entry path"):

1. **PR 1** — `lib/position-entry/types.ts`, `calculations.ts` (§7, minus `calledAwayReturn` pending
   §17), `pmccValidation.ts` (§8, minus dividend/assignment exposure, deferred to LCC-0001E per §8).
   Unit coverage only, no consumer wiring.
2. **PR 2** — `app/api/position-entry-plans/route.ts`, `app/api/position-entry-executions/route.ts`
   (+ `mark-applied`), `planStore.ts`, `executionStore.ts`. Still zero visible production change.
3. **PR 3** — `leapsOnly.ts` workflow + its Screener/Portfolio UI wiring, behind its own flag. Chosen
   first because it has the simplest apply-path (no allocation call at all, §6.1) and is the lowest-
   risk workflow to validate the plan→execution→tracking pipeline end to end.
4. **PR 4** — `stockCoveredCall.ts` + `callAgainstPosition.ts` workflows (share the same
   allocation-creation shape against an equity/long-call foundation respectively), flagged
   independently.
5. **PR 5** — `newPmcc.ts` workflow, flagged independently — deliberately sequenced after the simpler
   workflows have validated the underlying plumbing, since PMCC's two-leg partial-fill handling (§11)
   is the most complex case.
6. **PR 6** — `buyWrite.ts` workflow, last, since it is the least distinct from the combination of
   `stockCoveredCall.ts`'s allocation-creation logic and a plain equity purchase.

Each PR touching `app/portfolio/page.tsx` or `app/screener/page.tsx` requires a full Vercel preview
build, per standing convention.

---

## 16. Unit, integration, and acceptance-test matrix

| Test | Type | Location | Traces to |
|---|---|---|---|
| `SavedPlan`/`ExecutionRecord`: plan never creates a position or allocation (type-level + integration check) | Unit + Integration | `lib/position-entry/__tests__/workflowBoundary.test.ts` | Ticket "Workflow boundary" |
| `applyLeapsExecution`: creates position, no allocation | Integration | `lib/position-entry/__tests__/leapsOnly.test.ts` | "LEAPS only" acceptance criterion |
| `applyPmccExecution`: both legs fill → two positions, `CREATED_TOGETHER` allocation | Integration | `lib/position-entry/__tests__/newPmcc.test.ts` | "New PMCC" acceptance criterion |
| `applyPmccExecution`: long fills, short cancelled → `LongCallOnly`, no fabricated relationship | Integration | Same | "Partial PMCC" acceptance criterion |
| `applyStockCoveredCallExecution`: verified capacity → position + allocation created | Integration | `lib/position-entry/__tests__/stockCoveredCall.test.ts` | "Existing shares" acceptance criterion |
| Proposed vs. executed: accounting uses fill evidence, not plan assumptions, even when they differ | Unit | `lib/position-entry/__tests__/calculations.test.ts` | "Proposed versus executed" acceptance criterion |
| `callAgainstPosition`: single eligible foundation preselected and disclosed; multiple → confirmation required | Integration | `lib/position-entry/__tests__/callAgainstPosition.test.ts` | Ticket "Call against existing position" scope |
| `callAgainstPosition`: fully allocated foundation never appears as a sell-action target | Integration | Same | LCC-0001B §16 cross-check |
| Partial/unequal/multi-fill matrix (§11's five rows) | Integration | `lib/position-entry/__tests__/partialExecution.test.ts` | Ticket "Partial execution" acceptance criteria |
| Golden calculation tests (gross premium, liability, realized/unrealized splits, net strategy basis, called-away return placeholder, initial max loss) | Unit | `lib/position-entry/__tests__/calculations.test.ts` | **Requires Alan's approval per ticket validation requirement** — flagged, not self-approved here |
| PMCC validation: every check in §8's table except dividend/assignment (deferred) | Unit | `lib/position-entry/__tests__/pmccValidation.test.ts` | Ticket "PMCC validation" scope |
| Two-step apply failure: allocation call fails after execution recorded → `ActionNeeded`, not silent inconsistency | Integration | `lib/position-entry/__tests__/applyConsistency.test.ts` | §14 |
| Manual record vs. broker match: both converge on identical downstream `apply*Execution` behavior | Integration | `lib/position-entry/__tests__/executionEvidence.test.ts` | Ticket "Execution evidence" scope |
| Accessibility: dialogs, coverage choice, confirmations | Component | Extends `app/screener/__tests__/*`, `app/portfolio/__tests__/*` | Ticket validation requirement |
| Existing PMCC pairing/ranking suites remain green (regression — ranking untouched) | Existing suite, unmodified | `lib/scans/__tests__/pmccPairing.test.ts`, `pmccProduction.test.ts` | Reused-unchanged classification, §3 |
| Existing LCC-0001A/B suites remain green (regression) | Existing suite, unmodified | `lib/portfolio-snapshot/__tests__/*`, `lib/coverage/__tests__/*` | Dependency integrity |
| `npx tsc --noEmit --incremental false` | Type check | CI | Standing convention |
| Full Vercel preview build | Build | Manual/CI per PR | Standing convention |
| `git diff --check` | Lint | CI | Standing convention |

---

## 17. Acceptance-criterion traceability

| LCC-0001C acceptance criterion | Implementing mechanism |
|---|---|
| LEAPS only (record long-call execution → independent Foundation Only, no liability) | §6.1 `applyLeapsExecution` |
| New PMCC (both legs fill → two positions, linked, classified PMCC) | §6.2 `applyPmccExecution` |
| Existing shares (verified capacity → option position + share allocation) | §6.3 `applyStockCoveredCallExecution` |
| Proposed versus executed (accounting uses fills, not scanner prices) | §4 type separation (`ProposedLeg.assumedPrice` vs `ExecutionFill.price`), §7 calculations |
| Partial PMCC (long fills, short cancelled → LEAPS Only, no fabricated relationship) | §6.2, §11 row 1 |

All five acceptance criteria map to an explicit, named, testable mechanism.

**Open items surfaced by this ticket, requiring resolution before the affected PRs:**

1. **`calledAwayReturn` (§7)** — no existing implementation found anywhere in the repository. This
   ticket specifies its formula but flags that it has not been validated against Alan's golden
   fixtures (which this ticket's own validation requirement mandates). Do not implement PR 1's
   calculation module without Alan's sign-off on this specific formula first.
2. **Dividend and early-assignment exposure check (§8)** — no existing implementation found.
   Recommended to defer to LCC-0001E (scanner transparency) rather than build new risk-assessment
   logic inside this ticket's already-large scope. Needs explicit confirmation this deferral is
   acceptable, since the ticket text lists it under LCC-0001C's own "PMCC validation" scope, not
   LCC-0001E's.

---

## 18. File-by-file implementation sequence

1. `lib/position-entry/types.ts` — new (§4).
2. `lib/position-entry/calculations.ts` — new, minus `calledAwayReturn` pending §17 item 1 (§7).
3. `lib/position-entry/pmccValidation.ts` — new, minus dividend/assignment exposure pending §17 item 2 (§8).
4. `app/api/position-entry-plans/route.ts` — new (§9.1).
5. `app/api/position-entry-executions/route.ts` + `[id]/mark-applied/route.ts` — new (§9.1).
6. `lib/position-entry/planStore.ts`, `executionStore.ts` — new (§9.2).
7. `lib/position-entry/workflows/leapsOnly.ts` — new (§6.1).
8. `lib/position-entry/workflows/stockCoveredCall.ts` — new (§6.3).
9. `lib/position-entry/workflows/callAgainstPosition.ts` — new (§6.5).
10. `lib/position-entry/workflows/newPmcc.ts` — new (§6.2).
11. `lib/position-entry/workflows/buyWrite.ts` — new (§6.4).
12. `components/portfolio-data/PortfolioDataProvider.tsx` — extend (§2.3).
13. `app/screener/page.tsx` — extend, additive action wiring only (§2.3, §12).
14. `app/portfolio/page.tsx` — extend, additive entry-point wiring only (§2.3, §12).
15. Test files per §16, one per new module plus the extended existing suites named there.

**Not touched:** `lib/scans/pmccPairing.ts`, `pmccScore.ts`, `pmccProduction.ts`, `pmccChainAdapter.ts`
(discovery/ranking, unmodified); `lib/tastytrade/client.ts` and `app/portfolio/page.tsx`'s private
`ttPost`/`ttValidateOrder`/`ttPostComplex` (no order submission added); `lib/coverage/*` (LCC-0001B,
called, not modified); `lib/portfolio-snapshot/*` (LCC-0001A, called, not modified).

---

## 19. Explicit exclusions — deferred to LCC-0001D and LCC-0001E

- **Short-call lifecycle transitions** (`Proposed → Pending → Open → ...`), rolls, expiration,
  assignment reconciliation — LCC-0001D. This ticket's `ExecutionRecord`/`apply*Execution` functions
  create the *initial* `Position`/`CoverageAllocation`; everything that happens to them afterward is
  LCC-0001D's state machine.
- **Assignment reconciliation** — explicitly named as a non-goal in the LCC-0001C ticket itself,
  restated here for completeness.
- **Automatic broker execution** — non-goal; this ticket only ever records evidence of fills that
  already happened (manually entered or broker-matched), never places an order (§2.2, §14).
- **Automatic roll recommendations** — non-goal; not applicable to this ticket's scope.
- **Scanner ranking changes, new launcher, Find LEAPS/Find Covered Calls/Calls Against My Positions
  as first-class Screener sections** — LCC-0001E. This ticket adds actions to *existing* result cards
  (§2.3, §12); building the reframed launcher and its four named sections is LCC-0001E's own scope.
- **Dividend and early-assignment exposure check** — recommended deferral to LCC-0001E, pending
  confirmation (§17 item 2).
- **PMCC scoring changes** — out of scope for this ticket and the epic generally, per the resolved
  product decision (master architecture §15.0); this ticket explicitly reuses `pmccScore.ts`
  unmodified (§3).

---

## 20. Self-review against source material

- **Epic:** this ticket's workflows are the concrete mechanism behind the epic's release-definition
  items 3–6 (hold a long call without an active short call; open a new PMCC or add a short call to an
  existing long call; sell a covered call against verified available shares; track every short-call
  cycle independently — the last partially, since full cycle tracking is LCC-0001D, but this ticket
  creates the cycle's *first* record correctly).
- **LCC-0001C ticket:** every scope item (standalone LEAPS, new PMCC, stock covered call, buy-write,
  call against existing position, execution evidence, required calculations, PMCC validation, partial
  execution) and all five acceptance criteria map to an explicit mechanism — §17 traceability table.
  Non-goals (automatic broker execution, automatic roll recommendations, assignment reconciliation,
  scanner ranking changes) are respected and restated in §19.
- **Corrected master architecture:** §4.5, §8 are implemented without deviation. The
  discovery/planning/execution-evidence/tracking boundary (§5) is enforced at the type level
  (`SavedPlan` structurally cannot reach `lib/coverage/store.ts`'s API), not just by convention.
- **Architecture review:** no direct findings from that review apply to LCC-0001C's own new code (the
  review's findings were about `isPmccPosition()` and the adjusted-multiplier reference, both already
  addressed in the LCC-0001A/B specs this ticket builds on); this ticket's own PMCC-origination
  handling (§6.2) correctly applies the corrected, workflow-asserted rule rather than the original
  timing heuristic.
- **LCC-0001A/B technical specs:** every type and function this ticket calls (`PortfolioSnapshot`,
  `EquityHolding`, `CoverageAllocation`, `findEligibleFoundations`, `inferOrRequireConfirmation`,
  `validatePmccCompatibility`, `sumTotalSymbolExposure`) is consumed exactly as those specs defined
  it, with no assumed field or behavior not present in either document. The recorded 60-second
  snapshot-staleness threshold (LCC-0001B, revised) is inherited automatically since this ticket's
  workflows call LCC-0001B's existing `POST /api/coverage-allocations` route rather than
  reimplementing staleness handling.
- **Execution sequence / Gate C:** all four Gate C criteria (discovery/planning/execution/tracking
  remain distinct; LEAPS-only/PMCC/CC/buy-write/existing-position flows pass; partial/unequal fills
  produce truthful position states; Alan's golden calculations pass) map to §5, §6, §11, and §17 item 1
  respectively — the last one is flagged as **not yet satisfied**, since Alan's approval is a
  precondition this document cannot self-certify.
- **Mockups:** §12 explicitly maps every LCC-0001C mockup-map row to a concrete UI wiring point, and
  correctly attributes the launcher/section-level UI to LCC-0001E rather than claiming it here.
- **`PMCC_SPECIFICATION.md`:** not applicable to this ticket's scope; `pmccScore.ts` explicitly
  reused unmodified (§3), consistent with the resolved product decision.
- **Current code:** §2 verified every cited file/function against the repository at the synced
  commit, including confirming that TradeEdge-initiated order submission (`ttPost`/`ttValidateOrder`)
  is private to `app/portfolio/page.tsx` and is correctly excluded from this ticket's scope rather
  than silently reused or duplicated.

Two open items were surfaced during this review and are **not yet resolved**: `calledAwayReturn`'s
formula requires Alan's sign-off before implementation (§17 item 1), and the dividend/early-assignment
exposure check's deferral to LCC-0001E requires explicit team confirmation, since the ticket text
places it in LCC-0001C's own scope (§17 item 2). Both are flagged rather than silently assumed or
silently implemented without the required approval. No contradiction with the epic, the ticket, the
corrected architecture, the architecture review, the LCC-0001A/B specs, the execution sequence, the
mockups, or `PMCC_SPECIFICATION.md` was found, and none of the three resolved product decisions from
the master architecture's §15.0 are reopened.
