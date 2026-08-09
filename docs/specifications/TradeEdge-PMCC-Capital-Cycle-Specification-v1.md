# TradeEdge PMCC Capital Cycle Specification v1

**Status:** PRE-IMPLEMENTATION DESIGN — NO IMPLEMENTATION AUTHORIZED  
**Primary purpose:** Preserve the product, strategy, architecture, UX, and governance decisions reached during PMCC/LEAPS design before implementation begins.  
**Next gate:** Henry methodology verification + portfolio policy calibration + repository contract audit + formal wireframe/QA review.  
**Dane:** HOLD — no implementation work is authorized from this document alone.

---

## 1. Product Definition — FROZEN

TradeEdge PMCC Capital Cycle uses a proven PMCC/LEAPS methodology to deploy limited capital into approved companies using long-dated calls as capital-efficient ownership substitutes, opportunistically harvest short-call income, actively manage both legs through their lifecycle, realize gains according to validated exit rules, and recycle capital into the next best portfolio opportunity.

The strategy is not intended to create a collection of long-dated calls that are simply held to expiration. The long call is a managed capital position used to create ownership-like exposure while enabling repeated covered-call-style income through a Poor Man's Covered Call (PMCC) lifecycle.

Selling a short call is expected when the validated methodology says it is advantageous, but it is not mandatory at every moment. LONG ONLY / WAIT is a valid strategy state.

---

## 2. Product Operating Principle — FROZEN

TradeEdge should do the analysis so the user can make the decision. The user should not be required to manually optimize contracts, capital allocations, or portfolio combinations in order to use the system.

Normal transaction flow should remain simple:

1. Use the approved ownership universe.
2. Select PMCC / capital deployment strategy.
3. Authorize an amount of capital.
4. Receive one recommended deployment.
5. Optionally adjust a small number of intent-level constraints.
6. Review evidence if desired.
7. Produce an execution-ready plan.

Slow-moving policy decisions should be established deliberately and reused across many transactions.

---

## 3. Canonical PMCC Capital Cycle — FROZEN

```text
APPROVED OWNERSHIP UNIVERSE
           │
           ▼
   EVALUATE ENTRY TIMING
           │
      ┌────┴─────┐
      │          │
     WAIT      FAVORABLE
                 │
                 ▼
       EVALUATE LONG LEG
                 │
            ┌────┴────┐
            │         │
           WAIT     QUALIFIED
                      │
                      ▼
             PORTFOLIO FEASIBILITY
                      │
                 ┌────┴────┐
                 │         │
                WAIT     FEASIBLE
                           │
                           ▼
                   ESTABLISH LONG
                           │
                           ▼
                  EVALUATE SHORT CALL
                           │
                   ┌───────┴───────┐
                   │               │
                  WAIT            WRITE
                   │               │
                   ▼               ▼
               LONG ONLY       PMCC ACTIVE
                   │               │
                   └───────┬───────┘
                           │
                           ▼
                     MANAGE CYCLE
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       HOLD LONG       MANAGE SHORT     EXIT TRIGGER
                           │                │
                     CLOSE / ROLL           │
                           │                │
          └────────────────┼────────────────┘
                           │
                           ▼
                     LONG EXIT READY
                           │
                    short-call-safe
                     exit sequence
                           │
                           ▼
                      REALIZE GAIN
                           │
                           ▼
                      RECYCLE CAPITAL
                           │
                           ▼
                  PORTFOLIO CONSTRUCTOR
                           │
                           └──────► NEXT CYCLE
```

---

## 4. Strategy Lifecycle Timing — FROZEN

Every material PMCC lifecycle transition must independently evaluate:

1. **Eligibility** — is the position/action allowed under the strategy?
2. **Timing** — does the methodology say the action should occur now?
3. **Implementation selection** — if action is warranted, which contract/action is preferred?

TradeEdge must explicitly support WAIT and HOLD outcomes and must never force a trade merely because an eligible contract exists.

Timing modules:

