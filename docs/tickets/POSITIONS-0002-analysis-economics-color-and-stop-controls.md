# POSITIONS-0002 — Position Analysis Economics, Semantic Color, and Stop Controls

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Design review:** Diane  
**Requirements:** Paul  
**Depends on:** Positions Workspace V2 and the canonical close/stop safety work  
**Status:** Ready for implementation

## Problem

The Position Analysis table exposes the right categories of data, but several cells are either
misleading or not actionable:

- `What Moved` duplicates the movement already shown in `Trade Evolution` and consumes valuable
  horizontal space.
- Trade Evolution presents every comparison with the same visual weight, so favorable,
  unfavorable, threshold-approaching, and merely directional changes cannot be scanned quickly.
- The table reports GTC/stop status but provides no way to add, adjust, repair, or cancel a stop.
- Long debit options display `Buying power / Cash: Unavailable`, even though their verified opening
  debit is their capital at risk.
- The underlying cell always appends `% OTM`. This produces `—% OTM` and mislabels options whose
  strike has been crossed; long calls and long puts are especially visible examples.
- Credit/debit and other high-value fields lack a consistent semantic color vocabulary.

## User value

The trader can scan position economics and deterioration quickly, understand whether an option is
OTM, ATM, or ITM, and manage protective stops without leaving Position Analysis. Color improves
comprehension but never substitutes for text, signs, icons, or order review.

## Product decisions

1. Remove `What Moved` completely. Do not replace it with a new summary column; Trade Evolution is
   the sole movement summary in the table.
2. Color communicates interpreted meaning, not decoration:
   - green = improvement or favorable state;
   - red = deterioration, loss, or crossed risk boundary;
   - amber/orange = approaching a management threshold or an opening debit;
   - blue = material movement whose direction is not universally favorable;
   - gray = prior values, neutral state, unavailable data, or immaterial change.
3. An opening debit is amber/orange, not red. Paying a debit is not itself a loss; red remains
   reserved for actual loss/danger.
4. Stop actions are review-first. No table action may immediately submit, replace, or cancel a
   broker order.
5. Stop behavior must distinguish net-credit and long-debit positions. Credit-only labels or
   formulas must never leak into a debit workflow.
6. Unknown or incomplete evidence remains unavailable with a reason. Never substitute zero,
   infer order identity, or manufacture a broker-supported trigger type.

## Scope

### 1. Remove `What Moved`

- Remove the `movement` column id, definition, rendering, presets, customization option, and tests.
- Remove the table cell and its `Prior snapshot → now` disclosure.
- Preserve the underlying snapshot history; this ticket removes only the redundant presentation.
- Migrate persisted custom-column preferences safely: silently discard the obsolete `movement` id
  and preserve all other valid selections. Ensure a saved selection remains usable after migration.
- Reclaim the width for Position, economics, Trade Evolution, stop controls, and Suggested Action.

### 2. Semantic color system

Apply the shared semantic vocabulary consistently:

| Field/state | Treatment |
|---|---|
| Opening `Credit` and amount | Green |
| Opening `Debit` and amount | Amber/orange |
| Positive current P/L | Green |
| Negative current P/L | Red |
| Zero/near-zero or unavailable P/L | Neutral gray |
| OTM with adequate cushion | Green |
| OTM approaching a management threshold | Amber |
| ITM where strike crossing is adverse to the position | Red |
| GTC/stop aligned and live | Green |
| Missing protection when relevant, too loose/tight, or unverified | Amber/orange according to canonical classification |
| Invalid/conflicting protection | Red |
| Hold/Monitor | Neutral |
| Take Profit | Green |
| Review/Roll | Purple or amber |
| Reduce Risk | Amber |
| Cut Losses/Close | Red |

Keep dates, raw strikes, ordinary buying-power values, raw Greeks, IV, and IVR neutral unless a
canonical rule supplies a defensible interpretation. Do not make a whole row red or green.

Create small reusable presentation helpers/view-model fields rather than scattering Tailwind
conditionals through `AnalysisRow`. Helpers must be pure and unit tested.

### 3. Trade Evolution interpretation

Retain `first tracked → now` and the existing metric set. Style comparisons as:

- prior value: muted gray;
- arrow: subdued;
- current value: semantic color when its change can be interpreted;
- material change: stronger weight; immaterial change: muted.

Interpretation rules:

- Open P/L improved from baseline: green; deteriorated: red; unchanged/unknown: gray.
- POP increased: green; decreased: red; unchanged/unknown: gray.
- OTM cushion increased: green; narrowed but remains OTM: amber; crossed from OTM to ITM: red.
- DTE becomes amber/red only when the current value enters an existing strategy-management window;
  do not color the mere passage of time as deterioration. Reuse canonical strategy/DTE policy where
  it exists instead of inventing a second threshold table in React.
