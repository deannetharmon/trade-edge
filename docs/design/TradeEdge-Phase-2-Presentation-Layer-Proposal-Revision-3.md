# TradeEdge Phase 2 Presentation-Layer Proposal — Revision 3

**Status:** Proposed; unapproved
**Decision authority:** Dean
**Phase:** 2 — conceptual presentation layer
**Revision date:** 2026-07-26
**Document role:** Complete consolidated replacement proposal

## 1. Purpose

Phase 2 defines how TradeEdge presents decisions across the full trading
lifecycle. Revision 3 preserves the complete presentation model and folds in
one lifecycle-wide Opportunity and Position Analytics Contract. It does not
replace economics, structure, capital, portfolio, order, event, or lifecycle
truth with analytics; it adds consistent analytics to those existing truths.

Phase 2 remains unapproved until Dean explicitly approves Revision 3. Phase 3
must not begin before that approval.

## 2. Scope and boundaries

This proposal defines conceptual information ownership, hierarchy, decision
states, workspace behavior, transitions, evidence, and Phase 3 handoff.

It does not define production APIs, storage schemas, React components,
implementation architecture, pixel-level designs, strategy flowcharts, new
strategy policy, fixed trading thresholds, or scoring rules. Thresholds remain
configurable policy unless Dean explicitly approves them as product
requirements.

## 3. Product model: five workspaces

TradeEdge has five coordinated workspaces with distinct ownership.

### 3.1 Mission Control

Mission Control answers: “What is the overall state of my trading system and
what deserves attention?” It owns portfolio-wide status, review completion,
system health, high-level risks, and routing. It references but does not
duplicate Today, Opportunities, Positions, or Briefing detail.

### 3.2 Today

Today answers: “What should I do now?” It owns the finite, ordered action queue.
It summarizes decisions and routes to the authoritative workspace. It never
becomes the full analytics home or calculates independent metrics.

### 3.3 Briefing

Briefing answers: “What changed and what context matters?” It owns since-last-
review changes, market and portfolio context, upcoming events, structured news,
and explanatory narrative. It does not own position management or opportunity
selection.

### 3.4 Positions

Positions answers: “What do I own, what is true now, and how should it be
managed?” It owns open-position structure, lifecycle state, current economics,
management objectives, position analytics, orders, and position-specific risk.

### 3.5 Opportunities

Opportunities answers: “What new trades are eligible, preferred, or worth
monitoring?” It owns discovery, evaluation, comparison, recommendation detail,
alternatives, opportunity analytics, and external execution handoff.

Each visible fact has one authoritative owner. Other workspaces may summarize
and deep-link but may not create competing truth.

## 4. Shared three-level information hierarchy

### 4.1 Summary

Summary surfaces answer what, why, urgency, and next action. They remain compact
and decision-useful. They include essential economics, structure, portfolio
impact, events, lifecycle state, and Dean’s required compact analytics. Every
summary routes to Decision Detail.

### 4.2 Decision Detail

Decision Detail explains the complete decision: structure, economics, analytics,
portfolio and policy context, events, lifecycle state, alternatives, action,
urgency, decisive reason, risks, and what would change the decision.

### 4.3 Data & Evidence

Evidence exposes sources, inputs, calculations, policy evaluations, timestamps,
freshness, provenance, conflicts, unsupported inputs, and how evidence affected
eligibility, confidence, warning, or blocked status.

## 5. Today workspace

### 5.1 Purpose

Today is a finite, completable queue of decisions requiring review or action.
It summarizes and routes; it does not duplicate full position, opportunity, or
evidence detail.

### 5.2 Information order

1. Immediate actions and unresolved safety issues
2. Time-sensitive position-management actions
3. Conditional decisions whose triggers are met
4. New recommended opportunities
5. Scheduled reviews and approaching critical events
6. Informational changes
7. No-action-needed confirmations

Within the same tier, ordering uses the approved decision priority and
time-sensitivity rules. Display order does not invent a new score.

### 5.3 Today item contract

Each item includes:

- Decision state, action, urgency, and decisive reason
- Authoritative workspace and exact destination
- Symbol, strategy, and position/opportunity identity
- Relevant economics and capital consequence
- Nearest critical event or trigger
- DTE where applicable
- POP where applicable
- OTM% for the controlling strike
- Net position delta
- Visible degraded-liquidity warning
- For positions, current P/L and management-objective progress
- Completion/review behavior and whether the item can be completed

### 5.4 Today rules and outcomes

Completing an item records review, not necessarily economic completion. Healthy
monitoring does not pollute the actionable queue. If no action is required,
Today says so truthfully. Loading, evaluation failure, stale prior results, and
reconciliation states cannot masquerade as an empty or completed queue.

## 6. Opportunities workspace

### 6.1 Purpose and journey

The opportunity journey is:

1. Define or select scan/evaluation intent
2. Evaluate the complete candidate population
3. Apply policy and eligibility
4. Rank and compare eligible and conditional opportunities
5. Inspect summary
6. Open Decision Detail
7. Inspect alternatives and Evidence
8. Choose to monitor, reject, or proceed externally
9. Preserve recommendation continuity if the opportunity becomes a position

The workspace must distinguish discovery results, evaluated opportunities,
recommended opportunities, alternatives, and rejected/ineligible candidates.

### 6.2 Opportunity summary contract

The original decision and trade information remains required:

- Symbol and strategy
- Leg/structure summary, strikes, expirations, ratios, and quantity
- Credit/debit and whether quoted per share, per contract, or total
- Maximum profit
- Maximum loss or authoritative capital at risk
- Breakeven
- Return metric where applicable
- Buying-power/capital consequence
- Portfolio fit, concentration, correlation, and conflict indicators
- Earnings, dividend, macro, expiration, and other critical events
- Recommendation state, action, urgency, rank, and decisive reason
- Key concern and what would improve the opportunity
- Quote/analysis freshness

Dean’s compact analytics are added, not substituted:

- DTE
- Strategy POP
- Controlling short-strike or decision-relevant OTM%
- Net position delta
- Degraded-liquidity warning

### 6.3 Opportunity Decision Detail

Decision Detail includes:

- Complete multi-leg structure and contract identity
- Entry economics and authoritative capital requirement
- Maximum profit/loss, breakeven, and return assumptions
- Portfolio and policy evaluation
- Eligibility, preference, rank, disposition, confidence, and rationale
- Supporting factors, concerns, tradeoffs, rejection reasons, and improvement
  conditions
- Critical events and timing
- Complete Opportunity Analytics Contract
- Alternatives, including why each is less preferred or ineligible
- Evidence link
- External execution handoff state

### 6.4 Alternatives

Alternatives retain their own identity, structure, economics, analytics,
eligibility, and decisive tradeoff. They are not anonymous suggestions.
“Eligible-not-preferred” is a first-class state, not a rejection.

### 6.5 External execution handoff

TradeEdge presents an intentional handoff package containing exact structure,
side, quantity, limit/price context, economics, analytics timestamp, risks, and
decision provenance. Phase 2 does not authorize broker submission or imply that
displaying a recommendation executes a trade. Execution outcomes return through
reconciliation before the lifecycle becomes a managed position.

## 7. Positions workspace

### 7.1 Purpose and lifecycle truth

Positions owns:

- Pending/opening
- Open
- Working-order
- Adjustment pending
- Closing
- Closed
- Expired
- Assigned/exercised
- Reconciliation required
- Ambiguous structure

Lifecycle truth must distinguish position state from recommendation state and
order state.

### 7.2 Position summary contract

The original position information remains required:

- Symbol and strategy
- Exact legs, shares, strikes, expirations, ratios, quantity, and multiplier
- Entry date and entry credit/debit
- Current value
- Realized and unrealized P/L
- Progress toward management objective
- Maximum profit and maximum loss/capital at risk
- Breakeven and return metric where applicable
- Buying-power/capital commitment
- Current working/pending orders and status
- Assignment, exercise, dividend, earnings, expiration, and event risks
- Current recommendation state, action, urgency, and decisive reason
- Lifecycle and reconciliation status

Dean’s compact analytics are added:

- DTE
- Current strategy POP where meaningful
- Controlling-strike OTM%
- Net position delta
- Degraded-liquidity warning
- Nearest critical event

### 7.3 Position Decision Detail

