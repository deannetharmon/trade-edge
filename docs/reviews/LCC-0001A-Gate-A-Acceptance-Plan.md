# LCC-0001A — Gate A Acceptance Plan

**Status:** Ready for repository-owner and production-evidence review

## Current implementation state

LCC-0001A is already implemented on `main`:

- `lib/portfolio-snapshot/` defines and acquires the account-scoped snapshot,
  normalizes equities/options/orders, and calculates fail-closed capacity.
- `PortfolioDataProvider` exposes the same snapshot to Portfolio consumers.
- Portfolio renders feature-gated equity holdings while preserving the existing
  option position model.
- Covered Call capacity shadow comparison is implemented, but the legacy
  capacity report remains authoritative until parity is accepted.

This gate does not introduce new data models, allocations, PMCC workflows, or
scanner cutover.

## Acceptance evidence

### Repository evidence

Run and retain the results of:

```text
lib/portfolio-snapshot/__tests__/*.test.ts
components/portfolio-data/__tests__/PortfolioDataProvider.snapshot.test.tsx
components/portfolio-data/__tests__/EquityHoldingsSection.test.tsx
app/portfolio/__tests__/PortfolioPage.test.tsx
app/screener/__tests__/CcCapacityGate.test.tsx
```

The reviewed result must demonstrate all of the following:

1. Long and short equity rows remain separately visible; short stock contributes
   zero covered-call capacity.
2. Incomplete basis and unavailable/stale quotes remain visibly incomplete or
   unavailable, never fabricated.
3. Missing working-order or attribution evidence leaves reliable holdings
   visible but makes capacity unavailable.
4. Existing option positions and close-order safety retain their existing
   behavior.
5. Snapshot capacity and the legacy scanner report are compared without the
   comparison changing scanner eligibility or a broker action.

### Production shadow evidence

Before cutover, enable only the documented snapshot and shadow flags in a
controlled deployment. Review the authenticated telemetry endpoint over a
repository-owner-selected observation window. Acceptance requires:

- a recorded window and sample count;
- no unexplained parity differences in share quantity, short-call exposure,
  working reservations, capacity, or data-quality status;
- documented treatment for every skipped sample; and
- confirmation that a flag rollback hides the new display/shadow behavior
  without changing the legacy capacity path.

The observation window and acceptable sample threshold are product/operations
decisions; this document deliberately does not invent them.

## Gate decision

- **Accept Gate A:** record the evidence window, findings, and approval; then
  LCC-0001B may begin.
- **Reject / hold Gate A:** keep legacy capacity authoritative, document the
  discrepancy, and correct only the snapshot/shadow layer. Do not start
  LCC-0001B–E.
