# LCC-0001 — Execution Sequence and Review Gates

## Recommended sequence

```text
LCC-0001A  Unified Portfolio Snapshot + Equity Holdings
    ↓
LCC-0001B  Coverage Allocations + Strategy Composition
    ↓
LCC-0001C  Position Entry + Management Workflows
    ↓
LCC-0001D  Lifecycle + Reconciliation + Migration
    ↓
LCC-0001E  Scanner Reframing and Production Cutover
```

LCC-0001E design and isolated LEAPS-ranking work may begin after LCC-0001A, but production integration must consume the canonical models delivered by A through D.

## Why this order

1. Portfolio must know actual holdings before any strategy relationship is trusted.
2. Relationships and capacity must exist before the UI can safely offer entry actions.
3. Entry workflows must produce canonical positions before lifecycle handling can reconcile them.
4. Migration and broker reconciliation must be stable before scanners create more records in the new model.
5. Scanners come last so they consume the shared portfolio model rather than creating a third interpretation of ownership.

## Gate A — Portfolio foundation accepted

Required before LCC-0001B:

- Equity and option holdings normalize from the same account snapshot.
- Actual stock positions render in Portfolio.
- Basis completeness and data-quality states work.
- Current option behavior remains green.
- Covered Call capacity parity shadow checks pass.

## Gate B — Relationship model accepted

Required before LCC-0001C:

- Allocation invariants pass.
- Stock-covered and long-call-diagonal strategies derive correctly.
- Fully allocated actions are safe.
- Symbol-level P/L has no double counting.
- Ambiguous linkage enters reconciliation.

## Gate C — Entry workflows accepted

Required before LCC-0001D:

- Discovery, planning, execution evidence, and tracking remain distinct.
- LEAPS-only, PMCC, Covered Call, Buy-Write, and existing-position flows pass.
- Partial and unequal fills produce truthful position states.
- Alan's golden calculations pass.

## Gate D — Lifecycle and migration accepted

Required before LCC-0001E production cutover:

- Roll, expiration, assignment, replacement, and correction transitions pass.
- Migration dry run preserves history and P/L.
- Reconciliation is idempotent.
- Rollback and diagnostics are ready.

## Gate E — Scanner cutover accepted

Required for epic completion:

- Find LEAPS, Find Covered Calls, Find PMCCs, and Calls Against My Positions use shared services.
- Covered Call capacity matches Portfolio.
- Existing PMCC ranking parity is demonstrated or approved changes are documented.
- Quote and assumption transparency is present.
- Feature flags and monitoring support safe rollout.

## Parallel work

Safe parallel activities:

- Diane final production copy and accessibility annotations while Dane specifies LCC-0001A/B.
- Quinn builds golden fixtures and acceptance matrices while domain work proceeds.
- Alan approves calculation fixtures before LCC-0001C is merged.
- LEAPS scoring research may proceed without wiring results into production state.

Unsafe parallel activities:

- Building strategy grouping before allocation invariants are final.
- Rewriting scanners against another holdings fetch.
- Migrating PMCC records before canonical identities and idempotency rules exist.
- Adding broker-bound actions before partial-fill and safety behavior is defined.

## Mockup map

| Ticket | Relevant Diane mockup states |
|---|---|
| LCC-0001A | Mixed AAPL Position, Stock-Only Holding, Basis Incomplete, Data Unavailable |
| LCC-0001B | Mixed AAPL Position, Stock Holding Detail, Working Reservation, Blocked Close |
| LCC-0001C | Screener Result, LEAPS Result, PMCC Plan, Existing Coverage, Portfolio, Stock Covered Call |
| LCC-0001D | Roll, Assignment, Partial Execution, Import Reconciliation, Replace Foundation |
| LCC-0001E | Screener Result, LEAPS Result, PMCC Plan, Coverage Choice |

Mockups:

- [Integrated lifecycle flow](./mockups/tradeedge-integrated-leaps-flow.html)
- [Equity-aware Portfolio revision](./mockups/tradeedge-equity-portfolio-revision.html)

## Definition of ready for each ticket

- Upstream dependencies are merged or exposed through stable contracts.
- Acceptance criteria are converted to executable tests or named fixtures.
- Required mockup state is reviewed against the current TradeEdge shell.
- Migration/data implications are documented.
- Feature-flag and rollback behavior are specified.

## Definition of done for each ticket

- Acceptance criteria pass.
- Required unit, integration, and regression suites pass.
- `npx tsc --noEmit --incremental false` passes.
- Full test suite and `git diff --check` pass.
- Implementation report documents deviations and validation gaps.
- User-facing diagnostics exist for unavailable or unresolved states.
