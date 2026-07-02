# ADR-0003 — Ranked Scan Cancellation Semantics

## Status

Proposed

## Context

TE-0005A moves Ranked Scan execution into the app-level Task Manager and Command Bus infrastructure. Once scans run outside page-local state, cancellation semantics become important.

Cancellation must be safe, predictable, and compatible with future background execution patterns.

## Decision

Use cooperative cancellation for Ranked Scan.

The preferred implementation is:

- create an `AbortController` per running ranked-scan task
- pass `AbortSignal` into the Ranked Scan runner
- check `signal.aborted` between expensive scan steps
- when cancellation is requested, stop scheduling additional work
- mark the task as `cancelled`
- do not display partial results as completed results

If the current scan implementation cannot safely support `AbortSignal` without risky refactoring, TE-0005A may implement a cancellation boundary and document the limitation.

## Semantics

### Cancelled means

- the user/system requested the task stop
- the task should stop as soon as reasonably possible
- the result should not be treated as a successful scan
- the task status should be `cancelled`

### Cancelled does not mean

- failed
- completed with partial results
- hidden from task history
- silently discarded

## Guardrails

- Cancellation should not corrupt existing scan state.
- Cancellation should not leave loading indicators stuck.
- Cancellation should not create duplicate running tasks.
- Cancellation should not require server-side infrastructure in TE-0005A.
- Cancellation should remain compatible with future durable task execution.

## Consequences

### Positive

- Establishes clear semantics before scans become background workflows.
- Makes future Cancel Scan UX straightforward.
- Creates a pattern for Screener, Portfolio AI, and Autopilot paper-mode tasks.

### Trade-offs

- Cooperative cancellation may not stop immediately if a scan step is synchronous and expensive.
- Full cancellation may require future scan-runner refactoring.
- Partial results are intentionally not promoted to completed results in this phase.

## Follow-ups

- TE-0005B may expose task completion/cancellation notifications.
- TE-0006 should reuse the same cancellation semantics for Screener.
- A later durable task ADR should revisit cancellation if server-backed execution is introduced.
