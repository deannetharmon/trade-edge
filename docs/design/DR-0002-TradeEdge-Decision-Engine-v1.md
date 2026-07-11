# DR-0002 — TradeEdge Decision Engine v1

**Status:** Accepted  
**Branch:** `feature/autopilot-decision-engine`  
**Date:** 2026-07-10

## Decision

The Decision Engine is a core TradeEdge domain service. It is not owned by Autopilot.

Portfolio, Screener, Hunter, Repeat Trades, Pending Orders, and Autopilot may all consume the same Decision Engine contract.

Autopilot is an execution client of the Decision Engine. It must not duplicate recommendation logic or bypass Decision Engine controls.

## Initial Scope

The first implementation slice evaluates one supplied candidate and returns one structured `DecisionAnalysis`.

Input:

- Candidate
- Objective
- Portfolio context
- Market context
- Trader preferences
- Existing Opportunity Score
- Existing Decision Confidence result

Output:

- Normalized action
- Recommendation status
- Confidence breakdown
- Supporting evidence
- Concerns
- Alternatives considered
- Review triggers
- Expected outcome
- Evaluated and blocked rules

## Canonical Output

The canonical contract is defined in:

```text
lib/decision-engine/types.ts
```

The v1 evaluator is defined in:

```text
lib/decision-engine/evaluateSingleCandidate.ts
```

Public exports are defined in:

```text
lib/decision-engine/index.ts
```

## Normalized Actions

- `WAIT`
- `BUY_SHARES`
- `SELL_CSP`
- `WRITE_CC`
- `OPEN_BPS`
- `OPEN_BCS`
- `OPEN_IC`
- `ROLL`
- `CLOSE`
- `MANAGE`
- `HOLD`
- `AVOID`

The engine recommends an action, not merely a strategy name.

## Strategy Selection Principle

The engine is objective-driven rather than strategy-driven.

It should first determine the portfolio objective and constraints, then select the strategy or action that best satisfies them.

Examples:

- A CSP may be preferred when ownership is desirable and buying power is sufficient.
- A BPS may be preferred when the directional thesis is bullish but capital efficiency or defined risk is more important.
- A BCS may be recommended for a justified bearish or hedging objective, but it is not a default income strategy.
- `WAIT` and `AVOID` are valid first-class recommendations.

## Safety Boundary

Decision Engine v1 cannot execute trades.

Every `DecisionAnalysis` includes:

```text
executionAllowed: false
paperExecutionAllowed: false
```

No paper or live-order path is part of this implementation slice.

## Next Implementation Steps

1. Add deterministic fixtures for CSP, BPS, BCS, and WAIT/AVOID outcomes.
2. Add an API route that evaluates one supplied fixture or request candidate.
3. Add a reusable Decision Analysis display component.
4. Validate TypeScript and Vercel build.
5. Expand from one candidate to ranked alternatives only after the single-candidate analysis is reviewed.
