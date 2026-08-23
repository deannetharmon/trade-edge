# LCC-0001 — Positions Workspace Redesign Implementation Handoff

**Audience:** Dane (implementation owner)
**Product approval:** Ian
**Design:** Diane
**Requirements:** Paul
**Branch:** `feature/lcc-0001-positions-workspace-redesign`
**Approved interaction model:** `docs/tickets/mockups/tradeedge-equity-portfolio-revision.html`
**Status:** Implemented behind the V2 feature flag

## 1. Outcome

Implement the approved Positions workspace inside the existing TradeEdge Portfolio page. The
workspace must support two first-class views over the same canonical portfolio data:

1. **Portfolio** — symbol-level ownership, strategy composition, coverage evidence, capacity, data
   quality, and contextual next actions.
2. **Position Analysis** — dense contract-level comparison, movement history, Greeks, economics,
   order state, recommendations, and relevance-aware management actions.

This redesign complements the existing operational position data; it must not replace it with a
high-level summary. The final product must retain all canonical calculations and safety behavior
currently rendered by `app/portfolio/page.tsx`.

## 2. Non-negotiable product rules

1. Portfolio and Position Analysis consume the same `PortfolioDataProvider` refresh result.
2. Every broker instrument is independently identifiable and appears exactly once in symbol P/L.
3. Strategy labels are projections over canonical evidence, never a second persisted truth.
4. Never claim shares or a long call support a short call unless canonical relationship evidence is
   present. Conservative capacity is not the same thing as a durable allocation.
5. Allocated and reserved are distinct:
   - allocated = supports a filled/open short call;
   - reserved = held by a working sell-to-open order.
6. Short stock remains visible and contributes no covered-call capacity.
7. Unknown account, working-order, underlying, or deliverable evidence fails coverage-dependent
   actions closed while reliable holdings remain visible.
8. `Trade Evolution` and `What Moved` are different baselines and must remain separate.
9. Existing close/roll, stop, recommendation, pricing-verification, and order-safety gates remain the
   authority. The redesign may invoke them; it may not reproduce or weaken them.
10. No action in the new workspace submits an order without the existing review/confirmation path.

## 3. Scope and dependency boundary

### Already available on `main`

- `lib/portfolio-snapshot/*` and `PortfolioSnapshot`.
- Snapshot exposure through `components/portfolio-data/PortfolioDataProvider.tsx`.
- Equity rendering through `components/portfolio-data/EquityHoldingsSection.tsx`.
- Conservative share-capacity calculation and fail-closed data quality.
- Existing option `Position` model, acquisition, metrics, movement snapshots, objectives,
  recommendations, order actions, and close safety.

### Relationship dependency

Durable share/long-call-to-short-call allocations belong to LCC-0001B. Until that canonical model is
implemented and exposed:

- Group instruments by symbol, but do not label an inferred group as a confirmed Covered Call or
  PMCC relationship unless the existing position structure provides unambiguous evidence.
- Conservative stock capacity may be shown as `100 shares available` only when the snapshot capacity
  report is `ok`.
- Existing short-call exposure may be shown independently.
- Do not manufacture `100 shares allocated` from arithmetic alone. Use `Coverage relationship not
  yet recorded` or `Coverage unresolved` where appropriate.
- Contextual opportunity actions must revalidate capacity at action time.

The branch may introduce a typed relationship adapter/interface for later LCC-0001B wiring, but must
not introduce a competing persistence model as part of this UI change.

## 4. Architecture direction

Do not add more rendering logic to the 8,000+ line `app/portfolio/page.tsx` beyond orchestration.
Extract the workspace into feature modules.

```text
features/portfolio/positions-workspace/
  PositionsWorkspace.tsx
  PositionsWorkspaceTabs.tsx
  portfolio/
    PortfolioOverview.tsx
    SymbolPositionList.tsx
    SymbolPositionRow.tsx
    SymbolDetailPanel.tsx
    EquityCapacitySummary.tsx
    ContextualOpportunityAction.tsx
  analysis/
    PositionAnalysisView.tsx
    PositionAnalysisTable.tsx
    PositionAnalysisRow.tsx
    AnalysisToolbar.tsx
    AnalysisViewSelect.tsx
    PositionFilterDialog.tsx
    ColumnCustomizationDialog.tsx
    MovementHistoryCell.tsx
    WhatMovedCell.tsx
    ManagementActionsCell.tsx
  model/
    types.ts
    buildPositionsWorkspaceModel.ts
    buildPortfolioSymbolGroups.ts
    buildPositionAnalysisRows.ts
    filters.ts
    columns.ts
    preferences.ts
    contextualActions.ts
  __tests__/
```