Position detail includes:

- Original thesis and recommendation identity
- Immutable entry snapshot
- Current structure and economics
- Entry-to-current changes
- Management objective and progress
- Complete Position Analytics Contract
- Current recommendation, decisive reason, triggers, and alternatives
- Pending/working order truth
- Assignment/exercise and expiration scenarios
- Portfolio and policy impact
- Event and news context
- Evidence and reconciliation history

### 7.4 Action precedence

Safety and reconciliation outrank strategy optimization. Pending-order truth
precedes a new action. Required risk reduction precedes profit optimization.
Explicit trader commitments are revalidated before proposing contradictory
actions. When multiple actions remain valid, the approved decision priority
determines the lead action; alternatives remain visible.

### 7.5 Strategy-specific position truth

- **CSP:** obligation, short-put risk, assignment intent, capital commitment,
  breakeven, short-put analytics, and assignment context.
- **BPS:** both put legs, net defined risk, width, short-strike risk, pin and
  expiration risk.
- **CC:** shares plus short call, covered quantity, call-away risk, dividend and
  early-assignment context.
- **BCS:** both call legs, net defined risk, short-strike risk, and expiration.
- **Long-dated call:** intrinsic/extrinsic value, duration, decay, volatility
  exposure, and capital at risk.
- **PMCC:** long/short diagonal relationship, assignment asymmetry, remaining
  long-leg duration, and net capital at risk.
- **Stock-only:** share economics and risk; option analytics remain not
  applicable until an option opportunity becomes a position.

## 8. Portfolio & Policy

Portfolio & Policy supplies context, not a second recommendation engine.

It includes:

- Available capital and buying power
- Existing symbol and sector exposure
- Concentration and correlation
- Defined-risk preference
- Income, growth, preservation, or other approved objective
- Ownership/assignment intent
- Strategy permissions and configurable thresholds
- Earnings, macro, volatility, liquidity, and event policy
- Trader commitments
- Portfolio-mode and execution constraints

Every opportunity and management decision states which policy applied, which
rules warned or blocked, and which values were unavailable. Fixed thresholds
are not invented in presentation.

## 9. Authoritative Opportunity and Position Analytics Contract

The same metric names, definitions, units, and states apply from opportunity
evaluation through position management.

### 9.1 Required analytics

For every applicable opportunity and option position:

- Net position delta, gamma, theta, vega, and rho
- Per-leg delta, gamma, theta, vega, and rho
- Strategy-level POP
- OTM% for every material strike, especially every short strike
- Underlying and/or contract implied volatility as applicable
- IV Rank and/or IV Percentile when supported
- Open interest for every option leg
- Current volume for every option leg
- Bid, ask, midpoint/mark, absolute width, and percentage width
- Quote and analytics timestamps
- Broker, quote, chain, volatility, and probability provenance
- Current economics and authoritative capital at risk

Open interest and OI are the same measure. Implied volatility is separate.

### 9.2 Metric states

- Current
- Stale
- Missing
- Partial
- Conflicting
- Unsupported
- Not applicable

Missing is never converted to zero. Stale values cannot look current.

### 9.3 Greek safeguards

Per-leg Greeks show sign, units, quantity, ratio, and multiplier treatment.
Aggregate Greeks are properly signed and quantity/multiplier-adjusted. A missing
leg makes the aggregate partial or unavailable rather than zero-filled.

### 9.4 POP safeguards

Strategy POP comes from an approved model/provider. It is never created by
adding or averaging leg probabilities. Detail identifies model, assumptions,
and calculation time. Unsupported POP is labeled honestly.

### 9.5 OTM% safeguards

Each OTM% identifies strike and underlying reference price. Credit strategies
identify the short strike controlling assignment risk. Multi-short-leg
strategies expose each material short strike.

### 9.6 Volatility safeguards

IV Rank and IV Percentile include definition, lookback, and methodology and are
not treated as interchangeable. Contract and underlying IV are labeled.

### 9.7 Liquidity safeguards

Liquidity considers OI, current volume, bid/ask width, percentage width, quote
quality, market session, and freshness. OI alone is insufficient. Policy states
whether degradation warns, lowers confidence, makes a candidate ineligible, or
blocks action.

