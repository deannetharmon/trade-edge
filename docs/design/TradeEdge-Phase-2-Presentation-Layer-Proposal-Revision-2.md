# TradeEdge Phase 2 Presentation-Layer Proposal — Revision 2

**Status:** Proposed; unapproved
**Decision authority:** Dean
**Phase:** 2 — conceptual presentation layer
**Revision date:** 2026-07-26

## 1. Purpose and decision requested

Revision 2 defines how TradeEdge presents decisions, opportunities, and managed
positions without turning summary surfaces into data walls. It preserves the
approved three-level hierarchy—Summary, Decision Detail, and Evidence—and adds
one authoritative Opportunity and Position Analytics Contract shared across
the lifecycle from recommendation through position management.

Dean is asked to approve, reject, or return Revision 2 with specific changes.
Until Dean explicitly approves it, Phase 2 remains unapproved and Phase 3 must
not begin.

## 2. Scope and non-goals

This proposal defines conceptual presentation behavior, information ownership,
terminology, state handling, and Phase 3 handoff requirements.

It does not define APIs, persistence schemas, React components, implementation
architecture, pixel-level designs, strategy flowcharts, new trading policy,
fixed eligibility thresholds, or scoring changes.

Today remains a summarization and routing surface. It is not the authoritative
home of full analytics and must not calculate independent values.

## 3. Presentation principles

1. A trader should understand the recommended action and decisive reason before
   opening detail.
2. Summary views stay compact; detail and evidence provide progressive
   disclosure.
3. Opportunity and position metrics use the same names, definitions, units, and
   state semantics.
4. A recommendation’s entry analytics remain traceable after it becomes a
   position and are visually distinguished from current analytics.
5. Missing, stale, conflicting, unsupported, and not-applicable values are
   explicit states, never silently coerced to zero.
6. Analytics do not imply universal applicability. Instruments display
   “not applicable” or “unavailable” honestly.
7. Eligibility thresholds remain configurable policy unless Dean explicitly
   approves a threshold as a product requirement.

## 4. Authoritative Opportunity and Position Analytics Contract

The contract applies to every new opportunity being evaluated or recommended
and every applicable existing option position being monitored or managed.

### 4.1 Shared metric identity

The following concepts have one identity across opportunity and position
surfaces:

- Position-level delta, gamma, theta, vega, and rho
- Per-leg delta, gamma, theta, vega, and rho
- Probability of Profit (POP)
- OTM percentage
- Implied volatility
- IV Rank and IV Percentile, when supported
- Open interest (OI)
- Current option volume
- Bid, ask, midpoint or mark, absolute spread width, and percentage spread width
- Quote and analytics time
- Market-data source, session, freshness, and provenance
- Credit or debit, current value, P/L, maximum profit, maximum loss or
  authoritative capital at risk, breakeven, and applicable return metric

Open interest and OI are the same measure. Implied volatility is a separate
required concept.

### 4.2 Shared state vocabulary

Each metric is either:

- **Current:** supported and within its freshness policy.
- **Stale:** supported but outside freshness policy; the prior value may be
  shown only with unmistakable stale treatment and its timestamp.
- **Missing:** expected but no value was received or calculated.
- **Partial:** some required inputs or legs are available and others are not.
- **Conflicting:** authoritative inputs disagree.
- **Unsupported:** the provider or approved model cannot supply the metric.
- **Not applicable:** the metric has no valid meaning for the instrument or
  strategy.

Zero is a legitimate numeric value only when the authoritative source or
calculation produced zero. It is never a substitute for another state.

## 5. Three-level information hierarchy

### 5.1 Summary level

Summary surfaces include Today, queues, lists, compact opportunity cards, and
compact position cards. They must remain readable and decision-useful.

Each applicable opportunity or position surfaces:

- Recommendation state, proposed/current action, urgency, and decisive reason
- DTE
- POP, with non-current state visible
- OTM% for the controlling or most decision-relevant strike, identifying that
  strike compactly
- Net position delta
- A visible liquidity warning when liquidity is degraded
- Nearest critical event
- For open positions, current P/L and progress toward the management objective

Every summary links to Decision Detail. Summary values are projections of the
authoritative analytics contract; they are not independently calculated.

### 5.2 Decision-detail level

Every applicable opportunity and option position exposes:

- Net signed, quantity-adjusted position delta, gamma, theta, vega, and rho
- Per-leg delta, gamma, theta, vega, and rho for every option leg, including
  spreads, covered calls, and PMCCs