- Entry Timing
- Short-Call Write Timing
- Short-Call Roll/Close Timing
- Long-Leg Exit/Reset Timing

Each timing decision must be explainable as:

**Action → Evidence → Applicable Rule → Observed Value → Why now / why not now**

---

## 5. Entry Timing and Bollinger Bands — WORKING / TO VERIFY

Henry places meaningful emphasis on where price sits within the Bollinger Bands when determining whether it is a good time to enter a LEAPS position.

TradeEdge should treat Bollinger Band position as deterministic technical evidence, not as an AI visual interpretation of a chart.

Potential canonical technical evidence includes:

- Current price
- Middle band
- Upper band
- Lower band
- Band width
- Price location within the bands
- Normalized %B or equivalent derived measure if appropriate
- Indicator parameters and version
- Data timestamp and sufficiency

Entry timing output should support:

- FAVORABLE
- WAIT
- UNAVAILABLE

The exact Henry methodology remains to be verified, including:

- Bollinger parameters
- Preferred price region
- Whether %B or visual band position is the actual method
- What causes WAIT
- Whether another indicator is combined with Bollinger position
- Whether rules differ between initial entry, replacement entry, and other lifecycle states

A qualifying company and qualifying long-call contract do not automatically imply that a new PMCC position is actionable.

---

## 6. Decision Model — FROZEN

TradeEdge recommendation is evaluated through three distinct dimensions:

### 6.1 Trade Quality

Does the trade satisfy the adopted PMCC methodology?

Long-leg concepts include:

- Approved underlying
- Long-duration call
- Deep ITM structure
- Target delta behavior
- Valid market
- Liquidity
- Contract economics
- Entry timing

Short-call concepts eventually include:

- Short-call delta
- DTE
- Strike relationship
- Premium
- Liquidity
- Timing
- Management characteristics

No unsupported synthetic Trade Quality score is required.

### 6.2 Portfolio Fit

Does the qualified trade belong in this portfolio right now?

At minimum:

- Capital at risk
- Existing same-underlying exposure
- Projected same-underlying exposure
- Portfolio constraints
- Available capital
- One-contract granularity
- Required reserve / flexibility

### 6.3 Capital Efficiency

What useful exposure is obtained for the capital committed?

At minimum:

- Long-leg debit
- Initial short-call credit when applicable
- Delta-adjusted exposure
- Capital required versus 100 shares
- Remaining available capital

Capital efficiency should be expressed using dollars, percentages, and deterministic ratios wherever possible rather than a synthetic score.

---

## 7. Long-Leg Strategy Policy — WORKING / TO VERIFY

### 7.1 Approved Ownership Universe — FROZEN

The long-duration ownership universe is a small, slow-moving, explicitly approved set of companies that the user is willing to own economically.

Universe Exploration is separate from trade transactions.

A trade transaction may consume the approved universe but may not modify it.

Universe review is expected to be deliberate and relatively infrequent, approximately every 3–4 months or following a material thesis-breaking event.

The tactical Screener may continue using a broader dynamic opportunity universe for strategies that do not require long-term ownership conviction.

### 7.2 Duration — WORKING

Henry's demonstrated/public methodology includes positions approximately **9–24 months** to expiration.

The system must not implicitly require 12+ months. Nine-month examples must be first-class validation cases.

Two separate concepts are required:

- **Eligibility:** Is expiration within the adopted duration envelope?
- **Selection:** Of eligible expirations, which best implements the methodology?

The exact preference among ~9, 12, 18, and 24 months remains to be sourced rather than invented.

### 7.3 Delta — WORKING / TO VERIFY

Dean observed that Henry targets approximately **0.70 delta** in the examples being used as the reference methodology.

Earlier discussion of 0.80 delta is retracted as the default TradeEdge assumption.

The exact semantics remain to be verified:

- Target
- Floor
- Band
- Situational guideline

Architecture must distinguish:

- Hard range
- Minimum threshold
- Target
- Preference

Delta is expected to be a primary targeting variable, but it must not override liquidity, duration, market validity, or other validated strategy protections.

