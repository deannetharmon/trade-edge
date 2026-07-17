# PI-0006A — Assertive Recommendation Engine — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `7ec6b27`

## Executive summary

Portfolio Intelligence now emits one decisive, assertive primary recommendation per objective instead of the old generic/tactical labels ("Roll Soon", "Watch", "Manage position", "Review pending order"). Every recommendation is backed by 2-4 concise evidence bullets, using only data the engine already computes — no new calculations, no new rules, no threshold changes. This is a display/labeling refinement on top of the existing rule engine, not a redesign: `kind`, `ruleId`, `type`, priority/urgency/actionability, and every trigger condition are byte-for-byte unchanged. Only the user-facing `label`/`title` text, the evidence arrays, and a handful of review-trigger/duration strings changed.

"Roll Soon" is retired everywhere it wasn't backed by objective evidence that rolling specifically (vs. holding or closing) was the preferred action. The one exception — a position explicitly flagged `roll_review` in `evaluatePortfolioObjectives.ts` — keeps a roll-specific label (`Roll Position`) because that flag *is* objective evidence. Every other DTE/watch-driven case becomes `Review Position`. Pending-order age now renders as "5 hours" / "3 days" instead of raw minutes.

## Files changed

Modified:
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — added `LABEL_BY_KIND` (the one-per-kind decisive label mapping, with rationale for each choice); `makeLegacyRecommendation` now derives `label` from `kind` instead of taking it as a parameter (removed from all 9 call sites); added `buildSupportingReasons()`, which pads health-score-factor bullets with the already-computed `dte`/`pnlPct`/`buffer`/`healthScore` values whenever there are fewer than 2, guaranteeing 2-4 evidence bullets on every recommendation; renamed the DTE review-trigger label to match the ticket's "Next DTE management threshold reached" example.
- `lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` — added `humanizeMinutes()` (minutes → "X minutes"/"X hours"/"X days"), applied to `REVIEW_PENDING_ORDER`'s summary/rationale/evidence/review-trigger text; decisive titles for every rule (see table below); guaranteed second evidence bullet added to `REVIEW_THREATENED_POSITION`, `CLOSE_FOR_PROFIT`, `MANAGE_POSITION`/`ROLL_POSITION`, `REDUCE_CONCENTRATION` (symbol + sector), and `REVIEW_PENDING_ORDER`, each reusing a field already on the position/order/portfolio input (`theoreticalMaxLoss`, `currentRisk`, the already-computed concentration excess, `order.status`).
- `lib/portfolio-intelligence/prioritizePortfolioObjectives.ts` — `synthesizeWaitObjective`'s title changed from `'No action required'` to `'No Action Required'` (Title Case, matching the ticket's example verbatim).
- `lib/portfolio-intelligence/__tests__/positionObjective.test.ts` — two label assertions updated (`'Assignment Risk'` → `'Exit Position'`, `'Hold'` → `'Hold Position'`).
- `lib/portfolio-intelligence/__tests__/evaluatePortfolioObjectives.test.ts` — one rationale assertion updated (`'300 minutes'` → `'5 hours'`, reflecting the new humanized duration).

New:
- `docs/reviews/PI-0006A-Implementation-Report.md` — this report.

## Label mapping