- IV/IVR movement is blue unless an existing strategy-aware rule can prove it favorable or adverse.
- Delta, gamma, theta, and vega movement is blue by default. A raw increase/decrease is not
  inherently good or bad.
- Missing baseline or current data uses `—` plus neutral styling; never coerce missing to zero.

Color the current value based on the interpreted change, not merely the sign of the current number.
For example, P/L `−$210 → −$120` colors `−$120` green because the loss improved.

### 4. Structure-aware capital presentation

Rename the column label to `Capital / Collateral` and select its label/value by verified structure:

| Structure | Label/value |
|---|---|
| Cash-secured put | `Cash required` using canonical cash-secured collateral |
| Credit spread/defined-risk credit structure | `Buying power` or `Max risk` using reliable canonical max risk |
| Long call or long put opened for a verified debit | `Capital at risk` = verified total opening debit |
| Covered call | `Shares securing call` using canonical coverage evidence |
| Unsupported/ambiguous/incomplete | `Unavailable` plus a concise reason |

For a standard long option position:

```text
capitalAtRisk = entryDebitPerContract × contractMultiplier × canonicalQuantity
```

Use the already verified whole-position debit when that is the canonical stored convention; do not
multiply it a second time. Require complete entry economics, `entryPriceEffect === 'Debit'`, a
non-null canonical identity, and a finite positive debit. Do not repurpose
`reliableSupportedMaxRisk()`, whose credit-only fail-closed contract is intentional.

### 5. Correct moneyness

Build a pure moneyness view model from current underlying price and the relevant canonical option
leg. For a single option leg with underlying `S` and strike `K`:

```text
distancePct = abs(S - K) / S × 100

Call: OTM when S < K; ATM when S == K; ITM when S > K
Put:  OTM when S > K; ATM when S == K; ITM when S < K
```

Use a documented display tolerance/rounding rule so a value rounded to `0.0%` is labeled `ATM`, not
`0.0% OTM`. The result is independent of whether the leg is long or short; direction affects the
risk interpretation/color, not the factual OTM/ITM classification.

- Single long/short call or put: use that leg.
- Multi-leg structure: use the canonical management/risk-defining leg already selected by the
  position model (normally the short strike for credit structures). If no unambiguous relevant leg
  exists, show `Moneyness unavailable` rather than choosing `legs[0]`.
- Render `12.9% OTM`, `14.6% ITM`, or `ATM`; never render a negative OTM percentage or `—% OTM`.
- Preserve explicit words in addition to color.
- The Trade Evolution baseline must carry the same state-aware label. If historical evidence only
  contains a legacy numeric buffer and cannot establish OTM/ITM state, display the honest available
  comparison without fabricating a state.

### 6. Contextual stop management

The `GTC / Stop` cell becomes a compact status plus contextual controls:

| Canonical stop state | Controls |
|---|---|
| `NO_STOP` | `Add Stop` |
| `ALIGNED` with verified working order identity | `Adjust` and `Cancel` |
| `TOO_LOOSE` | `Adjust` |
| `TOO_TIGHT` | `Verify/Adjust` |
| `UNKNOWN_PROVENANCE` | `Verify`; do not offer destructive replacement until broker identity is re-established |
| `INVALID` | `Repair Stop` when safely targetable; otherwise explain the block |

Buttons must invoke/extract the existing guarded stop workflow; do not duplicate live order
construction in `PositionsWorkspace.tsx`.

#### Credit-position stop review

- Order side/effect is the canonical buy-to-close action.
- Support entry-credit loss multiple and an explicit option-price trigger using the canonical
  stop-loss policy.
- Show entry credit, trigger, limit behavior, quantity, estimated loss dollars/percent, existing
  profit-target interaction, and whether an OCO replacement is required.
- Reuse `DEFAULT_ENTRY_STOP_MULTIPLE`, `StopLossPolicy`, canonical close identity, quote validation,
  portfolio-mode gate, and close-order safety gate.

#### Long-debit stop review

- Order side/effect is the canonical sell-to-close action.
- Support remaining option value and percentage loss from verified entry debit. An underlying-price
  threshold may be offered only if the broker/order path truly supports it; otherwise label it as a
  TradeEdge monitoring policy and never imply that a broker stop exists.
- Estimated P/L at trigger:

```text
estimatedProceeds = triggerOptionPrice × contractMultiplier × canonicalQuantity
estimatedPnl = estimatedProceeds - verifiedOpeningDebit
lossPctOnDebit = max(0, -estimatedPnl / verifiedOpeningDebit × 100)
```