### 7.4 User Delta Override — FROZEN CONCEPTUALLY

R1 should support designated transaction-specific target overrides, including delta where approved, within validated strategy boundaries.

Normal flow uses the strategy default.

Advanced flow may allow the user to choose a permitted custom target.

An override:

- Does not mutate the underlying strategy policy
- Is recorded with explicit provenance
- Causes the entire recommendation to be reconstructed
- Does not require the user to manually choose the replacement contract
- Must remain inside validated strategy boundaries in R1

Hard strategy and portfolio-safety constraints remain non-overridable inside the transaction workflow.

### 7.5 Liquidity — WORKING / TO VERIFY

R1 liquidity evaluation should consider:

- Valid two-sided market — hard requirement
- Bid/ask spread quality — hard or bounded requirement
- Open interest — evidence
- Volume — supporting evidence

Long-dated options may have low daily volume while retaining usable open interest and markets, so volume should not automatically be a stand-alone hard rejection.

Exact thresholds remain open pending source validation and policy calibration.

### 7.6 Deterministic Economics — FROZEN

TradeEdge must calculate and retain, as applicable:

- Underlying price
- Expiration / DTE
- Strike
- Multiplier
- Bid / Ask / Mark
- Delta / Gamma / Theta / Vega / Rho
- IV
- Volume
- Open interest
- Estimated debit
- Intrinsic value
- Extrinsic value
- Extrinsic % of debit
- Breakeven
- Breakeven distance from spot
- Capital required
- Maximum loss
- Delta-adjusted share equivalents
- Delta-adjusted underlying exposure

Missing or invalid required evidence must remain unavailable rather than being fabricated as zero.

---

## 8. Stock-Replacement Evidence — FROZEN

TradeEdge should make the economics of using a LEAP instead of 100 shares directly inspectable.

The analysis should compare, where appropriate:

| Dimension | Buy 100 Shares | Proposed Long Call |
|---|---:|---:|
| Capital required | Explicit | Explicit |
| Maximum loss | Explicit | Explicit |
| Initial delta-adjusted shares | 100 | Calculated |
| Initial delta-adjusted exposure | Calculated | Calculated |
| Expiration | None | Contract expiration |
| Breakeven at expiration | N/A | Calculated |
| Extrinsic value paid | N/A | Calculated |
| Dividend rights | Yes | No |

TradeEdge should also expose the tradeoffs of LEAPS versus shares, including expiration risk, time decay, changing delta, liquidity/spread cost, lack of dividends, and the possibility of losing 100% of the premium.

This must be factual, not promotional.

---

## 9. PMCC Long/Short Relationship — FROZEN

The long call is the ownership foundation of the PMCC strategy.

A good long call does not automatically imply a good short-call overlay.

The system must independently evaluate:

### Long-leg qualification

Is the synthetic ownership position valid under the long-leg methodology?

### Short-call opportunity

Is selling a call attractive now under the PMCC methodology?

Valid outcomes include:

- LONG QUALIFIED + SHORT ATTRACTIVE → establish full PMCC
- LONG QUALIFIED + SHORT NOT ATTRACTIVE → establish long leg / WAIT to write
- LONG NOT QUALIFIED → do not establish position merely because short-call premium is attractive

The long-leg architecture should be reusable by LEAPS-only and PMCC strategies without duplicating canonical economic truth.

---

## 10. PMCC Lifecycle State Model — FROZEN CONCEPTUALLY

Conceptual strategy states:

1. CANDIDATE
2. READY TO ESTABLISH
3. LONG ONLY
4. PMCC ACTIVE
5. SHORT CLOSED
6. LONG EXIT READY
7. CYCLE COMPLETE

These states are separate from recommended actions.

Possible lifecycle actions include:

- ENTER
- WAIT
- WRITE
- HOLD
- TAKE PROFIT
- ROLL
- CLOSE
- EXIT
- RESET / REDEPLOY

State, action, and evidence must remain separate concepts.

---

