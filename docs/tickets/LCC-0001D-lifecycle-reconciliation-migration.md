# LCC-0001D — Lifecycle, Reconciliation, and Migration

**Status:** Ready after LCC-0001C
**Depends on:** LCC-0001A, LCC-0001B, LCC-0001C
**Blocks:** LCC-0001E production completion

## Objective

Support the complete lifecycle of short-call cycles and foundations, reconcile broker events safely, and migrate existing PMCC history into the new model.

## Scope

### Formal lifecycle

Short-call transitions:

```text
Proposed → Pending → Open
Pending → Cancelled | Rejected | Partially Filled
Open → Closing Pending → Closed
Open → Expired | Assigned | Reconciliation Required
```

A roll consists of:

```text
Old call: Open → Closed (closing reason: Rolled)
Roll event: Created
New call: Pending → Open
```

Never overwrite the prior contract.

### Roll workflow

- Preserve the realized result of the old cycle.
- Open a new liability for the replacement cycle.
- Display closing cost, opening credit, net roll credit/debit, and both independent outcomes.
- Support partial quantities and multiple fills.

### Expiration

- OTM expiration realizes the short-call result and releases coverage.
- ITM or near-ITM expiration creates the appropriate attention and reconciliation state.
- Handle exchange/user timezone, exercise-by-exception evidence, after-hours risk, and broker cutoffs where data exists.

### Assignment

Stock covered call:

- Remove confirmed called-away share quantity.
- Retain remaining shares.
- Recalculate capacity.
- Calculate realized result only when assigned-lot basis is verified; otherwise mark it pending reconciliation.

PMCC:

- Do not assume the long call was exercised.
- Reconcile short shares, shares purchased to cover, long-call exercise, long-call sale plus separate cover, or broker correction.
- Warn that exercising a long call may forfeit extrinsic value without prescribing one universal action.

### Foundation replacement

- Close the original foundation and preserve realized P/L.
- Open the replacement foundation.
- Validate every active short call against it.
- Ask whether the user intends strategy-history continuity.
- Retain both foundations in history.

### Reconciliation

Detect and queue:

- Missing opening or closing events.
- Duplicate executions.
- Corrected or reversed executions.
- Assignment and exercise.
- Stock created or removed through assignment.
- Snapshot/history disagreement.
- Adjusted contracts.
- Ambiguous coverage.
- Manual records later matched to broker data.

### Corrections

Distinguish economic activity from data correction. A correction creates an audit event and must not fabricate cash flow or P/L.

### Existing-data migration

Convert existing PMCC records into:

- Independent long-call foundations.
- Independent short-call cycles.
- Coverage relationships.
- Derived strategy grouping.
- Original transaction/execution identity where available.

Migration must be idempotent, report ambiguity, support rollback until acceptance, and prevent duplicates after broker sync.

## Non-goals

- Tax advice.
- Automatic exercise or roll decisions.
- Destructive rewriting of broker history.

## Acceptance criteria

### Roll

**Given** an open short call,
**when** it is rolled,
**then** the old call closes with realized P/L, the new call opens independently, and the roll event links them without replacing history.

### Stock assignment

**Given** 200 shares and one assigned covered call,
**when** broker activity confirms 100 shares called away,
**then** 100 shares remain, the cycle completes, and capacity recalculates to one standard unit.

### PMCC assignment

**Given** a PMCC short call is assigned,
**when** no long-call exercise event exists,
**then** TradeEdge retains the long call and creates an unresolved short-share state.

### Foundation replacement

**Given** an active PMCC and a proposed replacement long call,
**when** replacement executes,
**then** both foundations remain in history and the active short-call relationship is revalidated.

### Migration rerun

**Given** the same migration is run twice,
**then** no duplicate position, transaction, cycle, or relationship is created.

### Broker correction

**Given** a broker reverses an assignment,
**when** synchronization runs,
**then** TradeEdge records a reversal event and reconciles state without deleting history.

## Validation

- State-transition tests, including prohibited transitions.
- Quinn's full stock-covered-call and PMCC lifecycle matrix.
- Migration tests for simple, rolled, partial, closed, and ambiguous records.
- Reconciliation idempotency tests.
- Production-like dry-run with before/after P/L comparison.

## Rollout

- Run migration in report-only mode first.
- Require explicit acceptance of ambiguity reports.
- Keep rollback available until post-migration broker sync passes.
- Add operational dashboards for unresolved assignments and reconciliation failures.
