# POSITIONS-0003 — Portfolio Valuation and Structure-Aware Details

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Design review:** Diane  
**Requirements:** Paul  
**Depends on:** Positions Workspace V2, canonical portfolio snapshot, canonical option entry/quote economics  
**Status:** Ready for implementation

## Problem

The Portfolio view groups instruments by symbol, but its detail model currently applies the same
labels and coverage language to equities, long options, and short options. It also violates the
canonical option-value unit contract and combines unlike P/L bases:

- option `currentValue` is already a whole-position dollar amount but is multiplied by `100 ×
  quantity` again, producing values 100× or more too large;
- an absolute option close obligation is labeled as positive `Option market value`, so a short
  option can look like an asset;
- equity mark-based unrealized P/L is summed with option marketable close-now P/L under the single
  label `Unrealized P/L`;
- null instruments are dropped from totals, allowing a partial value to appear complete;
- the absence of an asset class is shown as `Unavailable` rather than `Not held`/`Not applicable`;
- equity average basis warnings appear on option-only symbols, even though options use entry
  premium economics rather than share basis;
- covered-call share capacity and `Coverage relationship unresolved` language appear on puts and
  standalone long options where those concepts do not apply;
- share remainder is dropped in the list, so two unallocated shares can display as `0 shares
  available`.

These are financial-contract defects, not cosmetic wording issues.

## User value

The Portfolio view will distinguish assets from obligations, mark-based value from executable
close estimates, missing evidence from inapplicable concepts, and complete totals from partial
ones. A trader can understand what is owned, what is owed to close, how current P/L was valued, and
what capital or coverage supports each position without opening Position Analysis.

## Non-negotiable invariants

1. All monetary view-model fields declare their unit and sign convention.
2. A whole-position dollar value is never multiplied by the option contract multiplier again.
3. Midpoint unrealized P/L and marketable close-now P/L are separate metrics with separate labels.
4. A total is `complete` only when every in-scope contributing instrument has a finite value on the
   same valuation basis.
5. `Not held`/`Not applicable` is distinct from `Unavailable`.
6. Equity basis and option entry economics are distinct evidence domains.
7. Coverage, collateral, and capital-at-risk language is selected from canonical structure and leg
   direction, never from the symbol or generic `CALL`/`PUT` strategy label alone.
8. Every broker instrument contributes exactly once to each applicable symbol aggregate.
9. Ambiguous structure or incomplete evidence fails closed with a reason; the UI never fabricates
   direction, basis, quantity, value, P/L, or coverage.
10. Values used for decisions or execution continue to use canonical pricing and safety gates; this
    ticket does not authorize UI-side financial formulas.

## Scope

### 1. Classify every symbol group

Build a pure classification from canonical equity holdings and canonical option legs:

```ts
type SymbolAssetComposition =
  | 'equity-only'
  | 'long-option-only'
  | 'short-option-only'
  | 'mixed-options'
  | 'equity-and-options'
  | 'ambiguous';
```

Also retain instrument-level roles:

```ts
type InstrumentRole =
  | 'long-equity'
  | 'short-equity'
  | 'long-call'
  | 'long-put'
  | 'short-call'
  | 'short-put'
  | 'multi-leg-option-structure'
  | 'ambiguous-option-structure';
```

Classification rules:

- Equity direction comes from the canonical normalized holding.
- Single-option direction and type come from the canonical leg.
- A multi-leg option position retains its canonical strategy/identity; do not reduce it to the first
  leg.
- `Position.identity === null`, `structureAmbiguous === true`, mismatched leg quantities, or an
  unresolved multi-leg partition produces an ambiguous role for structure-dependent presentation.
- A symbol can have more than one instrument role. Do not manufacture a combined strategy or
  coverage relationship from co-location under the same symbol.

The list and detail panel must display `Long 2 shares`, `Short put`, `Long call`, etc. Generic `PUT`
or `CALL` alone is insufficient.

