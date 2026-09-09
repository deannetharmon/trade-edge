# ENTRY-0001A — Credit-Spread Entry Snapshot Foundation

**Audience:** Dane (implementation owner)  
**Product:** Paul / Ian  
**Safety and testability:** Quinn  
**Status:** Implemented; awaiting live filled-OTO verification  
**Blocks:** ENTRY-0001 entry surface and ENTRY-0002 performance analysis

## Objective

Create the durable, immutable, execution-linked record required to learn from credit-spread entries. This is a narrow data-contract and persistence increment—not a new scorer, an alert UI, or Performance feature.

## Facilitated team decision

Use TradeEdge's existing server-side Redis/KV persistence pattern for snapshots. Browser localStorage and IndexedDB may cache a rendered snapshot but are not authoritative. If server persistence is not configured in an environment, capture must fail visibly and the feature must not claim the snapshot was saved.

The initial schema reserves every ENTRY-0001 field. It records available values now and uses an explicit `UNAVAILABLE` evidence state for inputs that have no approved source; it never delays the foundation while waiting for a future historical-data provider.

## Scope

1. Add a versioned, serializable `CreditSpreadEntrySnapshot` contract with:
   - stable `entrySnapshotId`;
   - account identity, execution/transaction identity, strategy and contract identity;
   - capture/as-of timestamps and source metadata;
   - field-level `AVAILABLE` / `UNAVAILABLE` / `STALE` evidence state and reason;
   - raw entry values plus derived values; and
   - immutable schema and policy versions.
2. Persist snapshots server-side with an account-scoped execution key and idempotent write behavior. Repeated capture for the same verified execution must return the original record, not overwrite it.
3. Preserve all broker transaction IDs needed to join a snapshot to `ClosedTrade.sourceTransactionIds`. Define and test partial and multi-fill behavior: one snapshot per actual opening execution, with a stable trade/group link where evidence supports one.
4. Populate only approved live evidence from the existing Tastytrade paths: underlying quote, option-chain bid/ask/mid/leg IV/delta, market-metrics IVR/underlying IV/earnings date, actual execution evidence, and formula inputs/output for expected move when available.
5. Include schema fields but store `UNAVAILABLE` for IV trend, realized volatility, and 5/20-day price action until an authoritative historical-series provider, lookback, and freshness contract are separately accepted.
6. Provide read APIs/helpers required by ENTRY-0001 and ENTRY-0002. No UI is required in this increment.

## Non-goals

- New alert thresholds or a candidate/order-review UI.
- Current-market-data refresh after capture.
- Historical snapshot backfill.
- New external market-data vendor integration.
- Changes to canonical Trade Log P/L or matching logic.

## Acceptance criteria

**Given** a confirmed opening credit-spread execution,  
**when** capture runs with server persistence configured,  
**then** TradeEdge saves one immutable, account-scoped snapshot per opening execution with raw inputs, evidence states, source/capture timestamps, and stable transaction links.

**Given** the same confirmed execution is submitted to capture again,  
**when** the write completes,  
**then** it returns the original snapshot unchanged.

**Given** a required historical-series input has no accepted provider,  
**when** the snapshot is read,  
**then** it contains an explicit unavailable state/reason, never a zero, inferred current value, or fabricated historic value.

**Given** an opening fill later contributes to a reconstructed closed trade,  
**when** ENTRY-0002 reads it,  
**then** the snapshot can be joined through preserved broker transaction identity without reimplementing Trade Log reconstruction.

## Validation

- Pure schema, serialization, idempotency, and immutability tests.
- Redis/KV adapter tests, including absent configuration and write/read failure.
- Tests for account isolation, duplicate capture, partial/multi-fill, stale/unavailable evidence, and stable join identity.
- Regression tests proving existing `lib/tradeLog` outputs are unchanged.

## Exit gate

Quinn signs off once the storage, identity, migration, failure, and test contracts above are implemented. That closes the data-persistence hold for ENTRY-0001; it does not authorize historical-series alerts without their later source contract.
