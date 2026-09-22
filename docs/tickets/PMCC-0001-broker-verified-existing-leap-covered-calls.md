# PMCC-0001 — Broker-Verified Covered Calls Against Existing LEAPS

## Owner

Dane

## Status

In progress — foundation/discovery safety slice

## Required reviewers and gate

Ian, Paul, Diane, and Quinn must each review the problem framing, target architecture, rules/defaults, safety boundary, and acceptance criteria. No production-code implementation begins until their feedback is incorporated and the ticket is explicitly approved.

## Consolidated implementation contract

The following contract incorporates all four conditional approvals and is binding for every delivery slice.

1. **Broker snapshot:** discovery and ordering use a versioned snapshot with account ID, successful position/order scopes, `asOf`, freshness policy, completeness/pagination status, and snapshot ID. Stale, partial, unavailable, ambiguous, or mismatched snapshots block ordering.
2. **Foundation identity:** capacity is attributed to one exact verified long option (OCC symbol plus deliverable/multiplier). A candidate must share the underlying/deliverable, have a later long expiration, a lower long strike, and enough unreserved contracts.
3. **Capacity and submission:** open and working short calls reserve their specific foundation. Submission uses an idempotency key, rechecks the snapshot/capacity/quote, persists broker order ID only after acknowledgement, and transitions through `WORKING`, `PARTIALLY_FILLED`, `FILLED`, `REJECTED`, and `CANCELLED` only from broker evidence.
4. **Discovery truth:** every configured expiration is acquired with bounded batching. The result declares `COMPLETE`, `INCOMPLETE`, or `BLOCKED`; incomplete acquisition never asserts that all calls are available. Every candidate/rejection has reason codes and market-data timestamp/source.
5. **Rules and UX:** immutable safety gates are separate from editable, versioned strategy presets. Results show the backing LEAP, capacity calculation, active rules, counts, ranking, and near-miss/rejection explanations.
6. **Audit and rollout:** preserve an exportable decision trace; ship behind a feature flag with shadow comparison, telemetry, rollback criteria, and idempotent retry/reconciliation tests.

## Implementation progress

**Completed in the foundation/discovery safety slice:**

- Broker snapshot acquisition for account positions and live orders, including account ID, `asOf`, freshness expiry, snapshot ID, and completeness booleans.
- Exact OCC-symbol long-call foundation normalization with conservative capacity. Same-underlying multi-LEAP exposure is blocked when existing/working short calls cannot be attributed safely.
- Long Book requires a fresh matching broker foundation before call selection and rechecks it immediately before submit. Missing broker order ID no longer creates a local order record.
- Submitted order state is `WORKING`, not `OPEN`.
- Long Book scans every expiration in its configured 21–60 DTE window rather than only the first three, surfaces complete/incomplete quote-acquisition state, and blocks ordering when acquisition is incomplete.

**Remaining before release:** configurable/versioned rules and ranking; full per-candidate reason ledger; actual broker lifecycle reconciliation; exact adjusted-deliverable support; idempotent submit keys; feature flag, shadow telemetry, and the corresponding integration coverage.

## Review log

### Ian — Conditional approval

Ian supports replacing the unsafe local picker and agrees with the delivery order: broker truth, complete discovery, then lifecycle/UI. Before implementation, the ticket must explicitly require:

- Capacity allocation to a specific verified long-call foundation, not only an aggregate underlying symbol. The long call must have sufficient contracts, matching underlying and deliverable/multiplier, a lower strike, and a later expiration than the proposed short call. Existing and working short calls consume that same foundation capacity conservatively.
- A broker snapshot contract: successful, identifiable positions-and-orders refresh; missing, stale, partial, ambiguous, or mismatched data blocks ordering. A submitted order must return a broker order ID before it persists as `working`; only broker fill/position evidence promotes it to `open`.
- Tests for mixed LEAPS on one underlying, a short expiration after the long expiration, nonstandard/adjusted deliverables, duplicate submission, and broker reject/cancel/partial-fill transitions.

### Paul — Conditional approval

Paul approves the broker-first, full-discovery direction subject to these additions:

- Deterministic capacity reservation against the selected long OCC contract. The UI must identify the covering LEAP and never silently pool capacity across LEAPS on the same ticker.
- Editable, versioned strategy presets for DTE, delta, OI, quote width/freshness, and strike rules; active values must be visible beside results.
- An explicit ranking model and user sorting, while retaining the complete qualified universe and its counts.
- Acquisition state separate from qualification: incomplete market data may be visible but cannot support an “all available” conclusion or submission. Submission requires fresh selected-contract quote and capacity checks.
- Order review must show the exact contracts, quantity, limit, linked foundation, and available buying-power/margin impact when available; duplicate working submission must be blocked.
- Partial fills consume only filled capacity; working remainder stays reserved and releases on cancellation/rejection.

### Diane — Conditional approval

Diane approves subject to a clear trader-facing state and audit model:

- Standard states: discovery `COMPLETE`/`INCOMPLETE`/`BLOCKED`; foundation `VERIFIED`/`STALE`/`MISMATCHED`; capacity `AVAILABLE`/`EXHAUSTED`/`UNATTRIBUTABLE`; order `DRAFT`/`SUBMITTING`/`WORKING`/`PARTIALLY_FILLED`/`FILLED`/`REJECTED`/`CANCELLED`.
- An auditable decision ledger including timestamps, broker account/position/order IDs, long foundation identity, deliverable/multiplier, ruleset version/values, quote timestamp, and acquisition failures.
- Per-LEAP capacity display, hard safety gates visibly separate from adjustable preferences, explainable near-misses/rejections, and refreshed confirmation if source state changes.
- Usable empty/error/partial/retry states and an exportable/copyable decision trace for support.

### Quinn — Conditional approval

Quinn approves direction but requires implementation contracts and rollout controls:

- A versioned, complete broker snapshot contract: account ID, positions/order scopes, as-of/freshness maximum, pagination completeness, stable snapshot ID, and fail-closed unavailable/partial/stale behavior.
- Deterministic per-foundation attribution using full option identity plus deliverable/multiplier, with an explicit ambiguous/malformed exposure policy.
- Idempotent submit contract, capacity-check/request sequencing and time-of-check/time-of-use policy, acknowledgement/order-ID persistence, and idempotent lifecycle reconciliation.
- Per-contract market-data source/timestamp and an explicit policy for which acquisition failures block which submissions.
- API/UI contracts for counts, reason codes, and candidate snapshot version.
- Feature-flagged rollout, shadow comparison, audit telemetry, rollback criteria, and tests for pagination, stale/partial snapshots, concurrent submission, retry after timeout, multiple LEAPs, multipliers, and reconciliation.

## Problem

Long Book’s `+ Call` workflow is a browser-local option picker rather than a broker-verified PMCC discovery workflow. It limits discovery to the first three expirations, silently ignores quote-batch failures, and can record a submitted short-call order as open before a fill is confirmed. It does not calculate available coverage against actual long-call positions and working short-call orders.

## Goal

Make the existing-LEAP PMCC workflow discover and rank the complete configured short-call universe against broker-verified open long calls, while preventing a new short-call order whenever capacity, quote freshness, or position/order state is unverified.

## Non-goals

- Replacing the new-position PMCC Screener pairing engine.
- Changing stock covered-call capacity behavior.
- Introducing automatic order placement or automated trade decisions.

## Delivery slices

### Slice 1 — Broker foundation and capacity truth

- Add a pure PMCC foundation normalizer for open long equity/index calls.
- Derive per-underlying short-call capacity from verified long contracts less open and working short calls; fail closed on unattributable exposure.
- Reconcile Long Book’s `+ Call` foundation with broker state before enabling a selectable contract or order review.
- Keep local Long Book data as display cache only; never as authorization to sell a new call.

### Slice 2 — Complete, auditable discovery

- Fetch every expiration in the submitted short DTE range, with bounded quote-batch requests.
- Use shared configurable short-leg filters: DTE, delta, OI, two-sided quote, maximum bid/ask width, quote freshness, and strike-versus-spot/long-strike requirements.
- Return qualified, near-miss, rejected, and acquisition-failure counts. A display limit may occur only after full discovery and must report omitted count.

### Slice 3 — Execution lifecycle and presentation

- Recheck capacity and quote quality immediately before submit.
- Record submitted orders as `working`, keyed by broker order id; reconcile them to `open` only after broker position/fill evidence.
- Explain blocked ordering and incomplete market-data state in the UI.

## Acceptance criteria

1. A local LEAP absent from the broker account cannot enable a short-call order.
2. Existing and working short calls reduce available capacity; no selection/order exceeds available capacity.
3. Every configured eligible expiration is queried. A fourth eligible expiration is discoverable.
4. A failed quote batch produces visible incomplete-acquisition state and counts; it cannot masquerade as a complete result set.
5. One-sided, crossed, stale, wide, or below-OI quotes do not qualify, and their reasons are auditable.
6. A short call at/below spot or the verified long strike does not qualify by default.
7. The UI displays total discovered, qualified, near-miss, rejected, and display-retained counts.
8. A submitted order is not marked `open` until confirmed by broker data.
9. Unit tests cover capacity, foundations, filter gates, quote-batch outcomes, and lifecycle transitions; integration tests cover broker-position/working-order fixtures.
10. Existing PMCC pairing and stock covered-call suites continue to pass.

## Implementation notes

- Reuse the conservative raw-position/order normalization conventions in `lib/scans/covered-call-capacity.ts`; do not duplicate its option-symbol parsing logic.
- Build a PMCC-specific capacity model rather than treating long calls as equity-share coverage.
- Preserve the Screener PMCC engine’s audit conventions (`qualified`, `near miss`, explicit retention accounting) where applicable.

## Review references

- `docs/reviews/PMCC-COVERED-CALL-REVIEW-2026-09-10.md`
- `docs/tickets/TE-0007C-covered-call-first-class-screener.md`
