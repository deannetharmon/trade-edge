# PMCC-0003 — Qualified Ranked LEAPS and PMCC Finders

**Owner:** Paul (product policy and acceptance)  
**Methodology:** Ian  
**UX:** Diane  
**Architecture / QA:** Quinn  
**Implementation:** Dane  
**Review facilitation:** Frank  
**Status:** Package A correction ordered in PMCC-0003A; Packages B–F remain gated
**Target branch:** `feature/pmcc-leaps-ranked-finders`

## 1. Outcome

TradeEdge must make three different long-call decisions obvious and safe:

| Launcher | Starting state | Finder output | Permitted order proposal |
|---|---|---|---|
| **FIND LEAPS** | No holding required | Ranked standalone long calls | Buy-to-open long call only |
| **FIND NEW PMCC** | No holding required | Ranked complete new long-call + short-call combinations | Two-leg net-debit order only |
| **LEAPS SHORT CALLS** | Exact eligible long call already held | Ranked short calls against that holding | Sell-to-open short call only |

The expanded modal title for **LEAPS SHORT CALLS** is **Find a Short Call for My LEAPS**. Its helper text is: **Rank short calls that can be safely sold against an eligible LEAPS you already own.**

These actions share observations, analytics, policies, and explanations, but they never share or blur order authority.

## 2. Authority and supersession

This ticket supersedes the earlier conversation implementation order that treated one Find PMCC action as both new-pair discovery and held-LEAPS income generation.

It supersedes only the conflicting product-routing and scoring portions of:

- `docs/handoffs/PMCC-CC-LEAPS-Scanner-Implementation-Order.md`
- `docs/tickets/LCC-0001E-scanner-reframing.md`
- `PMCC_SPECIFICATION.md`

It does **not** supersede their account, contract-identity, coverage, lifecycle, reconciliation, review, or fail-closed safeguards. Those requirements remain binding unless this ticket explicitly strengthens them.

`PMCC_SPECIFICATION.md` must be marked superseded by this ticket. Do not leave it appearing concurrently authoritative. Preserve it as historical decision evidence rather than silently deleting it.

## 3. Product invariants

1. Original purchase intent is never an eligibility gate.
2. Any otherwise eligible held long call may support a later short call, regardless of where, when, or why it was purchased.
3. A long call may transition repeatedly between `LONG_ONLY` and `PMCC_ACTIVE`.
4. Buying a LEAPS does not require selling a short call.
5. A new PMCC result is not qualified unless the complete two-leg combination qualifies.
6. A held-LEAPS result never proposes purchasing another long call.
7. A high score can never override a failed qualification gate.
8. Missing, stale, ambiguous, or conflicting required evidence fails closed.
9. No finder automatically submits an order.
10. No workflow recommends a naked short call.

## 4. Existing behavior to preserve

Extend the current shared implementation rather than recreating it. Preserve:

- `lib/scans/pmccChainAdapter.ts` as the chain boundary where valid.
- `lib/scans/pmccPairing.ts` exact contract pairing and rejection evidence.
- Conservative new-pair qualification using long ask and short bid unless a later versioned fill policy explicitly replaces it.
- Net debit must be positive and below strike width for a newly purchased pair.
- Exact OCC identity, underlying, expiration, strike, quantity, and active-account matching.
- Held-long quote, OI, delta, and DTE are informational preferences rather than pretending the existing contract is being repurchased.
- Current quote freshness, spread, market-session, trend, near-miss, exclusion, and incomplete-analysis evidence.
- Short-call-only held-LEAPS order review and two-leg new-PMCC order review as separate routes/contracts.
- Existing campaign, allocation, lifecycle, reconciliation, and immutable original-cost behavior.
- The recent PMCC credit-floor behavior until the canonical policy below explicitly classifies or replaces it.

Do not modify unrelated strategy scoring or portfolio behavior.

## 5. Canonical pipeline

Both LEAPS and PMCC finders must use the same layered decision pipeline:

1. Acquire a timestamped market/account snapshot.
2. Normalize exact contracts and observations.
3. Derive analytics.
4. Apply mandatory qualification gates.
5. Record qualified, excluded, near-miss, and unavailable outcomes.
6. Rank only qualified candidates.
7. Produce deterministic explanations and recommendation labels.
8. Create an immutable proposal only after explicit user selection.
9. Revalidate exact evidence before broker submission.