### 9.8 Entry-to-position traceability

Analytics supporting the recommendation remain as an immutable entry snapshot.
Current live analytics are separately timestamped and labeled. TradeEdge never
represents entry values as current.

## 10. Strategy-specific analytics interpretation

- **CSP:** short-put delta, POP, short-strike OTM%, IV, liquidity, assignment
  probability context, breakeven, and capital commitment.
- **BPS:** both legs, net Greeks, short-strike OTM%, spread liquidity, width,
  maximum loss, and pin/expiration risk.
- **CC:** stock plus short-call exposure, covered quantity, short-call and net
  Greeks, POP, OTM%, IV, liquidity, call-away risk, and ex-dividend/early
  assignment.
- **BCS:** both legs, net/per-leg Greeks, short-strike OTM%, spread liquidity,
  maximum loss, and expiration risk.
- **Long-dated call:** delta, gamma, theta, vega, intrinsic/extrinsic value, IV,
  liquidity, duration, and capital at risk; no misleading short-premium POP.
- **PMCC:** both legs, net/per-leg Greeks, diagonal relationship, short-strike
  OTM%, valid POP, net capital at risk, both-leg liquidity, assignment
  asymmetry, and remaining long-leg duration.
- **Stock-only:** option analytics are not applicable; covered-call candidate
  analytics belong to the opportunity until opened.

## 11. Data & Evidence

### 11.1 Decision-level Evidence

For each decision:

- Exact source for broker, quote, chain, position, volatility, event, news, and
  probability inputs
- Input values and timestamps
- Calculation definitions and formulas
- Greek conventions, units, quantity, ratio, and multiplier treatment
- POP provider/model, assumptions, and time
- OTM strike and reference price
- IV Rank/Percentile methodology and lookback
- Economics and capital definitions
- Policy rules evaluated, warned, blocked, or unavailable
- Missing, stale, partial, conflicting, unsupported, and not-applicable inputs
- Effect on eligibility, preference, confidence, warning, or block

### 11.2 System-level Evidence

System evidence includes:

- Data-provider and broker health
- Last successful refresh by source
- Market session
- Freshness classifications
- Partial/outage/conflict status
- Recommendation/publication run identity and completeness
- Reconciliation state
- Policy/configuration version
- Audit continuity across opportunity, order handoff, and position

System evidence never substitutes for decision-level evidence.

## 12. Structured events and news

Events and news are structured decision inputs, not an undifferentiated feed.
Each item includes:

- Event type
- Symbol/portfolio scope
- Scheduled/observed time
- Source and provenance
- Freshness and confirmation state
- Expected or observed decision relevance
- Affected opportunity/position identities
- Whether it changes eligibility, urgency, confidence, or management action

Earnings, dividends, ex-dividend dates, expirations, assignments, exercises,
macro releases, corporate actions, and material news retain distinct meaning.
Unconfirmed news is labeled and cannot silently become policy fact.

## 13. Complete decision-state vocabulary

The presentation vocabulary is:

- Recommended
- Conditional
- Eligible-not-preferred
- Warning
- Blocked
- Rejected/Ineligible
- Informational
- Monitor
- No-action-needed
- No-eligible-opportunity
- Completed/Closed

Every state includes action, urgency, decisive reason, and what would change it.
Warning is not automatically rejection. Eligible-not-preferred remains
actionable comparison context. No-eligible-opportunity is a genuine evaluated
outcome, not an error or empty state.

## 14. Loading, failure, empty, and reconciliation states

- **Loading:** no current evaluation is yet available.
- **Refreshing:** prior complete publication remains visible and labeled while
  a replacement evaluates.
- **Pending order:** order truth is visible and may suppress contradictory new
  actions.
- **Ambiguous structure:** TradeEdge cannot safely classify legs/coverage;
  management recommendations are blocked as policy requires.
- **Empty:** the source population is genuinely empty.
- **No candidate:** inputs exist but no candidate was produced.
- **No eligible opportunity:** evaluation completed and none are eligible.
- **Reconciliation required:** broker/order/position truth is unresolved.
- **Evaluation error:** the attempt failed; prior valid publication may remain
  visible with explicit stale/failure treatment.
