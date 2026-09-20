# LEAPS-DASH-0001 — Dashboard view for "Analyze with AI" (rule-computed)

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-DASH-0001-implementation-report.md)
**Design:** Diane's dashboard mock, board 1 (revision 2). **Policy:** Ian's thresholds below.

## Problem

The Analyze with AI panel opens as paragraphs (Mechanics, Tradeoffs, Evidence, Inferences, Cautions). Dean finds it hard to take in and does not want to depend on AI text to understand a LEAPS.

## Scope

1. `lib/leaps-analysis/dashboard.ts` (pure): builds six tiles, chips, a rule line and short callouts **by rule** from the server-resolved analysis snapshot plus the candidate's IVR/IVx and the PMCC start price. No AI is involved.
2. `features/screener/components/LeapsAnalysisDashboard.tsx` renders it (tiles, coloured callouts with ✓ / ⚠ / ✗ and screen-reader labels).
3. `app/screener/page.tsx`: the panel's status line, rule line, prior-session note, discovery note, and gates list are replaced by the dashboard; the AI explanation (Mechanics … Missing) moves behind a collapsed **Read full analysis · AI review: …** control. The "AI: …" verdict is no longer a headline chip.

## Rules (Ian, 2026-09-20)

| Item | Rule |
|---|---|
| Tile tones | Delta in your range = good, outside = bad; extrinsic under your cap = good, over = bad, no cap = neutral; spread under the scan's limit = good, over = bad; breakeven above price = watch, below = good; PMCC start above = good, below = watch, unavailable = neutral; IVR outside 30–50 = watch |
| "Mostly intrinsic" | Extrinsic ≤ **15%** of cost = good callout; above = watch ("some time value at risk") |
| IVR | **< 30** "cheap to buy, thin premium to sell"; **≥ 50** "expensive to buy, calls pay well"; 30–50 no callout |
| Spread callout | Spread > **5%** (and not already over the scan's limit) = watch, with dollars per contract to cross |
| Failed gate | Each failed gate is a red callout with its own message, first in the list; unavailable gates are watch |
| Order | bad, then watch, then good |
| Wording | Callouts describe what a number means; none recommends a trade |

The thresholds live in `LEAPS_DASHBOARD_POLICY` and are pinned by tests.

## Non-goals

- No change to the analysis route, snapshot, scan qualification, or any order path.
- The AI still runs when you click Run analysis; making the dashboard available **without** clicking (a facts-only mode that skips the model) is the next ticket.
- LEAPS Advisor, Covered Call and PMCC advisors, and the Positions cards are separate tickets.

## Acceptance criteria

1. Every tile value, tone, and callout above is produced by `buildLeapsDashboard` and pinned by unit tests, including each threshold boundary (15 / 15.01, IVR 29.9 / 30 / 49.9 / 50, spread 5 / 5.1).
2. The dashboard renders whenever a snapshot exists, including when the AI output is missing or the analysis status is `MORE_INFORMATION_NEEDED`.
3. The AI explanation is collapsed by default and unchanged inside.
4. No number or sentence on the dashboard comes from the model.

## Rollout notes

No flag or environment variable. Rollback is a revert.