### 2. Canonical units and value fields

Document and enforce these unit contracts in the view model:

| Source field | Unit | Sign/current behavior | Allowed use |
|---|---|---|---|
| `EquityHolding.currentPrice` | dollars per share | positive quote | display underlying/share price |
| `EquityHolding.marketValue` | whole-holding dollars | signed by long/short equity direction | equity market value |
| `Position.currentValue` | whole-position dollars | currently stored as absolute midpoint close value | midpoint option close/value presentation; never multiply again |
| `Position.closeValue` | whole-position dollars | absolute marketable close value | executable close-now estimate |
| `Position.pnl` | whole-position dollars | midpoint P/L | option unrealized P/L |
| `Position.closeNowPnl` | whole-position dollars | marketable bid/ask P/L | option close-now P/L estimate |
| `Position.entryCredit` | whole-position dollars | absolute opening credit or debit, qualified by `entryPriceEffect` | option entry economics |

`Position.currentValue` and `closeValue` already include leg quantity and `CONTRACT_MULTIPLIER` in
acquisition. The Portfolio builder must consume them directly.

#### Equity market value

For each equity holding:

```text
longEquityMarketValue  = currentPrice × quantity
shortEquityMarketValue = currentPrice × quantity × -1
```

Reuse `EquityHolding.marketValue`; do not recompute it in React.

#### Option midpoint value presentation

Because the current `Position.currentValue` compatibility field is absolute, do not call a simple
short option's value a positive asset:

- long option: `Option value (mid)` or `Liquidation value (mid)` = `currentValue`;
- short option: `Buyback obligation (mid)` = `currentValue`;
- canonical multi-leg net-debit structure: `Net option value (mid)` = `currentValue`;
- canonical multi-leg net-credit structure: `Net buyback obligation (mid)` = `currentValue`.

For mixed symbol groups, do not produce a signed `Net option market value` until a canonical signed
value is available for every option position. In the interim show separate long-option value and
short/net-credit buyback obligation subtotals, each completeness-aware. Do not infer sign merely
from `entryPriceEffect` when current leg composition is ambiguous.

#### Marketable close value

When complete two-sided quotes exist, show a separately labeled `Marketable close value`:

- long option: estimated sell-to-close proceeds from bid-side evidence;
- short option: estimated buy-to-close cost from ask-side evidence;
- multi-leg: canonical marketable net close value.

This value is an estimate, not a guaranteed fill. Do not substitute midpoint when a marketable
quote is unavailable.

### 3. Separate midpoint unrealized P/L from close-now P/L

The Portfolio view must expose two distinct concepts:

#### Unrealized P/L (mid)

```text
symbolUnrealizedPnlMid =
  sum(equity mark-based unrealizedPnl) +
  sum(option midpoint pnl)
```

This is the primary `Unrealized P/L` value because all contributors use a mark/midpoint valuation
basis.

Option formulas remain canonical:

```text
credit option midpoint P/L = verified opening credit - midpoint buyback obligation
debit option midpoint P/L  = midpoint liquidation value - verified opening debit
```

#### Close-now P/L estimate

```text
symbolCloseNowPnl =
  equity close-now estimate, only if a canonical executable equity estimate exists +
  option closeNowPnl
```

Do not combine mark-based equity P/L with marketable option P/L and call the result close-now. Until
a canonical equity liquidation estimate exists, either:

- show close-now P/L only for the option portion, explicitly labeled `Options close-now P/L`; or
- mark the symbol close-now total partial and enumerate the excluded equity component.

Show the pricing basis (`Mid` versus `Marketable`) in the label or adjacent provenance text. Never
silently fall back from `closeNowPnl` to `pnl` inside one field.

### 4. Completeness-aware aggregation

Replace nullable `finiteSum` behavior with an explicit aggregate result:

```ts
interface FinancialAggregate {
  value: number | null;
  completeness: 'complete' | 'partial' | 'unavailable' | 'not-applicable';
  includedCount: number;
  expectedCount: number;
  excludedInstrumentKeys: string[];
  reasons: string[];
  basis: 'mark-mid' | 'marketable-close' | 'mixed' | null;
  asOf: string | null;
}
```

Definitions:

- `complete`: every expected contributor has a finite value on the declared basis;
- `partial`: at least one contributor is included and at least one is excluded;
- `unavailable`: contributors exist but none has a defensible value;
- `not-applicable`: no instrument exists in that asset class or the metric does not apply.

Presentation:

- Complete: show value normally.
- Partial: show `Partial $X` and a concise disclosure such as `1 of 2 instruments priced`.
- Unavailable: show `Unavailable` plus the first actionable reason.
- Not applicable: show `No equity holding`, `No option position`, or `Not applicable`; do not use
  `Unavailable`.

Do not treat a genuine `$0` value as null or unavailable.

### 5. Equity basis versus option entry economics

#### Equity

Equity cost-basis metrics require:

- equity holding exists;
- `basisComplete === true`;
- finite canonical average basis;
- applicable quote evidence for the derived metric.

If a holding exists but basis is incomplete, show `Equity basis unavailable` and the normalized data
quality reason. This does not hide share quantity or, when independently known, current market
value.

#### Options

Options do not use equity average basis. They use verified entry economics:

- `entryEconomicsComplete === true`;
- finite `entryCredit`;
- explicit `entryPriceEffect` of `Credit` or `Debit`;
- canonical identity for structure-dependent calculations.

For option-only symbols, do not display `Average basis unavailable`. Display opening premium
evidence (`Opening credit`, `Opening debit`, or `Option entry economics unavailable`) in the
instrument detail.

For equity-and-option symbols, show equity basis only in the equity section and option entry
economics only in the option section. Never use equity basis to calculate option P/L or option entry
premium to calculate equity P/L.

### 6. Structure-specific capital, collateral, and coverage

Select the detail section from canonical role:

| Canonical structure | Heading and required content |
|---|---|
| Equity only | `Share capacity` — shares owned, allocated, reserved, unallocated, whole covered-call contracts available, remainder |
| Cash-secured short put | `Cash collateral` — canonical cash required/effective assignment basis when reliable |
| Other short put | `Buying power / collateral` — broker/canonical requirement or unavailable reason; never call it share coverage |
| Long call/put | `Capital at risk` — verified opening debit; no coverage warning |
| Short call | `Coverage` — canonical shares or long-call relationship, reserved/working state, or explicit unresolved block |
| Covered call | `Share coverage` — exact allocated shares and remaining capacity |
| PMCC/diagonal | `Long-call coverage` — exact canonical supporting long call and allocation state |
| Defined-risk spread/condor | `Max risk / buying power` — reliable canonical value |
| Mixed/unresolved | Separate instrument sections; no inferred combined coverage; explain each unavailable relationship |

Share-capacity units must remain explicit:

```text
sharesOwned = allocatedShares + reservedShares + unallocatedShares
availableCoveredCallContracts = floor(unallocatedShares / 100)
remainderShares = unallocatedShares % 100
```

For two unallocated shares, render:

```text
2 unallocated shares · 0 covered-call contracts available
```

Never render `0 shares available`. `availableCoveredCallContracts × 100` represents shares usable in
whole contracts, not total unallocated shares.

Only short calls need a coverage relationship. Do not print `Coverage relationship unresolved` for
puts or standalone long options. A standalone compatible long call may be labeled `Unallocated long
call` only when that conclusion is supported by complete relationship/working-order evidence.

### 7. Structure-aware detail layout

The selected-symbol panel should follow this order:

1. Symbol, current underlying price, quote timestamp/freshness, instrument count.
2. Complete/partial mark-mid P/L summary.
3. Asset/obligation value blocks that apply to the symbol.
4. Structure-specific capital/collateral/coverage section.
5. Instrument list, with each instrument shown exactly once and labeled by direction/type.
6. Contextual actions only when canonical eligibility is verified.

