# TradeEdge — Session Handoff

Last updated: 2026-07-16 (post UX Polish sprint). Paste this file (or point Claude at its repo path) at the start of a new chat to resume with full context.

## Project

Next.js/React options-trading dashboard (`options-screener`), deployed via Vercel. Repo: `/Users/deanharmon/Github/trade-edge` (this is Dean's selected/mounted folder — Claude reads and writes here directly).

Dean's standing preferences: full files not snippets (unless asked), very concise responses, check the project for context before asking questions.

## Current git state

- Active branch: `feature/portfolio-intelligence`
- Latest local commit: `2ee4b0e` — "refactor(portfolio-intelligence): expanded panel UX polish"
- Latest known remote commit: `5cc82c5` — "docs: add session handoff for portfolio intelligence" (Dean committed/pushed this + `e35c96d` himself after the last session). **`2ee4b0e` sits directly on top of `5cc82c5` with no divergence** (confirmed via `git merge-base`) — pushing is a clean fast-forward, no rebase needed. Local sandbox has no git network credentials, so this couldn't be pushed from here; Dean pushes from his own machine:
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
- **Portfolio Intelligence UX Polish (just completed, commit `2ee4b0e`)** — readability/layout refactor of the expanded Position Intelligence panel, no scoring/calculation/recommendation-logic/API changes. Added a `SuggestedActionCard` at the top of `PositionIntelligencePanel.tsx` (urgency-colored, elevates label/suggested action/confidence/confidence-tier/top evidence/remaining-opportunity — all pre-existing values, nothing newly computed); restructured the rest of the panel into a responsive `grid-cols-1 lg:grid-cols-2` layout (narrative left, reference/next-steps right); hid the existing Decision Scorecard and Decision Review sections behind `SHOW_DECISION_SCORECARD`/`SHOW_DECISION_REVIEW` flags (both `false` — logic/persistence untouched, one-line flip to restore, but their in-panel expand/collapse tests were removed since they're unreachable while hidden); added a "RULE ENGINE'S EXISTING CALL" block to `buildPositionPrompt()` in `app/portfolio/page.tsx` instructing the AI Analysis prompt not to restate the rule engine's existing recommendation verbatim (prompt copy only, JSON schema/API unchanged). Report: `docs/reviews/Portfolio-Intelligence-UX-Polish-Implementation-Report.md`.

## Loose ends / things a fresh session should know

1. **Push not yet done for `2ee4b0e`** — it's a clean fast-forward on top of what's already on `origin/feature/portfolio-intelligence` (`5cc82c5`), so `git fetch && git push origin feature/portfolio-intelligence` from Dean's machine should apply cleanly, no rebase expected.
2. **Old CSP docx still in repo, untracked**: `docs/reviews/CSP-Realistic-Loss-Implementation-Report.docx` is now superseded by `CSP-2Sigma-Scenario-Loss-Terminology-Refinement.docx` but was left in place (files in Dean's mounted folder can't be deleted without his explicit OK). If Dean wants it removed, ask first, then use the file-delete confirmation flow.
3. **`feature/autopilot-paper-mode` doesn't exist** — if a future ticket references it again, flag it the same way rather than assuming it should just be created or substituted silently.
4. **IV-normalization edge case, documented not fixed**: a decimal IV of exactly `1.0` (100%) gets misread by the `impliedVolatility >= 1` heuristic as whole-number-percent and divided down to 1%. Known, accepted, out of scope unless a real bug report comes in.
5. **`next build` validation is unreliable in this sandbox** — don't repeatedly retry it; note the limitation and move on, consistent with how PI-0006A, the CSP ticket, and this UX Polish ticket all handled it.
6. **Decision Scorecard and Decision Review are hidden, not gone** — `SHOW_DECISION_SCORECARD`/`SHOW_DECISION_REVIEW` at the top of `PositionIntelligencePanel.tsx` are both `false`. If a future ticket asks to bring either back, flip the flag and restore/rewrite the removed expand/collapse tests (see the UX Polish report's "Trade-offs disclosed" section) rather than re-implementing the underlying components, which are untouched.
7. **No visual/screenshot QA on the UX Polish layout** — this sandbox can't render the live app (same build-hang issue), so the two-column grid and Suggested Action card have only been verified via passing component tests + code review, not an actual screenshot. Worth a manual look once deployed, especially the `lg` breakpoint collapse and all four urgency colors.

## Key files to know

- `lib/calculateCspRisk.ts` — CSP risk math (Capital at Risk + 2σ Scenario Loss).
- `components/CspRiskCell.tsx` — CSP risk table cell UI + tooltip.
- `lib/portfolio-intelligence/` — objectives, recommendations, priority scoring, health scoring, decision review engine.
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — the expanded Position Intelligence panel (Suggested Action card, two-column layout, hidden Scorecard/Review sections).
- `lib/todaysPriorities/` — Today's Priorities dashboard orchestration.
- `lib/tradeLog/reconstructTrades.ts` — shared trade reconstruction logic.
- `app/portfolio/page.tsx` — main portfolio dashboard page, wires most of the above together (large file); also home to `buildPositionPrompt()` (AI Analysis prompt) and `AnalysisPanel` (AI Analysis UI, separate from Position Intelligence).
- `docs/reviews/` — all implementation reports, `.md` (engineering) and `.docx` (product-owner) as needed.
