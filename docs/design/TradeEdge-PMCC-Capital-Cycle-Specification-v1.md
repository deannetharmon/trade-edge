# TradeEdge PMCC Capital Cycle Specification v1

**Status:** PRE-IMPLEMENTATION DESIGN — NO IMPLEMENTATION AUTHORIZED  
**Design checkpoint:** 2026-08-09  
**Implementation owner:** Dane — **HOLD**  
**Next gate:** Henry methodology verification + portfolio policy calibration + repository contract audit + formal wireframe/QA review

---

## 1. Purpose of this document

This document is the authoritative recovery point for the PMCC/LEAPS product-design work completed before implementation. It records what is **FROZEN**, what is a **WORKING / TO VERIFY** interpretation of Henry's methodology, and what remains **OPEN**.

The intent is to prevent future conversations or implementation work from reconstructing, simplifying, or silently changing decisions made during design.

### Decision-state vocabulary

- **FROZEN** — approved product/design direction. Do not change during implementation without reopening the design decision.
- **WORKING / TO VERIFY** — supported by current discussion/source observations but requires source-level verification before becoming canonical strategy policy.
- **OPEN** — intentionally unresolved. Dane must not invent the answer.

---

## 2. Product definition — FROZEN

> **TradeEdge PMCC Capital Cycle uses a proven PMCC/LEAPS methodology to deploy limited capital into approved companies using long-dated calls as capital-efficient ownership substitutes, opportunistically harvest short-call income, actively manage both legs through their lifecycle, realize gains according to validated exit rules, and recycle capital into the next best portfolio opportunity.**

This is not merely a LEAPS screener and not merely PMCC trade discovery.

The user's primary purpose for acquiring a LEAP is to create capital-efficient long exposure that can support repeated short-call income through a Poor Man's Covered Call (PMCC) lifecycle. A long-only LEAP remains a valid state when the methodology says that selling a short call is unattractive.

### Core product principle — FROZEN

> **A TradeEdge recommendation is a function of trade quality, portfolio fit, and capital efficiency.**

These dimensions are evaluated using observable facts and approved policy. They are **not** collapsed into an opaque synthetic score.

---

## 3. Product philosophy — FROZEN

### 3.1 Proven strategy first

TradeEdge starts from a proven external methodology rather than allowing AI to invent a trading strategy.

Henry's demonstrated PMCC/LEAPS methodology is the initial reference baseline for this work. TradeEdge must distinguish sourced methodology from TradeEdge-specific portfolio policy and from later evidence-based optimization.

### 3.2 Policy once, execute repeatedly

Slow-moving investment decisions should be made deliberately and inherited by frequent transactions.

Examples:

- Approved Ownership Universe: reviewed periodically, not rediscovered during every trade.
- PMCC Strategy Policy: versioned methodology.
- Portfolio Policy: versioned capital/concentration constraints.
- Individual deployment: fast transaction using those approved policies.

### 3.3 Complexity on demand

KISS means simple decision-making, not hidden analysis.

The user experience has three trust levels:

1. **DECIDE** — tell the user what TradeEdge recommends.
2. **VERIFY** — show the material evidence and policy checks.
3. **AUDIT** — show exactly how the recommendation was produced, including rejected alternatives and provenance.

### 3.4 Explicit WAIT/HOLD is a valid outcome

TradeEdge must never manufacture a trade merely because an eligible contract exists.

Examples:

- Approved company + poor entry timing → **WAIT**.
- Qualified long leg + unattractive short-call opportunity → **LONG ONLY / WAIT TO WRITE**.
- Existing short call + roll conditions not met → **HOLD SHORT**.
- Long leg + exit conditions not met → **HOLD LONG**.

---

## 4. PMCC Capital Cycle lifecycle — FROZEN

Canonical lifecycle:

```text
APPROVED OWNERSHIP UNIVERSE
           |
           v
   EVALUATE ENTRY TIMING
           |
      +----+-----+
      |          |
     WAIT     FAVORABLE
                 |
                 v
       EVALUATE LONG LEG
                 |
            +----+----+
            |         |
           WAIT    QUALIFIED
                      |
                      v
           PORTFOLIO FEASIBILITY
                      |
                 +----+----+
                 |         |
                WAIT    FEASIBLE
                           |
                           v
                   ESTABLISH LONG
                           |
                           v
                 EVALUATE SHORT CALL
                           |
                   +-------+-------+
                   |               |
                  WAIT            WRITE
                   |               |
                   v               v
               LONG ONLY       PMCC ACTIVE
                   |               |
                   +-------+-------+
                           |
                           v
                     MANAGE CYCLE
                           |
              +------------+------------+
              |            |            |
           HOLD LONG    MANAGE SHORT   EXIT TRIGGER
                           |
                     CLOSE / ROLL
                           |
                           v
                    LONG EXIT READY
                           |
                  SHORT-CALL-SAFE EXIT
                           |
                           v
                      REALIZE GAIN
                           |
                           v
                     RECYCLE CAPITAL
                           |
                           v
                  PORTFOLIO CONSTRUCTOR
                           |
                           +----> NEXT CYCLE
```

### Canonical conceptual states

1. **CANDIDATE** — approved underlying being evaluated.
2. **READY TO ESTABLISH** — qualifying long implementation and portfolio feasibility exist.
3. **LONG ONLY** — long leg exists; short call is intentionally absent.
4. **PMCC ACTIVE** — long leg and active short call exist.
5. **SHORT CLOSED** — long remains; prior short economics remain attached to strategy history.
6. **LONG EXIT READY** — validated long-leg exit condition has triggered; exit sequence must remain short-call safe.
7. **CYCLE COMPLETE** — long and short obligations closed; realized economics captured and capital becomes eligible for redeployment.

---

## 5. General lifecycle decision model — FROZEN

Every material lifecycle action evaluates three separate concerns:

1. **Eligibility** — is this action allowed/appropriate for the current strategy state?
2. **Timing** — does the adopted methodology say to act now?
3. **Implementation selection** — if action is warranted, which contract/action implements it?

This model applies to:

- Long-leg entry.
- Short-call write timing.
- Short-call close/roll timing.
- Long-leg exit/reset timing.

The applicable evidence can differ by lifecycle action.

---

## 6. Approved Ownership Universe — FROZEN

PMCC transaction execution does not rediscover the stock universe.

A new position must originate from the **Approved Ownership Universe**, a persistent/versioned set of companies the user is willing to own or hold long-term exposure to.

Universe exploration is a separate, slow-moving exercise, expected to occur periodically (for example, roughly quarterly), not as part of each transaction.

Henry's example companies discussed as useful validation/test cases include:

- MSFT
- AMZN
- MCD
- CMG
- NVTS

These are benchmark/test candidates, not hard-coded TradeEdge recommendations.

---

## 7. Entry Timing — FROZEN ARCHITECTURE; EXACT RULES TO VERIFY

A good company and a good long option are not sufficient to make a new PMCC position actionable.

TradeEdge must separately determine whether **now is a favorable time to establish the long position**.

### Bollinger Bands

Henry places meaningful emphasis on the underlying's position within Bollinger Bands when evaluating LEAPS entry timing.

TradeEdge should compute Bollinger evidence deterministically from canonical historical price data rather than asking AI to visually interpret a chart.

Potential canonical evidence includes:

- Current underlying price.
- Middle band / moving average.
- Upper band.
- Lower band.
- Band width.
- Price position within the band.
- Normalized %B if useful to the validated methodology.
- Indicator parameters/version.
- Data timestamp and sufficiency.

### Entry Timing output

At minimum:

- **FAVORABLE**
- **WAIT**
- **UNAVAILABLE**

### TO VERIFY from Henry

- Bollinger parameters.
- Preferred entry region.
- Exact conditions producing WAIT.
- Whether %B or visual/relative band position is used.
- Other indicators combined with Bollinger position.
- Whether entry rules differ for a new long leg versus replacement/re-entry.

TradeEdge must not invent a rule such as "below the middle band = buy" without methodology support.

---

## 8. Long-leg strategy — WORKING / TO VERIFY

### 8.1 Role of the long leg — FROZEN

The long call is a capital-efficient synthetic ownership foundation for the PMCC lifecycle, not an asset expected to be held to expiration.

### 8.2 Delta — WORKING / TO VERIFY

Henry's examples indicate a target of approximately **0.70 delta** for the long leg.

Earlier design assumptions around >=0.80 delta are **RETRACTED**.

Still to verify whether 0.70 is:

- a target,
- a floor,
- a preferred band,
- or a situational guideline.

The domain model must distinguish:

- hard minimum/maximum,
- target,
- permitted target override range,
- preference/tie-break behavior.

### 8.3 DTE — WORKING / TO VERIFY

Henry has demonstrated long positions including approximately nine-month durations. Current working envelope is roughly **9–24 months**, but exact selection preferences and boundaries require source verification.

TradeEdge must not artificially prefer 18–24 months merely because they are longer.

### 8.4 Other long-leg evidence

The validated policy is expected to consider, as applicable:

- Deep ITM status/moneyness.
- Bid/ask and valid two-sided market.
- Liquidity.
- Open interest.
- Volume.
- Implied volatility.
- Greeks.
- Intrinsic value.
- Extrinsic value.
- Breakeven.
- Estimated debit.
- Capital required / maximum loss.
- Delta-adjusted share equivalents.
- Delta-adjusted underlying exposure.

No arbitrary threshold is authorized merely because a metric exists.

### 8.5 Long-leg evaluation states — FROZEN

Each evaluated contract must resolve to:

- **QUALIFIED**
- **NOT QUALIFIED** with exact reasons
- **UNAVAILABLE** with missing/invalid evidence

---

## 9. Delta override — FROZEN ARCHITECTURE; RANGE OPEN

Delta is the only proposed R1 strategy-target override.

Normal workflow uses the approved strategy target.

An advanced transaction control may allow the user to choose another delta target **within validated boundaries**.

Requirements:

- Override does not mutate Strategy Policy.
- Effective target and provenance are recorded.
- Recommendation is completely reconstructed using the override.
- User does not manually become the contract selector.
- Recommendation clearly identifies that a custom target was used.
- Hard strategy and portfolio constraints remain non-overridable in the transaction workflow.
- Outside-policy values should not be casually treated as strategy compliant.

Where useful, TradeEdge may factually compare the standard and overridden constructions without declaring one superior unless policy/evidence supports that conclusion.

---

## 10. Short-call income overlay — FROZEN ARCHITECTURE; EXACT RULES TO VERIFY

The purpose of the long leg is normally to support a PMCC income lifecycle. However, TradeEdge must not force a short call merely because the long leg exists.

Possible states after establishing the long leg:

- **WRITE** — current short-call opportunity satisfies the adopted methodology.
- **WAIT** — retain uncapped long exposure because no acceptable short-call opportunity exists.
- **UNAVAILABLE** — required evidence is missing/invalid.

### TO VERIFY from Henry

- Short-call DTE selection.
- Short-call delta/strike selection.
- Premium requirements.
- Liquidity requirements.
- Technical/timing evidence used before writing.
- Whether Bollinger position participates in short-call timing.
- Profit-taking rules.
- Roll rules.
- Close rules.
- Assignment/ITM handling.

---

## 11. Roll / close timing — FROZEN ARCHITECTURE; EXACT RULES TO VERIFY

Roll timing is its own lifecycle decision, not a side effect of a short call moving against the position.

Potential evidence may include, only where supported by the adopted methodology:

- Short-call P/L.
- Short-call delta.
- ITM/OTM status.
- Remaining DTE.
- Remaining extrinsic value.
- Underlying price movement/technical state.
- Replacement-call availability.
- Net roll credit/debit.
- Strike and expiration relationship.

Outputs include:

- **HOLD SHORT**
- **TAKE PROFIT / CLOSE**
- **ROLL**
- **UNAVAILABLE**

Exact triggers remain OPEN pending Henry methodology extraction.

---

## 12. Long-leg exit/reset timing — FROZEN ARCHITECTURE; EXACT RULES TO VERIFY

The long LEAP is expected to have an intentional profit-taking/recycling lifecycle rather than being held to expiration by default.

Dean recalls Henry discussing long-leg profit realization in the approximate **30% / 40% / 50%** range. Those numbers are **NOT YET POLICY**.

TradeEdge must verify:

- Exact profit target/range.
- Whether target varies by conditions.
- Exact return calculation used for the trigger.
- Whether short-call income participates in the trigger calculation.
- Time-based/remaining-DTE exit rules.
- Technical exit conditions, if any.
- What happens when the long exit trigger occurs while a short call remains open.
- Re-entry/replacement behavior.

### FROZEN lifecycle principle

> Long legs have an intentional profit-taking/exit lifecycle and capital is recycled after a completed cycle.

---

## 13. Strategy timing framework — FROZEN