`app/portfolio/page.tsx` should pass existing state/callbacks into `PositionsWorkspace`; it must not
create a second acquisition path.

## 5. View-model contracts

Create pure view-model builders. Components must not calculate portfolio economics.

```ts
export type PositionsWorkspaceView = 'portfolio' | 'analysis';
export type AnalysisViewId = 'management' | 'risk' | 'full' | 'custom';

export interface PositionsWorkspaceModel {
  snapshotAsOf: string | null;
  quoteAsOf: string | null;
  dataQuality: SnapshotDataQuality;
  portfolioSummary: PortfolioSummaryViewModel;
  symbolGroups: SymbolGroupViewModel[];
  analysisRows: PositionAnalysisRowViewModel[];
}

export interface SymbolGroupViewModel {
  symbol: string;
  underlyingPrice: number | null;
  equityMarketValue: number | null;
  optionMarketValue: number | null;
  symbolUnrealizedPnl: number | null;
  equityHoldings: EquityInstrumentViewModel[];
  optionPositions: OptionInstrumentViewModel[];
  strategyProjections: StrategyProjectionViewModel[];
  capacity: CapacityViewModel;
  attention: AttentionViewModel;
  contextualAction: ContextualOpportunityAction | null;
}
```

The builder receives the provider snapshot, existing `Position[]`, pending/working orders, current
recommendations, and existing action eligibility results. It only maps and groups them.

### P/L ownership

- `symbolUnrealizedPnl` sums every equity and option instrument exactly once.
- Never sum a strategy subtotal and the same underlying instruments again.
- Label equity-only market value as `Equity market value`; do not call it total symbol value.
- Realized P/L belongs to completed/history views and is not mixed into current unrealized P/L.

## 6. Portfolio view

### Default layout

- Show 5–7 symbol rows on a normal laptop viewport.
- Each row includes symbol, underlying price, instrument count, strategy summary, relevant value,
  symbol unrealized P/L, attention/capacity status, and selection state.
- Selecting a row updates the side detail panel without changing the list scroll position.
- Closing the panel expands the list. Escape closes it and returns focus to the selected row.
- Selection must use more than color: visible marker, border/rail, `aria-current`, and focus ring.
- On mobile, selecting a row opens a full-width detail state with `Back to Positions`; restore list
  scroll and filters on return.

### Symbol detail

- List each actual instrument once.
- Keep stock-backed and long-call-backed strategies visibly separate when relationship evidence is
  canonical.
- Show exact relationship wording:
  - `Covered by 100 AAPL shares`;
  - `Supported by 1 Jan 2028 $150 long call`;
  - otherwise `Coverage relationship unresolved`.
- Capacity wording uses shares and contract counts, never `unit`.
- Complete breakdown when evidence supports it:
  `250 shares · 100 allocated · 0 reserved · 100 available · 50-share remainder`.
- Basis incomplete does not hide quantity capacity, but disables basis-dependent metrics.

### Contextual actions

Do not render a global `Find Opportunities` button.

| Evidence | Action |
|---|---|
| Verified available shares | `Find Covered Call` |
| Unallocated compatible long-call foundation | `Find Short Call` |
| Completed/expired/assigned position requiring redeployment | `Find Replacement` |
| Capacity unavailable or relationship unresolved | No discovery action; show blocking reason |

Each action opens the existing Screener/planning workflow with explicit context and revalidates the
latest snapshot before displaying eligible opportunities.

## 7. Position Analysis view

Use the existing `Position` objects and current canonical calculation helpers. Preserve these 14
columns:

1. Position identity.
2. Entry / Expiry / DTE.
3. Underlying / OTM.
4. Strike / Breakeven.
5. Buying power / Cash.
6. Credit / Debit.
7. Buyback / Value.
8. Open P/L / Target.
9. Trade Evolution.
10. What Moved.
11. Greeks.
12. IV / IVR.
13. GTC / Stop.
14. Suggested action.

The first column remains pinned during horizontal table scrolling. Do not cause document-level
horizontal overflow.

### Metric provenance

Reuse existing functions/fields; do not reimplement formulas in React:

- Acquisition and position economics: `lib/portfolio-data/acquisition.ts`.
- Pure calculations and direction coloring: `lib/portfolio/positionMetrics.ts`.
- Close-now/marketable pricing: existing position valuation and pricing fields.
- Recommendations/objectives: existing portfolio-intelligence and recommendation pipeline.
- Management eligibility: existing `isActionRelevant`, safety gates, stop policy, and close-order
  analysis in `app/portfolio/page.tsx`/`lib/portfolio/*`; extract reusable helpers only where required.

### Trade Evolution

