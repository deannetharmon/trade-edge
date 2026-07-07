# TE-0006C — Daily Priority List — Implementation Report

## Executive summary

Implements a deterministic Daily Priority List that ranks open positions to answer "what should I work on today?" — using only existing information (recommendation urgency/confidence/kind, health score, DTE, and position flags already computed by TE-0006A and TE-0006B). No AI calls, no persistence, no Autopilot, no execution. A compact "Today's Priorities" panel showing the top 5 positions is mounted near the top of the Portfolio page's Positions tab. Existing Portfolio functionality is unchanged.

## Files changed

New:
- `features/portfolio/priorities/priority-types.ts` — `PriorityItem`, `PriorityPositionInput`
- `features/portfolio/priorities/priority-engine.ts` — `buildDailyPriorities`, `buildTopPriorities`, scoring
- `features/portfolio/priorities/priority-sort.ts` — deterministic comparator + rank assignment
- `features/portfolio/components/DailyPriorityList.tsx` — compact panel UI
- `docs/reviews/TE-0006C-Implementation-Report.md` — this report

Modified:
- `app/portfolio/page.tsx` — three additions only: two imports, one `topPriorities` computed from `positions` state via `buildTopPriorities`, and one panel mount inside the Positions tab. No existing logic touched.

## Priority scoring algorithm

Each position with a recommendation is scored 0-100:

```
raw   = (urgencyBase + kindBonus + healthContribution + dteContribution) * confidenceMultiplier
score = clamp(round(raw), 0, 100)
```

- **urgencyBase** — critical 80, high 60, medium 35, low 15. Urgency is the dominant signal because TE-0006B already folds assignment/earnings/loss severity into it.
- **kindBonus** — assignment-risk +15, earnings-risk +12, close-loser +12, roll-soon +8, close-winner +8, place-gtc +4, let-expire +2, watch +2, hold 0. Surfaces time-sensitive actions above passive holds.
- **healthContribution** — 0-15, scaled by inverted health score (worse health → higher priority).
- **dteContribution** — ≤3d +8, ≤7d +6, ≤14d +4, ≤21d +2, else 0. Mild near-expiration nudge.
- **confidenceMultiplier** — 0.90-1.00, so recommendation confidence only breaks near-ties.

Positions without a recommendation are excluded (nothing to act on).

## Sort order

`priority-sort.ts` sorts by: (1) score descending, (2) urgency weight descending, (3) symbol alphabetical, (4) positionId — fully deterministic and stable across renders, independent of input order. Ranks are 1-based post-sort.

## UI integration

- Panel renders only when `topPriorities.length > 0`, mounted immediately inside `{activeTab === 'positions' && (<>`, above the dry-run banner.
- Compact: rank, urgency dot, symbol, recommendation label badge (styling mirrors `PositionRecommendationBadge`), truncated reason, score. Top 5.
- No Portfolio redesign; no changes to card rendering, sorting, grouping, or actions.

## Vercel build status

Local esbuild syntax/bundle check of the patched `app/portfolio/page.tsx` passes with zero errors. Vercel is authoritative — confirm the `feature/autopilot-paper-mode` deploy is green after push.

## Manual validation status

Not run locally (no local npm per project convention). Recommend visually confirming after deploy: panel appears with real positions, top 5 ordering looks sensible, empty state (no positions / no recommendations) hides the panel.

## Technical debt

- `onSelect` click-to-scroll was intentionally omitted — cards have no `position-${id}` DOM anchors yet. Adding scroll-to-card is a small follow-up if desired.
- Scoring weights are hardcoded constants; if Autopilot's config-driven-threshold pattern is later desired here, they could move into a config object.

## Recommendations before TE-0006D

- Confirm the panel's top-5 ordering matches intuition against a live portfolio before layering anything on top of it.
- If TE-0006D introduces Advisor Cards or a full priority page, reuse `buildDailyPriorities` (the full list) rather than re-deriving — the engine already returns the complete ranked set; the panel just slices the top 5.