Keep observation, derivation, qualification, scoring, presentation, and order construction in separate modules. UI components must not independently calculate or upgrade qualification.

## 6. Versioned policy contracts

Introduce independently versioned policy identities for:

- LEAPS qualification
- PMCC pair qualification
- Short-call cadence
- Earnings proximity
- Quote / modeled execution
- Ranking and tie-breaking
- Order revalidation

Every recommendation must retain its policy versions, market snapshot timestamp, account snapshot identity when applicable, and exact OCC symbols.

The same inputs and policy versions must produce the same qualification, score, explanation, and ordering.

## 7. Short-call cadence

Both **FIND NEW PMCC** and **LEAPS SHORT CALLS** support:

| Profile | Target | Normal candidate range |
|---|---:|---:|
| Auto | Compare supported profiles | All supported candidates |
| 7 Day | Approximately 7 DTE | 5–9 DTE |
| 14 Day | Approximately 14 DTE | 10–18 DTE |
| 30–45 Day | Approximately 35 DTE | 25–45 DTE |

Requirements:

- Default to **Auto** and remember the user's last explicit choice.
- A weekly candidate must not fail merely because it is outside the monthly range.
- Auto may inspect otherwise strong 19–24 DTE candidates so arbitrary range gaps do not hide a valid setup.
- Auto first ranks within each cadence, then compares cadence winners using normalized safety, executable return, liquidity, upside participation, gamma/management burden, and transaction frequency.
- Raw or theoretical annualized premium must not dominate Auto ranking.
- Any annualized value is labeled theoretical and not presented as a forecast.

### Cadence-specific delta policy V1

Use absolute call delta. These are recommendation bands, evaluated only after
the contract passes the global hard boundary.

| Profile | Preferred short-call delta |
|---|---:|
| 7 Day | 0.15–0.22 |
| 14 Day | 0.18–0.25 |
| 30–45 Day | 0.20–0.30 |

The global supported boundary is 0.10–0.35. A contract outside that boundary
is excluded from V1 recommendations. A contract inside the global boundary
but outside its cadence preference may remain qualified with a ranking
penalty and explicit tradeoff. Auto applies the preference for the cadence
that produced each candidate; it does not compare every candidate to one
universal target delta.

These values are `short-call-cadence-v1-shadow`. They must be tested on real
candidate distributions before user-facing activation. Changing them later
requires a policy-version change.

## 8. Earnings policy

Replace the fixed “earnings within 35 days” behavior with expiration-relative, trading-session-aware policy:

| Relationship between short expiration and confirmed earnings | Decision |
|---|---|
| Expiration on or after earnings | Fail |
| Fewer than 5 trading sessions before earnings | Fail |
| 5–9 trading sessions before earnings | Caution and ranking penalty |
| At least 10 trading sessions before earnings | Pass without proximity penalty |

If the earnings date is unconfirmed and its estimated window overlaps the short-call life plus the required buffer, return `WAIT` / `UNAVAILABLE`; do not fabricate certainty.

Respect before-market and after-market event timestamps. Add early-assignment evidence for dividend-paying underlyings when short-call extrinsic value and ex-dividend timing make it relevant.

### Earnings evidence states

- **Confirmed:** the provider identifies an actual scheduled date/time and the
  observation belongs to the current market snapshot.
- **Pending / Estimated:** the issuer has not confirmed the event, but a current
  sourced expected date or bounded date range is available. Preserve the source,
  as-of timestamp, and the range rather than collapsing it to false precision.
- **Unknown:** required acquisition attempts failed or no usable confirmed date,
  estimated date, or bounded estimate could be established.
- **Stale:** the event observation predates the current scan's permitted data
  age or conflicts with another current provider observation.
- **Not scheduled:** an authoritative, current observation explicitly reports
  no scheduled earnings event inside the provider's declared coverage horizon.