Examples:

- Equity-only: `Equity market value`; `No option position`; share basis and capacity.
- Long-option-only: `No equity holding`; `Liquidation value (mid)`; `Marketable sell value`; opening
  debit and capital at risk.
- Short-option-only: `No equity holding`; `Buyback obligation (mid)`; `Marketable buyback cost`;
  opening credit and applicable collateral/coverage.
- Equity-and-options: separate equity asset value, long option asset value, and short option
  obligation; do not collapse unlike signs into an unlabeled positive total.

### 8. Compact overview row contract

The Portfolio list is not merely a symbol selector. Each compact row must show, in this hierarchy:

1. **Symbol + recognized structure/composition** — for example `META · Equity`, `UBER · Long
   call`, `BE · Short put`, or `AAPL · Equity + short call`. Use `Mixed instruments` or `Structure
   unresolved` when canonical evidence cannot support a stronger label.
2. **Applicable current value** — equity market value, long-option midpoint liquidation value,
   short-option midpoint buyback obligation, or separately labeled mixed components. Do not label a
   short obligation as positive market value.
3. **Opening economics/basis** — average share basis for equity; opening debit for long options;
   opening credit for short options; separate values for mixed symbols. Omit the field when it is not
   applicable. Use `Unavailable — reason` only when it applies and evidence is missing.
4. **Canonical Unrealized P/L (mid)** — dollar value and percentage when a canonical denominator
   exists. Mark partial aggregates explicitly.
5. **Management status + short reason** — for example `Monitoring · 32 DTE`, `Needs attention ·
   protection invalid`, or `Data incomplete · 1 option quote missing`. Reuse canonical
   recommendation/health/order state; do not derive a second recommendation in the view.
6. **Freshness** — current/stale/unknown indicator plus accessible `as of` evidence.

The normal laptop view should remain scannable. Secondary Greeks, leg details, verbose provenance,
and close-now estimates belong in the selected-symbol drawer, not the compact row.

#### Canonical P/L percentage denominators

Percentages are structure-specific and must never be averaged across instruments:

```text
equity unrealized P/L % = equity unrealized P/L / abs(complete equity cost basis dollars) × 100
long-option unrealized P/L % = option midpoint P/L / verified opening debit × 100
short-credit option unrealized P/L % = option midpoint P/L / verified opening credit × 100
```

Requirements:

- Denominator must be finite and strictly positive.
- Equity percentage requires complete basis for every contributing share lot.
- Option percentage requires complete verified entry economics.
- Multi-leg percentage uses the canonical whole-position opening debit/credit, never one leg's
  premium.
- For homogeneous multi-instrument groups, aggregate dollars and aggregate denominator separately,
  then divide; never average per-instrument percentages.
- For mixed equity/long-option/short-option groups, there is no universal economically comparable
  denominator. Show aggregate P/L dollars plus per-component percentages in the drawer; omit the
  aggregate percentage with explicit accessible copy `Percentage not comparable across mixed
  structures`.
- Partial numerator or denominator means the percentage is partial/unavailable; never compute a
  percentage from only the known contributors and present it as complete.

### 9. Structure-aware drawer contract

The drawer omits non-applicable fields and follows the applicable schema:

| Structure | Required fields |
|---|---|
| Equity | Shares/direction, current price, average basis, equity market value, midpoint/mark P/L dollars and percent, quote freshness, share capacity where applicable |
| Long call/put | Contracts, strike/type, expiry/DTE, opening debit, midpoint liquidation value, marketable sell value when available, midpoint P/L dollars/percent, separate close-now P/L, underlying/moneyness, Greeks, quote freshness, capital at risk |
| Short put | Contracts, strike/expiry/DTE, opening credit, midpoint buyback obligation, marketable buyback cost, midpoint P/L dollars/percent, separate close-now P/L, cash collateral/buying power and assignment exposure, protection, underlying/moneyness, freshness |
| Short call | Contracts, strike/expiry/DTE, opening credit, midpoint buyback obligation, marketable buyback cost, midpoint P/L dollars/percent, separate close-now P/L, verified coverage or unresolved reason, protection, underlying/moneyness, freshness |
| Mixed/multi-leg | Aggregate summary with declared completeness plus an explicit leg/instrument table containing direction, quantity, strike/type, expiry, midpoint value, marketable value, entry economics, and P/L evidence |

Do not show empty placeholder blocks for non-applicable concepts. A long option drawer has no equity
basis warning; a put drawer has no short-call coverage block; an equity-only drawer has no option
value block.

## Data-quality and provenance rules

- Carry quote basis and `asOf` through every aggregate.
- When contributors have materially different timestamps, disclose the oldest timestamp or mark the
  aggregate stale according to canonical freshness policy.
- Entry economics completeness, quote completeness, structure completeness, equity basis
  completeness, coverage completeness, and working-order completeness are independent flags.
- A failure in one domain must not erase reliable data in another domain.
- Never append generic text such as `Reliable holdings remain visible` when there is no holding.
- Reasons must identify the missing domain: `Equity basis missing`, `Option midpoint quote missing`,
  `Marketable bid unavailable`, `Working-order evidence incomplete`, etc.
- Corporate-action, split, merger, spinoff, adjusted-option, and non-standard-deliverable evidence is
  a separate data-quality domain. The current equity normalizer does not establish corporate-action
  normalization merely by receiving a broker price and basis. If price/basis units or deliverable
  adjustment are unresolved, preserve raw broker evidence, surface the condition, and block the
  affected derived basis/P&L metric rather than guessing a split factor or silently declaring the
  deliverable standard.

## Accessibility

- Do not communicate asset/obligation, profit/loss, or completeness with color alone. Use explicit
  words, signs, and `Complete`/`Partial`/`Unavailable` labels.
- Values and their basis labels must be associated in the accessibility tree.
- Partial/unavailable disclosures must be keyboard reachable without hover-only tooltips.
- Preserve visible focus, selected-row marker, `aria-current`, Escape behavior, focus restoration,
  and mobile back navigation.
- Use accessible names that distinguish midpoint from marketable values.

## Likely code touchpoints

- `features/portfolio/positions-workspace/model/types.ts`
- `features/portfolio/positions-workspace/model/buildPositionsWorkspaceModel.ts`
- New pure valuation/composition helpers under
  `features/portfolio/positions-workspace/model/`
- `features/portfolio/positions-workspace/PositionsWorkspace.tsx`
- `features/portfolio/positions-workspace/__tests__/model.test.ts`
- `features/portfolio/positions-workspace/__tests__/PositionsWorkspace.test.tsx`
- `lib/portfolio-data/types.ts` only if the canonical signed option-value contract must be extended
- `lib/portfolio-data/acquisition.ts` only if a new signed whole-position value/provenance field is
  required; preserve compatibility fields and canonical close safety
- `lib/portfolio/positionMetrics.ts` for reusable pure financial helpers
- `lib/portfolio-snapshot/types.ts` and normalized equity data only if provenance required by the
  view model is not already exposed
- Coverage/capacity model from `lib/portfolio-snapshot/capacity.ts`; do not reimplement it in React

## Acceptance criteria

### Units and values

1. A one-contract option with `Position.currentValue === 760` displays `$760`, not `$76,000`.
2. Quantity is not multiplied again when `currentValue`, `closeValue`, `pnl`, `closeNowPnl`, or
   `entryCredit` is already a whole-position dollar amount.
3. A short option never appears as a positive option asset merely because the compatibility field is
   absolute.
4. Long-option midpoint value, short-option midpoint buyback obligation, and marketable close value
   are separately and accurately labeled.
