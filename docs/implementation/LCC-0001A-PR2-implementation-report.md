# LCC-0001A PR 2 — Implementation Report

**Status:** Corrected after cross-functional review; ready for re-review
**Implementation commits:** `271c673`, `85eb367`, `08369be`, plus the current provenance correction at branch HEAD
**Branch:** `feature/lcc-0001a-unified-portfolio-snapshot`
**Specification:** `docs/design/LCC-0001A-technical-spec.md`, rollout PR 2
**Production flag:** `NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED=true`
**Default:** Off

## 1. Outcome

PR 2 establishes the unified, account-scoped portfolio snapshot acquisition and capacity layer
behind a disabled-by-default feature flag. It does not render equity rows, cut over Screener, add
persistence, or implement tickets LCC-0001B through E.

When enabled, one broker source supplies:

- the existing option `Position[]` adapter;
- normalized long and short equity holdings;
- normalized working orders;
- existing short-call exposure;
- working short-call reservations; and
- fail-closed capacity evidence.

The rejected draft performed a second positions fetch and left `snapshot.options` empty. That draft
was never pushed. The published implementation instead shares one `PortfolioBrokerSource` with the
mature `loadPositions()` path and every snapshot normalizer.

## 2. Files delivered

### Runtime

- `lib/portfolio-data/acquisition.ts`
  - Adds `PortfolioBrokerSource` and `acquirePortfolioBrokerSource()`.
  - Fetches marked positions, live orders, and paginated complex-order evidence once per acquisition and passes them into the mature adapter.
  - Allows `loadPositions(source)` to reuse that source while preserving `loadPositions()` as a
    compatibility wrapper.
- `lib/portfolio-snapshot/acquire.ts`
  - Adds the canonical `acquireSnapshot()` boundary and provider-oriented
    `acquirePortfolioSnapshot()` result.
  - Populates equities and existing option positions from the same raw positions response.
- `lib/portfolio-snapshot/normalizeShortCallExposure.ts`
  - Ports the existing conservative short-call exposure rules.
- `lib/portfolio-snapshot/normalizeWorkingOrders.ts`
  - Ports working call reservation rules and normalizes the narrow working-order shape.
- `lib/portfolio-snapshot/dataQuality.ts`
  - Centralizes account-, positions-, orders-, and attribution-failure semantics.
- `lib/portfolio-snapshot/capacity.ts`
  - Exposes `buildSnapshotCapacityReport(snapshot)` as the public capacity boundary.
- `lib/portfolio-snapshot/types.ts`
  - Adds normalized `coverageEvidence` to `PortfolioSnapshot`.
- `components/portfolio-data/PortfolioDataProvider.tsx`
  - Exposes snapshot and snapshot data quality behind the feature flag.
  - Preserves the existing flag-off path.

### Tests

- `lib/portfolio-data/__tests__/portfolioBrokerSource.test.ts`
- `lib/portfolio-snapshot/__tests__/acquire.test.ts`
- `lib/portfolio-snapshot/__tests__/capacity.test.ts`
- `lib/portfolio-snapshot/__tests__/dataQuality.test.ts`
- `lib/portfolio-snapshot/__tests__/normalizeShortCallExposure.test.ts`
- `lib/portfolio-snapshot/__tests__/normalizeWorkingOrders.test.ts`
- `components/portfolio-data/__tests__/PortfolioDataProvider.snapshot.test.tsx`
- `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx` (flag-off assertion added)

## 3. Final acquisition contract

`acquirePortfolioBrokerSource()` resolves the account and acquires canonical evidence from:

```text
/accounts/{accountNumber}/positions?include-marks=true
/accounts/{accountNumber}/orders/live
/accounts/{accountNumber}/complex-orders?page-offset={page}&per-page=50
```

The returned source contains the token, account number, marked raw positions, raw live orders, and
the complete paginated complex-order result. `loadPositions(source)` reuses all three; it does not
re-fetch any of them. Complex-order pagination can require multiple page requests, but each page is
observed only once per acquisition.

Live and complex evidence are consumed independently by the mature GTC adapter. If either request
fails, evidence from the successful request remains available for existing option-management
behavior, while snapshot coverage is explicitly incomplete and capacity fails closed.
`acquirePortfolioSnapshot()` passes that same object to `loadPositions(source)` and to the equity,
short-call, and working-order normalizers. Consequently:

- `PortfolioDataProvider.positions` and `snapshot.options` originate from the same response;
- `snapshot.equities` uses that response as well;
- normalized views share one snapshot `asOf` and source object; this does not claim that the broker
  payloads themselves carry an identical acquisition timestamp;
- the mature option grouping, pricing, identity, and safety behavior stays in `loadPositions()`.

With the flag off, the Provider continues to call the compatibility `loadPositions()` entry point.

## 4. Snapshot and capacity contract

`PortfolioSnapshot` now carries `coverageEvidence`:

```ts
interface SnapshotCoverageEvidence {
  existingShortCallsBySymbol: Record<string, number>;
  workingShortCallsBySymbol: Record<string, number>;
  unclassifiedSymbols: string[];
  complete: boolean;
  warnings: string[];
  hasAdjustedOrUnknownDeliverable: boolean;
}
```

This is normalized once during acquisition. `buildSnapshotCapacityReport(snapshot)` consumes this
evidence directly; it does not synthesize raw broker payloads or independently re-normalize option
positions and orders. If evidence is incomplete, the report returns `status: 'unavailable'` and no
per-symbol capacity.

