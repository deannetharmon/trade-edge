# LCC-0001A PR 3 — Equity Portfolio UI Implementation Report

**Status:** Corrected; ready for team re-review
**Branch:** `feature/lcc-0001a-equity-portfolio-ui`
**Base:** merged PR #26 / `main`
**Specification:** `docs/design/LCC-0001A-technical-spec.md`, rollout PR 3
**Implementation commit:** `ff82044`; corrective commit is current branch HEAD

## Outcome

PR 3 adds an Equity Holdings section to the existing Portfolio → Positions workspace. It is
additive to the existing option cards and gated independently by
`NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED=true`. The snapshot acquisition flag remains
`NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED=true`; neither flag implies the other.

## Delivered behavior

- Long and short stock remain visible as independent equity rows.
- Quantity and complete average basis are displayed; incomplete basis renders “Basis unavailable.”
- Mark-derived values with unknown broker timestamp are labeled “Reference price,” never “Current
  price.” Market value and unrealized P/L remain unavailable unless quote freshness is verified.
- Prior-close-only evidence uses the same stale/reference treatment supplied by PR 2.
- Missing and mixed-lot-incomplete quote evidence remains unavailable.
- Short stock explicitly contributes zero covered-call capacity.
- Long-stock capacity is read only through `buildSnapshotCapacityReport(snapshot)`.
- Any unavailable snapshot quality keeps holdings visible while disabling capacity-dependent
  figures/actions.
- Cached holdings render “Last known holdings” with `lastSuccessfulAsOf`; current holdings with
  incomplete order evidence remain distinguishable.
- Display enabled while acquisition is disabled renders an explicit data-unavailable state.
- Initial loading with no snapshot uses only the page loading state; it does not simultaneously
  claim equity data is unavailable. A prior snapshot remains visible during refresh.
- A definitive empty-portfolio message renders only when a successful snapshot proves equities,
  options, and pending orders are all empty. Unknown equity data never becomes “no positions.”
- Current economics require both `staleQuote === false` and non-null `quoteAsOf`; contradictory
  future inputs fail safely to reference/unavailable presentation.

## Files

- `app/portfolio/page.tsx` — additive flagged section wiring and equity-aware empty-state logic.
- `components/portfolio-data/EquityHoldingsSection.tsx` — themed equity rows and honest data states.
- `components/portfolio-data/__tests__/EquityHoldingsSection.test.tsx` — focused rendering and flag
  contract coverage.
- `app/portfolio/__tests__/PortfolioPage.test.tsx` — page composition, independent-flag,
  loading/unavailable/empty, and equity-plus-option coexistence coverage.
- This report.

## Scope boundaries

No option-card, close-order, recommendation, health/objective, acquisition, order-evidence,
capacity-calculation, Screener, persistence, allocation, PMCC-ranking, or LCC-0001B–E behavior was
changed. Mixed stock/option strategy grouping remains LCC-0001B scope.

## Verification

- PR3 component, Portfolio page, Provider snapshot, and snapshot-domain tests: **85/85 passing**.
- TypeScript: only the known **41** errors in
  `lib/portfolio/__tests__/trendClassification.test.ts`; zero new errors.
- `git diff --check origin/main...HEAD`: clean after the corrective commit-range verification.
- `npm run build`: passed (53/53 static pages generated). Local build emitted expected Redis
  `ECONNREFUSED` warnings because no development Redis instance was running; compilation, type
  validation, page generation, and optimization completed successfully.

## Rollback

Unset `NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED` and rebuild/redeploy to hide the equity UI
without disabling snapshot acquisition. Code rollback is the single PR3 implementation commit;
merged PR1/PR2 remains intact.

## Next gate

Team review of PR3. Do not begin PR4 shadow-mode capacity parity until PR3 is approved.