- Strategy-level POP with model/provider, material assumptions, and calculation
  time
- OTM% for every material strike, especially every short strike
- Applicable underlying and contract implied volatility
- IV Rank and/or IV Percentile when supported, with definitions
- Open interest and current volume for every option leg
- Bid, ask, midpoint or mark, absolute bid/ask width, and percentage width for
  every option leg
- Quote and analytics timestamps
- Current economics: entry credit/debit, current value, current P/L, maximum
  profit, maximum loss or capital at risk, breakeven, and applicable return
  metric
- Nearest critical event and the event’s decision relevance
- Recommendation state, action, urgency, decisive reason, material risks, and
  management objective

Unavailable, stale, unsupported, and not-applicable fields remain visible as
explicit states where their absence affects interpretation.

### 5.3 Evidence level

Evidence exposes:

- Source for each broker, quote, chain, volatility, and probability input
- Calculation definitions and formulas
- Greek sign conventions, units, quantity treatment, and contract multiplier
- POP methodology, assumptions, provider/model, and timestamp
- OTM% definition, controlling strike, and underlying reference price
- IV Rank/IV Percentile lookback and methodology
- Quote time, analytics time, market session, freshness classification, and
  provenance
- Missing, stale, partial, conflicting, or unsupported inputs
- Whether degraded analytics reduced confidence, triggered a warning, made the
  opportunity ineligible, or blocked a recommendation
- For positions created from recommendations, the immutable entry snapshot
  alongside clearly labeled current analytics

## 6. Calculation and presentation safeguards

### 6.1 Greeks

Multi-leg strategies show each leg and the aggregate. Aggregate Greeks are
properly signed and adjusted for leg direction, quantity, ratio, and contract
multiplier. The evidence view states conventions and units. Missing leg Greeks
make the aggregate partial or unavailable; they are not treated as zero.

### 6.2 Probability of Profit

POP is strategy-level output from an approved model or provider. TradeEdge must
not add or average individual-leg probabilities. The display identifies model,
assumptions where material, and calculation time. If no valid approved POP
exists for an instrument, POP is unsupported or not applicable.

### 6.3 OTM percentage

Each OTM% identifies its strike and underlying reference price. Credit
strategies clearly identify the short strike controlling assignment risk.
Multi-short-leg strategies show each material short strike; the summary selects
the controlling or most decision-relevant value without hiding the others in
detail.

### 6.4 Volatility

Implied volatility is distinct from open interest. Contract and underlying
volatility context is labeled. IV Rank and IV Percentile state their lookback
and methodology and are not presented as interchangeable measures.

### 6.5 Liquidity

Liquidity considers open interest, current volume, bid/ask width, percentage
width, quote quality, market session, and freshness. Open interest alone is
never sufficient. A degraded result produces an explicit warning and states
whether policy degrades confidence or blocks eligibility.

### 6.6 Freshness and traceability

Stale analytics never retain current styling. Summary and detail show freshness
state, while Evidence shows timestamps, source, and policy effect. Entry
analytics remain traceable after conversion to a position, but are never
confused with live values.

## 7. Opportunity presentation contract

### 7.1 Opportunity summary

An opportunity summary answers:

- What is proposed?
- Why now?
- How urgent is it?
- What are DTE, POP, controlling-strike OTM%, and net delta?
- Is liquidity healthy?
- What critical event is nearest?
- What opens complete Decision Detail?

It may use compact values and warnings but may not omit degraded-state meaning
or calculate separate analytics.

### 7.2 Opportunity decision detail

Decision Detail includes the full shared contract, strategy-specific
interpretation, economics, recommendation rationale, material tradeoffs,
eligibility/confidence effects, and a clear path to Evidence.

### 7.3 Opportunity lifecycle

When an opportunity becomes a position, TradeEdge preserves its recommendation
identity, entry analytics snapshot, model/provenance information, and decision
reason. Current position analytics remain separately timestamped.

## 8. Position presentation contract

### 8.1 Position summary

A position summary answers:

- What is current P/L and progress toward the management objective?
- What action, if any, is recommended and why?
- What are DTE, POP, controlling-strike OTM%, and net delta?
- Is liquidity degraded?
- What event or management trigger is nearest?

It links to full Position Decision Detail.

### 8.2 Position decision detail

Position detail applies the full shared contract to the current position and
adds:

- Original thesis and entry snapshot
- Current thesis status and management objective
- Change since entry in economics, Greeks, POP, OTM%, volatility, liquidity,
  and critical events
- Current recommendation, urgency, decisive reason, and material risks
- Clear separation of entry facts from live analytics

## 9. Strategy-specific interpretation

### 9.1 Cash-Secured Put

Emphasize short-put delta, strategy POP, short-strike OTM%, IV context,
liquidity, assignment-probability context, breakeven, and capital commitment.

### 9.2 Bull Put Spread

Show both legs, signed net Greeks, short-strike OTM%, spread liquidity, width,
maximum loss, breakeven, and pin/expiration risk.

### 9.3 Covered Call

Show stock plus short-call exposure, covered quantity, short-call Greeks,
position-level Greeks, POP, short-call OTM%, IV, liquidity, call-away risk, and
ex-dividend/early-assignment context.

### 9.4 Bear Call Spread

Show both legs, net and per-leg Greeks, short-strike OTM%, spread liquidity,
maximum loss, breakeven, and expiration risk.

### 9.5 Long-dated Call

Emphasize delta, gamma, theta, vega, intrinsic/extrinsic value, IV, liquidity,
duration, breakeven, and capital at risk. Do not force short-premium-style POP
when no approved model supports it.

### 9.6 Poor Man’s Covered Call

Show long and short calls, net and per-leg Greeks, diagonal expiration/strike
relationship, short-strike OTM%, valid strategy POP, net capital at risk,
liquidity of both legs, assignment asymmetry, and remaining long-leg duration.

### 9.7 Stock-only Position

Option-specific analytics are not applicable. If TradeEdge evaluates a
covered-call candidate, its option analytics belong to that opportunity, not
to the stock position until a call is opened.

## 10. Standard decision states

Opportunity and position presentation uses a consistent state model:

- **Recommended / Action now**
- **Conditional / Action if**
- **Monitor / No action now**
- **Blocked**
- **Rejected / Not suitable**
- **Completed / Closed**, where applicable

Each state includes action, urgency, decisive reason, and analytics quality.
“Blocked” states what must become valid. “Conditional” states the trigger.
“Monitor” states what would cause reassessment. Analytics degradation is not
itself silently equated with a decision; policy states whether it warns,
reduces confidence, makes a candidate ineligible, or blocks it.

## 11. Data, failure, and degraded states

1. A summary remains visible when detail analytics are degraded, unless policy
   requires the entire decision to be blocked.
2. Missing required analytics never creates a favorable default.
3. Partial multi-leg data identifies the affected leg and prevents a falsely
   complete aggregate.
4. Conflicting sources identify the conflict and chosen authoritative source,
   or block the decision when authority cannot be resolved.
5. Stale data shows timestamp and stale classification and cannot look current.
6. Unsupported and not-applicable are distinct.
7. If a recommendation cannot be supported safely, the UI shows a truthful
   blocked or unavailable state rather than an empty or healthy state.
8. Recovery preserves the last valid snapshot as historical context while
   clearly separating it from current decision data.

## 12. Conceptual screen inventory

- **Today:** compact decisions, urgency, decisive reason, minimal analytics,
  degraded warning, and routing.
- **Opportunity queue/list:** comparable opportunity summaries with filters and
  sorting over authoritative metrics.
- **Opportunity Decision Detail:** complete contract, rationale, economics,
  strategy interpretation, and Evidence link.
- **Position list:** management-objective progress and compact current analytics.
- **Position Decision Detail:** complete current contract plus entry-to-current
  comparison.
- **Evidence:** provenance, formulas, assumptions, units, timestamps, freshness,
  missing/conflicting inputs, and decision impact.

No screen owns a competing definition of a shared metric.

## 13. Phase 3 handoff requirements

Phase 3 may begin only after Dean approves Revision 2. The handoff must preserve:

- The three-level hierarchy
- The shared metric names, definitions, units, and state vocabulary
- Per-leg and aggregate Greek requirements
- POP, OTM%, volatility, liquidity, freshness, and provenance safeguards
- Entry-snapshot/current-analytics distinction
- Strategy-specific interpretations
- Configurable-policy boundary for thresholds
- Explicit degraded-data effects on eligibility and confidence

Phase 3 must trace each strategy flow through Summary, Decision Detail, and
Evidence without designing a second analytics contract.

## 14. Phase 2 acceptance criteria