TradeEdge must explicitly support four timing decisions:

| Timing decision | Question | Typical outputs |
|---|---|---|
| Entry timing | Is now a good time to establish the long LEAP? | ENTER / WAIT |
| Short-call timing | Is now a good time to sell a call? | WRITE / WAIT |
| Roll/close timing | Should the active short call be managed now? | HOLD / CLOSE / ROLL |
| Long exit timing | Should the long LEAP be realized/reset now? | HOLD / EXIT |

Each timing decision uses its own validated evidence and rules.

Bollinger position is one possible evidence input wherever Henry actually uses it; it is not a universal timing rule by itself.

---

## 14. Portfolio Fit — FROZEN ARCHITECTURE; NUMERIC POLICY OPEN

A strategy-qualified opportunity must separately pass portfolio feasibility.

Potential Portfolio Policy constraints include:

- Maximum strategy capital authorization.
- Maximum capital at risk per position.
- Maximum same-underlying capital at risk.
- Maximum same-underlying delta-adjusted exposure.
- Required reserve, if configured.

### One-contract granularity — FROZEN

Standard equity option contracts are indivisible at the one-contract level. Portfolio policy must account for this rather than assuming continuously divisible position sizing.

If the minimum qualifying one-contract position violates portfolio policy, the result is **NOT FEASIBLE**. TradeEdge must not weaken the strategy to manufacture a cheaper trade.

### Capital risk vs exposure — FROZEN

Keep separate:

- Capital committed.
- Maximum loss.
- Delta-adjusted exposure.

Do not collapse them into a misleading synthetic "risk exposure" value.

### Stress evidence — FROZEN

Portfolio Policy calibration should show consequences such as:

- Largest LEAP goes to zero.
- Two largest LEAPS go to zero.

These are stress evidence, not automatically hard policy rules.

### Portfolio numeric calibration — OPEN

Initial limits must be calibrated using realistic one-contract economics for the approximately $50,000 active-options use case rather than selecting aesthetically pleasing percentages.

---

## 15. Capital Efficiency — FROZEN

Capital efficiency is observable economics, not an opaque score.

Useful facts include:

- Long-leg debit.
- Initial short-call credit, if applicable.
- Net capital committed.
- Maximum loss.
- Delta-adjusted exposure.
- Delta-adjusted shares.
- Cost of 100 shares.
- Capital not required versus purchasing 100 shares.
- Exposure acquired per dollar of capital, if shown as a factual ratio.
- Remaining deployable capital.

TradeEdge must not label a ratio GOOD/BAD without an adopted methodology supporting that interpretation.

---

## 16. Portfolio Constructor — FROZEN FOR R1 VALIDATION

Primary rule:

> Preserve the preference ordering produced by the validated strategy while satisfying all hard portfolio constraints and capital authorization.

Requirements:

- Evaluate feasible portfolio combinations.
- Do not weaken strategy rules merely to deploy more capital.
- Do not select inferior qualifying investments solely to consume authorized capital.
- Candidate strategy priority dominates.
- Where strategy preference cannot distinguish alternatives, deterministic diversification and capital-utilization tie-breaks may be used.
- No weighted synthetic optimization.
- No AI portfolio selection.
- Partial deployment is valid.
- Zero deployment is valid.

This policy is subject to Shadow Validation before live-money automation.

---

## 17. Stock replacement comparison — FROZEN

The verification layer should make the economics of the long call versus 100 shares understandable.

Comparison should include, where applicable:

- Capital required.
- Maximum loss.
- Initial delta-adjusted shares/exposure.
- Expiration.
- Breakeven at expiration.
- Extrinsic value paid.
- Dividend rights.

The comparison must also disclose relevant LEAPS tradeoffs, including:

- Expiration risk.
- Time decay.
- No dividend ownership.
- Changing delta.
- Liquidity/spread cost.
- Possibility of 100% loss of premium.

This section explains economics; it is not promotional copy.

---

## 18. PMCC accounting and strategy lineage — FROZEN

TradeEdge must preserve the complete strategy story across the long leg and successive short calls.

At minimum track separately:

- Original long-leg debit.
- Current long-leg value.
- Long-leg unrealized/realized P&L.
- Short-call history.
- Active short-call P&L.
- Cumulative realized short premium.
- Combined strategy economics.
- Original capital committed.
- Holding period.
- Completed-cycle return metrics.

### Immutable transaction truth