- Use current sell-to-close bid/marketable evidence for previews. Never use credit-position
  buyback, profit-capture, or loss-multiple copy for a debit position.
- Rolling a debit position remains unavailable unless the existing debit-aware roll safety model
  explicitly supports it; this ticket does not authorize weakening that block.

#### Adjust, repair, and cancel safety

- `Add`, `Adjust`, and `Repair` first open a review dialog. Live submission remains a separate,
  explicit action and is disabled while any safety/pricing/identity gate fails.
- `Cancel` first opens a confirmation dialog naming symbol, order type, trigger, quantity, and the
  protection that will be removed. Cancellation occurs only after explicit confirmation and a fresh
  broker-state check.
- Tastytrade has no atomic replace. Adjust/repair must use the existing cancel/place/restore safety
  sequence where applicable. A known-invalid replacement must fail before cancellation. If the new
  order fails after cancellation, attempt the established safe restore and disclose the outcome.
- Existing GTC/OCO conflicts must be shown before confirmation. Never silently cancel a
  profit-target or another closing order.
- Every action revalidates account, canonical identity, exact legs, canonical quantity, current
  working-order id/state, quotes, portfolio mode, and duplicate/conflicting closing orders.
- Ambiguous structures, stale/unpriceable quotes, unknown order identity, or unsupported effects
  fail closed with a specific reason.
- The table itself never submits or cancels an order.

## Interaction model

1. Trader selects the contextual stop control in the row.
2. TradeEdge refreshes/revalidates the position and broker order state.
3. A focused review dialog shows the exact structure, action/effect, quantity, trigger, limit
   behavior, estimated economics, working-order consequences, and safety verdict.
4. The final live button remains disabled until every required gate passes.
5. After a successful submit/cancel, refresh positions and working orders, announce the result, and
   return focus to the originating row control.
6. On failure, preserve the dialog with actionable error copy and an accurate statement of whether
   the original protection is still working, was restored, or is absent.

## Accessibility

- Color is never the sole carrier of state. Keep signs, `Credit`/`Debit`, `OTM`/`ATM`/`ITM`, stop
  classifications, and action labels visible.
- Meet WCAG AA contrast against the dark table background for normal and emphasized text.
- Do not use red/green alone; pair semantic text with an icon or explicit label where status is
  compact.
- All row controls are keyboard reachable with a visible focus indicator and an accessible name
  that includes the symbol, for example `Adjust stop for ORCL`.
- Dialogs trap focus, close with Escape only when no submission is in flight, restore focus to the
  invoking control, and expose title/error/result with appropriate dialog/alert semantics.
- Announce successful add/adjust/repair/cancel outcomes through an `aria-live` status region.
- Preserve horizontal-table keyboard scrolling and pinned Position-column behavior.

## Likely code touchpoints

- `features/portfolio/positions-workspace/PositionsWorkspace.tsx`
- `features/portfolio/positions-workspace/model/types.ts`
- `features/portfolio/positions-workspace/model/columns.ts`
- `features/portfolio/positions-workspace/model/preferences.ts`
- `features/portfolio/positions-workspace/model/buildPositionsWorkspaceModel.ts`
- New pure workspace model/presentation helpers under
  `features/portfolio/positions-workspace/model/`
- `features/portfolio/positions-workspace/__tests__/PositionsWorkspace.test.tsx`
- `features/portfolio/positions-workspace/__tests__/model.test.ts`
- `app/portfolio/page.tsx` for orchestration and extraction/reuse of the existing stop dialog only;
  do not add further table rendering logic there
- `lib/portfolio/positionMetrics.ts` and its tests for canonical reusable economics/moneyness helpers
- `lib/portfolio/stopLossPolicy.ts` and tests for policy-level extensions
- `lib/portfolio/closeOrderSafety.ts` / `lib/portfolio/closeOrderSubmission.ts` and tests for any
  broker-boundary debit stop support
- Existing pending-order replacement safety/submission modules where cancel/place/restore semantics
  apply

Keep live order construction and submission behind canonical library boundaries. Components consume
review plans and callbacks; they do not build broker payloads.

## Acceptance criteria

1. No `What Moved` header, cell, preset entry, or customization option remains.
2. Previously saved custom columns containing `movement` load without error and retain other valid
   selections.
3. Trade Evolution shows the prior value muted and the current value colored according to the
   interpreted change rules; missing data is never rendered as zero.
4. A loss improving from `−$210` to `−$120` colors the current value as an improvement even though
   it remains negative.
5. Raw Greek and IV/IVR direction changes remain blue/neutral unless a canonical strategy-aware
   interpretation exists.