First-tracked snapshot → current:

- POP, delta, theta, gamma, vega, modeled net edge, OTM buffer, IV, IVR, DTE.
- Preserve metric-specific favorable/unfavorable coloring.
- Label the baseline `first tracked`, not `entry`, unless verified execution evidence establishes a
  true entry snapshot.
- Show `new baseline` and insufficient-history disclosure when appropriate.

### What Moved

Prior qualified daily snapshot → current:

- Stock, P/L, net edge, IV, IVR, delta, theta, gamma, vega, POP, buffer.
- Preserve the canonical noise thresholds from `buildMovementSummary()`.
- If no movement crosses a threshold, show the canonical stable state.
- If no history exists, show `Tracking — first day tracked`.
- Add an expandable `Why this changed` narrative. It must explicitly use the prior-snapshot baseline
  and must not claim causality not supported by the metrics.

## 8. Analysis controls

### Primary hierarchy

Only the workspace tabs are primary navigation:

```text
Portfolio | Position Analysis
```

The Analysis toolbar is:

```text
View: [Management ▾]   [Filter n]   [Customize Columns]
```

### Saved views

- `Management`: identity, dates, underlying/OTM, strike, buyback, P/L/target, What Moved, GTC/Stop,
  suggested action.
- `Risk`: identity, dates, underlying/OTM, strike, P/L/target, Trade Evolution, What Moved, Greeks,
  IV/IVR, suggested action.
- `Full Detail`: all 14 columns.
- `Custom`: activated automatically after manual column changes.

### Filters

Implement an accessible dialog/drawer with draft state, Apply, Cancel, and Clear All. Initial filter
dimensions:

- symbol;
- strategy type;
- attention state;
- open P/L state.

Architecture must allow later DTE range, intent, working-order, and coverage filters without schema
replacement. The button displays the active filter count. Filtering affects rows only, never
recalculates the underlying position model.

### Customize Columns

Categorized checklist:

- Position;
- Economics;
- Movement;
- Risk & Greeks;
- Orders;
- Recommendation.

Requirements:

- Position identity cannot be removed.
- Apply/Cancel are distinct; closing without applying discards draft changes.
- `Reset to preset` restores the selected preset.
- Applying manual changes switches View to `Custom`.
- Avoid an empty table; enforce at least identity plus one information column.

## 9. Preferences and schema versioning

Production preference persistence must not copy the mockup's unversioned storage literally.

```ts
export interface PositionsWorkspacePreferencesV1 {
  version: 1;
  workspaceView: PositionsWorkspaceView;
  analysisView: AnalysisViewId;
  filters: PositionAnalysisFilters;
  customColumnIds: AnalysisColumnId[];
}

export const POSITIONS_WORKSPACE_PREFERENCES_KEY =
  'tradeedge:positions-workspace:preferences:v1';
```

- Validate parsed data with a narrow runtime decoder.
- Drop unknown filters and columns.
- Fall back to defaults on malformed JSON or future versions.
- Do not persist account numbers, broker identifiers, prices, P/L, symbols selected by broker state,
  or any other sensitive portfolio data. UI preference state only.
- Storage errors must never block portfolio rendering.
- Add migration functions when incrementing the schema version.
- Preference restoration occurs after hydration without a visible destructive reset.

## 10. Management actions

Render existing management actions only when the canonical eligibility logic permits them:

- Take Profit.
- Close/Roll.
- Set Stop.
- Intent selector.
- Position Intelligence.
- Explain Recommendation.

Rules:

- Do not show Take Profit when the profit target has not been reached.
- Do not show Set Stop when basis/entry/stop validation is incomplete.
- Close/Roll must use existing canonical close identity and structure analysis.
- PMCC actions must preserve foundation coverage safety.
- Every action opens the existing review/confirmation flow; no inline direct submission.
- Explain withheld actions with concise safety copy.

## 11. Data-quality states

Implement in place; do not obscure reliable holdings with a global modal.

- **Basis incomplete:** show all shares, `Average basis unavailable`, quantity capacity if verified,
  and `Strike-vs-basis metrics unavailable`.
- **Working reservation:** show allocated and reserved separately; no additional action when zero
  capacity remains.
- **Assignment:** show called-away and remaining shares; realized result only when assigned-lot basis
  is verified.
- **Coverage unavailable:** keep holdings visible, disable coverage-dependent actions, name the exact
  source failure, and provide `Review Unmatched Exposure` / `Refresh Portfolio Data`.
- **Short stock:** visible, zero covered-call capacity.
- **Adjusted deliverable:** never apply standard 100-share wording unless the actual deliverable is
  verified.

## 12. Feature flags and rollout

