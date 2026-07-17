# PI-0006B — Intent-Based Recommendation Engine

## Objective

Replace the current trigger-first recommendation model with an intent-based recommendation model.

TradeEdge must recommend the single portfolio management intent expected to maximize long-term risk-adjusted return on deployed capital.

This is an evolution of the existing Decision Engine, not a redesign.

## Product Principle

The Decision Engine recommends management intent, not broker actions.

Canonical management intents:

- Hold Position
- Take Profit
- Cut Losses
- Reduce Risk
- Roll Position
- Accept Assignment
- Replace Working Order
- Deploy Idle Cash

Broker actions such as buy, sell, close, or replace remain execution details outside the Decision Engine.

## Current Problem

Today recommendations are largely trigger-first.

Example:

```text
17 DTE
→ roll-soon
→ Roll preferred
```

That does not prove rolling is superior to holding or closing.

The engine must evaluate relevant management intents and select exactly one winner.

## Scope

Implement Version 1 of intent selection using the evidence already available in TradeEdge.

Use existing inputs where available, including:

- DTE
- P/L
- Net Edge
- Strike buffer
- Health score
- Technical factors
- Earnings
- Existing rule triggers
- Position lifecycle
- Position strategy
- Assignment preference

Do not add new market-data integrations.

Do not add AI.

Do not add opportunity-cost optimization or replacement-trade search.

## Requirements

### 1. Canonical Management Intent

Introduce a first-class `ManagementIntent` type representing the canonical intents above.

Map the selected intent onto the existing recommendation/objective model without breaking existing consumers.

### 2. Relevant Intent Set

Evaluate only intents relevant to the position or objective.

Examples:

- Credit spread: Hold Position, Take Profit, Cut Losses, Reduce Risk, Roll Position
- Wheel CSP: Hold Position, Take Profit, Accept Assignment, Roll Position, Cut Losses
- Pending order: Replace Working Order, Hold Position
- Idle cash: Deploy Idle Cash, Hold Position

### 3. Select One Winner

The engine must select exactly one primary intent.

The winning intent becomes the canonical recommendation shown by:

- Portfolio Briefing
- Today's Priorities
- Position Intelligence
- future Autopilot consumers

### 4. Evidence-Based Selection

Use existing evidence and policy thresholds only.

Do not invent unsupported calculations.

The selected intent must include concise supporting reasons from the existing data.

### 5. Roll Must Earn the Recommendation

DTE alone must never make Roll Position the winner.

Roll may win only when existing evidence specifically supports rolling over holding or exiting.

If the current system lacks enough evidence to prove that, Roll must remain a secondary alternative.

### 6. Profit and Loss Intent Specificity

Do not use generic `Close` as a canonical intent.

Use:

- Take Profit when closing to realize gains
- Cut Losses when closing to stop deterioration or enforce loss policy
- Reduce Risk when the purpose is exposure reduction rather than full exit

### 7. Strategy Awareness

Respect existing strategy and assignment preference fields.

Examples:

- A Wheel CSP with assignment preferred should not default to Cut Losses solely because assignment risk increased.
- A threatened defined-risk spread should not default to Roll without roll-specific evidence.

### 8. Compatibility

Preserve:

- stable Rule IDs
- Portfolio Objective types where practical
- Portfolio Briefing
- Today's Priorities
- Position Intelligence
- current ranking and actionability behavior unless required for intent selection

Avoid broad refactoring.

## Acceptance Scenarios

### SOXL BPS

Given:

- approximately 17 DTE
- large decline in Net Edge from peak
- weak recent technical context
- small or moderate unrealized loss
- no roll-specific evidence

Expected:

- `Roll Position` must not win automatically from DTE.
- The engine must choose one supported intent such as Hold Position, Cut Losses, or Reduce Risk.
- The recommendation must include concise reasons.

### NVDA Wheel CSP

Given:

- strategy = Wheel
- assignment preference = Prefer
- concentration elevated

Expected:

- preserve concentration awareness
- do not recommend abandoning the Wheel unless a hard-risk policy requires it
- Accept Assignment or Hold Position may win when supported

### AMD Earnings

Expected:

- outside the configured review window: no actionable earnings intent
- inside the review window: a concrete intent such as Reduce Risk, Hold Position, or Cut Losses based on existing evidence
- do not stop at a generic Review Earnings Plan if the engine has enough evidence to choose

### Profit Target

Expected:

- Take Profit wins when the existing profit-target rule is satisfied

### Material Loss

Expected:

- Cut Losses wins when existing loss policy is breached and no stronger strategy-specific exception applies

## Non-Goals

Do not implement:

- AI recommendation generation
- replacement-trade search
- portfolio-wide capital optimization
- new market-data providers
- Autopilot execution
- UI redesign
- major architecture documents

## Validation

Add focused regression tests for the acceptance scenarios.

At completion run once:

```bash
npm test
npx tsc --noEmit
npm run build
```

## Success Criterion

TradeEdge no longer hands the user a generic review task when enough evidence exists to select a concrete management intent.

The engine performs the management review and returns one assertive recommendation suitable for both human review and future Autopilot execution.
