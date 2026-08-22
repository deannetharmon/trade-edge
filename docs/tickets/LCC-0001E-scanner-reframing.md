# LCC-0001E — LEAPS, Covered Call, and PMCC Scanner Reframing

**Status:** Ready after the portfolio foundation
**Depends on:** LCC-0001A, LCC-0001B, LCC-0001C; production completion depends on LCC-0001D

## Objective

Reframe the existing discovery experience so users can find standalone long calls/LEAPS, stock covered calls, new PMCC combinations, and calls against existing positions using the shared portfolio and strategy model.

## Product decision

Keep the existing Screener/Hunter workspace and current TradeEdge shell. Do not create a separate discovery application.

Visible strategy launchers:

- Find LEAPS.
- Find Covered Calls.
- Find PMCCs.
- Calls Against My Positions.

`Find PMCCs` remains directly recognizable and accessible.

## Scope

### Find LEAPS

- Evaluate long calls independently.
- Rank using approved duration, delta, intrinsic/extrinsic, trend, liquidity, valuation, and exit-rule inputs.
- Support Review LEAPS Plan, Compare, Save, and optionally Add Short Call.
- Do not require a short call.

### Find Covered Calls

- Use only verified available share capacity from the shared snapshot.
- Allow Opportunity Universe to narrow holdings but never create eligibility.
- Display shares, allocations, working reservations, available capacity, cost-basis status, and assignment considerations.
- Refresh capacity before finalizing a plan.

### Find PMCCs

- Preserve current production ranking behavior until changes are separately validated.
- Present long and short legs independently.
- Support Review PMCC Plan and Review Long Call Only.
- Allow replacing either proposed leg or substituting an eligible existing long call.
- Transition through planning and execution evidence before Portfolio creation.

### Calls Against My Positions

- Begin from a verified stock or long-call foundation.
- Respect remaining capacity.
- Preselect only an unambiguous support source.
- Require confirmation where multiple eligible foundations exist.

### Scanner transparency

Display or make progressively available:

- Quote timestamp.
- Bid, ask, and assumed execution price.
- Slippage and fee assumptions.
- Volatility and dividend assumptions.
- Leg deltas.
- Intrinsic and extrinsic value.
- Net debit and strike width.
- Liquidity and open interest.
- Estimated outcome at short-call expiration.
- Clear indication that projections are estimates.

### PMCC risk checks

- Validate underlying, deliverables, quantities, and expirations.
- Evaluate net debit versus strike width without representing it as a guarantee.
- Surface assignment and expiration risk.
- Avoid continuing to call the opening debit the current max loss after lifecycle changes.

## Existing code preservation

- Reuse the unified launcher, Opportunity Universe, canonical scan sessions, PMCC modal, PMCC pair lookup, result hierarchy, and recommendation pipeline where valid.
- Refactor calculation ownership behind shared services rather than duplicating logic in the page.
- Do not use the legacy CC Tracker as the new lifecycle foundation.

## Non-goals

- New global navigation.
- Automatic order submission.
- Naked-call recommendations.
- Unvalidated changes to existing PMCC scoring.

## Acceptance criteria

### LEAPS-only path

**Given** a qualifying long-call result,
**when** the user selects Review Long Call Only,
**then** TradeEdge opens a proposed LEAPS plan and does not create a position.

### Covered Call eligibility

**Given** Portfolio reports one available standard share unit,
**when** Find Covered Calls runs from the same snapshot,
**then** it scans at most one new contract and shows the same snapshot timestamp.

### Fully reserved shares

**Given** all share capacity is allocated or reserved,
**when** Find Covered Calls loads,
**then** no new call is recommended and the blocking reason is visible.

### New PMCC

**Given** a ranked PMCC pair,
**when** the user selects Review PMCC Plan,
**then** the proposed long leg is shown as support without an unnecessary coverage-selection step.

### Existing position

**Given** multiple eligible foundations,
**when** the user searches for a call against existing positions,
**then** TradeEdge requires the intended support relationship before recording execution.

### Data unavailable

**Given** coverage cannot be verified,
**when** the user runs Find Covered Calls,
**then** scanning fails closed while existing holdings remain visible.

## Validation

- Existing Screener and canonical scan-session suites.
- Launcher and result-card component tests.
- Portfolio/Screener capacity parity tests.
- PMCC ranking regression fixtures.
- LEAPS ranking golden fixtures.
- Accessibility tests for plans and disclosures.

## Rollout

- Introduce Find LEAPS behind a feature flag.
- Shadow-compare old/new Covered Call and PMCC calculations.
- Preserve current PMCC ranking until parity is demonstrated.
- Track workflow completion and reconciliation rates, not trading outcomes.