## 11. Long-Leg Exit and Capital Recycling — WORKING / TO VERIFY

The long LEAP should be treated as a managed and recyclable capital position, not as a buy-and-hold-to-expiration asset.

Dean recalls Henry discussing profit-taking behavior around **30% / 40% / 50%**, and that positions would generally not be held to expiration.

The exact methodology must be sourced before implementation, including:

- Whether the long-leg profit target is fixed or variable
- Whether 30/40/50% corresponds to different conditions
- Whether the calculation applies to the long leg alone or combined PMCC economics
- Whether remaining DTE creates a separate exit condition
- What happens when an active short call exists at the long-leg exit trigger
- Whether the long leg is rolled, replaced, exited, or reassessed
- Whether re-entry is immediate or timing-dependent

Architecture is frozen around the principle that realized capital returns to the Portfolio Constructor for the next permissible deployment.

---

## 12. Short-Call Management — TO VERIFY

The full Henry methodology must be extracted for:

- Short-call entry timing
- Short-call delta / strike selection
- Short-call DTE
- Premium requirements
- Short-call profit taking
- Roll timing
- Roll selection
- Close conditions
- Assignment risk handling
- Interaction with long-leg exit

The system must not invent these thresholds or assume that ordinary covered-call rules automatically apply to PMCCs.

---

## 13. Safety Invariants — FROZEN

1. Missing required evidence never silently becomes zero or PASS.
2. Strategy qualification and portfolio feasibility remain separate.
3. Portfolio constraints cannot weaken strategy qualification.
4. Transaction overrides cannot silently rewrite Strategy Policy.
5. Recommendation construction is deterministic from canonical inputs.
6. AI may explain, analyze, and propose; AI does not silently change policy.
7. A PMCC long leg must never be closed while leaving an uncovered short call.
8. Original transaction economics remain immutable; adjusted strategy economics are derived separately.
9. Stale recommendations are reconstructed from current canonical inputs rather than cosmetically repriced.
10. Every recommendation retains market, portfolio, universe, and policy provenance.
11. No material decision evidence exists solely inside an opaque score.
12. No broker execution may occur without execution-time revalidation.
13. Portfolio construction may choose among strategy-qualified trades; it may not weaken strategy rules to make a portfolio fit.
14. The system must support DO NOTHING / WAIT / HOLD as legitimate recommendations.
15. Capital authorization is a ceiling, not an obligation to spend.

---

## 14. Portfolio Policy — WORKING / TO CALIBRATE

Portfolio Policy is separate from PMCC Strategy Policy.

It must support at least:

- Maximum strategy capital authorization
- Maximum capital at risk per new PMCC/long position
- Maximum same-underlying capital at risk
- Maximum same-underlying delta-adjusted exposure
- Minimum reserve / available capital requirement, if configured

Important distinctions:

- Capital committed ≠ maximum loss ≠ delta-adjusted exposure
- Portfolio capital ≠ strategy budget ≠ position risk ≠ economic exposure
- One standard equity option contract is indivisible and policy must account for one-contract granularity

A strategy-qualified contract can still be portfolio NOT FEASIBLE.

The system must be able to represent:

- QUALIFIED / NOT QUALIFIED / UNAVAILABLE at the strategy level
- FEASIBLE / NOT FEASIBLE at the portfolio level

Initial numeric policy values remain open pending calibration using a representative ~$50,000 portfolio and realistic contracts.

Policy calibration should expose stress evidence such as:

- Largest position goes to zero
- Two largest positions go to zero

These are stress illustrations, not automatically hard trading rules.

---

## 15. Portfolio Constructor — FROZEN CONCEPTUALLY

Inputs:

- Approved Ownership Universe
- Versioned PMCC Strategy Policy
- Versioned Portfolio Allocation Policy
- Current Portfolio State
- Current Market State
- Capital Authorization
- Transaction-specific exclusions / allowed target overrides

Output:

A single **Recommended Portfolio Transition**:

**Portfolio Before + Proposed Trades = Projected Portfolio After**