Confirmed evidence is evaluated against the scheduled event. Pending / Estimated
evidence is evaluated conservatively against the earliest date in its bounded
range. An estimate whose uncertainty window cannot be established, Unknown
evidence, and Stale/conflicting evidence produce `WAIT` / `UNAVAILABLE` for a
new short-call recommendation. Broad-market ETFs and indexes may record earnings
as `NOT_APPLICABLE` under an explicit underlying-classification policy.

`NOT_SCHEDULED` may pass only when the observation also records the provider's
coverage horizon and that horizon extends through short expiration plus the
required buffer. A null date by itself is `UNKNOWN`, never `NOT_SCHEDULED`.

### Earnings acquisition requirement

For a company stock, earnings evidence is required on every new short-call
evaluation and again at submission-time revalidation. A null date from the
existing market-metrics provider is not a completed lookup.

Use a deterministic acquisition cascade:

1. Current confirmed issuer / investor-relations event evidence when available.
2. Current confirmed broker or licensed market-data event evidence.
3. Current sourced consensus estimate or bounded expected-date range.
4. `UNKNOWN` only after the configured sources fail or conflict.

Internet or search results may help locate evidence, but a search-result snippet
or unsourced date cannot become canonical policy input. Store the underlying
source, observed status, as-of timestamp, confirmation state, and coverage
horizon or estimated range.

The product must say **Earnings date pending — estimated [date/range]** when the
issuer has not confirmed the date. It must not say earnings are unknown merely
because confirmation is pending. If no usable evidence can be obtained, show a
specific degraded-data reason and block the short-call recommendation rather
than silently treating the event as absent.

## 9. FIND LEAPS

### Qualification evidence

Evaluate each new long-call candidate using:

- Exact OCC identity and standard deliverable support
- Expiration and DTE
- Strike and delta
- Bid, ask, midpoint, modeled entry, spread, and timestamp
- Open interest and available volume
- Intrinsic and extrinsic value
- Extrinsic value as a percentage of modeled premium
- Breakeven and breakeven percentage above spot
- Capital required and portfolio-allocation impact
- IV / event / trend context supported by available data
- Standalone LEAPS suitability
- PMCC-foundation suitability as a separate assessment

Keep the long-call delta and duration preferences versioned. The current shipped defaults and the older `PMCC_SPECIFICATION.md` conflict; do not silently adopt the older 0.78–0.88 / 270–400 rule. V1 must preserve the currently supported broader universe while shadow output is reviewed. Any tightening is a later policy decision based on real result distributions.

### LEAPS delta and duration policy V1

| Dimension | Supported boundary | Primary recommendation band | Preferred target |
|---|---:|---:|---:|
| Absolute long-call delta | 0.65–0.90 | 0.70–0.90 | 0.75–0.85 |
| DTE | 180–900 | 365–900 | 540–900 |

The supported boundary preserves visibility into the current broader universe
while extending the ceiling to include approximately two-year-plus contracts
such as an 827-DTE expiration. Contracts outside the primary recommendation
band remain inspectable but cannot receive a primary recommendation. The
preferred target affects ranking, not structural eligibility.

For a new PMCC, the long leg must fall inside the primary recommendation band.
For a held long call, these new-entry bands are informational preferences and
must not pretend the contract is being purchased again.

This policy is `leaps-entry-v2-shadow` and requires shadow validation before
activation.

### Outcomes

- `BUY`
- `WATCH`
- `WAIT`
- `REJECT`
- `UNAVAILABLE`

### Primary recommendations

- Recommended LEAPS
- More Conservative
- Lower Capital
- Best PMCC Foundation

The primary result surface contains qualified candidates only. Excluded and unavailable contracts remain inspectable with reasons.

## 10. FIND NEW PMCC

### Search behavior

For each qualified PMCC-foundation long candidate, evaluate compatible short-call candidates from a synchronized market snapshot. Rank complete combinations; never choose the best legs independently and assume their pairing is best.

### Required economics

Calculate at minimum:

- Modeled long debit
- Modeled short credit
- Net debit per share and per contract
- Strike width
- Effective breakeven: `long strike + net debit per share`
- Dollar cushion: `short strike - effective breakeven`
- Cushion percentage using a documented denominator
- Width-minus-debit amount and percentage
- Short credit / net debit
- Short credit / long extrinsic value where defined
- Short-strike OTM percentage
- Long intrinsic and extrinsic composition
- Per-leg and aggregate Greeks where available
- Capital required and allocation impact
- Modeled slippage and fees where available