- **Partial/degraded data:** available facts remain visible with policy effect.
- **Unavailable:** required system or source is unavailable.

These states cannot be collapsed into one generic empty message.

## 15. Cross-workspace transitions and continuity

Transitions preserve exact identity and decision history:

- Today → exact Opportunity or Position Decision Detail
- Briefing event → affected decision/position
- Opportunity → Evidence or alternative
- Opportunity → external execution handoff
- Reconciled execution → Position
- Position → Evidence, order, event, or management decision
- Mission Control → exact actionable workspace item

Recommendation identity, structure, economics, analytics snapshot, decisive
reason, policy version, and evidence survive the opportunity-to-position
transition. Current analytics and new management decisions remain distinct.

## 16. Conceptual screen inventory

1. Mission Control overview
2. Today finite action queue
3. Briefing / since-last-review
4. Structured events and news
5. Opportunities discovery and controls
6. Opportunity results list
7. Opportunity Decision Detail
8. Opportunity alternatives comparison
9. Opportunity Data & Evidence
10. External execution handoff review
11. Positions list
12. Position Decision Detail
13. Position lifecycle/order/reconciliation history
14. Position Data & Evidence
15. Portfolio & Policy
16. System Data & Evidence / source health

Each screen follows the shared hierarchy and authoritative ownership.

## 17. Phase 3 handoff requirements

Phase 3 must preserve:

- Five-workspace ownership
- Today ordering, finite-queue behavior, and outcomes
- Complete opportunity journey and external handoff
- Position lifecycle truth and action precedence
- Portfolio & Policy context
- Decision- and system-level Evidence
- Structured event/news semantics
- Complete decision-state vocabulary
- Loading, error, ambiguity, empty, no-candidate, no-eligible, pending-order,
  and reconciliation states
- Cross-workspace identity and continuity
- Summary, Decision Detail, and Evidence hierarchy
- Shared Opportunity and Position Analytics Contract
- Per-leg and aggregate Greek safeguards
- POP, OTM%, IV, OI, volume, quote liquidity, freshness, and provenance
- Entry-snapshot versus current-analytics distinction
- Strategy-specific interpretations
- Configurable-policy boundaries

Phase 3 must create strategy flowcharts against these contracts without
inventing a competing presentation or analytics model.

## 18. Future Considerations

Future phases may consider:

- Provider/model comparison and calibration
- Historical analytics replay
- Scenario and stress analysis
- User-configurable summary density
- Accessibility and mobile optimization
- Explainable policy simulation
- Broker-native execution integration after separate authorization
- Cross-account and tax-aware analysis
- Advanced volatility-surface and skew presentation
- Automated anomaly detection for conflicting or degraded analytics

These are not Phase 2 requirements and do not authorize implementation.

## 19. Proposed decisions

### D-013 — Five-workspace architecture

Approve Mission Control, Today, Briefing, Positions, and Opportunities as the
five workspaces with the ownership defined here.

### D-014 — Three-level hierarchy

Approve Summary → Decision Detail → Data & Evidence as the standard hierarchy.

### D-015 — Today ownership

Approve Today as the finite action queue that summarizes and routes without
owning full detail or independent calculations.

### D-016 — Opportunities ownership and external handoff

Approve the complete opportunity journey, alternatives model, and intentional
external execution handoff.

### D-017 — Positions lifecycle and action precedence

Approve Positions as owner of lifecycle truth, management objectives, orders,
reconciliation, and precedence rules.

### D-018 — Portfolio, policy, events, and evidence

Approve the Portfolio & Policy context and decision/system Evidence contracts,
including structured events and news.

### D-019 — Decision and degraded-state vocabulary

Approve the complete decision, loading, failure, ambiguity, empty,
no-candidate, no-eligible, pending-order, and reconciliation vocabulary.

### D-020 — Lifecycle-wide analytics contract

Approve one Opportunity and Position Analytics Contract with consistent metric
identity, per-leg and aggregate Greeks, valid strategy POP, strike-specific
OTM%, IV context, OI, volume, bid/ask liquidity, freshness, provenance,
explicit degraded states, and entry-to-current traceability.

## 20. Phase 2 acceptance criteria