The user should receive one recommended construction, not five scenarios by default.

The constructor must:

- Honor hard strategy rules
- Honor hard portfolio policy
- Stay within authorized capital
- Permit partial deployment
- Permit zero deployment
- Preserve strategy candidate preference
- Evaluate feasible combinations deterministically
- Avoid synthetic weighted optimization in R1
- Avoid choosing inferior investments solely to consume more authorized capital

R1 working allocation policy:

- Strategy candidate preference dominates
- Portfolio constraints are hard
- Feasible combinations are evaluated
- Deterministic diversification / capital-use tie-breaks may be used only where strategy preference does not distinguish alternatives
- AI does not choose the winning portfolio

---

## 16. Recommendation Transparency — FROZEN

Prefer dollars, percentages, ratios, explicit limits, and PASS / FAIL / WAIT / UNAVAILABLE evaluations over synthetic scores whenever the underlying fact can be expressed directly.

Scores may assist ranking where justified but must not replace explicit capital, risk, exposure, concentration, liquidity, or strategy-rule evidence.

The user must be able to see why a company or contract was not selected.

Reason classes include:

- Strategy not qualified
- Entry timing WAIT
- Data unavailable
- Portfolio not feasible
- Concentration limit
- Capital constraint
- Valid but not selected by allocation policy

---

## 17. Progressive Evidence UX — FROZEN

### Level 1 — DECIDE

The user sees the recommended action and only the essential facts:

- Company
- Contract
- Delta
- DTE
- Capital
- Delta-adjusted exposure
- Portfolio fit
- Short-call status
- Current recommended action

Primary actions:

- View Analysis
- Adjust
- Review Deployment Plan

### Level 2 — VERIFY

The user can inspect:

- Underlying context
- Entry timing / Bollinger evidence
- Long contract
- Short contract, when applicable
- Greeks
- Liquidity
- Intrinsic / extrinsic value
- Breakeven
- Capital / maximum loss
- Stock versus LEAP comparison
- Delta-adjusted exposure
- Portfolio impact
- Combined PMCC economics
- Tradeoffs
- Observed value → applicable rule → PASS / FAIL / WAIT / UNAVAILABLE

### Level 3 — AUDIT

The user can inspect:

- Contracts evaluated
- Rejection reasons
- Qualifying alternatives
- Selection methodology
- Market timestamps
- Data provenance
- Strategy policy version
- Portfolio policy version
- Ownership universe version

No material fact used to select or reject a position may exist only inside an opaque score or inaccessible backend calculation.

---

## 18. Recommendation Freshness — FROZEN

Each recommendation must be an immutable, reproducible snapshot tied to:

- Market snapshot
- Portfolio snapshot
- Ownership Universe version
- PMCC Strategy Policy version
- Portfolio Policy version
- Capital authorization
- Transaction overrides / exclusions

If the recommendation becomes stale, TradeEdge must rebuild from current canonical inputs.

It must not merely replace displayed option prices while retaining stale qualification or portfolio decisions.

---

## 19. Adjustment Model — FROZEN

Normal transactions should not expose a trading cockpit.

R1 adjustment may support intent-level restriction such as:

- Reduce authorized capital
- Increase desired reserve
- Exclude one or more companies
- Choose an approved custom delta target within validated bounds

Changing a target or constraint causes the complete recommendation to be reconstructed.

Transaction-level adjustments may tighten constraints or choose permitted targets; they may not weaken hard strategy or portfolio-safety boundaries.

---

## 20. Strategy Optimization Governance — FROZEN

TradeEdge may use deterministic analytics and AI-assisted analysis to identify potentially beneficial changes to tunable strategy parameters based on accumulated evidence and relevant market context.

TradeEdge must not silently modify an approved Strategy Policy.

Optimization process:

**Proven methodology → Approved baseline → Measurement → Evidence → AI-assisted insight → Proposed optimization → User decision → Versioned policy change**

A strategy proposal must expose supporting evidence and remain distinct from the currently approved rule.

The user may:

- Reject
- Apply once as a permitted transaction override
- Approve an appropriate persistent policy change, creating a new strategy policy version

Historical positions retain the policy version under which they were entered.

R1 does not need to implement an autonomous strategy-learning platform, but architecture must preserve the provenance and evidence needed to support this later.

---

## 21. PMCC Strategy Lineage — FROZEN CONCEPTUALLY

TradeEdge should model a PMCC as a strategy instance, not as unrelated option trades.

Conceptual `PmccStrategyInstance` responsibilities include:

- Strategy instance ID
- Underlying
- Ownership Universe version
- Entry Strategy Policy version
- Portfolio Policy version
- Lifecycle state
- Long leg
- Short-call history
- Active short call, if any
- Original capital committed
- Cumulative realized short-call premium
- Realized long-leg P/L
- Unrealized long-leg P/L
- Combined strategy economics
- Current recommended action
- Action evidence
- Exit status
- Successor / replacement cycle lineage where appropriate

Original transaction facts remain immutable.

Adjusted strategy economics are derived separately.

---

## 22. PMCC Performance Accounting — TO VERIFY / DESIGN

At minimum, future position intelligence should distinguish:

- Original long-leg debit
- Long-leg unrealized P/L
- Long-leg realized P/L
- Current short-call P/L
- Cumulative realized short-call income
- Combined strategy P/L
- Return on capital
- Holding period

If an adjusted economic basis is shown, it must be a clearly defined derived metric and must not overwrite historical transaction cost basis.

The exact return definition used for Henry's long-leg profit-taking rule must be sourced before implementing exit logic.

---

## 23. Execution Architecture — FROZEN CONCEPTUALLY / OUT OF R1A LIVE SCOPE

TradeEdge owns the investment decision and trading workflow.

The broker owns regulated execution and custody.

Long-term target workflow:

**Recommendation → Human approval → Execution-time revalidation → Broker order intent → Broker acceptance / working / partial fill / fill / rejection → TradeEdge reconciliation**

Recommendation ≠ Order ≠ Accepted Order ≠ Fill ≠ Position.

R1A ends at an execution-ready plan and does not submit live orders.

Live execution requires its own validated pricing policy and broker-bound safety gates.

---

## 24. UX Wireframe Requirements — FROZEN CONCEPTUALLY

Formal wireframes are required before Dane receives implementation work.

Required R1A views / states include:

1. Deploy Capital
2. Recommendation
3. Long / PMCC Position Analysis
4. Entry Timing / Bollinger evidence
5. Portfolio Before / After
6. Why this contract?
7. Why not selected?
8. Adjust Recommendation
9. Partial Deployment
10. Zero Deployment
11. Execution-Ready Deployment Plan
12. Stale Recommendation / Rebuild
13. User delta override comparison
14. LONG ONLY / WAIT short-call state
15. Full PMCC initial entry state

The design philosophy is **complexity on demand**:

- Decide
- Verify
- Audit

Simple presentation must not mean incomplete underlying evidence.

---

## 25. Pre-Dane UX Gate — FROZEN

Before implementation begins:

**Ian must be able to say:**

> If I were about to put my own money into this PMCC/LEAPS capital cycle, the wireframes give me enough information to trust or reject the recommendation without reconstructing the analysis myself.

**Quinn must be able to say:**

> Every financial assertion on those screens has an authoritative canonical source, and every safety-critical failure state fails closed.

**Alan must be able to say:**

> The architecture supports the experience without presentation-layer financial logic or duplicated strategy truth.

**Paul must be able to say:**

> This remains inside the approved release scope and has not become a general trading-platform redesign.

Only then may Frank authorize Dane to implement.

---

## 26. Release Model — FROZEN

### R1A — PMCC Capital Deployment

Build:

- Approved Ownership Universe consumption
- Entry timing evaluation
- Long-leg qualification
- Initial short-call evaluation
- Portfolio-aware construction
- Single recommended deployment
- Progressive evidence
- Intent-level adjustments
- Execution-ready plan

No broker writes.