### Mandatory pair gates

- Both legs individually eligible
- Exact valid OCC identity for both legs
- Long expiration after short expiration
- Long strike below short strike
- Positive net debit
- Net debit below strike width
- Positive policy-minimum dollar and percentage cushion
- Positive combined delta
- Both transacted legs meet quote and liquidity requirements
- Cadence and earnings policies pass
- Capital allocation passes
- Required observations are fresh and mutually consistent

### Cushion policy V1

The existing `net debit < strike width` test remains the structural floor. A
new PMCC primary recommendation must additionally satisfy:

`minimum recommendation cushion per share = max($1.00, 3% of net debit per share)`

Where:

- `cushion per share = strike width - net debit per share`
- `cushion percentage = cushion per share / net debit per share * 100`

A pair with positive cushion that does not reach this recommendation minimum
is a near miss, not a qualified recommendation. This deliberately rejects
examples such as a $0.19 cushion on an approximately $49.81 net debit.

Ranking continues to reward additional cushion rather than treating the
minimum as full marks. This policy is `pmcc-cushion-v1-shadow`; shadow evidence
must report how many otherwise-valid pairs it excludes before activation.

### Existing PMCC credit-floor resolution

The existing short-credit-as-percentage-of-width control remains a
user-adjustable post-qualification filter and comparison preference. It is not
a mandatory safety gate and cannot upgrade an unqualified pair. Preserve the
current choices and saved preference during migration. Canonical ranking uses
short-call premium quality as one component without requiring the user to set
a credit floor.

Do not claim that width-minus-debit guarantees profit. Clearly explain early assignment, slippage, changing long-leg extrinsic value, and lifecycle effects.

### Outcomes

Show only complete qualified combinations as PMCC recommendations. If none qualifies:

> No qualified new PMCC setup is available right now.

The experience may offer **View Qualified Standalone LEAPS**, but must not label a long call by itself as a PMCC.

## 11. LEAPS SHORT CALLS

### Discovery

Begin from the canonical current active-account snapshot. Evaluate every eligible standalone long call regardless of original purchase intent or TradeEdge provenance.

The Opportunity Universe may not create eligibility. The user may narrow verified holdings but may not add an unverified foundation by typing a ticker.

### Held-foundation behavior

- Bind every result to the exact account, position key, OCC symbol, underlying, expiration, strike, and available quantity.
- Search only for a new short call.
- Existing or working short calls reduce available coverage.
- A held long outside new-entry preferences may still support a safe short call; disclose the variance rather than pretending it is being bought again.
- Ambiguous structures, adjusted contracts without supported deliverables, stale holdings, wrong-account contracts, insufficient quantity, or unresolved allocations fail closed.
- The only permitted order proposal is sell-to-open short call against the verified foundation.

The held long call must expire after the proposed short call. V1 classifies
remaining runway as follows:

- 90 or more calendar days beyond short expiration: preferred
- 30–89 calendar days beyond short expiration: caution and ranking penalty
- Fewer than 30 calendar days beyond short expiration: fail

This is a short-call-entry safety policy, not a retroactive judgment about the
original LEAPS purchase.

### Lifecycle

- Adding the first active short call transitions `LONG_ONLY` to `PMCC_ACTIVE`.
- Closing, expiring, or validly rolling the short call updates the campaign without changing original LEAPS cost.
- When no short call remains, the position returns to `LONG_ONLY`.
- Assignment, exercise ambiguity, missing execution evidence, or snapshot/history conflict produces `RECONCILIATION_REQUIRED`.

## 12. Qualification versus ranking

Qualification runs first. Ranking cannot compensate for a failed gate.

Reconcile the shipped ROI-heavy `pmccScore.ts`, `pmccBestFit.ts`, and root `PMCC_SPECIFICATION.md` behind one canonical scoring service. Do not leave multiple components independently claiming to provide the definitive PMCC score.

### Best Overall V1 dimensions

Use these approved dimensions for shadow-mode comparison:

