# PERFORMANCE-STRATEGY-0002 — Full history and broker-confirmed strategy lifecycles

## Status

**Draft for approval. Do not implement until approved.**

## Problem

The initial Strategy Performance Report accurately shows only the selected Trade Log lookback window and only fully reconstructed, closed option records. It does not yet provide an all-history view or prove whether a short call was a covered call, an income cycle against a specific LEAPS, or an unrelated short call. Consequently, Covered calls, PMCC, and Standalone LEAPS may show no history even when the trader has relevant open positions or older transactions.

## User value

The trader can compare actual, broker-confirmed historical performance across CSP, CC, PMCC, standalone LEAPS, BPS, BCS, and IC, with the report plainly separating:

- closed realized outcomes from current open-position information;
- complete lifecycle evidence from partial or missing history;
- a standalone LEAPS lifecycle from an income-producing PMCC lifecycle.

## Scope

### 1. Full-history Trade Log retrieval

- Add an `All history` range to Trade Log and Performance.
- Retrieve transactions in broker-supported pages until the account’s available history is exhausted or an explicit documented broker boundary is reached.
- Preserve existing 1-week through 12-month quick ranges.
- Display the actual fetched history boundary and a clear notice if the broker, connection, or transaction API prevents a complete history.
- Do not silently treat a truncated fetch as all history.

### 2. Broker-confirmed lifecycle records

Create a durable, account-scoped lifecycle record using broker transaction identities and verified holdings:

| Lifecycle | Required proof | Report treatment |
| --- | --- | --- |
| Covered call | Verified share lot covers the short-call quantity at entry | One covered-call lifecycle; show related call cycles |
| Standalone LEAPS | Long call opening and closing transactions for one OCC contract | One standalone LEAPS lifecycle |
| PMCC | Specific long LEAPS OCC contract plus short call(s) whose quantity is covered by that long call | One PMCC lifecycle with separate long-leg and income-cycle totals |

- Store canonical broker account ID, OCC symbol(s), broker transaction IDs, quantities, dates, and linkage state.
- Linkage is explicit and auditable; same ticker, date, strike, or expiration proximity is never enough evidence.
- Keep unresolved short calls in `Needs classification`; provide a reason, not a guessed classification.
- Support lifecycle states: active, closed, partial, incomplete, and unlinked.

### 3. Strategy Performance Report expansion

- Add an `All history` range control.
- Populate CC, PMCC, and Standalone LEAPS only from confirmed lifecycle records.
- For PMCC, show one parent lifecycle with optional component detail:
  - long LEAPS realized P/L;
  - short-call income realized P/L;
  - combined realized P/L;
  - lifecycle dates and whether all expected history is covered.
- Keep open P/L outside realized strategy metrics. A separate Current open exposure panel may show current holdings, clearly labeled as live/open and timestamped.
- Maintain the existing incomplete-record exclusion and disclosure.
- Continue to show `Insufficient history` for fewer than five completed lifecycles; never use blanks or zeroes to imply performance.

### 4. Account and freshness integrity

- All history and lifecycle records are scoped to the actively selected broker account.
- Refresh must invalidate stale cached history when account selection changes.
- Show source freshness and the latest successful broker history sync time.
- Never use account cash or buying power to reconstruct past return-on-capital unless historical broker evidence is available for that lifecycle.

### 5. AI performance questions — after snapshot support is approved

- Define a dedicated `performance_summary` frozen snapshot carrying only the visible account-scoped report facts, filters, completeness state, metric definitions, and source timestamps.
- Use the governed AI gateway to explain visible report data only.
- The AI may explain a metric, a lifecycle’s missing evidence, or a visible comparison. It must not name a “best” strategy, recommend a trade, infer missing linkage, or mix realized and open P/L.
- AI is unavailable, with a useful explanation, whenever data is stale, incomplete beyond the report threshold, or the snapshot cannot be frozen.

## Non-goals

- Manual classification that overrides broker evidence.
- Guessing a PMCC or covered-call relationship from common ticker/date patterns.
- Backtesting, allocation advice, strategy recommendations, or trade execution.
- Treating unrealized P/L as realized performance.

## Acceptance criteria

1. `All history` shows the complete broker-available transaction range or visibly identifies the exact source boundary.
2. Existing quick ranges continue to return the same scoped results as today.
3. A short call is shown as CC or PMCC only with a stored, auditable broker-confirmed linkage.
4. Standalone LEAPS and PMCC lifecycle P/L are separately visible; PMCC does not double-count its long leg and income cycles.
5. Open positions are visibly separate from realized strategy-performance metrics.
6. Account switching cannot reuse another account’s history or lifecycle linkage.
7. Incomplete, partial, and unresolved histories are excluded from comparison metrics and disclosed.
8. Automated tests cover paging, account isolation, no heuristic classification, PMCC no-double-counting, partial lifecycle treatment, and stale-cache invalidation.
9. The AI entry point remains disabled until the dedicated performance snapshot passes governance, route, and evaluation tests.

## Implementation sequence

1. Audit Tastytrade transaction pagination, earliest available history, and account identifiers using read-only broker requests.
2. Add full-history retrieval with source-boundary and cache-version behavior; test it independently.
3. Add the lifecycle persistence schema and reconciliation job; backfill only relationships proven by existing broker evidence.
4. Expand the report using lifecycle records, while preserving the current conservative report as the fallback.
5. Add the governed performance-summary AI snapshot and UI only after the deterministic report is validated.

## Validation and rollout

- Validate on a non-production account/history fixture first, then one selected live account using read-only data.
- Reconcile lifecycle totals against the underlying broker transactions before enabling each new strategy row.
- Release behind a feature flag with a visible data-completeness banner.
- Preserve the existing report if the new full-history or lifecycle source is unavailable.

## Decisions needed for approval

1. Should `All history` mean all broker-available history, even if it makes the initial load slower, with paging/progress shown?
2. Should unresolved historical short calls remain permanently unclassified unless broker evidence proves coverage, rather than allowing user labeling?
3. Do you approve the phased release order: full-history integrity, lifecycle linkage, expanded report, then AI?