Original transaction economics remain immutable.

If the adopted methodology uses an adjusted economic basis, it is a derived metric. Do not overwrite historical acquisition cost.

### Strategy instance — conceptual contract

A canonical `PmccStrategyInstance` should be capable of owning:

- strategyInstanceId
- underlying
- ownershipUniverseVersion
- entryStrategyPolicyVersion
- portfolioPolicyVersion
- lifecycleState
- longLeg
- shortCallHistory[]
- activeShortCall?
- originalCapitalCommitted
- cumulativeShortPremiumRealized
- realizedLongPnl
- unrealizedLongPnl
- combinedStrategyEconomics
- currentRecommendedAction
- actionEvidence
- exitStatus
- parent/successor cycle lineage where appropriate

Exact repository implementation is subject to the architecture audit.

---

## 19. Progressive evidence UX — FROZEN

### Level 1 — DECIDE

Primary recommendation should be concise and show essential facts only.

Example information:

- Underlying.
- PMCC / Long Only state.
- Long contract.
- Delta.
- DTE.
- Capital.
- Delta-adjusted exposure.
- Portfolio fit.
- Entry-timing status.
- Short-call status.
- Current recommended action.

Primary actions:

- **View Analysis**
- **Adjust**
- **Review Deployment Plan**

### Level 2 — VERIFY

The Investment Analysis view should expose material evidence, including:

- Underlying facts.
- Entry timing / Bollinger evidence.
- Long contract.
- Short contract when applicable.
- Greeks.
- Liquidity.
- Intrinsic/extrinsic value.
- Breakeven.
- Capital/max loss.
- Stock-versus-LEAP comparison.
- Delta-adjusted exposure.
- Portfolio impact.
- PMCC combined economics.
- Strategy tradeoffs.

For any metric participating in a rule:

> **Observed value → Applicable rule → PASS / FAIL / UNAVAILABLE**

### Level 3 — AUDIT

`Why this contract?` should expose:

- Contracts evaluated.
- Rejection reasons/counts.
- Qualifying alternatives.
- Selection methodology.
- Market timestamp.
- Strategy version.
- Portfolio-policy version.
- Ownership-universe version.
- Data provenance.

Qualification records should not be discarded merely because a contract lost selection.

### UX principle

> No material fact used to select or reject a position may exist only inside an opaque score or inaccessible backend calculation.

---

## 20. Operating UX — FROZEN CONCEPTUALLY

Once positions exist, the portfolio experience should emphasize lifecycle state and action rather than force repeated deep analysis.

Representative states/actions:

- **PMCC ACTIVE — HOLD**
- **LONG ONLY — WAIT TO WRITE**
- **SHORT — TAKE PROFIT**
- **SHORT — ROLL**
- **LONG — EXIT / RESET**

The detailed evidence remains available on demand.

TradeEdge should make it easy to answer:

> **What is my capital doing, and what requires attention?**

---

## 21. Recommendation provenance and freshness — FROZEN

Every recommendation is an immutable, reproducible snapshot tied to canonical inputs.

At minimum retain:

- Market snapshot.
- Portfolio snapshot.
- Ownership Universe version.
- PMCC/LEAPS Strategy Policy version.
- Portfolio Policy version.
- Capital authorization.
- Transaction-specific overrides and their provenance.

A stale recommendation must be **reconstructed** against current canonical inputs, not cosmetically repriced.

The execution-ready plan must visibly identify whether market/portfolio snapshots remain current enough to rely on.

---

## 22. Strategy optimization governance — FROZEN

TradeEdge is allowed to learn, but not to silently rewrite the strategy.

> **TradeEdge may discover and recommend strategy improvements. It may not silently adopt them.**

Long-term process:

> Proven methodology → adopted baseline → TradeEdge measurement → evidence → AI-assisted insight → proposed optimization → user decision → versioned policy change.

AI/deterministic analytics may eventually identify evidence concerning tunable parameters such as:

- Long-leg delta.
- Preferred duration.
- Short-call delta.
- Short-call DTE.
- Profit-taking thresholds.
- Rolling behavior.
- Entry conditions.

An optimization recommendation must expose evidence such as, where applicable:

- Sample size.
- Time period.
- Relevant market context/regime.
- Performance difference.
- Capital usage difference.
- Drawdown/loss characteristics.
- Comparison quality/confounders.