| Dimension | Weight |
|---|---:|
| Safety and breakeven cushion | 30% |
| Liquidity and execution quality | 20% |
| LEAPS quality and downside protection | 15% |
| Capital efficiency | 15% |
| Short-call premium quality | 10% |
| Upside participation | 10% |

The weights are versioned V1 policy, not universal investing truth. Expose component scores and evidence.

Specialized recommendations are separate ranking objectives:

- Recommended
- More Conservative
- More Upside Room
- Lower Capital
- Higher Premium

Preserve the useful intent of current Balanced / Income / Upside logic, but route it through the canonical service and final labels. Do not use separate qualification rules for each label.

### Tie-breaking

Resolve exact score ties by:

1. Greater safety cushion
2. Better worst-leg liquidity
3. Lower modeled slippage
4. Lower LEAPS extrinsic burden
5. Lower capital requirement
6. Stable OCC-symbol order

## 13. Explanations and UX

Primary result surfaces initially show:

- Recommended
- More Conservative
- More Upside Room

Each result explains:

- Capital required
- Modeled premium
- Effective breakeven
- Dollar and percentage cushion
- Upside to short strike
- Combined delta where available
- Why it qualified
- Principal advantage
- Principal tradeoff
- Market-data timestamp and policy version

Provide progressive access to all qualified candidates, calculation details, exclusions, scenario analysis, and assumptions.

When no candidate qualifies, say so plainly and summarize the dominant exclusion reasons. Never relax policy to populate the screen.

## 14. Scenario analysis

For complete PMCC combinations, model standardized underlying outcomes at short-call expiration:

- Material decline
- Moderate decline
- Flat
- Moderate increase
- Approaches short strike
- Above short strike
- Sharp increase through short strike

Show modeled combined value, remaining long-call value and extrinsic value, short-call state, and likely management requirement. Label all projections as estimates.

Scenario analysis is explanatory and cannot upgrade qualification.

### Scenario valuation boundary

Do not invent a theoretical option-pricing model in this ticket. Phase 1 may
show deterministic structure facts and intrinsic-value floors, but it must not
present a future LEAPS mark as though it were known.

A modeled future option value requires a separately versioned valuation
contract that declares, at minimum, pricing model, volatility assumption,
interest-rate input, dividend input, valuation timestamp, and behavior when
any input is unavailable. Until that contract is implemented and approved,
show future LEAPS value as **Unavailable — valuation model not approved**.

Unavailable scenario valuation is non-blocking for structural qualification;
it blocks only claims that depend on the missing projection. Scenario-model
implementation is a later gated phase and cannot delay the core qualified
finder unless the team separately promotes it to a release requirement.

## 15. Accounting and campaign integrity

- Original LEAPS acquisition cost is immutable.
- Current LEAPS P&L, current short-call P&L, realized PMCC income, current full-exit P&L, and lifetime campaign P&L remain separate.
- Historical short-call income is excluded from current-exit P&L.
- Properly attributed realized short-call income is included in lifetime campaign P&L.
- Canonical Trade Log attribution is reused.
- Campaign identity persists across short-call cycles and rolls.
- No silent reassignment occurs when multiple foundations or quantities exist.

## 16. Cache and session migration

Introduce distinct internal workflow identities for:

- Standalone LEAPS discovery
- New PMCC pair discovery
- Held-LEAPS short-call discovery

Do not reuse one `requestedStrategy: 'pmcc'` value where doing so would allow a cached held-position session to restore into a new-pair workflow or vice versa.

Version or invalidate affected local/session caches. A mismatched or legacy record must be rejected with a concise rescan notice, not coerced into the new shape.

Preserve old history records unless their identity is actually ambiguous; route ambiguous history to reconciliation.

Use these canonical workflow identities:

- `leaps`
- `new-pmcc`
- `leaps-short-call`

The existing ambiguous `requestedStrategy: 'pmcc'` cache/session identity must
not be silently mapped to either new workflow. Invalidate it for finder-session
restore and present a rescan notice. This affects transient finder/session
caches only; it must not delete PMCC campaign, Trade Log, position, or broker
history.

Introduce V2 cache keys/schemas for both PMCC workflows. Validation must reject
wrong-workflow payloads even when their other fields happen to be structurally
compatible.

