# LCC-0001A — Technical Specification
Unified Portfolio Snapshot and Equity Holdings

**Status:** Draft for team review (Dane)
**Depends on:** None
**Blocks:** LCC-0001B, LCC-0001C, LCC-0001D, LCC-0001E
**Traces to:** LCC-0001 epic, LCC-0001A ticket, corrected master architecture
(`docs/design/LCC-0001-technical-architecture.md`, commit `d686a02`), architecture review
(`docs/design/LCC-0001-architecture-review.md`), execution sequence, both approved mockups, and the
current repository implementation cited throughout this document.
**Does not implement application code. Does not begin LCC-0001B.**

---

## 1. Objective

Create one normalized, account-scoped portfolio snapshot for equities, options, and working orders,
and display actual equity holdings in the existing Portfolio workspace, without regressing existing
option-position behavior. This is the direct implementation of §4.2 ("New module:
`lib/portfolio-snapshot/`"), §5.1 ("Canonical Portfolio Snapshot"), and §6 ("Portfolio snapshot &
broker reconciliation architecture") of the master architecture document.

---

## 2. Exact current files, functions, types, and components affected

Verified against the repository at the corrected-architecture commit. Three independent acquisition
paths were found (the master architecture named two; this spec adds the third, found during this
ticket's own code pass — see §2.4).

### 2.1 Primary acquisition path (client-side, Provider-mediated)

| File | Function/Type | Role today |
|---|---|---|
| `lib/portfolio-data/acquisition.ts` | `loadPositions()` (line ~941) | Fetches `/accounts/{n}/positions`, filters to `p['instrument-type'] === 'Equity Option' \|\| 'Index Option'` at line 952–953. **This is the exact filter that must stop discarding equity rows.** |
| `lib/portfolio-data/acquisition.ts` | `loadAccountBalances()` | Unrelated to position filtering; not modified by this ticket. |
| `lib/portfolio-data/types.ts` | `Position` | Entirely option-shaped (`legs`, `expDate`, `dte`, `identity`). Not modified — becomes the option half of the snapshot (§4). |
| `components/portfolio-data/PortfolioDataProvider.tsx` | Provider component | The single runtime call site for `loadPositions()`/`loadAccountBalances()` app-wide (per its own module doc, verified accurate). This is where snapshot acquisition is added. |
| `app/portfolio/page.tsx` (8,800+ lines) | Position rendering | Consumes `PortfolioDataProvider`'s context; renders option `Position[]` only today. Equity rows are additive here. |
| `app/dashboard/page.tsx` | Position rendering | Also consumes the Provider; out of scope for this ticket's UI changes but will see the extended context shape. |

### 2.2 Second, independent acquisition path (client-side, Screener-only)

| File | Function/Type | Role today |
|---|---|---|
| `lib/scans/tastytrade-client.ts` | `getCoveredCallCapacityReport(token)` (line ~276) | Its own client-side fetch: `/customers/me/accounts` → `/accounts/{n}/positions` (**unfiltered**) → `/accounts/{n}/orders/live`, then delegates to `buildCoveredCallCapacityReport()`. Entirely independent of `acquisition.ts` — no shared account/token/position-fetch code path. |
| `app/screener/page.tsx` (line 7739) | Call site | `const capacityReport = await getCoveredCallCapacityReport(token);` — this is where Covered Call capacity currently disagrees with Portfolio, because it reads a different, later, unfiltered snapshot. |
| `lib/scans/covered-call-capacity.ts` | `normalizeEquityHoldings()`, `normalizeShortCallExposure()`, `normalizeWorkingCallReservations()`, `computeCoveredCallCapacity()`, `buildCoveredCallCapacityReport()` | Pure, well-hardened normalization logic (§2.3 below). This is the module being **absorbed**, not deleted. |

### 2.3 Third acquisition path — found during this ticket's code review, previously unreferenced by the master architecture

| File | Function/Type | Role today |
|---|---|---|
| `app/api/positions/route.ts` (168 lines) | `GET()` | A **server-side** Next.js API route that independently fetches `/customers/me/accounts` → `/accounts/{n}/positions` and applies the identical `'Equity Option' \|\| 'Index Option'` filter (line ~17–19) as `acquisition.ts`. No caller (`fetch('/api/positions')` or equivalent) was found anywhere in the app or its test suites. |

**Disposition:** this route is very likely dead code — it is also inconsistent with the documented
architectural constraint that TastyTrade calls must be browser-side only (Vercel server IPs are
blocked by TastyTrade's nginx per current project conventions), which a server-side Next.js API route
handler would violate if it were ever actually invoked in production. This ticket does **not** modify
`app/api/positions/route.ts`. Recommendation: confirm with Dean whether it is safe to delete as
orphaned code in a later, separate cleanup — out of scope here since deleting it is not required to
close LCC-0001A's gap, and speculative deletion risks removing something with an as-yet-undiscovered
caller (e.g., an external integration or a route reached only in a code path this review didn't find).
Flagged as an explicit open item, §13.

### 2.4 Supporting modules referenced, unmodified

| File | Role |
|---|---|
| `lib/optionSymbol.ts` | `parseOccSymbol()`, `resolveOptionType()`, `resolveUnderlyingSymbol()` — pure OCC parsing already used by `covered-call-capacity.ts`; reused unchanged. |
| `lib/portfolio/closeOrderSafety.ts` | `analyzePositionStructure()`, `buildCanonicalCloseIdentity()` — unmodified; remains the option adapter's internal machinery. |
| `lib/scans/financials.ts` | `resolveOptionContractMultiplier()`, `STANDARD_EQUITY_OPTION_MULTIPLIER` — reused for adjusted-deliverable handling per the corrected master architecture (§15.2 correction). |
| `lib/portfolio-intelligence/` (health, objectives, policies) | Consumes `Position[]`/`PortfolioFinancialContext` today; equity contribution to portfolio exposure is explicitly a **non-goal** of this ticket (LCC-0001A scope: "Define equity contribution to portfolio exposure separately from option-only Greeks" — deferred, see §14 exclusions). |

---

## 3. Reuse / refactor / replace classification

| Component | Classification | Detail |
|---|---|---|
| `acquisition.ts::loadPositions()` | **Refactor** | Remove the hard filter at line 952–953; retain option-grouping logic unchanged for the filtered subset; add a second, parallel equity-extraction pass over the same `rawPositions` array (no second fetch). |
| `covered-call-capacity.ts::normalizeEquityHoldings/normalizeShortCallExposure/normalizeWorkingCallReservations` | **Reuse (ported verbatim)** | Moved into `lib/portfolio-snapshot/normalizeEquity.ts` with zero logic changes — this is the single best-hardened existing implementation and is not being reinvented. Original file's exports remain in place as thin re-exports during the transition window (§10). |
| `covered-call-capacity.ts::buildCoveredCallCapacityReport()` | **Refactor** | Re-pointed to consume the shared snapshot's already-normalized equity/short-call/working-order data instead of re-fetching/re-normalizing. Public signature preserved for existing callers during transition (§10). |
| `getCoveredCallCapacityReport()` (tastytrade-client.ts) | **Replace (behind flag)** | Its private fetch sequence is replaced by a read from the shared snapshot obtained via `PortfolioDataProvider`; `app/screener/page.tsx`'s call site is updated to consume the new source. Old function retained, unwired, until Gate A parity is demonstrated (§10). |
| `Position` type, `positionMetrics.ts`, `closeOrderSafety.ts` | **Reuse (unchanged)** | Wrapped, not modified, per architecture AD-1. |
| `PortfolioDataProvider.tsx` | **Refactor** | Extended to also expose the snapshot's equity holdings and data-quality state; existing `Position[]`/`PendingOrder[]` context fields unchanged. |
| `app/portfolio/page.tsx` | **Refactor (additive)** | New equity-row rendering added; existing option-card rendering, close-order modals, and recommendation surfaces untouched. |
| `app/api/positions/route.ts` | **Unmodified (flagged for separate cleanup)** | See §2.3. |

---

## 4. Unified Portfolio Snapshot domain types

New module: `lib/portfolio-snapshot/types.ts`. Directly implements master architecture §5.1, with
field-level detail the master document intentionally left at summary level.

```ts
// lib/portfolio-snapshot/types.ts

export interface PortfolioSnapshot {
  accountNumber: string;
  asOf: string;                 // ISO snapshot-acquisition timestamp
  quoteAsOf: string | null;     // may differ from asOf; null if unknown
  equities: EquityHolding[];
  options: import('@/lib/portfolio-data/types').Position[]; // existing type, unmodified
  workingOrders: WorkingOrder[];
  dataQuality: SnapshotDataQuality;
}

export interface EquityHolding {
  accountNumber: string;
  symbol: string;
  direction: 'Long' | 'Short';       // ported from normalizeEquityHoldings' Long-only filter,
                                       // extended to retain (not discard) Short rows -- see §5
  quantity: number;
  settledQuantity: number | null;    // not present in current broker payload usage; carried as
                                       // null until a verified settled-quantity field is confirmed
                                       // (see §13 open item)
  basis: number | null;              // ported from EquityHolding.costBasis
  basisComplete: boolean;            // ported from EquityHolding.costBasisComplete
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  quoteAsOf: string | null;
  staleQuote: boolean;
  deliverable: 'standard' | 'adjusted';
  dataQualityWarnings: string[];
}

export interface WorkingOrder {
  accountNumber: string;
  orderId: string | null;
  status: string;                    // raw broker status, normalized token available via helper
  legs: WorkingOrderLeg[];
}

export interface WorkingOrderLeg {
  underlyingSymbol: string | null;
  symbol: string | null;
  action: string;                    // raw broker action string
  instrumentType: string | null;
  optionType: 'P' | 'C' | null;
  quantity: number;
}

export type CapacityDataStatus = 'ok' | 'unavailable';

export interface SnapshotDataQuality {
  status: CapacityDataStatus;
  unavailableReason?: string;        // successor to UNATTRIBUTABLE_EXPOSURE_REASON
  staleQuotes: boolean;
  warnings: string[];
}
```

**Design notes:**

- `EquityHolding.direction` retains short stock (unlike the current `normalizeEquityHoldings`, which
  filters to `'Long'` only and silently drops short rows). LCC-0001A's own acceptance criterion
  ("Short stock: the position remains visible but contributes no covered-call capacity") requires
  short equities to be **visible in Portfolio** even though they contribute zero capacity. This is a
  deliberate, spec-level extension of the ported logic, not a behavior change to the ported capacity
  math — capacity computation continues to treat `direction === 'Short'` as zero contribution (master
  architecture invariant 2, §5.3), it is only visibility that is added.
- `EquityHolding.settledQuantity` is carried as `null` for this ticket. The current broker payload
  shape consumed by `acquisition.ts`/`covered-call-capacity.ts` has not been confirmed to reliably
  supply a distinct settled-vs-total quantity field; rather than fabricate a value, this field exists
  in the type (per the ticket's "Total quantity and settled quantity when available" requirement) but
  is populated only if a real field is confirmed present during implementation. Flagged in §13.
- `OptionPosition` is intentionally **not** a new type — it is the existing `Position` (§2.1),
  referenced by import, per architecture AD-1.

---

## 5. Equity-holding normalization

New module: `lib/portfolio-snapshot/normalizeEquity.ts`. Ports `covered-call-capacity.ts`'s
`normalizeEquityHoldings()` (lines 89–135) with exactly two behavior changes, both required by
LCC-0001A's acceptance criteria and neither present in the ticket's source module (which was written
for capacity-only, not visibility):

1. **Retain short equity rows** instead of filtering them out (`p['quantity-direction'] !== 'Long'`
   currently `continue`s past them entirely). Short rows are aggregated into a `direction: 'Short'`
   `EquityHolding` with `sharesOwned` tracked as a positive magnitude and `direction` carrying the
   sign, rather than being silently dropped.
2. **Retain zero/short-adjacent edge cases visibly** where the current function would `continue`
   (e.g., non-positive quantity) — these remain dropped, since a zero/negative quantity is not a real
   holding to display; only the `direction` filter changes.

The weighted-basis and `costBasisComplete` logic (§2.3 lines 100–135 of the source file) is ported
**verbatim, unchanged** — this satisfies LCC-0001A's "Incomplete basis" acceptance criterion exactly
as the existing module already guarantees it (a partial-lot average is never presented as the
whole-holding basis).

```ts
// lib/portfolio-snapshot/normalizeEquity.ts (implementation plan, not code)

export function normalizeEquityHoldings(
  rawPositions: RawPositionLike[],
  accountNumber: string,
  asOf: string,
): EquityHolding[] {
  // 1. Group by symbol + direction (not symbol alone) so long and short
  //    positions in the same underlying are never merged.
  // 2. For each Long group: port normalizeEquityHoldings' weighted-basis /
  //    costBasisComplete logic verbatim.
  // 3. For each Short group: same shares/quantity aggregation, basis/P&L
  //    fields populated where available but basisComplete is not
  //    capacity-relevant for short stock (direction alone gates capacity,
  //    per invariant 2 -- basisComplete is still computed honestly for
  //    display, never fabricated).
  // 4. currentPrice/marketValue/unrealizedPnl/quoteAsOf/staleQuote are new
  //    fields not present in the ported function -- populated from the same
  //    quote-fetch path acquisition.ts already uses for option positions
  //    (see acquisition.ts's price-resolution helpers), not a new quote
  //    source.
  // 5. deliverable: 'standard' unless adjusted-contract evidence exists on
  //    the raw position (mirrors resolveOptionContractMultiplier's
  //    fallback-to-standard behavior, lib/scans/financials.ts).
}
```

---

## 6. Broker adapter boundaries

- **Single fetch, two normalizations.** `PortfolioDataProvider`'s `refresh()` (via
  `acquisition.ts`) issues exactly one `/accounts/{n}/positions` fetch and one
  `/accounts/{n}/orders/live`-equivalent fetch per refresh cycle. The raw `rawPositions` array is
  passed to **both** the existing option-grouping logic (unchanged) and the new
  `normalizeEquityHoldings()` (§5) — not two separate fetches. This is the literal mechanism that
  eliminates the two-acquisition-path problem (§2.1 vs §2.2): after this ticket,
  `getCoveredCallCapacityReport()`'s private fetch (§2.2) is replaced by a read from this single
  acquired snapshot.
- **Boundary contract.** `lib/portfolio-snapshot/acquire.ts` exposes one function,
  `acquireSnapshot(token: string): Promise<PortfolioSnapshot>`, which is the only place raw broker
  payloads are touched for snapshot purposes. Every other module in `lib/portfolio-snapshot/`,
  `lib/coverage/` (future, LCC-0001B), and Screener/Portfolio consumers receive only the normalized
  `PortfolioSnapshot` — raw broker field names (`'instrument-type'`, `'quantity-direction'`, etc.)
  do not leak past this boundary, per the ticket's "Keep raw broker payloads available for
  diagnostics without allowing them to leak throughout the UI" implementation note.
- **Existing option acquisition untouched internally.** `acquire.ts` calls `loadPositions()`
  (refactored per §3) rather than reimplementing option-grouping; this preserves every existing
  option-side guarantee (`identity`, `structureAmbiguous`, health/objective scoring) exactly as-is.

---

## 7. Working-order reservations

Ports `covered-call-capacity.ts::normalizeWorkingCallReservations()` (lines 250–288) verbatim into
`lib/portfolio-snapshot/normalizeWorkingOrders.ts`, with the same case/whitespace-insensitive
status/action matching (`OPEN_ORDER_STATUSES = {'live','working'}`, `SELL_TO_OPEN_ACTION`) and the
same unattributable-exposure fail-closed behavior. No behavior change — this function already meets
every LCC-0001A requirement for working-order reservation as written; it becomes a snapshot-layer
concern instead of a capacity-report-only concern.

`WorkingOrder`/`WorkingOrderLeg` (§4) are a normalized **subset** of the raw order/leg shape,
carrying only the fields `normalizeWorkingOrders.ts` and (in LCC-0001B) the coverage-reservation
logic actually need — consistent with the "raw broker payloads... without allowing them to leak"
principle above.

---

## 8. Coverage-capacity calculations

`computeCoveredCallCapacity()` (covered-call-capacity.ts lines 320–338) is **ported unchanged** into
`lib/portfolio-snapshot/capacity.ts` — the `Math.floor(sharesOwned / 100)` gross-capacity formula,
the `Math.max(0, rawAvailable)` clamp, and `oversubscribed`/`hasUnclassifiedExposure` diagnostics are
correct as written and require no LCC-0001A changes. `buildCoveredCallCapacityReport()`
(lines 377–419) is refactored (not rewritten) to take a `PortfolioSnapshot` instead of raw
`rawPositions`/`rawOrders` arrays, calling the now-shared `normalizeEquity`/`normalizeShortCallExposure`
(ported into `lib/portfolio-snapshot/normalizeShortCallExposure.ts`, also verbatim) /
`normalizeWorkingOrders` outputs already computed once during snapshot acquisition, rather than
re-deriving them.

This directly satisfies the "Portfolio/Screener parity" acceptance criterion: Portfolio and Covered
Call capacity, after this ticket, read literally the same `PortfolioSnapshot` object (same `asOf`
timestamp, same share counts, same exposure) rather than two independently-fetched, independently-
timed snapshots.

LCC-0001B's durable coverage allocations (active/proposed relationships) are explicitly **not**
computed here — this ticket's capacity figure remains the "existing conservative capacity logic"
the ticket text allows ("LCC-0001A may initially show capacity derived from the existing conservative
capacity logic while LCC-0001B adds durable allocations").

---

## 9. Data-quality and fail-closed behavior

Ports `buildCoveredCallCapacityReport()`'s existing fail-closed contract exactly, generalized from
"Covered Call scan unavailable" to snapshot-level:

| Condition | Behavior | Source |
|---|---|---|
| Positions fetch fails | `dataQuality.status = 'unavailable'`; equities/options from any prior successful snapshot remain visible if cached, current refresh's coverage-dependent fields are not computed | LCC-0001A "Data failure" acceptance criterion |
| Working orders fetch fails | Same as above — capacity/reservation figures unavailable, equity/option visibility unaffected | Same |
| Short option/working leg unattributable to any underlying | Entire snapshot's `dataQuality.status = 'unavailable'`, `unavailableReason` set to a successor string of `UNATTRIBUTABLE_EXPOSURE_REASON` | Ported verbatim from `covered-call-capacity.ts`'s "final corrective pass" |
| Account identity unresolved | `dataQuality.status = 'unavailable'` before any per-symbol computation | LCC-0001A fail-closed list |
| Deliverable incompatible/unknown | Surfaced per-holding via `EquityHolding.dataQualityWarnings`, does not by itself force account-wide unavailability (distinct from the unattributable-exposure case, which does) | Master architecture §12 |

The existing `hasUnclassifiedExposure` diagnostic (safe-by-construction conservative reservation, but
not confirmed) is preserved as `EquityHolding`/capacity-level warning content, not elevated to
`unavailable` — this distinction (unclassified vs. unattributable) is exactly the one
`covered-call-capacity.ts`'s own comments already draw and this spec does not change it.

---

## 10. API and service contracts

### 10.1 Service boundary

```
lib/portfolio-snapshot/
  types.ts                    (§4)
  acquire.ts                  acquireSnapshot(token) -- the one acquisition boundary (§6)
  normalizeEquity.ts          (§5)
  normalizeShortCallExposure.ts   (ported verbatim from covered-call-capacity.ts)
  normalizeWorkingOrders.ts   (§7)
  capacity.ts                 (§8)
  dataQuality.ts              (§9 — shared status/warning construction helpers)
  __tests__/
```

### 10.2 No new API route in this ticket

Acquisition remains **client-side only** (existing TastyTrade browser-side-only constraint,
unchanged). The master architecture's §9.3 sketch of `GET /api/portfolio-snapshot` is a **future**
convenience route for any server-rendered or cross-tab use case; it is explicitly **not required** to
close LCC-0001A's acceptance criteria, since `PortfolioDataProvider` already serves this role
client-side today for `Position[]`. Adding a server route in this ticket would risk resurrecting the
`app/api/positions/route.ts` problem (§2.3) — a redundant, likely-broken (due to the IP-blocking
constraint) server-side fetch path. **Recommend deferring §9.3's API route to whichever ticket first
has a genuine server-side consumer** (none identified yet in A–E).

### 10.3 `PortfolioDataProvider` contract extension

```ts
// components/portfolio-data/PortfolioDataProvider.tsx — additive context fields

interface PortfolioDataContextValue {
  // existing fields unchanged: positions, pendingOrders, balances, refresh, ...
  snapshot: PortfolioSnapshot | null;        // new
  snapshotDataQuality: SnapshotDataQuality;  // new, mirrors snapshot.dataQuality for convenience
}
```

`refresh()`'s existing latest-request-wins completion contract (PI-0014C, per the file's own module
doc) is preserved; snapshot acquisition participates in the same generation-check gating so a
superseded request cannot publish a stale snapshot any more than it can publish stale `Position[]`
today.

---

## 11. Portfolio UI integration

Per Diane's [Equity-Aware Portfolio mockup](../tickets/mockups/tradeedge-equity-portfolio-revision.html)
and LCC-0001A's "Portfolio presentation" scope:

- New equity-row rendering added to `app/portfolio/page.tsx`'s existing Positions workspace, additive
  to (not replacing) option-card rendering. Displays: quantity, average basis or "Basis unavailable"
  (driven by `basisComplete`), current price, market value, unrealized P/L, data-quality state.
  Allocated/reserved/available/remainder share breakdown is **not** part of this ticket (LCC-0001B
  non-goal boundary, §14) — LCC-0001A shows the conservative capacity number only, per the ticket's
  own allowance.
- Mockup states this ticket must render: "Stock-Only Holding," "Basis Incomplete," "Data Unavailable"
  (per the execution sequence's mockup map for LCC-0001A). "Mixed AAPL Position" (shares + option
  grouped together) is **not** required by this ticket — that grouping/relationship display is
  LCC-0001B's "Portfolio composition" scope. LCC-0001A's equity rows may render as an independent
  list alongside existing option cards without a durable cross-reference.
- No changes to existing option-card rendering, close-order modals, recommendation surfaces, or
  health/objective scoring displays — verified against `app/portfolio/page.tsx`'s existing structure;
  none of the new fields are consumed by any existing render path unless explicitly wired.
- Feature-flagged: equity-row display and shared-snapshot consumption are independently flaggable per
  the ticket's rollout section (§12).

---

## 12. Persistence implications

None. `PortfolioSnapshot` is a derived, in-memory, per-refresh construct — exactly like today's
`Position[]` — with no new persisted entity. This matches LCC-0001A's scope precisely (no allocation,
no relationship, no lifecycle state is introduced by this ticket; those begin in LCC-0001B/D). No
Redis schema changes, no new `stopPolicyStore.ts`-pattern store is introduced by this ticket.

---

## 13. Error handling and observability

- **Error handling** follows the existing `acquisition.ts`/`covered-call-capacity.ts` conventions
  exactly: never throw past the acquisition boundary into UI code; failures become `dataQuality`
  states, not exceptions (matching `getCoveredCallCapacityReport()`'s existing `try { } catch { return
  { status: 'unavailable', ... } }` pattern, ported to `acquire.ts`).
- **Observability:** `dataQuality.warnings[]` logged with account identifiers redacted, per the
  ticket's rollout section — this reuses the existing `warnings: string[]` logging convention
  verbatim, no new logging infrastructure.
- **Shadow-mode parity logging (required by this ticket's rollout section):** before
  `getCoveredCallCapacityReport()`'s call site in `app/screener/page.tsx` (§2.2) is switched to the
  new snapshot-derived capacity, both code paths run and their outputs are diffed and logged
  (symbol-by-symbol share counts, capacity, warnings) for a monitored period. This is the literal
  Gate A exit criterion ("Covered Call capacity parity shadow checks pass").
- **Open items requiring implementation-time confirmation** (not blocking this spec, but must be
  resolved before/during implementation, not silently assumed):
  1. Whether the TastyTrade `/accounts/{n}/positions` payload reliably carries a distinct
     settled-quantity field (§4 note on `EquityHolding.settledQuantity`).
  2. Whether `app/api/positions/route.ts` (§2.3) has any caller not discoverable via static grep
     (e.g., an external webhook or a dynamically-constructed fetch URL) before it is considered safe
     to delete in a future cleanup ticket.

---

## 14. Migration and rollout sequence

No data migration in this ticket (no persisted domain state is introduced, §12). Rollout sequence,
per the ticket's own "Rollout" section and the execution sequence's Gate A:

1. **PR 1** — `lib/portfolio-snapshot/types.ts` + `normalizeEquity.ts` (ported + the two extensions
   in §5), full unit coverage, **no consumer wiring**. Zero production behavior change; pure addition.
2. **PR 2** — `acquire.ts`, `normalizeShortCallExposure.ts`, `normalizeWorkingOrders.ts`, `capacity.ts`,
   `dataQuality.ts` completing the module; `PortfolioDataProvider` wired to acquire and expose the
   snapshot **behind a feature flag**, off by default. Still zero visible production change.
3. **PR 3** — `app/portfolio/page.tsx` equity-row rendering, flagged independently from PR 2's
   acquisition flag per the ticket's rollout requirement ("Feature-flag equity display and shared
   snapshot consumption independently").
4. **PR 4** — shadow-mode parity comparison between old `getCoveredCallCapacityReport()` and new
   snapshot-derived capacity (§13), logged, not yet switching any real consumer.
5. **PR 5** — flip `app/screener/page.tsx`'s call site (§2.2 line 7739) from
   `getCoveredCallCapacityReport()` to the shared snapshot, once shadow-mode parity is demonstrated
   clean for an agreed monitoring window. This is the Gate A exit action.
6. Old `getCoveredCallCapacityReport()` and its private fetch sequence are left in place, unwired,
   until Gate A is fully closed and a subsequent cleanup PR (not part of this ticket) removes it.

Each PR must pass a full Vercel preview build, not just `npx tsc --noEmit`, per standing project
convention — `app/portfolio/page.tsx` is exactly the kind of large `.tsx` file where `tsc --noEmit`
has previously missed real build failures.

---

## 15. Unit, integration, and acceptance-test matrix

| Test | Type | Location | Traces to |
|---|---|---|---|
| `normalizeEquityHoldings`: long shares, weighted basis, incomplete-basis gate | Unit | `lib/portfolio-snapshot/__tests__/normalizeEquity.test.ts` | LCC-0001A "Equity visibility," "Incomplete basis" |
| `normalizeEquityHoldings`: short stock retained but zero capacity | Unit | Same file | LCC-0001A "Short stock" |
| `normalizeShortCallExposure`/`normalizeWorkingOrders`: unattributable exposure fails closed | Unit | `lib/portfolio-snapshot/__tests__/dataQuality.test.ts` | LCC-0001A "Data failure," master architecture §12 |
| `computeCoveredCallCapacity`/`buildCoveredCallCapacityReport` (ported): identical outputs to existing `covered-call-capacity.test.ts` fixtures | Unit (regression) | `lib/portfolio-snapshot/__tests__/capacity.test.ts` — **run the existing `lib/scans/__tests__/covered-call-capacity.test.ts` fixtures against the new module verbatim** (architecture review recommendation) | LCC-0001A parity requirement |
| Multiple accounts remain distinct | Unit | `lib/portfolio-snapshot/__tests__/acquire.test.ts` | LCC-0001A source-of-truth rule 6 |
| Idempotency: repeated snapshot processing creates no duplicates | Unit | Same file | LCC-0001A "Idempotency" acceptance criterion |
| `acquireSnapshot()`: positions load, orders fail → coverage-dependent fields fail closed, equities still visible | Integration | `lib/portfolio-snapshot/__tests__/acquire.test.ts` | LCC-0001A "Data failure" |
| `PortfolioDataProvider`: snapshot published only after existing generation/latest-request-wins gating passes | Integration | `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx` (new) | PI-0014C convention preservation |
| Portfolio/Screener capacity parity: same snapshot → same share quantity, exposure, reservations, timestamp | Integration | Extends existing `app/screener/__tests__/CcCapacityGate.test.tsx` | LCC-0001A "Portfolio/Screener parity" acceptance criterion |
| Existing option Position suites remain green (regression) | Existing suite, unmodified | `lib/portfolio/__tests__/closeOrderSafety.test.ts`, `lib/portfolio-data/__tests__/*` | Execution sequence Gate A: "Current option behavior remains green" |
| Existing Covered Call capacity suite remains green pre-cutover | Existing suite, unmodified | `lib/scans/__tests__/covered-call-capacity.test.ts` | Same |
| Equity-row rendering: Stock-Only Holding, Basis Incomplete, Data Unavailable mockup states | Component | `app/portfolio/__tests__/PortfolioPage.test.tsx` (extended) | Execution sequence mockup map, §11 |
| Shadow-mode parity harness produces a diff log with zero unexplained discrepancies | Integration (manual/monitored, not CI-blocking) | New shadow-comparison utility, `lib/portfolio-snapshot/__tests__/shadowParity.test.ts` for the harness logic itself | Gate A exit criterion |
| `npx tsc --noEmit --incremental false` | Type check | CI | Ticket validation requirement |
| Full Vercel preview build | Build | Manual/CI per PR | Standing project convention (tsc insufficient for `page.tsx` changes) |
| `git diff --check` | Lint | CI | Ticket validation requirement |

---

## 16. Acceptance-criterion traceability

Direct mapping of every LCC-0001A acceptance criterion (ticket §"Acceptance criteria") to its
implementing mechanism in this spec:

| Acceptance criterion | Implementing mechanism |
|---|---|
| Equity visibility (250 MSFT shares → displayed with market value, basis status, timestamp, P/L) | §4 `EquityHolding` type, §5 normalization, §11 UI rendering |
| Short stock (visible, zero capacity) | §4 `direction: 'Short'` retained, §5 note 1, §8 capacity formula unchanged (invariant 2) |
| Incomplete basis (partial-lot never averaged as whole) | §5 — `costBasisComplete` logic ported verbatim |
| Portfolio/Screener parity (same snapshot → same numbers) | §6 single-fetch boundary, §8 shared capacity computation, §15 parity test |
| Data failure (positions load, orders don't → fail closed with reason) | §9 fail-closed table, §13 error handling |
| Idempotency (repeated snapshot processing, no duplicates) | §12 (no persistence — inherently idempotent, re-derives each time), §15 explicit test |

All six acceptance criteria are covered by an explicit, named mechanism — none are addressed only
implicitly.

---

## 17. File-by-file implementation plan

1. `lib/portfolio-snapshot/types.ts` — new (§4).
2. `lib/portfolio-snapshot/normalizeEquity.ts` — new, ports + extends `covered-call-capacity.ts`
   lines 89–135 (§5).
3. `lib/portfolio-snapshot/normalizeShortCallExposure.ts` — new, ports `covered-call-capacity.ts`
   lines 169–213 verbatim.
4. `lib/portfolio-snapshot/normalizeWorkingOrders.ts` — new, ports `covered-call-capacity.ts`
   lines 250–288 verbatim (§7).
5. `lib/portfolio-snapshot/capacity.ts` — new, ports `covered-call-capacity.ts` lines 320–419,
   refactored to take a `PortfolioSnapshot` (§8).
6. `lib/portfolio-snapshot/dataQuality.ts` — new, shared status/warning helpers (§9).
7. `lib/portfolio-snapshot/acquire.ts` — new, the single acquisition boundary (§6, §10.1).
8. `lib/portfolio-data/acquisition.ts` — refactor: remove the hard option-only filter at line
   952–953; retain existing option-grouping logic for the (now non-discarding) filtered subset (§3).
9. `components/portfolio-data/PortfolioDataProvider.tsx` — refactor: wire `acquireSnapshot()`,
   extend context shape (§10.3).
10. `app/portfolio/page.tsx` — refactor (additive): new equity-row rendering, flagged independently
    (§11).
11. `lib/scans/tastytrade-client.ts` — no change in this ticket; `getCoveredCallCapacityReport()`
    remains in place, unwired, until PR 5 of the rollout sequence (§14) — that rewiring happens at
    `app/screener/page.tsx`'s call site, not by deleting this function.
12. `app/screener/page.tsx` — refactor (PR 5 only, §14): call-site change at line ~7739 from
    `getCoveredCallCapacityReport(token)` to the shared snapshot.
13. `lib/scans/covered-call-capacity.ts` — refactor: `buildCoveredCallCapacityReport()`'s public
    signature preserved as a thin wrapper delegating to the new `lib/portfolio-snapshot/capacity.ts`,
    so any test or caller not touched by this ticket continues to compile and pass unchanged during
    the transition window.
14. Test files per §15, one per new module plus the extended existing suites named there.

**Not touched:** `app/api/positions/route.ts` (§2.3, flagged for separate review, not deleted here);
`lib/portfolio/positionMetrics.ts`, `lib/portfolio/closeOrderSafety.ts`,
`lib/portfolio-intelligence/*` (all unmodified per AD-1 and the equity-portfolio-exposure non-goal,
§14 exclusions below).

---

## 18. Explicit exclusions — belongs to tickets B–E

Restated explicitly per this ticket's own "Non-goals" section and the master architecture's ticket
boundaries, so implementation does not silently creep into later tickets' scope:

- **Durable coverage allocations** (persisted short-call ↔ foundation relationships, `active`/
  `proposed`/`released` status, audit history) — LCC-0001B.
- **Derived strategy grouping** (Stock Only / LEAPS Only / Stock Covered Call / PMCC / etc.) and the
  "Mixed AAPL Position" mockup state (shares + option grouped as one strategy) — LCC-0001B.
- **Allocated/reserved/available/remainder share breakdown in the Portfolio UI** — LCC-0001A shows
  the conservative capacity number only; the allocation-aware breakdown is LCC-0001B.
- **New trade-entry workflows** (LEAPS-only, PMCC, buy-write, execution evidence) — LCC-0001C.
- **Lifecycle state machine, rolls, assignment, foundation replacement, reconciliation queue,
  migration of existing PMCC records** — LCC-0001D.
- **Find LEAPS launcher, scanner reframing, PMCC risk-check integration into Screener** — LCC-0001E.
- **Equity contribution to portfolio-wide health/objective/exposure scoring**
  (`lib/portfolio-intelligence/*`) — explicitly named as a required-but-deferred distinction in the
  ticket text ("Define equity contribution to portfolio exposure separately from option-only
  Greeks") and not implemented in this ticket; `PortfolioFinancialContext` and related scoring
  remain option-only until a later ticket explicitly extends them.
- **Tax-lot optimization** — non-goal at the epic level, not reintroduced here.
- **PMCC scoring changes** — out of scope for this ticket and for the epic generally, per the
  resolved product decision in the master architecture (§15.0); not applicable to LCC-0001A's scope
  in the first place but restated for completeness since `covered-call-capacity.ts` and `pmccScore.ts`
  live in the same directory and should not be conflated.

---

## 19. Self-review against source material

- **Epic:** every cross-ticket invariant touched by this ticket (2, 6, 10, 11, 15) is satisfied —
  short-stock exclusion (§8), fail-closed on unresolved coverage (§9), idempotent acquisition (§12),
  Portfolio/Screener shared-snapshot parity (§6, §8), and no silent transaction rewriting (n/a — this
  ticket introduces no transaction-writing capability at all).
- **LCC-0001A ticket:** every scope item (shared snapshot, equity holding model, Portfolio
  presentation, existing-behavior preservation, source-of-truth rules, fail-closed behavior,
  non-goals, all six acceptance criteria, implementation notes, validation, rollout) is addressed with
  an explicit mechanism, file, or test — see §16 traceability table.
- **Execution sequence:** Gate A's five criteria are each mapped to a concrete deliverable in §14's
  rollout sequence; no gate criterion is left unaddressed.
- **Corrected master architecture:** §4.2, §5.1, §6, §12 (the sections this ticket is scoped to
  implement) are followed without deviation; AD-1 (wrap, don't replace) and AD-5 (port
  `covered-call-capacity.ts`'s fail-closed pattern as reference implementation) are both directly
  implemented, not just referenced.
- **Architecture review:** the review's Finding B (adjusted-multiplier reference) is incorporated at
  §4's `deliverable` field design note; the review's testing-matrix correction (reuse existing
  `covered-call-capacity.test.ts` fixtures) is directly incorporated at §15.
- **Mockups:** §11 correctly scopes which mockup states belong to this ticket ("Stock-Only Holding,"
  "Basis Incomplete," "Data Unavailable") versus LCC-0001B ("Mixed AAPL Position"), per the execution
  sequence's own mockup map — this spec does not over- or under-claim mockup coverage.
- **`PMCC_SPECIFICATION.md`:** not applicable to this ticket's scope; not touched, consistent with the
  resolved product decision.
- **Current code:** every file reference in §2 was verified against the repository at this session's
  synced commit, including one previously-unreported finding (§2.3, `app/api/positions/route.ts`) not
  present in the master architecture document — flagged as an open item (§13) rather than silently
  folded into the refactor scope, since its caller status is unconfirmed.

No contradiction with the epic, the ticket, the corrected architecture, the architecture review, the
execution sequence, the mockups, or `PMCC_SPECIFICATION.md` was found. This spec introduces no new
product decision and reopens none of the three resolved in the master architecture's §15.0.
