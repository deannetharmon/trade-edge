# PMCC-0003 — Qualified Ranked LEAPS and PMCC Finders

**Owner:** Paul (product policy and acceptance)  
**Methodology:** Ian  
**UX:** Diane  
**Architecture / QA:** Quinn  
**Implementation:** Dane  
**Review facilitation:** Frank  
**Status:** Approved implementation order  
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