Revision 2 is acceptable only if:

1. One analytics contract applies to opportunities and positions.
2. Summary surfaces remain compact and route to complete detail.
3. Decision Detail includes all applicable Greeks, POP, OTM%, IV context, OI,
   volume, quote liquidity, freshness, provenance, and economics.
4. Evidence exposes sources, definitions, formulas, units, assumptions, and
   decision effects.
5. Multi-leg aggregate Greeks are signed and quantity/multiplier-adjusted.
6. Strategy POP is never synthesized from leg probabilities.
7. OTM% identifies strike and reference price.
8. Liquidity is not reduced to OI.
9. Missing analytics are never zero-filled.
10. Stale values cannot look current.
11. Degradation versus blocking is explicit and policy-driven.
12. Entry analytics remain traceable and distinct from current analytics.
13. All seven strategy interpretations are preserved.
14. Opportunity and position screen contracts use consistent terms.
15. Standard decision and degraded-data states are reconciled.
16. Phase 3 handoff requirements are explicit.
17. No implementation architecture, fixed unapproved thresholds, or pixel-level
    design is introduced.
18. Dean explicitly approves Revision 2.

## 15. Material change summary

Revision 2 materially updates:

- Opportunity Summary Contract
- Opportunity Decision Detail
- Position Summary Contract
- Position Decision Detail
- Data & Evidence
- Standard Decision States
- Data/failure/degraded states
- Conceptual Screen Inventory
- Phase 3 handoff requirements
- Phase 2 acceptance criteria

The central correction is the authoritative lifecycle-wide analytics contract,
including full Greeks, POP, OTM%, volatility, OI, volume, quote liquidity,
freshness, provenance, economics, and explicit degraded states.

## 16. Persona review

### Ian — strategy correctness

Ian’s lens is satisfied conceptually: each strategy receives decision-relevant
analytics without forcing inappropriate metrics. The long-dated-call POP
exception and PMCC assignment asymmetry are explicit. Ian requires Phase 3 to
prove each strategy flow preserves the contract.

### Sam — summary usability

Sam’s lens is satisfied: Summary is limited to action, urgency, decisive reason,
DTE, POP, controlling OTM%, net delta, liquidity warning, critical event, and
position progress/P&L. Full analytics remain progressively disclosed.

### Alan — authoritative identity

Alan’s lens is satisfied: metric names, definitions, state semantics, and
entry-versus-current identity are shared across opportunity and position
surfaces. No summary surface calculates an independent version.

### Quinn — degraded and exceptional states

Quinn’s lens is satisfied conceptually: missing, stale, partial, conflicting,
unsupported, and not-applicable are distinct; zero-filling is prohibited; and
decision impact must be stated.

### Dane — conceptual feasibility

Dane finds the contract conceptually feasible without selecting APIs, schemas,
components, providers, or implementation architecture. Phase 3 will need to
resolve flow behavior within these boundaries.

### Frank — reconciliation

Frank finds no material disagreement among the stated persona lenses. The
tradeoff between summary readability and analytic completeness is resolved
through progressive disclosure. No claim is made that the named reviewers
personally approved this document; these are explicit lens-based evaluations
for Dean’s decision.

## 17. Frank’s scope-discipline check

- Conceptual presentation scope only: pass.
- No application/codebase comparison: pass.
- No production API, database, React, or implementation architecture: pass.
- No pixel-level design: pass.
- No Phase 3 flowcharts: pass.
- No new fixed thresholds or strategy policy: pass.
- No implementation work: pass.

## 18. Frank’s phase-gate recommendation

**Recommendation: return to Dean for conditional review, not approval yet.**

Revision 2 incorporates Dean’s analytics ruling comprehensively and is
conceptually ready for sponsor review. However, the four named authoritative
input documents were not available in the supplied attachment or accessible
workspace under their stated names. A final source-text reconciliation is
required before Frank can recommend unconditional approval. Phase 2 remains
unapproved.

## 19. Dean approval options

1. **Approve Revision 2** after confirming it is consistent with the four
   authoritative inputs. This closes Phase 2 and authorizes Phase 3 planning.
2. **Approve with explicit conditions** identifying required wording or policy
   clarifications that must be incorporated before Phase 3 begins.
3. **Return for correction** with section-specific rulings.
4. **Reject Revision 2** and retain the prior proposal as unapproved.

Dean remains the final decision authority. Silence or circulation does not
constitute approval.