## 17. Order review and revalidation

Selection creates an immutable proposal containing:

- Workflow identity
- Active account where applicable
- Quantity
- Exact OCC contract(s)
- Actions and sides
- Expirations and strikes
- Market-data snapshot
- Modeled prices
- Policy versions
- Qualification evidence

Before submission, re-fetch and revalidate contract identity, quotes, spreads, account allocation, coverage, earnings/event status, net debit/cushion, and qualification.

If the refreshed proposal no longer qualifies, block transmission and return it to review. Never silently substitute a strike, expiration, contract, foundation, or account.

## 18. Testing

Add or update unit, integration, and UI tests for:

- Three distinct launcher routes and labels
- Permitted order-leg shapes per workflow
- Original intent not gating a held LEAPS
- `LONG_ONLY` ↔ `PMCC_ACTIVE` lifecycle transitions
- Exact-account/OCC/quantity coverage
- Multiple held long calls and partial available quantities
- All cadence profiles and Auto comparison
- 19–24 DTE gap handling
- Earnings trading-session boundaries and unknown-date behavior
- Conservative execution inputs
- Net debit, breakeven, width, cushion, return, and aggregate Greeks
- Zero cushion, one-cent boundary, and percentage-cushion failure
- Missing, stale, crossed, zero-bid, delayed, and wide quotes
- Adjusted/nonstandard contracts
- No qualifying LEAPS
- No qualifying new PMCC
- Qualified held LEAPS with short-call `WAIT`
- Independently attractive legs forming an unqualified pair
- Deterministic scoring and tie-breaking
- Policy-version reproducibility
- Cache/session migration and invalidation
- Submission-time revalidation and race failure
- Existing held-LEAPS short-only order safety
- Existing new-PMCC two-leg order safety
- Unrelated strategy and portfolio regressions

Add explicit boundary tests for the shadow policies introduced by this
revision:

- 0.64 / 0.65 / 0.70 / 0.75 / 0.85 / 0.90 / 0.91 long delta
- 179 / 180 / 364 / 365 / 539 / 540 / 900 / 901 long DTE
- Every cadence delta and DTE boundary
- Cushion immediately below, equal to, and above both `$1.00` and `3% of net debit`
- Held-long runway of 29 / 30 / 89 / 90 days beyond short expiration
- Confirmed, Estimated, Unknown, Stale, and `NOT_APPLICABLE` earnings evidence
- Legacy `pmcc` session rejection and V2 cross-workflow cache rejection

## 19. Delivery sequence

1. Record repository audit and data-availability findings.
2. Mark the conflicting root PMCC specification superseded.
3. Freeze shared types and versioned policy contracts.
4. Split internal workflow/session identities and migration behavior.
5. Preserve and rename the existing held-LEAPS workflow to **LEAPS SHORT CALLS**.
6. Build **FIND NEW PMCC** using the shared complete-pair engine.
7. Upgrade **FIND LEAPS** qualification and ranking output.
8. Consolidate qualification and canonical ranking services.
9. Add explanations and scenario evidence.
10. Complete targeted tests, type-check, full tests, build, and `git diff --check`.
11. Produce shadow output comparing old and new PMCC ranking on representative fixtures.
12. Enable user-facing ranked results only after Ian, Diane, Quinn, and Paul review shadow evidence.
13. Enable order-review handoff only after all prior gates pass.

No unattended execution is authorized.

### Reviewable implementation packages

Do not deliver this as one indivisible change. Use the following review gates:

1. **Package A — contracts and policies:** workflow identities, cache schemas,
   cadence, earnings, LEAPS, cushion, and ranking policy modules with unit
   tests; no launcher activation.
2. **Package B — held workflow preservation:** rename current held finder to
   **LEAPS SHORT CALLS**, migrate its session identity, preserve short-only
   order authority, and run regression tests.
3. **Package C — new PMCC discovery:** add **FIND NEW PMCC**, complete-pair
   search, qualification, exclusions, and two-leg review proposal behind a
   disabled-by-default feature flag.
4. **Package D — canonical ranking and shadow output:** consolidate legacy
   scoring consumers, generate old/new comparison fixtures, and obtain Ian /
   Quinn review.
