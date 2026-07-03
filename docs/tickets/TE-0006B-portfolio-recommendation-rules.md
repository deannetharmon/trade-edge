# TE-0006B — Portfolio Recommendation Rules

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Create the first deterministic Portfolio Recommendation Rules engine.

TE-0006A added health scoring. TE-0006B should convert health score, health factors, and existing position fields into one clear recommendation per position.

This is still rules-only. No AI calls.

## Required Reading

Claude/Gemini must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/roadmap/ROADMAP.md`
- `docs/tickets/TE-0006A-portfolio-health-scoring-framework.md`
- `docs/reviews/TE-0006A-Implementation-Report.md`

Inspect:

- `features/portfolio/health/`
- `features/portfolio/components/PositionHealthBadge.tsx`
- `app/portfolio/page.tsx`

## User Story

As a trader, I want each portfolio position to have one clear recommendation so I can quickly decide what needs attention today.

## Scope

Create a deterministic recommendation rules engine.

It should produce one recommendation per eligible position.

Suggested outputs:

- `hold`
- `watch`
- `close-winner`
- `close-loser`
- `roll-soon`
- `place-gtc`
- `let-expire`
- `earnings-risk`
- `assignment-risk`

## Non-Goals

Do not:

- Add AI calls.
- Build Daily Priority List.
- Build Advisor Cards.
- Add Autopilot behavior.
- Place trades.
- Change order execution.
- Change health score rules unless a compile issue requires it.
- Rewrite Portfolio page.
- Add server-side persistence.
- Add new external dependencies.

## Suggested Files

Create:

```text
features/portfolio/recommendations/
  recommendation-types.ts
  recommendation-rules.ts
  recommendation-engine.ts
```

Create if useful:

```text
features/portfolio/components/PositionRecommendationBadge.tsx
```

Update minimally:

```text
app/portfolio/page.tsx
```

## Recommendation Model

Suggested type:

```ts
export type PortfolioRecommendationKind =
  | 'hold'
  | 'watch'
  | 'close-winner'
  | 'close-loser'
  | 'roll-soon'
  | 'place-gtc'
  | 'let-expire'
  | 'earnings-risk'
  | 'assignment-risk';

export interface PortfolioRecommendation {
  positionId: string;
  symbol: string;
  kind: PortfolioRecommendationKind;
  label: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-100
  primaryReason: string;
  supportingReasons: string[];
  suggestedAction: string;
  computedAt: string;
}
```

## Rule Priorities

The engine must choose one primary recommendation.

Recommended priority order:

1. Critical expiration/ITM/assignment risk
2. Close loser / severe loss pressure
3. Earnings risk before expiration
4. Close winner / profit target hit
5. Roll soon / DTE management
6. Place GTC if profitable and no GTC
7. Let expire if very low risk near expiration
8. Watch
9. Hold

## Expected Rule Examples

### Close Winner

If:

- health factor includes profit target
- or `hitTarget === true`
- or `pnlPct >= 50`

Then recommendation may be:

```text
Close Winner
Take profit or keep GTC active.
```

### Roll Soon

If:

- DTE <= 21
- not a profit target
- not critical loss

Then:

```text
Roll Soon
Position is in the management window.
```

### Place GTC

If:

- profitable
- no working GTC
- not urgent close/roll

Then:

```text
Place GTC
Protect profit with a working target order.
```

### Earnings Risk

If:

- earnings date before expiration
- and earnings is upcoming

Then:

```text
Earnings Risk
Review before holding through earnings.
```

### Assignment Risk

If:

- short put/call or CSP/covered-call style position
- buffer is tight or ITM
- near expiration

Then:

```text
Assignment Risk
Review assignment/roll plan.
```

## UI Integration

Keep UI minimal.

Acceptable:

- add a compact recommendation badge beside or near the health badge
- or add a small recommendation line under existing position header

Do not redesign Portfolio.

## Acceptance Criteria

- Recommendation engine exists as pure TypeScript.
- Recommendation model is strongly typed.
- Each recommendation includes kind, label, urgency, confidence, reason, and suggested action.
- Portfolio positions can receive a recommendation.
- Minimal UI integration appears without disrupting layout.
- Existing Portfolio functionality remains unchanged.
- Vercel build passes after push.
- No temporary scripts are committed.

## Validation

Use Vercel as authoritative build validation after push.

Manual smoke test when authenticated environment is available:

1. Open Portfolio page.
2. Confirm positions render.
3. Confirm health score still works.
4. Confirm recommendation badge/line appears if UI anchor is available.
5. Confirm no blank pages.
6. Confirm browser console has no new runtime errors.
7. Confirm no order/trading behavior changed.

If preview authentication is unavailable, document that in implementation report.

## Git Commit

After implementation:

```bash
git add .
git commit -m "feat(portfolio): add recommendation rules engine"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Completion Report

After implementation, create:

- `docs/reviews/TE-0006B-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- Recommendation model
- Rule priority order
- Rule behavior
- UI integration
- Vercel build result
- Manual smoke test status
- Diff statistics
- Technical debt
- Recommendations before TE-0006C