Add one UI flag for the new workspace, independent from snapshot acquisition flags:

```text
NEXT_PUBLIC_POSITIONS_WORKSPACE_V2_ENABLED
```

Recommended delivery sequence on this branch:

1. Pure view-model types/builders and golden fixtures; no UI change.
2. Analysis table extraction with complete metric parity against current position cards.
3. Portfolio overview and equity/symbol grouping without unverified relationship claims.
4. Workspace tabs and selection/detail behavior.
5. View presets, Filter, Customize Columns, and versioned preferences.
6. Existing management action wiring and contextual opportunity actions.
7. Accessibility/responsive correction pass.
8. Feature-flagged preview, parity review, and production rollout.

Use reviewable commits/PR slices even though the work shares one feature branch. Do not submit one
monolithic diff.

## 13. Tests

### Pure model tests

- Stable symbol grouping independent of input order.
- Each instrument appears once.
- Symbol P/L deduplication.
- Long and short equities remain separate.
- Capacity mapping and fail-closed states.
- No allocation label without relationship evidence.
- Contextual action eligibility.
- Filter predicates and count.
- Preset column membership.
- Preference decoder, malformed input, unknown fields, version mismatch, and migration.

### Component/integration tests

- Portfolio shows 5–7 rows at the target desktop fixture.
- Row selection updates detail without losing scroll.
- Close/Escape/focus-return behavior.
- Mobile detail/back behavior.
- Workspace tab keyboard semantics.
- Management/Risk/Full Detail/Custom behavior.
- Filter Apply/Cancel/Clear All and active count.
- Customize Apply/Cancel/Reset and non-empty enforcement.
- Reload restores valid preferences.
- All 14 analysis columns render in Full Detail.
- Pinned identity and internal horizontal scroll.
- Trade Evolution contains all 10 canonical metrics.
- What Moved uses prior-snapshot values and canonical thresholds.
- Narrative baseline labeling.
- Relevance-aware actions withheld/shown correctly.
- Data-unavailable holdings stay visible.
- Existing equity-section tests remain green.

### Regression suites

- `app/portfolio/__tests__/PortfolioPage.test.tsx`.
- `components/portfolio-data/__tests__/*`.
- `lib/portfolio-data/__tests__/*`.
- `lib/portfolio/__tests__/positionMetrics.test.ts`.
- `lib/portfolio/__tests__/closeOrderSafety.test.ts`.
- Existing recommendation, objective, stop-loss, pricing-verification, and movement suites.

### Required verification

```bash
npx vitest run <targeted suites>
npx tsc --noEmit --incremental false
npm test
npm run build
git diff --check
```

The production build is mandatory; typecheck alone is insufficient for `app/portfolio/page.tsx`.

## 14. Accessibility and responsive requirements

- WCAG-visible focus states on every interactive control.
- Native tab, select, checkbox, dialog, details/summary semantics where possible.
- Dialog focus containment and focus return.
- Do not rely on green/red alone; include text/icon/state labels.
- Table headers remain associated with visible cells after column hiding.
- Hidden columns must be removed from the accessibility tree, not visually concealed only.
- Reduced-motion support.
- No document-level horizontal overflow at 390px; analysis table scrolls internally.
- Touch targets at least 44px where the responsive layout permits.

## 15. Explicit non-goals

- New broker acquisition or API routes.
- Reimplementation of option calculations.
- Automatic order submission.
- New recommendation rules or PMCC scoring.
- Tax-lot optimization.
- Fabricated coverage relationships.
- LCC-0001D lifecycle migration/reconciliation.
- Global navigation redesign.

## 16. Definition of done

The branch is ready for review only when:

1. The approved Portfolio and Position Analysis views are implemented behind the flag.
2. Full Detail demonstrates parity with the current operational position information.
3. Both movement baselines retain their complete canonical fields and provenance.
4. Filters, columns, saved views, and versioned preferences work and are tested.
5. Contextual and management actions use existing safety gates.
6. No UI claims an unverified support relationship or capacity.
7. Reliable holdings remain visible through fail-closed states.
8. Existing option/equity behavior and regression suites remain green.
9. Accessibility and mobile containment pass.
10. Typecheck, full tests, production build, and `git diff --check` pass.

## 17. Dane's first implementation step

Before changing UI code, create `model/types.ts`, `columns.ts`, `preferences.ts`, and golden fixtures
derived from the approved mockup and existing live `Position` fixtures. Then extract a pure
`buildPositionAnalysisRows()` adapter from the current `PositionCard` data. Demonstrate metric parity
in tests before replacing any existing rendering. This protects the information depth that prompted
the redesign and prevents the new workspace from becoming a high-level-only view.
