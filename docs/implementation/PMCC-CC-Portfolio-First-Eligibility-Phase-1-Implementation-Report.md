# Portfolio-First Income Eligibility — Phase 1 Implementation Report

**Status:** Implemented; awaiting review and production snapshot configuration  
**Scope:** Existing-position PMCC and covered-call eligibility in Positions / Position Analysis  
**Out of scope:** Short-call timing recommendation, order creation, and new-PMCC deployment

## Outcome

Phase 1 adds a portfolio-first **Existing-position income** section to Position Analysis. It evaluates whether an existing holding has the verified structural and account evidence needed to enter a review-only income workflow.

The feature does not claim that writing a short call is attractive, does not create a ticket, and does not submit an order.

## Delivered behavior

### Held long calls / PMCC base

For each option position, the workspace now reports one explicit state:

- **Eligible — evaluate short call** when the position is an exact, single-leg, unambiguous long call in the current active account.
- **Not eligible** when the position is a long put, multi-leg/ambiguous, lacks leg evidence, or has an account mismatch.
- **Broker data unavailable** when current attributable portfolio-snapshot evidence is unavailable.

The review-only detail retains the exact held OCC contract symbol and says that no recommendation, ticket, or order was created.

### Stock holdings / covered-call base

For each canonical long equity holding, the workspace reports:

- **Eligible — evaluate short call** when verified available contract capacity is greater than zero.
- **Fully covered / no available capacity** when existing and working short-call commitments consume all share capacity.
- **Broker data unavailable** when current share and short-call commitment evidence cannot be verified.
- **Not eligible** for positions without long shares.

Displayed capacity evidence is derived from the canonical snapshot:

`floor(long shares / 100) - existing short calls - working short calls`

## Safety and architecture

- The implementation uses the existing canonical portfolio snapshot and `buildSnapshotCapacityReport()` for stock capacity.
- It does not add a second broker-acquisition path.
- A PMCC base is identified by exact broker-held long-call identity; a long put cannot qualify.
- A covered call never becomes eligible when capacity is zero or cannot be verified.
- The existing Screener path remains separate for new PMCC deployment.
- The user is not asked to enter a ticker to inspect a current holding.

## Changed files

- `features/portfolio/positions-workspace/PositionsWorkspace.tsx`
- `features/portfolio/positions-workspace/model/types.ts`
- `features/portfolio/positions-workspace/model/buildPositionsWorkspaceModel.ts`
- `features/portfolio/positions-workspace/__tests__/PositionsWorkspace.test.tsx`
- `features/portfolio/positions-workspace/__tests__/model.test.ts`

## Verification

Passed:

- `npx vitest run features/portfolio/positions-workspace/__tests__/model.test.ts features/portfolio/positions-workspace/__tests__/PositionsWorkspace.test.tsx`
  - 2 test files, 21 tests
- `npx tsc --noEmit --incremental false`
- `git diff --check`

The new coverage proves:

1. Exact held long calls qualify for review without a Screener ticker.
2. Long puts are excluded with an explicit reason.
3. Covered-call capacity carries shares, allocated, reserved, and available values.
4. Missing snapshot evidence is disclosed as unavailable rather than an empty portfolio.
5. The review detail says no recommendation, ticket, or order was created.

## Production prerequisite

This feature deliberately requires the existing canonical portfolio snapshot. Production must set:

`NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED=true`

and redeploy. Until that setting is enabled, Position Analysis correctly reports broker data unavailable instead of fabricating no holdings or no capacity.

## Phase 2 gate

Phase 2 must not begin until Ian approves the actual short-call timing methodology and Quinn approves the recommendation/evidence contract. That phase may add a time-sensitive recommendation only after it has authoritative policy and fresh option-chain evidence.

## Review requested

- **Ian:** confirm the portfolio-first eligibility and review states match the trader workflow.
- **Quinn:** confirm the fail-closed snapshot dependency, exact long-call identity requirement, and share-capacity contract.
- **Diane:** confirm the Position Analysis presentation matches the approved design direction.
- **Paul:** confirm Phase 1 scope is complete and Phase 2 remains correctly gated.
