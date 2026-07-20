# SM-0001 / SM-0002 — Strategy-Specific Lifecycle Management

**Status:** Queued for the next sprint after the currently active work is accepted and merged  
**Priority:** High  
**Owner:** Product Owner approval recorded  
**Scope type:** Architecture validation followed by corrective implementation

## Executive Decision

TradeEdge must not apply Bull Put Spread lifecycle assumptions—especially the default 50% profit target, stop-loss handling, and 21-DTE exit rules—to every options strategy.

The next sprint must first validate the current implementation and then correct the architecture so every strategy owns an explicit lifecycle policy.

The governing question is:

> Have Bull Put Spread assumptions been embedded in generic position-management code or unintentionally applied to Cash-Secured Puts, Covered Calls, PMCCs, Iron Condors, or other strategies?

---

# SM-0001 — Validate Strategy-Specific Position Management Rules

## Objective

Audit all position-management and recommendation paths to determine whether lifecycle rules are strategy-specific, intentionally shared, or incorrectly inherited from spread-management defaults.

## Required Investigation

Search the codebase for all logic related to:

- profit targets, including 50% profit defaults
- stop-loss thresholds and stop-order construction
- DTE-based exits, especially 21-DTE rules
- roll recommendations and roll eligibility
- expiration handling
- assignment handling
- covered-call share disposition
- PMCC long-leg preservation and short-call management
- lifecycle recommendations emitted by Portfolio Intelligence, the Decision Engine, execution modals, paper trading, and any background-management process

## Strategy Validation Matrix

The audit must produce a documented matrix covering at least:

| Strategy | Profit Target | Stop Loss | Roll Rule | DTE Exit | Assignment / Expiration Logic | Current Status |
|---|---|---|---|---|---|---|
| Bull Put Spread | Validate | Validate | Validate | Validate | N/A | Pass / Gap |
| Bear Call Spread | Validate | Validate | Validate | Validate | N/A | Pass / Gap |
| Iron Condor | Validate | Validate | Validate | Validate | N/A | Pass / Gap |
| Cash-Secured Put | Validate | Validate | Validate | Validate | Required | Pass / Gap |
| Covered Call | Validate | Validate applicability | Validate | Validate | Required | Pass / Gap |
| PMCC | Validate short call | Validate applicability | Validate | Validate both legs | Required | Pass / Gap |

## Covered Call Rule to Validate

A covered call must not automatically inherit a 50% profit exit merely because the short option has captured 50% of its original premium.

The evaluation must consider the combined stock-and-option position, including:

- whether the trader is willing to sell the shares at the strike
- remaining option premium
- stock appreciation or decline
- assignment probability
- dividend and ex-dividend risk where relevant
- whether closing or rolling the call improves the total-position objective
- whether the underlying outlook has materially changed

## SM-0001 Deliverables

1. Code-path inventory with file and function references.
2. Strategy lifecycle matrix showing current behavior and intended behavior.
3. List of all generic rules that are actually strategy-specific.
4. Defect and technical-debt classification by severity.
5. Migration recommendation for SM-0002.
6. Tests that reproduce any confirmed cross-strategy rule leakage before implementation changes begin.

## SM-0001 Acceptance Criteria

- Every lifecycle decision path is accounted for.
- The source of every 50% profit, stop-loss, DTE, roll, assignment, and expiration rule is identified.
- No strategy is marked safe based only on UI behavior; the underlying domain and submission paths must be examined.
- Existing behavior is documented before refactoring.
- Confirmed defects have failing characterization tests or a documented reason why a test cannot yet be written.

---

# SM-0002 — Implement StrategyLifecyclePolicy Architecture

## Objective

Replace implicit or generic lifecycle assumptions with explicit, deterministic, testable strategy-specific policies.

## Target Architecture

```text
Position / Candidate State
          │
          ▼
StrategyLifecyclePolicy Resolver
          │
          ├── BullPutSpreadLifecyclePolicy
          ├── BearCallSpreadLifecyclePolicy
          ├── IronCondorLifecyclePolicy
          ├── CashSecuredPutLifecyclePolicy
          ├── CoveredCallLifecyclePolicy
          └── PmccLifecyclePolicy
          │
          ▼
Canonical Lifecycle Evaluation
          │
          ├── monitor
          ├── take profit
          ├── close
          ├── roll
          ├── hold through expiration
          ├── allow / avoid assignment
          └── hard block when required data is unavailable
```

## Canonical Contract