Avoid opaque "AI confidence" as a substitute for evidence.

The user may:

- Reject the proposal.
- Apply it once as an allowed transaction override.
- Explicitly adopt it as a new Strategy Policy version.

No silent self-modification.

---

## 23. Canonical conceptual architecture — FROZEN DIRECTION; REPOSITORY MAPPING REQUIRED

Conceptual objects/capabilities include:

### `ApprovedOwnershipUniverse`
Persistent/versioned eligible ownership underlyings.

### `PmccStrategyPolicy` / `LeapsStrategyPolicy`
Versioned strategy truth and provenance.

### `PortfolioAllocationPolicy`
Versioned portfolio constraints and allocation policy.

### `TechnicalEntryEvidence`
Canonical deterministic technical/timing evidence, including Bollinger calculations where required.

### `PmccEntryTimingEvaluation`
Entry timing result such as FAVORABLE / WAIT / UNAVAILABLE with evidence.

### `LeapsContractEvaluation`
Canonical market facts, derived economics, rule outcomes, and overall QUALIFIED / NOT_QUALIFIED / UNAVAILABLE state.

### `LeapsUnderlyingEvaluation`
All evaluated contracts for an underlying plus selected contract where applicable.

### `PortfolioFeasibilityEvaluation`
FEASIBLE / NOT_FEASIBLE plus exact reasons.

### `PmccStrategyInstance`
Persistent lifecycle and economic lineage across long and successive short legs.

### `PmccDeploymentRecommendation`
Deterministic portfolio construction, including proposed positions, authorization, deployment, undeployed capital, before/after portfolio, exclusions, and provenance.

### `DeploymentPlan`
Exact execution-ready representation derived from the approved recommendation. No broker submission in R1A.

### Architecture rules

- UI does not reinterpret canonical financial values.
- Financial derivations have one canonical owner.
- Qualification, feasibility, timing, and selection remain explicit concepts.
- AI does not own deterministic trading calculations.
- Do not create generic plug-in/DSL infrastructure merely to support R1.
- Reuse/extend existing canonical TradeEdge contracts wherever authoritative.

---

## 24. PMCC relationship to existing TradeEdge architecture — OPEN AUDIT

Prior WA-0005 work established important blockers around making PMCC a canonical ranked recommendation, including missing/partial strategy, recommendation, capital, and transport contracts.

This design must not instruct implementation to reinterpret raw PMCC candidate fields or presentation data as canonical capital/economic truth.

Before Dane receives implementation work, Alan must perform a repository-level mapping of the approved design against actual current code and classify each capability:

- **REUSE**
- **EXTEND**
- **NEW**
- **CONFLICT**
- **BLOCKER**

Audit questions include:

- Does a canonical long-call representation already exist?
- Where are Greeks authoritative?
- Where are option quote/mark calculations authoritative?
- How is the current PMCC long leg represented?
- Is existing Screener contract-ranking machinery reusable?
- What does the Recommendation API currently permit?
- What portfolio/account snapshot is authoritative?
- What exposure calculations already exist?
- What versioning/provenance patterns already exist?
- What exactly remains unresolved from WA-0005 around PMCC theoreticalMaxLoss/capitalRequired and recommendation transport?

**No implementation until this audit is complete.**

---

## 25. Core safety and quality invariants — FROZEN

1. Missing required evidence never silently becomes zero or PASS.
2. Strategy qualification and portfolio feasibility remain separate.
3. Portfolio constraints cannot weaken strategy qualification.
4. Transaction overrides cannot silently rewrite Strategy Policy.
5. Recommendation construction is deterministic from canonical inputs.
6. AI may explain, analyze, discover patterns, and propose; it does not silently change approved policy.
7. A PMCC long leg must never be closed while leaving an uncovered short call.
8. Original transaction economics remain immutable; adjusted strategy economics are derived separately.
9. Stale recommendations are reconstructed from current inputs rather than cosmetically repriced.
10. Every recommendation retains market, portfolio, universe, policy, and override provenance.
11. No material decision evidence exists solely inside an opaque score.
12. No broker execution occurs without current-state execution-layer revalidation.
13. TradeEdge never weakens strategy requirements merely to spend more authorized capital.
14. One-contract granularity must be respected.
15. Long-leg and short-leg evaluations remain independently auditable even when combined into one PMCC lifecycle.

---