### R1B — PMCC Position Intelligence

Represent externally established positions as PMCC strategy instances and track:

- Long leg
- Short-call history
- Active short call
- Premium collected
- Combined economics
- Lifecycle state

### R2 — PMCC Management Recommendations

Add validated management recommendations:

- WRITE
- WAIT
- HOLD
- TAKE PROFIT
- ROLL
- EXIT / RESET

### R3 — Integrated Broker Execution

Only after Shadow Validation establishes sufficient trust:

**Approve → Revalidate → Submit → Confirm → Reconcile**

---

## 27. Shadow Validation — FROZEN

After R1 implementation and before live broker-write automation, TradeEdge should enter a Shadow Validation phase.

TradeEdge produces recommendations against real market conditions.

The user can compare them with Henry's methodology, market chains, and personal judgment.

Disagreements are recorded as evidence rather than immediately causing algorithm changes.

Systematic, evidence-supported findings may produce Strategy Optimization proposals.

One unusual trade must not cause policy thrash.

---

## 28. Henry Benchmark Cases — WORKING

Initial benchmark/test underlyings from Henry's examples:

- MSFT
- AMZN
- MCD
- CMG
- NVTS

These are validation cases, not hard-coded targets.

The system should demonstrate that it can explain why each qualifies, fails, becomes unavailable, becomes portfolio-infeasible, or enters WAIT.

Benchmark scenarios should include:

1. Plenty of capital
2. ~$50K portfolio with constrained PMCC/LEAPS allocation
3. Existing same-underlying exposure
4. Poor option liquidity
5. Missing Greek / incomplete data
6. One contract exceeds portfolio policy
7. Attractive ~9-month case
8. No valid deployment
9. Bollinger/entry timing WAIT
10. Favorable entry timing
11. Short call attractive now
12. Long qualified / short call WAIT

---

## 29. Known Current-State TradeEdge Context — TO AUDIT

Existing TradeEdge capabilities already include substantial infrastructure around:

- Screener and Opportunity Universe
- PMCC discovery
- Decision Engine
- Opportunity Engine
- Recommendation Service
- Portfolio Intelligence
- Portfolio/account acquisition
- Option chain / Greeks
- Live/paper trust boundaries
- Broker-order safety patterns

Long LEAPS first-class generation remains known backlog work.

Existing PMCC capability must not be assumed to contain all canonical recommendation/capital/exposure contracts required by this design.

A repository-level audit is required before implementation.

Required audit output for each needed capability:

- REUSE
- EXTEND
- NEW
- CONFLICT
- BLOCKER

The audit must specifically evaluate:

- Approved Ownership Universe versus current Opportunity Universe
- Canonical long-call representation
- Greeks authority
- Quote / mark authority
- PMCC long-leg representation
- Screener contract-ranking reuse
- Recommendation API strategy support
- Portfolio/account snapshot authority
- Capital calculations
- Same-underlying exposure calculations
- Strategy/policy versioning patterns
- PMCC canonical capital / theoretical max loss gaps previously identified

---

## 30. Implementation Backlog — R1A Working Set

1. Approved Ownership Universe domain
2. Canonical Long Call economics
3. Entry Timing technical evidence / Bollinger support
4. Long-leg PMCC qualification
5. Initial short-call opportunity evaluation
6. Portfolio exposure and feasibility
7. Deterministic Portfolio Constructor
8. Recommendation / provenance contract
9. PMCC Capital Deployment UX
10. Intent-level reconstruction
11. Execution-ready deployment plan
12. Henry benchmark + R1 acceptance suite
13. PMCC strategy-instance lineage foundation sufficient for future lifecycle compatibility

This backlog is subject to repository audit and formal wireframe review before implementation tickets are created.

---

## 31. Explicit Non-Goals for R1A — FROZEN

- Live broker order submission
- Automated execution
- Automated rolling
- Automated closing
- Full PMCC lifecycle automation
- Universe discovery / exploration UX
- CSP/Wheel universe redesign
- General-purpose AI stock-picking engine
- Synthetic capital-efficiency or portfolio-fit scoring as a substitute for explicit facts
- Autonomous AI strategy mutation
- Cross-underlying correlation / theme portfolio optimization
- General trading-platform redesign