Revision 3 is acceptable only if:

1. All five workspaces and ownership rules are preserved.
2. Today’s purpose, order, item contract, rules, and outcomes are complete.
3. Opportunity journey, summary, detail, alternatives, and external handoff are
   complete.
4. Position summary, detail, lifecycle, precedence, and strategy truth are
   complete.
5. Portfolio & Policy remains explicit.
6. Decision- and system-level Evidence are complete.
7. Structured events/news retain source, time, relevance, and decision effect.
8. The complete decision vocabulary is preserved.
9. Loading, pending-order, ambiguity, empty, no-candidate, no-eligible,
   reconciliation, and evaluation-error states remain distinct.
10. Cross-workspace transitions preserve identity and continuity.
11. The conceptual screen inventory is complete.
12. Phase 3 handoff retains every original requirement plus analytics.
13. Future Considerations remain non-authorizing.
14. Opportunity and position summaries retain economics, structure, capital,
    portfolio, order, event, and lifecycle truth while adding compact analytics.
15. One analytics contract applies to opportunities and positions.
16. Detail exposes applicable net/per-leg Greeks, POP, OTM%, IV context, OI,
    volume, quote liquidity, freshness, provenance, and economics.
17. Aggregate Greeks are signed and quantity/multiplier-adjusted.
18. POP is not synthesized from leg probabilities.
19. OTM% identifies strike and reference price.
20. Liquidity is not reduced to OI.
21. Missing analytics are not zero-filled.
22. Stale values cannot look current.
23. Degradation versus blocking is explicit and policy-driven.
24. Entry analytics remain traceable and distinct from live analytics.
25. Strategy-specific interpretations are preserved.
26. No implementation architecture, fixed unapproved thresholds, or pixel-level
    design is introduced.
27. Dean explicitly approves Revision 3.

## 21. Persona review

### Ian — strategy correctness

The strategy-specific opportunity and position truth is retained, and Dean’s
analytics are sufficient without forcing invalid POP onto long-dated calls.
Ian’s Phase 3 condition is that every strategy flow preserve structure,
economics, per-leg/net Greeks, assignment/expiration risk, and evidence.

### Sam — summary usability

The original summary content remains intact. Compact analytics are additive and
limited to DTE, POP, controlling OTM%, net delta, liquidity warning, and nearest
event. Progressive disclosure prevents Today and list views becoming data walls.

### Alan — authoritative identity

Workspace ownership, recommendation continuity, shared metric names, state
semantics, and entry-versus-current identity are explicit. No summary surface
owns a competing calculation.

### Quinn — degraded and exceptional states

Decision states remain distinct from data states. Missing, stale, partial,
conflicting, unsupported, and not-applicable metrics are explicit. Loading,
pending-order, ambiguous-structure, empty, no-candidate, no-eligible,
reconciliation, and evaluation-error states remain truthful.

### Dane — conceptual feasibility

The consolidated proposal is conceptually feasible without selecting APIs,
schemas, components, providers, or implementation architecture. Phase 3 can map
flows against these contracts.

### Frank — reconciliation

Frank finds the prior omission corrected without substituting analytics for the
original presentation requirements. No material disagreement remains across the
persona lenses. Dean remains the final authority.

## 22. Frank’s scope-discipline check

- Conceptual presentation scope only: pass
- No production API, schema, React, or implementation architecture: pass
- No code implementation: pass
- No pixel-level design: pass
- No Phase 3 flowcharts: pass
- No new fixed thresholds or strategy policy: pass
- Original presentation requirements retained and analytics added: pass

## 23. Frank’s phase-gate recommendation

**Recommendation: Revision 3 is ready for Dean’s review, not yet approved.**

The document is a full consolidation rather than an analytics-only
replacement. Phase 3 remains blocked until Dean explicitly approves Revision 3.

## 24. Dean approval options

1. **Approve Revision 3:** close Phase 2 and authorize Phase 3 planning.
2. **Approve with explicit conditions:** identify corrections required before
   Phase 3 begins.
3. **Return for correction:** provide section-specific rulings.
4. **Reject Revision 3:** Phase 2 remains open and the proposal unapproved.

Circulation, silence, or persona review does not constitute Dean’s approval.