| Kind / rule | Old label | New label | Why |
|---|---|---|---|
| `assignment-risk` | Assignment Risk | **Exit Position** | Critical urgency, tight/ITM buffer near expiration — decisive exit call |
| `close-loser` (both branches) | Close Loser | **Exit Position** | Loss-stop or weak-health-plus-loss already reached |
| `earnings-risk` | Earnings Risk | **Review Earnings Plan** | Matches ticket example verbatim |
| `close-winner` | Close Winner | **Take Profit** | Matches ticket example verbatim |
| `place-gtc` | Place GTC | **Take Profit** | Profit already accrued, just not yet protected by a working order |
| `roll-soon` | Roll Soon | **Review Position** | No flag/evidence that rolling specifically is preferred (see PI-0006A #3) |
| `let-expire` | Let Expire | **Hold Position** | Healthy, near expiration, intended to decay |
| `watch` | Watch | **Review Position** | Retires the "Monitor"-style generic call the ticket's Problem section names |
| `hold` | Hold | **Hold Position** | — |
| Portfolio `REVIEW_THREATENED_POSITION` (critical) | Review threatened position | **Exit Position** | Material loss or flagged technical/stop breach |
| Portfolio `REVIEW_THREATENED_POSITION` (earnings only) | Review threatened position | **Review Earnings Plan** | — |
| Portfolio `CLOSE_FOR_PROFIT` | Close for profit | **Take Profit** | — |
| Portfolio `MANAGE_POSITION` (CSP, assignment willing) | Monitor CSP toward assignment | **Hold Position** | Assignment is the stated goal, nothing is threatened |
| Portfolio `ROLL_POSITION` (`roll_review` flagged) | Review roll candidate | **Roll Position** | The flag *is* objective evidence rolling is preferred |
| Portfolio `MANAGE_POSITION` (plain DTE, no flag) | Manage position | **Review Position** | No evidence rolling specifically is preferred |
| `DEPLOY_IDLE_CASH` | Deploy idle cash | **Deploy Idle Cash** | Title Case, matches ticket example |
| `INCREASE_INCOME` | Increase recurring income | **Increase Income** | Decisive, concise |
| `REDUCE_CONCENTRATION` | Reduce concentration | **Reduce Concentration** | Title Case |
| `PRESERVE_BUYING_POWER` | Preserve buying power | **Preserve Buying Power** | Title Case |
| `REVIEW_PENDING_ORDER` | Review pending order | **Replace Working Order** | Matches ticket example verbatim |
| `WAIT` | No action required | **No Action Required** | Title Case, matches ticket example |

## Design decisions

**`kind`/`ruleId`/`type` untouched.** These are the stable internal identifiers other modules key off of — `managementChoices.ts` (Available Management Choices vocabulary), `nextLifecycleEvent.ts`, ranking in `prioritizePortfolioObjectives.ts`, and the type-consistency tests. Changing only the display `label`/`title` (and deriving `title` from `label`, as `buildObjective()` already did) kept the diff scoped to exactly what the ticket asked for and left every one of those modules — and their existing test suites — untouched and passing.

**Roll Position vs. Review Position.** The ticket is explicit: don't recommend rolling unless the existing rules can *objectively demonstrate* it's preferred. `positionObjective.ts`'s `roll-soon` branch fires purely off a DTE window with no roll-specific signal, so it became `Review Position`. `evaluatePortfolioObjectives.ts`'s DTE rule already had a distinct `ROLL_POSITION` type gated on an explicit `roll_review` management flag — that flag is exactly the objective evidence the ticket asks for, so that one branch alone kept a roll-specific decisive label.

**Evidence bullets via existing fields only.** Rather than add new fields to `PortfolioObjective`/`PortfolioRecommendation` or restructure the UI, bullets were guaranteed to reach 2-4 by reusing values each function already had in scope (`dte`, `pnlPct`, `buffer`, `healthScore` in `positionObjective.ts`; `theoreticalMaxLoss`, `currentRisk`, the concentration excess already computed for the concern text, and `order.status` in `evaluatePortfolioObjectives.ts`). No new calculations were introduced anywhere.

**No UI changes.** `TodaysPriorities.tsx` already renders `objective.title` prominently with `objective.summary` immediately below it, and the full evidence list directly under the rationale when expanded; `PositionIntelligencePanel.tsx` already renders `recommendation.label` under "Current Recommendation" with evidence bullets immediately below under "Why." Both already satisfied the ticket's "recommendation, then evidence immediately below" requirement structurally — the only gap was the underlying label/evidence data, which is what this ticket fixed. Confirmed via both components' existing test suites, which construct their own fixtures and don't call the evaluators, so they were unaffected by this change and required no updates.

## Tests

All 25 test files pass (run in three batches locally due to a per-command sandbox time limit, not test slowness — no failures in any batch). Two assertions were updated to reflect intentional output changes (see "Files changed" above); no other test needed touching, confirming the change stayed contained to label/evidence text as intended.

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build` did not complete in this sandbox — three attempts (~3.5 min total) all hung at the initial Next.js banner with near-zero CPU usage, which points to a sandbox/environment issue rather than a code problem (TypeScript is clean and all tests pass). Per the ticket's own instruction not to investigate the environment, this was not pursued further. Recommend treating the Vercel build on push as the authoritative build validation, per the ticket's stated assumption.

## Follow-up items

- Confirm the Vercel build succeeds for `feature/portfolio-intelligence`, since the local build couldn't be validated in this sandbox.
- Git housekeeping needed locally: this sandbox could not delete `.git/index.lock` or `.git/HEAD.lock` (a filesystem permission quirk specific to the sandbox mount) and had no stored GitHub credentials to push. The commit (`7ec6b27`) already exists locally on `feature/portfolio-intelligence`. From your own terminal:
  ```bash
  rm -f .git/index.lock .git/HEAD.lock
  git status
  git push origin feature/portfolio-intelligence
  ```
- Not manually smoke-tested against a live account/session. Recommend confirming after deploy: Today's Priorities and the Position Intelligence panel show the new decisive labels (e.g. "Exit Position," "Take Profit," "Review Position") instead of the old ones, and that a stale pending order shows a readable age ("2 days" rather than "2880m").
