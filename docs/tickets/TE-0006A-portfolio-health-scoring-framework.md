# TE-0006A — Portfolio Health Scoring Framework

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Create the foundational Portfolio Health Scoring framework.

This ticket should introduce a reusable, typed scoring engine that evaluates each portfolio position and produces a 0–100 health score plus factor-level explanations.

This is the foundation for future Portfolio AI recommendations, daily priorities, and advisor cards.

## Required Reading

Claude/Gemini must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/roadmap/ROADMAP.md`
- recent Portfolio page/code before making changes

Inspect current portfolio-related files and identify:

- where portfolio positions are loaded
- position type definitions
- current lifecycle/wheel logic
- existing warning/recommendation logic
- existing profit/loss, DTE, delta, IV/HV, earnings, and assignment-risk fields

## User Story

As a trader, I want Trade Edge to score the health of each portfolio position so I can quickly identify which positions need attention and which positions should be left alone.

## Scope

Implement a portfolio health scoring framework.

This ticket should create:

- a typed health score model
- a factor scoring model
- strategy-aware scoring categories
- a pure TypeScript scoring function
- minimal UI integration to expose the score where it is easy and low-risk

## Non-Goals

Do not:

- Build the full recommendation engine.
- Build Daily Priority List.
- Build Advisor Cards.
- Add AI calls.
- Add Autopilot behavior.
- Place trades.
- Change position data loading.
- Change existing position calculations unless required to read existing fields.
- Rewrite the Portfolio page.
- Add server-side persistence.
- Add new external dependencies.

## Suggested Files

Create or update as appropriate:

```text
features/portfolio/
  health/
    health-types.ts
    health-score.ts
    health-factors.ts
    health-rules.ts
```

If the project already has a better Portfolio feature/module structure, use that, but keep this engine outside React components.

## Health Score Model

The output should include:

```ts
export interface PositionHealthScore {
  positionId: string;
  symbol: string;
  score: number; // 0-100
  grade: 'excellent' | 'good' | 'watch' | 'action' | 'critical';
  summary: string;
  factors: PositionHealthFactor[];
  computedAt: string;
}
```

Suggested factor model:

```ts
export interface PositionHealthFactor {
  key: string;
  label: string;
  scoreImpact: number;
  severity: 'positive' | 'neutral' | 'watch' | 'warning' | 'critical';
  message: string;
}
```

## Scoring Principles

Start simple and deterministic.

The first scoring engine should consider available fields such as:

- DTE
- delta
- profit/loss percentage
- distance to strike / OTM percentage
- earnings proximity
- IV vs HV when available
- assignment risk
- strategy type
- lifecycle type
- bid/ask or liquidity if already available

Do not invent missing market data.

If a field is unavailable, skip that factor and include a neutral/missing-data factor only if useful.

## Strategy Awareness

The score should not treat all positions the same.

At minimum, distinguish:

- credit spreads
- CSP / short put
- covered call / short call
- long shares
- unknown/other

Do not overbuild this. Use existing position fields/types where possible.

## Score Interpretation

Suggested grade mapping:

```text
90-100 excellent
75-89  good
60-74  watch
40-59  action
0-39   critical
```

This can be adjusted if existing portfolio semantics require it.

## UI Integration

Keep UI integration minimal.

Acceptable options:

- show health score on each PositionCard
- or add a small score badge where existing warnings/lifecycle info already appears

Do not redesign the Portfolio page.

Do not add a new panel yet.

## Acceptance Criteria

- Portfolio health score engine exists as pure TypeScript.
- Score model is strongly typed.
- Each score includes factor-level explanations.
- Engine compiles.
- Portfolio UI shows the score minimally without disrupting layout.
- Existing portfolio behavior remains unchanged.
- Vercel build passes after push.
- No temporary scripts are committed.

## Validation

Use Vercel as authoritative build validation after push.

Manual smoke test when available:

1. Open Portfolio page.
2. Confirm positions render.
3. Confirm each eligible position shows a health score/badge.
4. Confirm no blank pages.
5. Confirm existing lifecycle/warning UI still appears.
6. Confirm browser console has no new runtime errors.

If live data/auth is unavailable, document that in the implementation report.

## Git Commit

After implementation:

```bash
git add .
git commit -m "feat(portfolio): add position health scoring framework"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Completion Report

After implementation, create:

- `docs/reviews/TE-0006A-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- Health scoring model
- Scoring factors
- Strategy handling
- UI integration
- Vercel build result
- Manual smoke test status
- Diff statistics
- Technical debt
- Recommendations before TE-0006B