## 26. Henry methodology extraction checklist — OPEN / REQUIRED PRE-DANE

The following must be recovered from Henry's source material before strategy policy is considered authoritative:

1. **Long-leg delta** — target, floor, band, or situational guideline around ~0.70.
2. **Long-leg DTE** — exact acceptable range and selection preference, including demonstrated ~9-month positions.
3. **Deep-ITM/moneyness rule** — exact semantics if explicitly defined.
4. **Liquidity** — two-sided market, spread, OI, volume, and any thresholds/relationships.
5. **Bollinger entry timing** — parameters, preferred region, WAIT conditions, and companion indicators.
6. **Long-leg profit exit** — exact meaning of remembered 30/40/50% behavior.
7. **Long-leg time-based exit** — remaining-DTE or other reset rules.
8. **Short-call entry** — DTE, delta/strike, premium, technical timing, and liquidity.
9. **Short-call profit taking** — close/harvest thresholds.
10. **Short-call rolling** — when and how.
11. **Assignment / ITM management** — expected handling.
12. **Long/short conflict handling** — what to do when long exit triggers while a short remains active.
13. **Re-entry/recycling** — immediate replacement versus wait/reassess.
14. **Performance accounting** — whether stated long profit targets are long-leg-only or combined PMCC economics.

Dane must not fill any of these gaps by inference.

---

## 27. Benchmark / acceptance scenarios — FROZEN FOUNDATION

Use Henry example underlyings as test beds without hard-coding Henry's conclusions.

Required scenario classes include:

1. Qualifying ~9-month long contract is evaluated normally.
2. Attractive ticker outside Approved Ownership Universe cannot enter the transaction.
3. Missing required Greek/market evidence produces UNAVAILABLE.
4. Long contract can be QUALIFIED but portfolio NOT FEASIBLE.
5. Existing same-underlying exposure affects feasibility.
6. Constructor does not weaken delta/DTE/liquidity rules to spend capital.
7. Partial deployment is valid.
8. Zero deployment is valid.
9. Identical canonical snapshots/policies produce identical recommendation.
10. Recommendation retains complete provenance.
11. User exclusion/adjustment reconstructs the recommendation.
12. Hard constraints cannot be weakened by transaction adjustment.
13. ~0.70 Henry-style delta behavior does not drift toward more expensive .80-.90 contracts merely because they are more stock-like.
14. Approved company + qualifying contract + poor entry timing returns WAIT.
15. Qualified long + no acceptable short call can produce LONG ONLY / WAIT TO WRITE.
16. Roll timing can explicitly return HOLD.
17. Long exit trigger cannot create an uncovered short call.
18. Stale recommendation requires reconstruction.
19. User delta override is provenance-tagged and reconstructs all dependent economics/portfolio selection.
20. Strategy optimization insight cannot silently mutate approved policy.

---

## 28. Shadow Validation — FROZEN

Before integrated broker execution, TradeEdge recommendations should undergo a **LEAPS/PMCC Shadow Validation** phase.

TradeEdge produces recommendations against live/current market conditions; the user verifies them against the real option chain and the adopted Henry methodology and may execute externally if desired.

Disagreements should be recorded as evidence:

- What TradeEdge selected/recommended.
- What the user/benchmark selected.
- Why they differed.
- Whether the difference reveals a policy defect, data defect, implementation defect, or user preference outside policy.

One unusual trade does not automatically cause strategy mutation. Only systematic, evidence-supported findings should drive reviewed/versioned policy changes.

---

## 29. Release boundaries — FROZEN

### R1A — PMCC Capital Deployment

Build:

Approved Ownership Universe → entry timing → qualifying long leg → initial short-call evaluation → portfolio-aware construction → recommendation → progressive evidence → execution-ready plan.

**No broker write.**

### R1B — PMCC Position Intelligence

Represent externally established positions as PMCC strategy instances and track:

- Long leg.
- Short-call history.
- Active short call.
- Premium collected.
- Combined economics.
- Lifecycle state.

### R2 — PMCC Management Recommendations

Add validated lifecycle recommendations:

- WRITE
- WAIT
- HOLD
- TAKE PROFIT
- ROLL
- EXIT / RESET

Full lifecycle methodology must be understood conceptually **before R1A implementation**, even though full management automation is not part of R1A.

### R3 — Integrated Broker Execution

Only after Shadow Validation establishes sufficient trust:

> Approve → Revalidate → Submit → Confirm → Reconcile

---

## 30. R1 conceptual backlog — WORKING; REBASE AFTER REPOSITORY AUDIT

The earlier LEAPS-only backlog must be rebased around the corrected PMCC Capital Cycle objective. Conceptual implementation slices remain:

- Approved Ownership Universe domain.
- Canonical long-call economics.
- Technical entry evidence / timing.
- LEAPS long-leg qualification.
- Initial PMCC short-call evaluation.
- Portfolio exposure and feasibility.
- Deterministic Portfolio Constructor.
- Recommendation/provenance contract.
- PMCC Capital Deployment UX.
- Progressive evidence / audit UX.
- Execution-ready deployment plan.
- PMCC strategy-instance / position-intelligence foundation.
- Henry benchmark and acceptance suite.

**Do not issue final ticket contracts until repository mapping is complete.**

---

## 31. Pre-Dane gates — REQUIRED

There are four genuine pre-implementation gates.

### Gate 1 — Henry Methodology Verification

Owner: Ian

Complete the extraction checklist in Section 26 and clearly distinguish sourced methodology from TradeEdge policy.

### Gate 2 — Portfolio Policy Calibration

Owners: Ian + Quinn + Dean approval

Using realistic one-contract economics for an approximately $50,000 active-options portfolio, calibrate:

- Position capital-at-risk limits.
- Same-underlying concentration limits.
- Delta-adjusted exposure constraints.
- Reserve policy.

Show actual consequences and stress cases rather than asking the user to choose arbitrary percentages in isolation.

### Gate 3 — Repository Contract Audit

Owner: Alan; Quinn review

Map every required capability to current TradeEdge canonical owners using REUSE / EXTEND / NEW / CONFLICT / BLOCKER.

Resolve or explicitly block on any WA-0005 PMCC contract gaps.

### Gate 4 — Formal Wireframes + QA Review

Owners: Diane + Quinn

Produce formal wireframes for:

- Capital deployment.
- Recommendation.
- Entry timing / WAIT.
- Investment analysis.
- Why this contract / alternatives.
- PMCC long + short combined economics.
- Long-only / wait-to-write state.
- Adjustment and delta override.
- Before/after portfolio.
- Exclusions / partial deployment / no deployment.
- Execution-ready plan and freshness.
- Position intelligence/lifecycle states sufficient to validate the R1 architecture.

Quinn verifies canonical backing, failure semantics, provenance, and safety invariants.

---

## 32. Dane stop condition — FROZEN

> **Dane receives no implementation prompt until all four Pre-Dane gates are reviewed and the team explicitly declares the design APPROVED for implementation.**

Dane must not resolve strategy-policy ambiguity, invent missing canonical financial contracts, or use presentation-layer calculations as substitutes for authoritative domain truth.

---

## 33. Final checkpoint

### Frozen tonight

- Product definition.
- PMCC Capital Cycle lifecycle.
- Trade Quality + Portfolio Fit + Capital Efficiency decision model.
- Policy Once, Execute Repeatedly.
- Progressive DECIDE / VERIFY / AUDIT trust model.
- Eligibility → Timing → Selection lifecycle framework.
- Entry timing as a first-class decision.
- Bollinger Bands as deterministic strategy evidence where validated.
- Long leg as managed/recyclable capital rather than hold-to-expiration by default.
- Long-only / WAIT TO WRITE as a legitimate PMCC lifecycle state.
- Delta override architecture.
- Portfolio-construction philosophy.
- PMCC strategy lineage/accounting requirements.
- Recommendation provenance/freshness.
- Strategy optimization governance.
- Safety/quality invariants.
- Shadow Validation before broker execution.
- R1A / R1B / R2 / R3 release boundaries.

### Still open by design

- Exact Henry delta semantics and permitted override range.
- Exact Bollinger entry rule.
- Exact DTE selection rule.
- Exact liquidity thresholds/relationships.
- Exact short-call entry/management rules.
- Exact 30/40/50% long-leg profit-taking semantics.
- Exact time-based exit/reset rule.
- Exact portfolio numeric limits.
- Repository-level canonical contract mapping.
- Formal wireframes.

### Next agenda

> **Henry rules → Portfolio calibration → Repository audit → Formal wireframes → Pre-Dane Review → Dane**

Do not reopen broad requirements unless one of these gates reveals a genuine design defect.
