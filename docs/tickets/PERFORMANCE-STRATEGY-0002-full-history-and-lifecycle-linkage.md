# PERFORMANCE-STRATEGY-0002 — Full history and broker-confirmed strategy lifecycles

## Status

**Draft for approval. Do not implement until approved.**

## Problem

The initial Strategy Performance Report accurately shows only the selected Trade Log lookback window and only fully reconstructed, closed option records. It does not yet provide an all-history view or prove whether a short call was a covered call, an income cycle against a specific LEAPS, or an unrelated short call. Consequently, Covered calls, PMCC, and Standalone LEAPS may show no history even when the trader has relevant open positions or older transactions.

## User value

The trader can compare actual historical performance across CSP, CC, PMCC, standalone LEAPS, BPS, BCS, and IC, with the report plainly separating:

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

### 2. Broker-confirmed lifecycle records and limited historical attestation

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

#### Historical classification for known legacy cycles

- Add a narrow, audited **Trader-confirmed historical classification** path for a closed short-call lifecycle when the trader knows its strategy but the older broker history cannot prove collateral linkage.
- The confirmation must record the selected account, transaction IDs, strategy selected, trader identity, timestamp, and a required short note. It must be reversible and visible in the lifecycle detail.
- A trader-confirmed row is visibly labeled `Trader-confirmed`, never `Broker-confirmed`, in the report and AI context.
- The first supported use case is the trader’s pre-PMCC **NVDA covered-call history**. It may be reported as Covered Calls once confirmed; it must never be backfilled as PMCC.
- The confirmation path must not permit a trader to label a short call as PMCC without a specific linked long-LEAPS OCC contract and coverage evidence.

### 3. Strategy Performance Report expansion

- Add an `All history` range control.
- Populate CC from broker-confirmed lifecycle records or visibly labeled trader-confirmed historical classifications. Populate PMCC only from broker-confirmed linked lifecycle records.
- Add a separate **Open standalone LEAPS** panel for live long calls. It shows current broker position facts, source timestamp, and no realized-performance metrics. The initial expected records are NFLX and UBER.
- PMCC displays `No PMCC cycles yet` when no broker-confirmed short call is linked to a held LEAPS. The existence of a long LEAPS alone must not create PMCC performance.
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

- Unlabeled or unaudited manual classification.
- Guessing a PMCC or covered-call relationship from common ticker/date patterns.
- Backtesting, allocation advice, strategy recommendations, or trade execution.
- Treating unrealized P/L as realized performance.

## Acceptance criteria

1. `All history` shows the complete broker-available transaction range or visibly identifies the exact source boundary.
2. Existing quick ranges continue to return the same scoped results as today.
3. A short call is shown as CC only with stored, auditable broker evidence or a visibly labeled trader-confirmed historical classification. A short call is shown as PMCC only with broker-confirmed linkage to its long LEAPS.
4. The confirmed pre-PMCC NVDA historical cycles can appear as `Trader-confirmed Covered Calls`; they cannot appear as PMCC.
5. Open NFLX and UBER LEAPS appear in a separate timestamped open-position panel and do not contribute to realized performance.
6. Standalone LEAPS and PMCC lifecycle P/L are separately visible; PMCC does not double-count its long leg and income cycles.
7. With no linked short-call cycle, PMCC visibly reports `No PMCC cycles yet` rather than a zero-performance conclusion.
8. Account switching cannot reuse another account’s history or lifecycle linkage.
9. Incomplete, partial, and unresolved histories are excluded from comparison metrics and disclosed.
10. Automated tests cover paging, account isolation, attestation audit/reversal, no heuristic PMCC classification, PMCC no-double-counting, partial lifecycle treatment, and stale-cache invalidation.
11. The AI entry point remains disabled until the dedicated performance snapshot passes governance, route, and evaluation tests.

## Implementation sequence

1. Audit Tastytrade transaction pagination, earliest available history, and account identifiers using read-only broker requests.
2. Add full-history retrieval with source-boundary and cache-version behavior; test it independently.
3. Add the lifecycle persistence schema and reconciliation job; backfill only relationships proven by existing broker evidence.
4. Add the audited trader-confirmed historical-classification flow, beginning with the identified NVDA covered-call cycles.
5. Add the open standalone-LEAPS panel and reconcile NFLX and UBER with live broker positions.
6. Expand the report using lifecycle records, while preserving the current conservative report as the fallback.
7. Add the governed performance-summary AI snapshot and UI only after the deterministic report is validated.

## Validation and rollout

- Validate on a non-production account/history fixture first, then one selected live account using read-only data.
- Reconcile lifecycle totals against the underlying broker transactions before enabling each new strategy row.
- Release behind a feature flag with a visible data-completeness banner.
- Preserve the existing report if the new full-history or lifecycle source is unavailable.

## Decisions needed for approval

1. Should `All history` mean all broker-available history, even if it makes the initial load slower, with paging/progress shown?
2. Do you approve the narrow, auditable `Trader-confirmed` classification path for known historical covered calls, beginning with NVDA, while keeping PMCC broker-confirmed only?
3. Do you approve the phased release order: full-history integrity, lifecycle linkage and NVDA attestation, open LEAPS panel, expanded report, then AI?