This refinement closes a gap in the specification's summarized `PortfolioSnapshot` sketch: the
approved capacity API takes the snapshot, so the normalized evidence required to compute capacity
must travel with that snapshot.

## 5. Fail-closed behavior

| Condition | Holdings | Capacity |
|---|---|---|
| Account unresolved | Retain prior cached Provider state when available | Unavailable |
| Positions request fails | Retain prior cached Provider state when available | Unavailable |
| Live orders request fails | Current equities and options remain visible | Unavailable |
| Unattributable short option/order | Current holdings remain visible for inspection | Unavailable account-wide |
| Adjusted or unresolved option deliverable | Current holdings remain visible | Unavailable account-wide |
| Unclassified but attributable option | Current holdings remain visible | Conservatively reserved with diagnostic flag |

Orders failure is not represented as zero reservations. Missing evidence always blocks a trusted
capacity result.

`PortfolioSnapshot.asOf` is acquisition observation time. It is never copied into `quoteAsOf`.
Because the marked-position payload supplies no verified broker quote timestamp, holding and
snapshot `quoteAsOf` remain null and mark-derived economics have unknown freshness (`staleQuote:
true`). A positive prior close is only a stale reference fallback and carries an explicit warning.
A missing or incomplete multi-lot quote remains unavailable. Snapshot `staleQuotes` reflects these
holding-level states. PR 3 must not label unknown-freshness marks as live/current and must label any
displayed close fallback “Prior close” or “Reference price.”

## 6. Provider behavior

The enabled path uses `acquirePortfolioSnapshot()` instead of invoking `loadPositions()` and
snapshot acquisition independently. Existing history, trend, health, and recommendation enrichment
still runs once on the returned option positions. The enriched `Position[]` is then published both
as the existing context `positions` and as `snapshot.options`, preventing post-enrichment drift.

The existing generation checks remain authoritative. A superseded request cannot publish positions,
snapshot state, or data quality. When a later positions/account refresh fails, the Provider retains
the last successful holdings, sets `freshness: 'last-known'`, retains `lastSuccessfulAsOf`, and marks
snapshot quality unavailable. An orders-only failure leaves the newly acquired holdings marked
`current` while disabling coverage-dependent capacity.

## 7. Review findings resolved

Paul and Ian independently reviewed the interrupted draft and agreed on four blockers:

1. Orders failure allowed capacity to fail open.
2. Failed positions/account refreshes could erase cached holdings.
3. Capacity reconstructed synthetic broker payloads instead of consuming canonical evidence.
4. Feature-enabled acquisition and latest-wins behavior lacked tests.

Those four were resolved in `271c673`. A later Alan/Paul/Ian/Quinn/Diane review found duplicate
broker observations, adjusted-deliverable risk, missing cached-data provenance, and undefined quote
behavior. Commit `85eb367` resolved the first corrective round; commit `08369be` closed the
partial-order-evidence behavior. The current branch-HEAD correction restores the approved
`quoteAsOf` contract without changing the order/capacity work in `08369be`. PR 3 remains gated on
team re-review.

## 8. Verification

- Final snapshot, acquisition, broker-source, and Provider-focused regression run: **69/69 passing**.
- Mature stop/GTC reconstruction and safety regression run: **49/49 passing**.
- Combined snapshot and legacy covered-call-capacity run: **96 passing**, including the unchanged
  legacy capacity suite at **39/39 passing**.
- `loadPositions()` Greek and entry-economics regression suite: **3/3 passing**.
- TypeScript: exactly **41 existing errors**, all in
  `lib/portfolio/__tests__/trendClassification.test.ts`; no new error introduced.
- `git diff --check`: clean.

Known baseline issue: `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx` has three
pre-existing `toHaveBeenCalledWith` failures caused by an existing fourth argument to
`attachSnapshotHistory()`. They reproduce before PR 2 and are not caused by this implementation.

## 9. Rollback

The production feature remains off unless
`NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED` is the literal string `true`. Immediate operational rollback
requires changing/unsetting the variable and rebuilding/redeploying the client bundle. The existing Provider path remains
available and unchanged behind the off state.

If code rollback is required before later PRs depend on this contract, revert the current provenance
correction at branch HEAD first, then `08369be`, `85eb367`, and `271c673`, in that order. PR 1's
original commit (`3bab2b3`) may remain only if
its now-superseded pure-normalizer contract is still desired; otherwise revert it last.

## 10. Deferred work and PR 3 entry criteria

Deferred exactly as planned:

- PR 3: independently flagged equity-row rendering in Portfolio.
- PR 4: old/new capacity shadow-mode parity instrumentation.
- PR 5: Screener cutover to snapshot-derived capacity.
- Post-Gate-A cleanup: removal of the old private covered-call fetch path.
- LCC-0001B–E: allocations, workflows, lifecycle, and scanner reframing.

PR 3 may begin only after this corrected report is re-reviewed. It must consume the published snapshot contract, keep
its UI flag independent from the acquisition flag, and must not change capacity or acquisition
semantics established here. Mark-derived economics have unknown freshness without a verified broker
quote timestamp and must not be labeled live/current; missing values must display as unavailable.
The UI must distinguish `current` holdings from
`last-known` cached holdings and show `lastSuccessfulAsOf` for the latter. Short stock remains visible
and contributes no covered-call capacity. Redacted snapshot warning observability is assigned to the
PR 4 shadow-mode instrumentation work.