5. A genuine `$0` value renders as `$0` with complete status when evidence is complete.

### P/L

6. Primary symbol `Unrealized P/L` uses equity mark P/L plus option midpoint `pnl`, all on the same
   declared mark-mid basis.
7. `closeNowPnl` is never silently substituted into midpoint Unrealized P/L.
8. Marketable close-now P/L is a separate labeled metric and never silently falls back to midpoint.
9. A symbol aggregate counts every instrument exactly once.
10. If one of multiple instruments lacks P/L, the aggregate is partial/unavailable rather than
    presented as complete.

### Applicability and evidence

11. Option-only symbols show `No equity holding`, not `Equity market value Unavailable`.
12. Equity-only symbols show `No option position`, not `Option market value Unavailable`.
13. Option-only symbols never show an equity average-basis warning.
14. Equity basis warnings are scoped to the affected equity holding; option entry-economics
    warnings are scoped to the affected option.
15. Missing basis does not hide known equity quantity or independently reliable market value.
16. Missing marketable quote does not hide a reliable midpoint value; each is labeled by basis.

### Structure-aware detail

17. Every option instrument is labeled long/short and call/put or by canonical multi-leg structure.
18. Short puts show cash collateral/buying power, not share coverage.
19. Long calls and puts show verified capital at risk and no coverage warning.
20. Only short calls show share/long-call coverage state.
21. Covered-call and PMCC wording requires canonical relationship evidence.
22. Ambiguous mixed symbols display separate instruments and do not manufacture a combined
    strategy or signed net option value.
23. Share-capacity copy distinguishes unallocated shares, whole contracts available, and remainder.
24. Two unallocated shares render as `2 unallocated shares · 0 covered-call contracts available`,
    never `0 shares available`.

### Screenshot regressions

25. **ORCL:** the shown `$76,000` option value regression becomes approximately `$760` for the same
    fixture/current midpoint and is labeled `Buyback obligation (mid)` for the short put. Equity is
    `No equity holding`; equity basis/coverage warnings are absent; cash collateral/buying power is
    shown or specifically unavailable.
26. **BE:** the shown `$126,500` regression becomes approximately `$1,265` for the same fixture/mid
    and is labeled as the short-put buyback obligation. Its marketable P/L remains a separate
    close-now estimate from midpoint P/L.
27. **UBER:** the shown `$208,250` regression becomes approximately `$2,082.50` for the same
    fixture/mid and is labeled long-call liquidation/value, with opening debit/capital at risk and no
    equity-basis or coverage warning.
28. **META:** equity-only detail shows its equity market value and mark-based P/L, `No option
    position`, and share capacity with explicit share/contract units.
29. **SNDK:** for two shares at `$1,438`, equity market value remains `$2,876`; P/L remains derived
    from the verified equity basis. Detail shows `2 unallocated shares · 0 covered-call contracts
    available`, not `0 shares available`. The fixture does not assume the broker price is erroneous.
30. Changes in next-day BE/ORCL/UBER/META/SNDK P/L are accepted when supported by fresh canonical
    quotes; tests assert formulas and provenance, not hard-coded production market outcomes.
31. Every compact row includes recognized composition, applicable value, applicable opening
    economics/basis, canonical midpoint P/L, management status/reason, and freshness without showing
    non-applicable placeholders.
32. Equity, long option, and short-credit P/L percentages use their respective canonical
    denominators; mixed-structure percentages are not fabricated.
33. Drawer contents follow the applicable structure schema and mixed groups include an explicit
    instrument/leg table.
34. A SNDK-like surprising broker price/basis is preserved until raw evidence proves an error; when
    corporate-action/deliverable normalization is unresolved, affected derived P/L is blocked and
    disclosed rather than guessed.

## Required tests

### Pure contract tests

- Whole-position option value is not remultiplied for quantities 1 and greater than 1.
- Composition classification for equity-only, long-option-only, short-option-only, mixed-options,
  equity-and-options, and ambiguous groups.