6. Opening credit is green; opening debit is amber/orange; actual negative P/L remains red.
7. A verified long-debit option shows `Capital at risk` equal to its total opening debit rather than
   `Unavailable`.
8. Incomplete or ambiguous debit economics show `Unavailable` with a reason and never `$0`.
9. Long and short calls/puts display correct OTM, ATM, or ITM labels and non-negative distance.
10. No cell can render `—% OTM` or a negative OTM percentage.
11. Multi-leg moneyness uses the canonical relevant leg or fails closed; it never assumes `legs[0]`.
12. Stop cells expose the correct contextual control for every canonical stop classification.
13. Credit stop review is buy-to-close and uses credit-specific economics; debit stop review is
    sell-to-close and uses debit-specific economics.
14. No Add/Adjust/Repair/Cancel control mutates broker state before a separate explicit review and
    confirmation.
15. Ambiguous identity, stale/unusable quotes, unsupported order effects, unknown broker order id,
    conflicts, and non-LIVE portfolio mode prevent broker mutation with a specific reason.
16. Adjust/repair preserves the established pre-cancel validation and restore-on-failure guarantees.
17. After a mutation, refreshed broker state—not optimistic local state—drives the displayed status.
18. All semantic states remain understandable with color removed.
19. The table remains usable on a normal laptop viewport with no document-level horizontal overflow.

## Required tests

### Pure/model tests

- Call and put moneyness on both sides of the strike, for both long and short directions.
- ATM/tolerance behavior, null underlying/strike, non-positive underlying, and ambiguous multi-leg
  selection.
- Long-debit capital-at-risk unit convention (per-contract versus whole-position), quantities above
  one, incomplete entry economics, and ambiguous identity.
- Semantic comparison classification for improved/deteriorated/unchanged/missing P/L and POP;
  widening/narrowing/crossed moneyness; DTE; Greeks; IV/IVR.
- Obsolete `movement` preference migration.

### Component tests

- Column removal from presets and Customize Columns.
- Credit/debit, P/L, moneyness, recommendation, GTC, and stop semantic copy/classes.
- Every stop classification renders the expected action and accessible name.
- Stop controls open review and do not directly call a submit/cancel boundary.
- Focus restoration and live-region success/error announcements.

### Safety/integration tests

- Credit add/adjust and debit add/adjust produce the correct canonical close effect and economics.
- Cancel requires confirmation and fresh matching working-order identity.
- Known-invalid replacement cannot cancel the existing order.
- Post-cancel replacement failure exercises restore success, restore blocked, and restore failure
  disclosures.
- Existing GTC/OCO conflict, ambiguous structure, stale quote, missing entry debit, unsupported
  underlying trigger, duplicate closing order, and non-LIVE mode all fail closed.
- A successful action refreshes broker positions/orders before the table reports the new state.

### Regression validation

- Existing Positions Workspace model/component tests.
- `lib/portfolio/__tests__/stopLossPolicy.test.ts`.
- Close-order safety/submission and pending-order replacement safety/submission suites.
- Debit P/L and debit close-dialog suites.
- Typecheck and production build.

## Non-goals

- Replacing Tastytrade as the authority for broker working-order state.
- Inventing synthetic cost basis, quotes, position identity, or stop provenance.
- Adding direct inline order submission.
- Enabling debit rolls where the canonical safety model still blocks them.
- Claiming an underlying-price alert is a broker stop when only TradeEdge monitoring is available.
- Redesigning Portfolio view, recommendations, or the broader order system.
- Replacing canonical recommendation, stop-loss, close-order, or replacement safety rules with UI
  heuristics.
- Adding another movement-summary column or causal narrative.

## Validation steps

1. Use representative credit put, credit spread, covered call, long call, and long put fixtures.
2. Confirm table values and colors against the formulas and semantic matrix above.
3. Exercise every stop classification with broker mutations mocked, then exercise review-only flows
   in the browser.
4. Verify that no network mutation occurs from the table-control click itself.
5. Verify cancel/replace/restore state messages against broker outcomes.
6. Test keyboard-only navigation, focus restoration, zoom, reduced viewport width, and a
   color-blind/grayscale pass.
7. Run focused tests, typecheck, and the production build before opening the PR.

## Rollout notes

- Ship under the existing Positions Workspace V2 feature flag; do not add an unrelated flag unless
  deployment risk requires an independently reversible stop-control rollout.
- If stop controls receive a separate flag, the read-only status remains visible when disabled.
- Monitor failed stop-plan validation, replacement/restore outcomes, and unavailable
  capital/moneyness reasons without logging account tokens or sensitive broker payloads.
- Diane performs the final visual and interaction review for table density, semantic-color balance,
  dialog hierarchy, and keyboard behavior before production activation.