The final shape may be refined during design review, but it must provide explicit strategy-owned evaluation for the following concerns:

```typescript
interface StrategyLifecyclePolicy<TPosition, TContext> {
  evaluate(position: TPosition, context: TContext): LifecycleEvaluation;
  evaluateProfitTaking(position: TPosition, context: TContext): LifecycleDecision;
  evaluateStopLoss(position: TPosition, context: TContext): LifecycleDecision;
  evaluateRoll(position: TPosition, context: TContext): LifecycleDecision;
  evaluateExpiration(position: TPosition, context: TContext): LifecycleDecision;
  evaluateAssignment(position: TPosition, context: TContext): LifecycleDecision;
}
```

The implementation must not force every strategy to fabricate decisions that do not apply. The design may use capability flags, discriminated unions, or narrower policy interfaces when that produces a safer domain model.

## Required Design Principles

1. **Strategy ownership** — each strategy owns its lifecycle semantics.
2. **No hidden defaults** — a generic 50% profit, 21-DTE, or stop-loss rule may run only when a strategy policy explicitly adopts it.
3. **Determinism** — the same normalized inputs must produce the same lifecycle decision and rule IDs.
4. **Explainability** — every recommendation must identify the policy, rule ID, evidence, and missing-data conditions used.
5. **Fail closed** — missing or ambiguous position structure, pricing, assignment intent, or required market data must not produce a confident action recommendation.
6. **Separation from execution** — policies recommend or block actions; broker submission remains behind the existing execution-safety boundaries.
7. **No behavioral regression** — accepted Bull Put Spread behavior must remain unchanged unless SM-0001 identifies it as incorrect and the Product Owner approves the correction.

## Initial Strategy Expectations

These are validation targets, not hard-coded implementation instructions. Final rules require Product Owner approval during the design review.

### Bull Put Spread / Bear Call Spread

- Explicit profit target policy, commonly including 50% capture when configured.
- Explicit stop-loss policy.
- Explicit DTE/gamma-risk exit policy.
- Roll only when the defined-risk economics and resulting exposure are acceptable.

### Iron Condor

- Defined-risk spread lifecycle policy.
- Combined-position evaluation rather than independently managing one side without accounting for the other.
- Explicit rules for challenged-side adjustment and whole-position closure.

### Cash-Secured Put

- Profit target and DTE rules may differ from vertical spreads.
- Assignment willingness and available cash are first-class inputs.
- Roll, close, or accept-assignment decisions must reflect the underlying ownership objective.

### Covered Call

- No automatic 50% profit exit inherited from spread rules.
- Evaluate the covered position as shares plus short call.
- Include call-away willingness, basis, strike, remaining extrinsic value, assignment risk, dividend risk, trend change, and roll quality.

### PMCC

- Preserve and evaluate the long LEAPS leg separately from the short call.
- Short-call profit management must not accidentally close or misclassify the long leg.
- Roll and assignment logic must account for diagonal structure, expiration mismatch, and exercise risk.

## SM-0002 Deliverables

1. Approved design document.
2. Canonical lifecycle-policy contract and resolver.
3. Strategy-specific policy implementations for every currently supported managed strategy.
4. Migration of existing lifecycle call sites to the canonical policy layer.
5. Stable rule IDs and explanation output.
6. Unit tests for every strategy and every applicable lifecycle action.
7. Integration tests proving generic consumers cannot silently apply another strategy's policy.
8. Updated architecture, roadmap, and implementation documentation.

## SM-0002 Acceptance Criteria

- No generic position-management code makes a strategy-specific lifecycle decision without resolving an explicit policy.
- Covered Calls do not receive an automatic 50% profit recommendation solely from short-call premium capture.
- PMCC short-call management cannot unintentionally close, overwrite, or ignore the long LEAPS leg.
- CSP decisions explicitly consider assignment willingness and capital requirements.
- Defined-risk spread behavior remains deterministic and regression-tested.
- Every lifecycle recommendation exposes its strategy policy and stable rule IDs.
- Unsupported strategies or missing policies fail visibly rather than falling back to Bull Put Spread behavior.
- Repository-wide tests, type checking, and documented build validation pass.

---

# Sprint Sequencing

SM-0001 and SM-0002 are intentionally paired in one sprint package:

1. Complete and review SM-0001 before implementation begins.
2. Freeze the confirmed lifecycle matrix and migration scope.
3. Implement SM-0002 against the approved findings.
4. Perform independent architecture review before Product Owner acceptance.

This document queues the work; it does not expand or alter the currently active sprint.