- Instrument role for long/short call/put and canonical multi-leg structures.
- Complete, partial, unavailable, not-applicable, and genuine-zero aggregates.
- Midpoint P/L and marketable close-now P/L remain separate.
- Long/debit and short/credit formulas use verified entry economics and correct units.
- Equity, long-debit option, and short-credit option P/L percentage denominators, including zero,
  null, partial, homogeneous-group, and mixed-group cases.
- Mixed long/short option values do not acquire a fabricated sign.
- Share-capacity conservation and remainder cases: 0, 2, 99, 100, 102, and 250 shares with
  allocated/reserved contracts.

### Component tests

- Structure-specific labels and absence copy.
- No equity-basis warning for option-only groups.
- No coverage warning for puts or standalone long options.
- Partial values visibly include `Partial` and contributor counts/reasons.
- Direction/type is included in each option instrument label.
- Midpoint/marketable basis and quote timestamp are accessible without hover.
- Compact row field contract for equity, long option, short option, and mixed symbols.
- Structure-aware drawer omission of non-applicable sections and explicit mixed leg table.

### Regression fixtures

- BE short put: opening credit, midpoint buyback obligation, marketable buyback cost, midpoint P/L,
  close-now P/L, collateral scope.
- ORCL short put: same contract with the `$760`/`$76,000` unit regression assertion.
- UBER long call: verified opening debit, midpoint value around `$2,082.50`, marketable proceeds,
  capital at risk, no equity warnings.
- META equity-only: one or more shares, equity market value/P&L, no-option applicability.
- SNDK two-share equity holding: `$2,876` market value at `$1,438`, verified basis/P&L, two-share
  remainder and zero whole covered-call contracts.
- Multi-instrument symbol with one missing quote to prove partial aggregation.
- Equity-and-short-call symbol with verified and unresolved coverage variants.

### Regression suites

- Positions Workspace model and component tests.
- Portfolio snapshot normalization/capacity tests.
- Position metrics, debit P/L, close-order pricing, and quote-provenance tests.
- Typecheck and production build.

## Non-goals

- Correcting or overriding a broker quote merely because it looks surprising.
- Reconstructing missing equity cost basis or option entry premium in the UI.
- Creating new coverage allocations or inferring Covered Call/PMCC relationships.
- Changing close/roll/stop submission behavior.
- Combining realized P/L with open-position unrealized P/L.
- Treating midpoint as an executable fill or guaranteeing a marketable estimate.
- Replacing Tastytrade as the authority for holdings, quotes, and working orders.
- Redesigning Position Analysis beyond consuming the same corrected canonical values where shared.

## Validation steps

1. Capture broker-normalized fixtures for BE, ORCL, UBER, META, and SNDK with sensitive account
   data removed.
2. Verify every fixture's source units before mapping it into the workspace model.
3. Compare midpoint values against canonical `currentValue` and marketable values against canonical
   `closeValue` without additional multiplication.
4. Reconcile symbol P/L instrument-by-instrument and prove each contributor appears once.
5. Force one missing quote/basis/entry field at a time and confirm only the applicable domain becomes
   partial or unavailable.
6. Verify share capacity for remainder-only holdings and canonical covered-call allocations.
7. Perform keyboard, screen-reader, narrow-viewport, and stale-data disclosure checks.
8. Run focused tests, typecheck, and production build before PR review.

## Rollout notes

- Ship under the existing Positions Workspace V2 feature flag.
- Treat the 100× option-value correction as a required release blocker for Portfolio details.
- During rollout, log aggregate completeness category and reason codes without account tokens,
  broker payloads, or other sensitive data.
- Compare production detail values to sanitized broker-normalized evidence for the named regression
  symbols before declaring the fix complete.
- Diane performs final review of asset-versus-obligation hierarchy, partial/unavailable disclosure,
  density, and responsive behavior.