5. **Package E — recommendation UX:** primary recommendation cards,
   explanations, cadence selection, no-result states, and Diane review.
6. **Package F — final handoff:** submission-time revalidation, full regression
   suite, build, and Paul acceptance before feature-flag activation.

Scenario valuation beyond deterministic structure facts remains outside these
packages until its separate model contract is approved.

## 20. Required implementation report

Dane must return:

- Files changed
- Architecture and existing services reused
- Workflow/session migration performed
- Policy names, versions, gates, weights, and tie-breakers introduced
- Data availability and limitations
- Calculations and explanations added
- UX behavior for all three launchers
- Tests added and exact results
- Shadow-validation fixtures and old/new comparison
- Remaining risks or explicitly deferred work
- Confirmation that no unrelated functionality changed

## 21. Stop conditions

Dane may resolve ordinary technical details within this contract. Stop and return to the team before implementation when a decision would materially change:

- User-visible workflow or naming
- Qualification methodology or safety boundary
- Account/coverage authority
- Order-leg authority
- Accounting or lifecycle meaning
- Data-provider cost or availability
- Scope or rollout risk

Otherwise proceed through implementation and validation without reopening settled product decisions.

## 22. Final cross-functional review record

**Review date:** 2026-09-11
**Gate owner:** Frank

### Ian — methodology

Approved the shadow-policy values for implementation and measurement:

- Cadence-specific delta bands
- 180–900 supported LEAPS DTE with 365–900 primary recommendation band
- 0.65–0.90 supported long delta with 0.75–0.85 preferred target
- Recommendation cushion of `max($1.00, 3% of net debit per share)`
- Credit floor as a user filter / ranking preference, not a safety gate
- Expiration-relative earnings policy
- Held-long runway classifications

These are approved for versioned shadow evaluation. User-facing activation
still requires the Package D evidence review specified above; Dane may not
silently tune them from observed results.

### Diane — experience

Approved:

- **FIND LEAPS**
- **FIND NEW PMCC**
- **LEAPS SHORT CALLS**
- Expanded held-flow title and helper text
- Three primary recommendation cards
- Secondary standalone-LEAPS link when no new PMCC qualifies
- Progressive disclosure of calculations and exclusions

The secondary link must not visually imply that a standalone LEAPS satisfies a
PMCC request.

### Quinn — architecture and QA

Approved the identities, invariants, cache invalidation, failure-state model,
boundary matrix, and package gates. The earnings evidence taxonomy is resolved
by distinguishing Confirmed, Pending / Estimated, `NOT_SCHEDULED`, and
null/`UNKNOWN` evidence. A bounded pending estimate uses its earliest possible
date; `NOT_SCHEDULED` requires an explicit provider coverage horizon before it
can pass.

Scenario valuation remains non-blocking and unavailable until a separately
approved valuation contract exists. Mechanical structure facts may still be
shown.

### Dane — feasibility

Confirmed Package A is feasible using pure, versioned modules and tests. The
current `LauncherStrategyId`, scan-session schema, cache validators, PMCC DTE
configuration, decision gates, scoring modules, and server trade-review
criteria are known integration points.

No UI activation, cache migration, broker-order change, or speculative pricing
model is authorized in Package A. Data availability is represented explicitly
in policy evidence rather than hidden behind defaults.

### Paul — product acceptance

Accepted the three-workflow scope, current naming, phased delivery, shadow-only
status of new methodology, and separation of qualification from ranking.

### Frank — gate disposition

All objections required to begin the foundation are resolved. **Package A is
authorized.** Packages B–F remain unauthorized until Package A returns:

- Shared workflow and policy contracts
- Unit and boundary tests
- Cache-version design (without migration activation)
- Data-availability report
- No production launcher or order-path behavior change

Frank will route the Package A report to Ian, Diane, Quinn, Dane, and Paul for
review before opening Package B.

## 23. Package A review disposition

The 2026-09-11 cross-functional review approved the Package A direction with
conditions. Frank held Package B pending the contained corrections specified in
`docs/tickets/PMCC-0003A-package-a-correction-order.md`. That addendum is the
authoritative work order for closing Package A. It does not authorize Package B
or any user-visible activation.
