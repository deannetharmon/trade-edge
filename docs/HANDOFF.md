# TradeEdge — Session Handoff

Last updated: 2026-07-17 (post PI-0013 Daily Briefing Dashboard). Paste this file (or point Claude at its repo path) at the start of a new chat to resume with full context.

## Governance

All future implementation planning, sprint management, repository management, and release decisions shall conform to:

planning/PROJECT_GOVERNANCE.md

If this handoff document conflicts with PROJECT_GOVERNANCE.md, the governance document takes precedence until intentionally amended.

## Project

Next.js/React options-trading dashboard (`options-screener`), deployed via Vercel. Repo: `/Users/deanharmon/Github/trade-edge` (this is Dean's selected/mounted folder — Claude reads and writes here directly).

Dean's standing preferences: full files not snippets (unless asked), very concise responses, check the project for context before asking questions.

## Current git state

- Active branch: `feature/portfolio-intelligence`
- Latest local commit: `59de0c5` — "feat(portfolio): add daily briefing dashboard" (PI-0013)
- Previous local commit: `69b64c3` — "feat(portfolio): add portfolio review composition layer" (PI-0012A) — **confirmed pushed** to `origin/feature/portfolio-intelligence` by Dean between sessions (verified via `git rev-list --left-right --count HEAD...origin/...` showing `0  0`).
- Local sandbox has no git network credentials, so pushes still need to happen from Dean's machine:
  ```
  git fetch
  git push origin feature/portfolio-intelligence
  ```
- **Known sandbox quirk**: `.git/index.lock` / `.git/HEAD.lock` can't be `unlink`ed (FUSE permission error) but CAN be renamed aside via Python immediately before any git command:
  ```python
  import os
  for f in ['.git/index.lock', '.git/HEAD.lock']:
      if os.path.exists(f):
          os.rename(f, f + '.bak' + str(os.getpid()))
  ```
  Harmless `tmp_obj_XXXX` unlink warnings during `git add`/`commit` are expected and non-fatal.
- **`npm run build` (`next build`) hangs at the initial Next.js banner in this sandbox** across multiple sessions/tickets — near-zero CPU, never completes. Treated as a sandbox/environment limitation, not a code defect, whenever `tsc --noEmit` is clean and tests pass. Recommend Vercel's build as the authoritative check. Don't burn time re-investigating this unless asked.
- Branches that exist: `backup/autopilot-before-main-merge`, `backup/portfolio-intelligence-before-sync`, `feature/autopilot`, `feature/autopilot-decision-engine`, `feature/portfolio-intelligence` (current), `main`, plus matching remotes, and `origin/feature/portfolio-lifecycle`, `origin/feature/watchlist-unification`. **`feature/autopilot-paper-mode` does NOT exist** — a ticket referenced it as a push target; flagged to Dean rather than silently substituted.

## Repo conventions learned this session

- Engineering-facing implementation reports live at `docs/reviews/<TICKET-ID>-Implementation-Report.md` (e.g. `PI-0006A-Implementation-Report.md`). Product-owner-facing reports are delivered as `.docx` via the `docx` skill when explicitly requested in that format.
- `docx` skill workflow: Node + `docx` npm package (not always preinstalled — `npm install docx --silent` if `require('docx')` fails), US Letter page size, `HeadingLevel`, `Table`/`TableRow`/`TableCell` need width set both on the table (`columnWidths`) and per-cell (`width`), both in DXA; `ShadingType.CLEAR` not `SOLID`; bullets via `numbering` config with `LevelFormat.BULLET` (never literal `•` chars). Verify rendering with `soffice.py --headless --convert-to pdf` → `pdftoppm -jpeg` → `Read` the resulting JPEGs before delivering.
- Tests: `vitest` (`npm test` = `vitest run`), colocated in `__tests__/` folders next to the module.
- `lib/portfolio-intelligence/` is the core rules/scoring engine for objectives, recommendations, priority scoring, health scoring, decision review, etc. — large, mature module built up over many tickets (see ticket log below).
- No existing "Max Loss" column matched the CSP risk-display request when it first came in — those files (`lib/calculateCspRisk.ts`, `components/CspRiskCell.tsx`) were built as standalone/portable code, not wired into a specific existing table cell, and Dean was told this explicitly.

## Ticket history (chronological, all complete unless noted)

Long run of Portfolio Intelligence (`PI-00xx`) tickets, each following the same loop — explore → implement → test → validate (`vitest`, `tsc --noEmit`, attempt `next build`) → commit — all on `feature/portfolio-intelligence`:

- **PI-0006A** — Assertive Recommendation Engine (decisive labels: "Exit Position", "Take Profit", etc., replacing generic "Watch"/"Roll Soon"/"Manage position").
- **PI-0006B** — Management Intent engine (`ManagementIntent` type + selection logic, net-edge decline evidence).
- Decision Scorecard added to Position Intelligence panel.
- **Remaining Opportunity Engine** (`lib/portfolio-intelligence/remainingOpportunity.ts`).
- **Decision Quality Matrix** — centralized scoring weights refactor.
- **Decision Review / Outcome Tracking** — persistence layer, Decision History subpage, "Needs Follow-Up" view.
- **Trade Log reconstruction** — shared `lib/tradeLog/reconstructTrades.ts` used by both trade-log and performance pages.
- **PI-0009A** — Position lifecycle snapshots (Redis-backed API route + capture wiring).
- **PI-0009B** — Outcome analysis wired into Decision History.
- **PI-0010A** — Today's Priorities dashboard (`buildTodaysPrioritiesDashboard`, new default portfolio tab).
- **PI-0010B** — Intelligent Prioritization (`lib/priorityScore`, `PriorityRankedList` component).
- **PI-0011A** — Mission Control tab (`MissionControl.tsx`).
- **PI-0011B** — Portfolio Health Engine (`lib/portfolioHealth`, health score section in Mission Control).

Then, separately (not part of the PI-00xx sequence):

- **CSP Max Loss / risk display** — added `lib/calculateCspRisk.ts` + `components/CspRiskCell.tsx` showing a 2-sigma volatility-based loss estimate ("Realistic Loss" at the time) alongside the existing "Capital at Risk" (stock-to-$0 theoretical worst case). Delivered with a product-owner-facing `.docx` implementation report (`docs/reviews/CSP-Realistic-Loss-Implementation-Report.docx`, still in repo, now superseded — see below).
- **CSP terminology refinement (commit `e35c96d`)** — renamed "Realistic Loss" → **"2σ Scenario Loss"** everywhere (field name `scenarioLoss`, was `realisticLoss`; `expectedMove`, was `twoSigmaMove`) because the old label implied more statistical certainty than the calculation provides. Kept the Capital at Risk calculation and all CSP math completely unchanged except one narrow defensive fix: `daysToExpiration` is now clamped to ≥0 before `Math.sqrt()` to prevent `NaN` on invalid/negative DTE input (doesn't change output for any valid DTE). Added a visible "2σ Scenario Loss" label in the UI (previously the primary value had no visible text label) and rewrote the tooltip to describe it as a modeled scenario, not a prediction. Added 8 new targeted tests (`lib/__tests__/calculateCspRisk.test.ts`) covering breakeven, both IV input formats (whole-percent vs. decimal), the $0 floor, DTE=0, and the negative-DTE regression. Report: `docs/reviews/CSP-2Sigma-Scenario-Loss-Terminology-Refinement.docx`.
- **Portfolio Intelligence UX Polish (commit `2ee4b0e`)** — readability/layout refactor of the expanded Position Intelligence panel, no scoring/calculation/recommendation-logic/API changes. Added a `SuggestedActionCard` at the top of `PositionIntelligencePanel.tsx` (urgency-colored, elevates label/suggested action/confidence/confidence-tier/top evidence/remaining-opportunity — all pre-existing values, nothing newly computed); restructured the rest of the panel into a responsive `grid-cols-1 lg:grid-cols-2` layout (narrative left, reference/next-steps right); hid the existing Decision Scorecard and Decision Review sections behind `SHOW_DECISION_SCORECARD`/`SHOW_DECISION_REVIEW` flags (both `false` — logic/persistence untouched, one-line flip to restore, but their in-panel expand/collapse tests were removed since they're unreachable while hidden); added a "RULE ENGINE'S EXISTING CALL" block to `buildPositionPrompt()` in `app/portfolio/page.tsx` instructing the AI Analysis prompt not to restate the rule engine's existing recommendation verbatim (prompt copy only, JSON schema/API unchanged). Report: `docs/reviews/Portfolio-Intelligence-UX-Polish-Implementation-Report.md`.
- **PI-0012 — Portfolio Review Architecture (design only, commit `fcaebce`)** — a design document (`docs/design/PI-0012-Portfolio-Review-Architecture.md`) inventorying every existing Portfolio Intelligence engine (Health Score, canonical objectives, Priority Score, Decision Review/Outcome Analysis, Trade Log) and proposing a thin `lib/portfolioReview/` composition layer for a new "Portfolio Review" capability, rather than a second scoring engine. Identified two genuinely new (but purely additive) aggregations needed — trailing performance rollup and portfolio-level decision-quality rollup — and recommended NOT adding a new composite score. Phased as PI-0012A (composition only) through PI-0012D (window selector polish). No application code changed for this ticket.
- **PI-0012A — Portfolio Review Composition Layer (commit `69b64c3`, pushed)** — implements Phase 1 of the PI-0012 design. New `lib/portfolioReview/` package (`buildPortfolioReview()`, pure, no fetch/API/React) composes the existing Portfolio Health Score, canonical portfolio-level objectives (concentration/buying-power/idle-cash/income, filtered not re-evaluated), and Today's Priorities' already-scored objectives (Top Risks, sorted not re-ranked) into one `PortfolioReviewSnapshot`, plus a new Portfolio Composition aggregation (position count, strategy counts, symbol concentration via the existing `derivePositionConcentration()` helper, Wheel-managed fraction via the existing `deriveWheelDominance()` helper). Rendered via a new `<PortfolioReviewCard>` placed as the first section on the Portfolio page's Positions tab, above the position list — deliberately not a new tab. No new score, no new ranking, no new recommendation logic, no persistence, no AI. Trailing performance and Decision Quality rollups are explicitly deferred to PI-0012B/C. Report: `docs/reviews/PI-0012A-Portfolio-Review-Composition-Implementation-Report.md`. A product-owner-facing summary was also produced: `docs/reviews/PI-0012A-Portfolio-Review-Implementation-Summary.docx`.
- **PI-0013 — Daily Briefing Dashboard (just completed)** — a new "Today's Briefing" card, first on the Portfolio page (above Portfolio Review). New `lib/dailyBriefing/` package (`buildDailyBriefing()`, pure, no fetch/API/React/AI) composes Portfolio Review's `PortfolioReviewSnapshot` (Health, Top Risks, concentration/capital concerns — all reused verbatim) and Today's Priorities' dashboard (DTE/earnings/follow-up buckets for Upcoming Events, opportunity buckets for Opportunity Summary, Immediate Action for Risk Summary) into one `DailyBriefing` model: a deterministic (no AI/LLM) template-generated Executive Summary sentence, Today's Priorities (Portfolio Review's own Top Risks, unchanged), a Portfolio Snapshot stat grid, Upcoming Events, Opportunity Summary, and a five-category Risk Summary (concentration, capital, assignment exposure via the existing `OBJ-ASSIGNMENT-RISK` ruleId tag, earnings exposure, immediate attention). `averagePositionHealth` was lifted out of the page's existing `healthInput` computation into its own single-source `useMemo` so both Portfolio Health and this new card read the same value rather than each computing it separately. No new score, no new ranking, no new recommendation logic, no persistence, no AI. Report: `docs/reviews/PI-0013-Daily-Briefing-Implementation-Report.md`.

## Loose ends / things a fresh session should know

1. **Push not yet done for the new PI-0013 commit** — sits directly on top of `69b64c3` (confirmed already on `origin/feature/portfolio-intelligence`), so `git fetch && git push origin feature/portfolio-intelligence` from Dean's machine should apply cleanly, no rebase expected.
2. **Old CSP docx still in repo, untracked**: `docs/reviews/CSP-Realistic-Loss-Implementation-Report.docx` is now superseded by `CSP-2Sigma-Scenario-Loss-Terminology-Refinement.docx` but was left in place (files in Dean's mounted folder can't be deleted without his explicit OK). If Dean wants it removed, ask first, then use the file-delete confirmation flow.
3. **`feature/autopilot-paper-mode` doesn't exist** — if a future ticket references it again, flag it the same way rather than assuming it should just be created or substituted silently.
4. **IV-normalization edge case, documented not fixed**: a decimal IV of exactly `1.0` (100%) gets misread by the `impliedVolatility >= 1` heuristic as whole-number-percent and divided down to 1%. Known, accepted, out of scope unless a real bug report comes in.
5. **`next build` validation is unreliable in this sandbox** — don't repeatedly retry it; note the limitation and move on, consistent with how PI-0006A, the CSP ticket, the UX Polish ticket, and PI-0012A all handled it.
6. **Decision Scorecard and Decision Review are hidden, not gone** — `SHOW_DECISION_SCORECARD`/`SHOW_DECISION_REVIEW` at the top of `PositionIntelligencePanel.tsx` are both `false`. If a future ticket asks to bring either back, flip the flag and restore/rewrite the removed expand/collapse tests (see the UX Polish report's "Trade-offs disclosed" section) rather than re-implementing the underlying components, which are untouched.
7. **No visual/screenshot QA on the UX Polish layout** — this sandbox can't render the live app (same build-hang issue), so the two-column grid and Suggested Action card have only been verified via passing component tests + code review, not an actual screenshot. Worth a manual look once deployed, especially the `lg` breakpoint collapse and all four urgency colors.
8. **PI-0012B/C not started** — Trailing Performance Rollup (win rate/P&L/by-strategy from `lib/tradeLog`) and Decision Quality Rollup (recommendation accuracy from `lib/decision-review`'s outcome analysis) are designed in `docs/design/PI-0012-Portfolio-Review-Architecture.md` but not implemented. Both are additive to `lib/portfolioReview/types.ts`'s `PortfolioReviewSnapshot` — no rework of PI-0012A's `currentState`/`composition` expected.
9. **No visual/screenshot QA on the Portfolio Review card** — same sandbox rendering limitation as the UX Polish sprint; verified via passing tests and code review only. Worth a manual look once deployed, especially the empty-portfolio state and the Wheel-managed stat reading "N/A" (expected — no live position carries a `positionStrategy` yet).
10. **Portfolio Review's Wheel-managed fraction will always read "N/A" in production today** — `positionStrategy` is passed as `null` for every real position on the page (no UI control exists yet to set it, same limitation already noted for `canonicalPriorities`). Not a bug; will start reading real values once that control exists.
11. **The untracked `docs/reviews/PI-0012A-Portfolio-Review-Implementation-Summary.docx`** was created after the PI-0012A commit and is not yet part of any commit — include it in a future commit if Dean wants it version-controlled.
12. **No visual/screenshot QA on the Daily Briefing card** — same sandbox rendering limitation as PI-0012A; verified via passing tests, `tsc --noEmit`, and code review only (including a markup-level, not rendered, check of the mobile-first grid classes). Worth a manual look once deployed, especially the six-stat Portfolio Snapshot grid at each breakpoint.
13. **Daily Briefing's Executive Summary is intentionally narrow** (health, immediate attention, concentration, earnings only) — see the PI-0013 report's Trade-offs section for what else could be added as simple additional sentence clauses without restructuring anything.
14. **PI-0012B/C are still not started** — unaffected by PI-0013; both remain purely additive to `lib/portfolioReview/types.ts`'s `PortfolioReviewSnapshot`, and PI-0013's `lib/dailyBriefing` would only need trivial changes (reading two more already-existing fields) to surface either once built.

## Key files to know

- `lib/calculateCspRisk.ts` — CSP risk math (Capital at Risk + 2σ Scenario Loss).
- `components/CspRiskCell.tsx` — CSP risk table cell UI + tooltip.
- `lib/portfolio-intelligence/` — objectives, recommendations, priority scoring, health scoring, decision review engine.
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — the expanded Position Intelligence panel (Suggested Action card, two-column layout, hidden Scorecard/Review sections).
- `lib/todaysPriorities/` — Today's Priorities dashboard orchestration.
- `lib/tradeLog/reconstructTrades.ts` — shared trade reconstruction logic.
- `app/portfolio/page.tsx` — main portfolio dashboard page, wires most of the above together (large file); also home to `buildPositionPrompt()` (AI Analysis prompt), `AnalysisPanel` (AI Analysis UI, separate from Position Intelligence), the `averagePositionHealth` single-source `useMemo`, and the `portfolioReviewInput`/`portfolioReview` and `dailyBriefingInput`/`dailyBriefing` `useMemo` pairs feeding `<PortfolioReviewCard>`/`<DailyBriefingCard>`.
- `lib/portfolioReview/` — Portfolio Review composition layer (PI-0012A): `buildPortfolioReview()`, `selectTopRisks()`. Pure, no fetch/API/React; composes `lib/portfolioHealth`, `lib/portfolio-intelligence`, and `lib/todaysPriorities` output, never recomputes any of it.
- `features/portfolio/review/PortfolioReviewCard.tsx` — the Portfolio Review UI card, second section on the Portfolio page's Positions tab (below Daily Briefing).
- `lib/dailyBriefing/` — Daily Briefing composition layer (PI-0013): `buildDailyBriefing()`. Pure, no fetch/API/React/AI; composes `lib/portfolioReview` and `lib/todaysPriorities` output into a deterministic "read in 30 seconds" summary.
- `features/portfolio/dailyBriefing/DailyBriefingCard.tsx` — the Daily Briefing UI card, first section on the Portfolio page's Positions tab.
- `docs/design/PI-0012-Portfolio-Review-Architecture.md` — the design doc PI-0012A implements Phase 1 of; PI-0012B/C/D (trailing performance, decision quality, polish) still to come.
- `docs/reviews/` — all implementation reports, `.md` (engineering) and `.docx` (product-owner) as needed.