---

## 32. Remaining Pre-Dane Gates — OPEN / REQUIRED

### Gate 1 — Henry Methodology Verification

Ian + Quinn must produce authoritative answers for:

- Long-leg delta semantics (~0.70 target/floor/band)
- Long-leg DTE selection inside the 9–24 month envelope
- Bollinger Band entry-timing method
- Long-leg profit exit / 30–40–50% behavior
- Time-based long exit
- Short-call entry timing
- Short-call delta / strike / DTE
- Short-call profit taking
- Roll timing and roll selection
- Long/short conflict handling
- Assignment-risk handling
- Recycling / re-entry
- Performance accounting definition

Anything unresolved must remain explicitly unresolved rather than invented.

### Gate 2 — Portfolio Policy Calibration

Using a representative ~$50,000 portfolio and realistic contracts, calibrate:

- Maximum capital at risk per new position
- Maximum same-underlying capital at risk
- Maximum same-underlying delta-adjusted exposure
- Minimum reserve / available capital policy
- One-contract feasibility behavior

Show consequences rather than asking the user to choose arbitrary percentages in isolation.

### Gate 3 — Repository Contract Audit

Alan + Quinn must map the approved design against the current repository and return:

- REUSE
- EXTEND
- NEW
- CONFLICT
- BLOCKER

No code changes during this audit.

### Gate 4 — Formal Wireframes + Final QA

Diane produces the formal wireframes.

Ian reviews the trader experience.

Quinn verifies canonical evidence and failure behavior.

Alan verifies architectural support.

Paul verifies release scope.

### Gate 5 — Consolidated Pre-Dane Review

Only after Gates 1–4 are complete may the team decide:

- APPROVED — Dane receives one consolidated implementation specification
- BLOCKED — exact unresolved blockers are documented

---

## 33. Decision Status Summary

### FROZEN

- PMCC Capital Cycle product definition
- Ownership Universe separate from trade transactions
- Portfolio-aware recommendation requirement
- Capital efficiency expressed through explicit economics
- Long/short evaluation separation
- PMCC lifecycle state concept
- Strategy timing framework
- Bollinger Bands as potential entry-timing evidence subject to Henry rule verification
- Strategy / portfolio policy versioning
- Transaction-specific delta override concept within validated boundaries
- Progressive evidence UX
- Decide / Verify / Audit trust model
- Deterministic portfolio construction from canonical inputs
- AI may propose strategy improvements but may not silently adopt them
- Strategy lineage / PMCC instance concept
- Partial and zero deployment are valid outcomes
- No live broker writes in R1A
- Shadow Validation before integrated execution
- Formal wireframes before Dane implementation

### WORKING / TO VERIFY

- ~0.70 delta semantics
- 9–24 month selection preference
- Bollinger entry rule
- LEAPS-specific liquidity thresholds
- Short-call selection and timing
- Long-leg profit exit / 30–40–50% behavior
- Long-leg time-based exit
- Roll/close methodology
- PMCC performance accounting details

### OPEN / TO CALIBRATE

- Maximum capital at risk per position
- Same-underlying concentration limits
- Reserve policy
- Final portfolio-allocation policy calibration under realistic cases

### REQUIRED BEFORE IMPLEMENTATION

- Henry methodology verification
- Portfolio policy calibration
- Repository contract audit
- Formal wireframes and QA review
- Consolidated Pre-Dane approval

---

## 34. Recovery Statement

This document is the authoritative pre-implementation recovery point for the PMCC Capital Cycle design as captured from the current product workshop.

If work resumes in a new session, start here. Do not reconstruct the design from memory or conversation fragments.

Do not treat WORKING, TO VERIFY, or OPEN items as implementation requirements until they are explicitly approved.

**Implementation remains unauthorized until the Pre-Dane gates are complete.**
