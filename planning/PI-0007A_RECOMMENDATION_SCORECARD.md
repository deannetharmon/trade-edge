# PI-0007A — Recommendation Scorecard

## Objective

Make the intent-selection engine observable without changing its decisions.

TradeEdge must expose how each management intent was scored, why the winning intent won, which intent was runner-up, and how large the decision margin is.

This sprint is diagnostic only. It must not change any scoring weights, thresholds, recommendations, rule IDs, priorities, or actionability.

## Product Principle

The Decision Engine must be explainable before it is tuned or automated.

A user or developer should be able to answer:

- Which intents were evaluated?
- What score did each intent receive?
- Which evidence items added or subtracted points?
- Why did the winner beat the runner-up?
- How decisive was the result?

## Scope

Implement a recommendation scorecard for the existing `selectManagementIntent()` engine.

The scorecard must be available on each Position Intelligence panel behind a collapsed developer/debug section.

## Required Model Changes

Extend the existing management-intent result so that each candidate includes:

- canonical intent
- display label
- total score
- ordered score contributions
- whether it is the winner

Each score contribution must include:

- stable identifier
- human-readable label
- signed point value
- explanation
- source evidence field, when known

Also expose:

- winning intent
- winner score
- runner-up intent
- runner-up score
- decision margin: `winnerScore - runnerUpScore`
- confidence tier derived only from the margin

Recommended confidence tiers for display only:

- High: margin >= 30
- Medium: margin >= 15 and < 30
- Low: margin < 15

These tiers are observability metadata only. They must not change the selected intent.

## Implementation Requirements

### 1. Preserve Current Decisions

For identical evidence, PI-0007A must return the same winning intent as PI-0006B.

Do not change:

- score weights
- baselines
- relevant-intent sets
- tie-break ordering
- trigger logic
- thresholds
- labels
- Rule IDs

### 2. Expose All Relevant Candidates

Return every intent considered for the current context, sorted by:

1. total score descending
2. existing tie-break order

Do not expose intents excluded by the existing relevant-intent set.

### 3. Capture Score Contributions at the Source

Do not reconstruct explanations later in the UI.

When `managementIntent.ts` adds points through its scoring helper, record the contribution at that moment.

Negative contributions are allowed if the current engine already applies them. Do not introduce new deductions solely for display.

### 4. Add a Collapsed Debug Panel

In Position Intelligence, add a collapsed section labeled:

`Decision Scorecard`

When expanded, show:

- winning recommendation
- confidence tier
- decision margin
- ranked candidate intents with scores
- score contributions under each candidate

Example:

```text
Decision Scorecard

Winner: Cut Losses
Confidence: High
Margin: 42

Cut Losses — 112
  +100 Material loss threshold breached
  +12 Weak health confirmation

Reduce Risk — 70
  +40 Net Edge declined from peak
  +30 Tight strike buffer

Hold Position — 10
  +10 Baseline

Roll Position — 5
  +5 Baseline
```

Use the existing theme system. Keep the presentation compact and visually secondary to the recommendation.

### 5. No User-Facing Recommendation Changes

The existing recommendation title, reasons, concerns, review triggers, lifecycle event, and management choices must remain unchanged.

The scorecard is supplemental diagnostic information only.

## Acceptance Scenarios

### SOXL 135/130 BPS

Expected:

- Hold Position remains the winner.
- The scorecard shows why Hold beat Cut Losses and Reduce Risk.
- The recommendation itself does not change.

### SOXL 155/150 BPS

Expected:

- Cut Losses remains the winner.
- The scorecard shows the contribution from material loss and weak health.
- Roll does not win without roll-specific evidence.

### NVDA Wheel CSP

Expected:

- Existing winning intent remains unchanged.
- Only Wheel-relevant intents are shown.

### Profit Target

Expected:

- Take Profit remains the winner.
- Profit-target evidence is visible as a score contribution.

### Weak-Evidence Position

Expected:

- Hold may win on baseline.
- Confidence should be Low when the winner narrowly beats the runner-up.

## Tests

Add focused tests covering:

- score totals remain identical to current selection behavior
- contributions sum exactly to each candidate total
- candidates are sorted correctly
- decision margin is correct
- confidence tiers are correct at boundaries
- excluded intents are not returned
- existing PI-0006B acceptance scenarios preserve the same winner
- Position Intelligence renders the collapsed scorecard and expands it correctly

## Constraints

Do not:

- change intent scoring weights
- add or remove evidence signals
- wire new technical data
- change AI prompts
- change health scoring
- redesign Position Intelligence
- add portfolio optimization
- add Autopilot behavior
- create a second decision engine
- create additional planning documents

## Validation

Run targeted tests while developing.

At completion, run once:

```bash
npm test
npx tsc --noEmit
npm run build
```

If a command exceeds five minutes, stop it and report the result. Do not investigate or reinstall the environment.

## Final Report

Provide only:

- What changed
- Files changed
- Tests
- TypeScript
- Build
- Commit hash
- Any narrowly scoped follow-up item
