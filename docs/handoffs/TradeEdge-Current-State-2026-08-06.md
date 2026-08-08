# TradeEdge — Current-State Handoff

**As of:** 2026-08-06  
**Audience:** Dane and any implementation/review agent joining the project  
**Status:** Current orientation and implementation handoff  
**Repository:** `/Users/deanharmon/Github/trade-edge`  
**Current production baseline:** `main` / `origin/main` at `638a562`

## 1. How to use this document

Read this document before starting work. It is the current orientation layer for the repository: what TradeEdge is, how the system is divided, what is merged, which rules must not be broken, what is known to be defective, and which documents and modules are authoritative for each area.

This document does **not** replace governance, approved architecture, accepted design records, or the actual code and tests. Its purpose is to prevent a new session from reconstructing current state from dozens of historical implementation reports.

When sources appear to conflict, use this order:

1. Approved governance in `governance/`.
2. Approved architecture, ADRs, and current ticket scope.
3. The current code and tests on `main`.
4. This current-state handoff for project status and reading order.
5. Implementation reports as historical evidence of what was attempted, corrected, validated, and merged.

Do not silently choose between a still-approved design and contradictory production code. Identify the conflict and escalate it to Dean before changing behavior.

### Documents known to have stale status sections

- `docs/HANDOFF.md` was last reconciled against a July baseline and explicitly contains a long historical session log.
- `docs/roadmap/ROADMAP.md` still names an older `main` commit.
- `planning/SPRINT_STATUS.md` is useful for the older capability history but its repository-state and validation sections predate the August work summarized here.

These files remain useful history. Do not use their branch, current-sprint, test-total, or `main`-commit statements as present truth.

## 2. Product purpose

TradeEdge is an options-trading decision-support platform. Its purpose is not merely to show market data or place trades. It converts market, strategy, portfolio, and account information into calm, explainable, deterministic guidance.

The core product principles are:

- Trust over apparent precision.
- Calm over noise.
- Explain every recommendation.
- Protect capital before pursuing profit.
- Evaluate the portfolio, not an isolated trade.
- Preserve buying power and future flexibility.
- Treat recommendations as persistent, explainable commitments.
- Fail closed when safety-critical data is missing, malformed, stale, unattributable, or from the wrong context.

Start with:

- `governance/GOV-0001-PRODUCT_PHILOSOPHY.md`
- `governance/GOV-0002-PORTFOLIO_DECISION_PRINCIPLES.md`
- `governance/GOV-0003-AI_DECISION_PRINCIPLES.md`
- `governance/GOV-0004-ARCHITECTURE_PRINCIPLES.md`
- `governance/GOV-0005-UX_PRINCIPLES.md`
- `governance/GOV-0006-CONTRIBUTING.md`

## 3. Team and decision model

Dean is the human project lead and final authority for scope, product direction, merges, and releases.

The collaboration roles used in product reviews are:

- **Paul:** product scope, prioritization, requirements, and implementation-ticket framing.
- **Quinn:** architecture, ownership boundaries, determinism, and implementation readiness.
- **Alan:** system and information architecture; state, workflow, and product-model coherence.
- **Ian:** professional-trader review, financial meaning, strategy behavior, obligations, and practical usability.
- **Diane:** UX design and beginner-facing information design.
- **Dane:** implementation engineer/agent. Dane implements approved scope, validates it, reports deviations, and stops before push/merge when instructed.

AI collaborators advise and implement. They do not redefine product direction. Material ambiguity, financial-policy choices, architectural conflicts, or scope expansion must be surfaced to Dean.

## 4. Working and Git rules

- Inspect the actual current code before accepting a bug report or line reference.
- Create feature/fix branches from the explicitly agreed base.
- Keep unrelated user changes and untracked files untouched.
- Do not silently broaden a ticket.
- Preserve existing behavior outside the approved scope.
- Put reusable business rules in domain modules, not React components.
- Every financial or recommendation rule has one canonical owner.
- Add regression tests for the exact production failure, not only idealized fixtures.
- Run targeted tests, the full suite, `npx tsc --noEmit`, `npm run build`, and `git diff --check` unless the ticket explicitly says otherwise.
- Report environment limitations honestly. Do not describe an uncompleted build as successful.
- Commit locally and stop before push or merge when Dean requests review first.
- Dean normally performs or explicitly authorizes the final push and merge.

The unrelated file `docs/reviews/portfolio-position-metrics-audit.md` was untracked at this handoff's creation. Do not add, delete, rewrite, or include it in a commit unless Dean explicitly scopes it.

## 5. Current repository baseline

As verified on 2026-08-06:

- `main`: `638a562`
- `origin/main`: `638a562`
- Commit subject: `Merge corrected SCREENER-OI-0001 (Ranked/Filtered-only OI floor + two-level sort) into integration branch`
- TypeScript: clean on the combined integration tree.
- Full test suite: **111 files / 1,688 tests passing**.
- Local production build: completed successfully; 53/53 static pages generated.
- Local build emitted repeated Redis `ECONNREFUSED` warnings because Redis was not running. They were non-fatal; compilation, page generation, trace collection, and optimization completed.
- `git diff --check`: clean on the validated integration tree.

Do not use earlier implementation-report totals as the current global baseline. They describe the tree at the time of their own validation.

### Recent merge sequence after the July documentation baseline

The following sequence is already reachable from current `main`:

| Capability | Current reachable commit(s) | Present status |
|---|---|---|
| WA-0004 Briefing separation | `f0b884d` | Merged |
| TE-0002 canonical stop policy | `6f962c8`, followed by rounds 3/4 through `e42ba2e` | Merged |
| PM-0001 position metrics correctness | `1e28c0c`, `71686a9`, `195f324` | Merged |
| TE-0007C Covered Call Screener | Final corrective work through `daa3f08` | Merged |
| HELP-0001 strategy reference | `106c3c6`, corrective pass `40f2b1a` | Merged |
| TE-0007 unified Screener launcher | `55d6d9c`, `c664a8f`, `a184afe`; integration merge `22a31f3` | Merged |
| PORTFOLIO-MODE-0001 header placement | `649dd2b`, `965460b` | Merged through current integration |
| SCREENER-OI-0001 | `fa5670a`, scope correction `5aa6f20` | Merged through `638a562` |

The phrase “local only, not pushed” in commit `22a31f3` is historical commit-message text. That commit is now an ancestor of pushed `origin/main`; do not interpret its subject as current merge status.

## 6. Technology and repository shape

TradeEdge is a Next.js 14 / React / TypeScript application.

Primary commands:

```text
npm run dev
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Important infrastructure:

- Tastytrade-authenticated market/account acquisition.
- Redis/ioredis persistence for server-owned state.
- IndexedDB/localStorage for appropriate client-side Screener state and cache behavior.
- Vitest and React Testing Library.
- Next.js App Router routes under `app/`.

The repository is still partly transitional. Several large pages—especially `app/screener/page.tsx`, `app/portfolio/page.tsx`, and `app/engine/page.tsx`—contain substantial orchestration and presentation code. New business rules should move toward canonical domain modules rather than making those files more authoritative.

## 7. Architectural boundaries

### 7.1 Market and scan acquisition

Primary areas:

- `lib/scans/`
- `lib/scans/tastytrade-client.ts`
- `lib/tastytrade/`
- `app/screener/page.tsx`

This layer acquires chains, quotes, classifications, balances needed by a scanner, and creates strategy candidates. It must not fabricate missing quote, OI, coverage, or account information.

### 7.2 Screener domain

Primary areas:

- `app/screener/page.tsx`
- `lib/screener/opportunityUniverse.ts`
- `lib/screener/screenerResultOrdering.ts`
- `lib/screener/`
- `lib/scans/rank-scoring.ts`

The Screener answers which market candidates satisfy a requested scan. It owns scan interaction and result presentation; it must not become the owner of portfolio recommendation rules.

### 7.3 Decision Engine

Primary areas:

- `lib/decision-engine/`
- `lib/autopilot/decision/`
- `docs/design/DR-0002-TradeEdge-Decision-Engine-v1.md`
- `planning/DECISION_ENGINE_CONSTITUTION.md`

The Decision Engine owns deterministic candidate-level recommendation reasoning: evidence, concerns, action selection, confidence, alternatives, and review triggers. The UI must not independently reproduce or override these decisions.

### 7.4 Opportunity Engine

Primary areas:

- `lib/opportunity-engine/`
- `lib/opportunity-engine/adapters/`
- `components/opportunity-engine/BestOpportunitiesPanel.tsx`
- `docs/design/OE-0001-Opportunity-Engine-Foundation.md`
- `docs/design/OE-0002A-Opportunity-Engine-Activation.md`
- `docs/design/OE-0002B-Recommendation-Service-Foundation.md`

The Opportunity Engine compares already-evaluated candidates. It does not recompute Decision Engine scores or override a hard rejection. Its current production activation receives Screener results through `/api/autopilot/recommendations`, adapts the returned `DecisionAnalysis[]`, and ranks recommendations for display and publication.

### 7.5 Recommendation Service

Primary area:

- `lib/recommendations/`

The Screener is a recommendation producer; consumers such as the Dashboard read through this acquisition boundary. Do not create a second cross-page recommendation store.

### 7.6 Portfolio Intelligence

Primary areas:

- `lib/portfolio-intelligence/`
- `lib/portfolioHealth/`
- `lib/portfolioReview/`
- `lib/dailyBriefing/`
- `lib/todaysPriorities/`
- `lib/todays-priorities-queue/`
- `lib/mission-control/`

This domain evaluates the investor's existing portfolio, priorities, health, objectives, risks, and review workflow. It is distinct from market opportunity discovery. A good market opportunity may still be inappropriate for the current portfolio.

### 7.7 Portfolio acquisition and position metrics

Primary areas:

- `lib/portfolio-data/acquisition.ts`
- `lib/portfolio-data/types.ts`
- `lib/portfolio/positionMetrics.ts`
- `lib/positionValuation/`
- `app/portfolio/page.tsx`

Position metrics must propagate unavailable data honestly. Do not turn missing quotes, crossed markets, debit structures, or missing entry values into zero-valued credit metrics or fabricated P/L.

### 7.8 Stop-loss policy and order safety

Primary areas:

- `lib/portfolio/stopLossPolicy.ts`
- `lib/portfolio-data/acquisition.ts`
- `lib/portfolio-data/stopPolicyStore.ts`
- `lib/portfolio/closeOrderSafety.ts`
- `lib/portfolio/pendingOrderReplacementSafety.ts`
- `lib/portfolio/pendingOrderReplacementSubmission.ts`
- `docs/design/ES-0001-Live-Close-Order-Safety.md`
- `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`
- `docs/te-0002-corrective-report.md`

The canonical stop policy separates trusted enforcement state from display/advisory state. An untrusted broker stop must never become authoritative merely because a display policy can be inferred. Manual action availability is also distinct from the system's suggested action.

Live close, roll, stop, and pending-order replacement paths must pass their applicable broker-boundary safety gates. Never bypass them from a UI call site.

### 7.9 Portfolio Mode and paper trading

Primary areas:

- `lib/portfolio-mode/`
- `components/portfolio-mode/`
- `lib/paper-trading/`
- `app/paper-trading/`
- `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md`
- `docs/design/PT-0002B-Portfolio-Context-Integration.md`

LIVE and PAPER are trust boundaries, not visual themes. The global indicator is centered in the application header region. PAPER remains unavailable from the ordinary global control until application integration is explicitly enabled. The paper ledger is separate from the dormant Autopilot paper-account framework even though both share a persisted account record namespace.

Never use paper balances, positions, or capacity to approve a LIVE recommendation or action.

### 7.10 Help and education

Primary areas:

- `lib/help/optionsStrategyReference.ts`
- `app/help/strategies/page.tsx`
- `docs/reviews/HELP-0001-Options-Strategy-Reference-Implementation-Report.md`

The Options Strategy Reference is educational, goal-first, progressively disclosed, and structurally isolated from recommendations and execution. It includes eight educational strategies, including strategies not yet available as Screener scans. Educational availability must not imply scanner or execution availability.

## 8. Current product surfaces

Important routes include:

- `/dashboard` — Mission Control / composed portfolio intelligence.
- `/portfolio` — positions, balances, priorities, briefing, and related portfolio workflows.
- `/screener` — Opportunity Universe, Filtered/Ranked/Targeted scanning, CSP, Covered Call, PMCC, and spread discovery.
- `/engine` — Income Engine and capital-allocation views.
- `/paper-trading` — manual paper-trading sandbox.
- `/help` and `/help/strategies` — product help and the Options Strategy Reference.
- `/trade-log`, `/performance`, `/rinse-repeat`, `/wheel`, `/wheel-simulator`, `/cc-tracker`, and `/long-book` — supporting workflows.

Do not assume every page uses one shared header. Several routes still implement their own header structure.

## 9. Screener capabilities currently merged

### 9.1 Opportunity Universe

TE-0007 replaced separate general/CSP/PMCC ticker boxes with one canonical Opportunity Universe.

- `tickers` / `hunter-watchlist` is the sole production authority.
- The opportunity-universe storage key is a derived write-only migration mirror/gate, not a second UI-state authority.
- Legacy ticker sources are unioned once; a legacy active ticker reactivates an existing inactive primary ticker.
- Newly added tickers default to active.

### 9.2 Strategy launch actions

The launcher currently exposes:

- Find Spreads
- Find CSPs
- Find Covered Calls
- Find PMCCs
- Find LEAPS — disabled / coming soon

There is exactly one ordinary Covered Call launch action. The separate “Scan all eligible holdings” override may appear only when the Opportunity Universe narrows otherwise eligible holdings; it bypasses that narrowing only, never capacity protections.

### 9.3 Covered Call safety

Covered Call eligibility originates from verified holdings and conservative exposure accounting. The Opportunity Universe may narrow eligible holdings but can never create coverage.

The capacity model accounts for:

- Owned shares.
- Existing short calls.
- Working short-call orders.
- Status/action normalization.
- OCC-derived option identity.
- Cost-basis completeness.
- Valid two-sided quotes.
- Unclassified but symbol-attributable exposure through conservative reservation.
- Genuinely unattributable exposure through an account-wide fail-closed unavailable state.

Do not weaken these protections while changing Screener state or presentation.

### 9.4 OI filter and multi-sort

SCREENER-OI-0001 is merged.

- User-facing controls exist in **Ranked and Filtered modes only**.
- Targeted retains its established rules and single-field sort.
- Minimum relevant-leg OI presets: Any, 100, 250, 500, and Custom.
- Positive floors fail closed on missing/non-finite required-leg OI.
- Any does not fabricate OI.
- Protective-leg OI does not determine vertical/IC eligibility, but weak protective liquidity may be disclosed separately.

Canonical relevant-leg rules:

| Strategy | OI required for the user floor |
|---|---|
| CSP | Short put |
| Covered Call | Short call |
| Bull Put Spread | Short put |
| Bear Call Spread | Short call |
| Iron Condor | Both short legs independently; display/sort uses the lower |
| PMCC | Long LEAPS call and short call independently; display/sort uses the lower |
| Bull Call Spread | Short call; canonical rule tested, scanner not implemented |
| Long LEAPS Call | Long call; canonical rule tested, scanner not implemented |

Available sort fields:

- Score
- POP
- Credit dollars
- Credit percentage
- ROC percentage
- OTM percentage
- Relevant-leg OI
- DTE

Primary and optional secondary sorting are deterministic; missing values sort last. Ranked mode filters and sorts before Show Top N. The ticket did not change the underlying scoring formula.

### 9.5 Strategy and mode availability

| Strategy | Educational reference | Current Screener generation | Notes |
|---|---:|---:|---|
| Covered Call | Yes | Yes | Requires verified share capacity |
| Cash-Secured Put | Yes | Yes | Uses CSP-specific finder/checklist |
| PMCC | Yes | Yes | Separate diagonal strategy |
| Bull Put Spread | Yes | Yes | Included in spread scans |
| Bear Call Spread | Yes | Yes | Included in spread scans; internal `BCS` means Bear Call Spread |
| Iron Condor | Yes | Yes | Included in spread scans |
| Bull Call Spread | Yes | No | Backlog: first-class scanner |
| Long LEAPS Call | Yes | No | Backlog: first-class scanner |

Never add a Bull Call Spread or Long LEAPS scan as incidental scope in another Screener ticket.

## 10. Recently merged portfolio corrections

### 10.1 Canonical stop-loss policy

TE-0002 replaced the unsafe stop-loss OR rule and the old `live|loose` classification with canonical states:

- `NO_STOP`
- `ALIGNED`
- `TOO_TIGHT`
- `TOO_LOOSE`
- `UNKNOWN_PROVENANCE`
- `INVALID`

Stop provenance is persisted when TradeEdge creates/replaces a stop. Untagged broker stops are not backfilled or fabricated as aligned. Confirmed stop breaches require trusted policy plus authoritative broker evidence or the configured confirmation sequence. Display-only policy must not drive enforcement.

Round 4 also separated the manual Cut Losses action from the Suggested Action. A trader may have a manual close/cut-loss control without TradeEdge recommending CUT_LOSSES merely because current P/L is negative.

### 10.2 Position metrics correctness

PM-0001 corrected:

- POP units.
- Iron Condor breakeven and side-specific buffer completeness.
- Crossed/missing quote treatment.
- Debit-structure credit metrics.
- P/L calculation gating for net-debit structures.
- Leg-order invariance.

Deferred from PM-0001: propagating `entryPriceEffect: 'Unknown'` when entry premiums are missing rather than zero. Treat this as a known data-parsing gap, not permission to broaden an unrelated ticket into general debit-strategy support.

## 11. Current known production defects — Screener review, 2026-08-06

These findings were reproduced visually and then traced into current code. They are the next approved corrective focus. They are not yet represented by a completed implementation report.

### 11.1 SCREENER-RESULTS-0001 — Scan-session and result integrity

**Priority: BLOCKER**

Observed behavior:

- A scan started with six selected equities but displayed five scanned without accounting for the missing symbol.
- Counts such as “2 of 2 qualified,” “3 of 3 disqualified,” and “5 scanned” were difficult to reconcile with the selected universe.
- Rejected recommendations appeared under “Best Opportunities.”
- Filters/sorts appeared below Best Opportunities even though they govern results.
- Running Find CSPs after Find Spreads produced a toast for seven CSP results but a page total of twelve results.
- The CSP view contained earlier spread structures such as `295/285`.
- Find Spreads remained visually highlighted after Find CSPs was selected.
- BPS/BCS/IC numeric badges were not identified as actual strategy versus comparative fit.
- Best Opportunity cards were always expanded and visually inconsistent with compact scan rows.

Confirmed implementation causes:

- `runCspScan()` appends CSP results to the existing `results` array.
- `runPMCCScan()` also appends to the existing result collection.
- The recommendation effect sends the full mixed `results` collection to `/api/autopilot/recommendations`.
- The Find Spreads button uses a filled accent style independent of actual active strategy state.
- `BestOpportunitiesPanel` renders all recommendation evidence by default and accepts rejected recommendations.
- `results.length` is used as a generic scanned count even when it does not mean requested or successfully evaluated symbols.

Required correction:

- Introduce an explicit scan-session model with scan ID, mode, requested strategy, normalized requested symbols, timestamps, status, evaluated symbols, skipped/failed symbols with reasons, candidates, and cache provenance.
- A new strategy launch replaces the visible prior session by default.
- Cache identity must include mode and requested strategy; legacy mixed caches must be invalidated or explicitly treated as legacy.
- Account for every selected ticker. Never let one disappear silently.
- Distinguish requested symbols, attempted symbols, evaluated symbols, failed/skipped symbols, candidate count, qualified candidates, and disqualified candidates.
- Preserve the selected launcher strategy through loading, completion, and restoration.
- Use strategy-specific headings, filters, and result fields.
- A CSP session must show a CSP short put, not a two-leg vertical structure.
- Display one unambiguous actual-strategy badge. Comparative fit, if retained, must be explicitly labeled and secondary.
- Best Opportunities may contain only `RECOMMENDED` and clearly labeled `ACCEPTABLE_ALTERNATIVE` items.
- WATCH belongs in a watch section; REJECTED belongs with rejected/disqualified outcomes.
- If none survives final review, show “No actionable opportunities found.”
- Actionable opportunity cards should be compact by default with accessible progressive disclosure.

Do not add implicit cross-strategy aggregation. A future compare-across-strategies feature would require explicit user intent and its own ticket.

### 11.2 SCREENER-ACCOUNT-0001 — LIVE account-context integrity

**Priority: BLOCKER**

Observed behavior:

The Best Opportunities evidence displayed `Available buying power (100000)` while the selected Tastytrade account showed approximately:

- Net liquidating value: `$48,837.73–$48,842.73`
- Cash: `$50,492.73`
- Option buying power: `$45,492.73`
- Stock buying power: `$90,985.46`
- Crypto buying power: `$42,205.37`

The small net-liquidating-value difference came from screenshots taken at slightly different times. The `$100,000` value did not match any live account field.

Confirmed implementation cause:

- `/api/autopilot/recommendations` calls the Autopilot recommendation engine.
- The engine loads `PaperAccount` from `lib/autopilot/persistence/paperAccountStore.ts`.
- A new Autopilot paper account defaults to `$100,000`.
- `buildDecisionContext()` uses `account.liveBuyingPowerSnapshot` or falls back to paper current balance minus paper open risk.
- `liveBuyingPowerSnapshot` is declared but has no production writer in the repository.
- Therefore a LIVE Screener candidate can be evaluated against the default paper balance.

Required correction:

- Make account mode and account identity explicit in the recommendation request/context.
- LIVE recommendations must never fall back to Autopilot paper capital.
- Use the selected broker account's verified, current strategy-appropriate capital field.
- Missing, invalid, stale, mismatched, or wrong-mode data fails closed with “Buying power unavailable — verification required.”
- Defined-risk spreads use verified option/derivative buying power and verified max-risk/buying-power requirement.
- CSP shows full cash-securement and uses the canonical verified cash measure; do not silently use margin.
- Covered Calls continue to use verified share capacity, not generic buying power.
- PMCC uses its actual debit/capital requirement and coverage rules.
- Label the measure, requirement, remaining capacity, broker/source, account, and freshness.
- Cached candidate data must trigger a fresh account-dependent recommendation evaluation.
- PAPER uses and labels the paper ledger; it must not imply LIVE broker capacity.

This is a LIVE/PAPER trust-boundary defect, not a display-only formatting issue.

## 12. Acceptance focus for the next corrective implementation

The approved sequence is:

1. Implement scan-session/result integrity as a separate commit.
2. Implement LIVE account-context integrity on top as a separate commit.
3. Validate the combined branch.
4. Stop before push or merge for Dean's review.

Minimum regression scenarios include:

- Run spreads, then CSP; only the new CSP session is visible and counted.
- Previous opportunity recommendations clear when the new strategy starts.
- Six requested / five evaluated / one failed reconciles, with the failed ticker and reason visible.
- Multiple candidates for one ticker do not inflate the symbol count.
- CSP cards cannot render vertical-spread fields.
- Strategy identity cannot be confused with strategy-fit scores.
- Rejected-for-earnings candidates never appear under Best Opportunities.
- No actionable survivors produces an honest empty state.
- Ranked and Filtered retain SCREENER-OI controls; Targeted remains unchanged.
- Covered Call capacity and unattributable-exposure fail-closed tests remain unchanged and passing.
- A LIVE account with `$45,492.73` option buying power never displays or evaluates against `$100,000`.
- Missing/stale/wrong-account LIVE balance data fails closed.
- PAPER and LIVE capital never cross contexts.
- Restored market candidates receive a fresh account-capacity evaluation.

Do not add order execution, new scanners, cross-strategy comparison, or unrelated scoring changes.

## 13. Backlog and deferred work

### Explicit backlog

- Bull Call Spread first-class Screener scanner.
- Long LEAPS Call first-class Screener scanner.
- Optional future compare-across-strategies result experience; not approved or scoped.
- Decide whether TradeEdge should become context-aware of the educational Options Strategy Reference. The Help reference itself is complete; contextual recommendation integration was intentionally not part of HELP-0001.

### Known technical/deferred items

- PM-0001 parsing gap for missing `entryPriceEffect` versus zero.
- The broker-submission inventory identified an unguarded OTOCO entry path in `app/rinse-repeat/page.tsx`; see `docs/reviews/ES-0002-Broker-Submission-Inventory.md`. Do not fix incidentally.
- Several historical docs require a future status reconciliation after the August merges.
- Portfolio-mode PAPER activation remains deliberately unavailable until application integration is approved.
- The untracked portfolio-position metrics audit requires an explicit disposition before it becomes repository authority.

## 14. Curated reading map

Do not read every implementation report before every task. Use the smallest authoritative set for the domain being changed.

### Always read for material work

1. This document.
2. `governance/GOV-0001-PRODUCT_PHILOSOPHY.md`
3. `governance/GOV-0002-PORTFOLIO_DECISION_PRINCIPLES.md`
4. `governance/GOV-0004-ARCHITECTURE_PRINCIPLES.md`
5. `governance/GOV-0005-UX_PRINCIPLES.md`
6. `docs/architecture/Engineering-Principles.md`
7. `docs/architecture/System-Map.md`, treating dated status claims as historical and verifying current code.
8. The current ticket and the actual modules/tests in scope.

### Screener and current correction

- `docs/design/DR-0001-Strategy-Unification-and-Wheel-Opportunity-Finder.md`
- `docs/design/OE-0001-Opportunity-Engine-Foundation.md`
- `docs/design/OE-0002A-Opportunity-Engine-Activation.md`
- `docs/design/OE-0002B-Recommendation-Service-Foundation.md`
- `docs/tickets/TE-0007-unified-strategy-launcher.md`
- `docs/reviews/TE-0007-Unified-Strategy-Launcher-Implementation-Report.md` — read through the final corrective section.
- `docs/tickets/TE-0007C-covered-call-first-class-screener.md`
- `docs/reviews/TE-0007C-Implementation-Report.md` — sections 15 and 16 supersede earlier incomplete rounds.
- `docs/tickets/SCREENER-OI-0001-oi-and-sort.md`
- `docs/reviews/SCREENER-OI-0001-implementation-report.md`
- `app/screener/page.tsx`
- `lib/screener/`
- `lib/scans/`
- `app/api/autopilot/recommendations/route.ts`
- `lib/autopilot/decision/recommendationEngine.ts`
- `lib/autopilot/persistence/paperAccountStore.ts`
- `lib/decision-engine/`
- `lib/opportunity-engine/`
- `components/opportunity-engine/BestOpportunitiesPanel.tsx`

### Portfolio metrics and stops

- `docs/reviews/pm-0001-implementation-report.md` — read through corrective round 2.
- `docs/te-0002-corrective-report.md` — read through rounds 3 and 4/current merge history.
- `docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md`
- `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md`
- `lib/portfolio-data/acquisition.ts`
- `lib/portfolio/positionMetrics.ts`
- `lib/portfolio/stopLossPolicy.ts`
- Associated tests before editing `app/portfolio/page.tsx`.

### Live-order safety

- `docs/design/ES-0001-Live-Close-Order-Safety.md`
- `docs/reviews/ES-0001-Closeout-Report.md`
- `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`
- `docs/reviews/ES-0002-Implementation-Report.md`
- `docs/reviews/ES-0002-Broker-Submission-Inventory.md`
- `lib/portfolio/closeOrderSafety.ts`
- `lib/portfolio/pendingOrderReplacementSafety.ts`
- `lib/portfolio/pendingOrderReplacementSubmission.ts`

### Portfolio Mode and paper trading

- `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`
- `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md`
- `docs/design/PT-0002B-Portfolio-Context-Integration.md`
- `docs/reviews/PT-0001-Implementation-Report.md`
- `docs/reviews/PT-0002A-Implementation-Report.md`
- `docs/tickets/PORTFOLIO-MODE-0001-header-placement.md`
- `docs/reviews/portfolio-mode-0001-header-placement-report.md`
- `lib/portfolio-mode/`
- `lib/paper-trading/`

### Help strategy reference

- `lib/help/optionsStrategyReference.ts`
- `docs/reviews/HELP-0001-Options-Strategy-Reference-Implementation-Report.md` — section 15 contains the accepted corrective pass.
- `app/help/strategies/page.tsx`

## 15. How to interpret implementation reports

Implementation reports are an audit trail. They are valuable because they record assumptions, rejected rounds, corrective work, validation, and deviations. They are not automatically the latest truth.

When reading one:

- Read the entire report, including final corrective/addendum sections.
- Treat statements such as “not merged” or old branch hashes as true only at the time written.
- Verify current reachability with `git log`, `git branch --contains`, and the current source.
- Prefer the final corrective section over an earlier summary.
- Never copy an old test total into a new report as the current baseline.
- Check whether a report describes an ideal fixture that later corrections hardened against real broker shapes.
- Do not treat a report-only claim as proof when the production wiring can be inspected and tested.

## 16. Dane start-of-task checklist

Before implementing:

1. Confirm the requested ticket and non-goals with Dean.
2. Check `git status`, current branch, `origin/main`, and the expected base commit.
3. Identify user-owned/untracked files and exclude them.
4. Read this handoff and the curated documents for the task.
5. Trace the actual production call path and state owners.
6. Write down confirmed root causes before editing.
7. Identify financial, mode, persistence, and execution trust boundaries.
8. Locate existing tests and canonical helpers to reuse.
9. Escalate contradictions or scope expansion before proceeding.

While implementing:

1. Keep business rules out of page components.
2. Preserve one canonical owner per rule.
3. Fail closed on unknown safety-critical inputs.
4. Add the exact production fixture and negative controls.
5. Preserve unrelated behavior and existing safety suites.
6. Record deviations rather than hiding them.

Before reporting completion:

1. Review the diff and changed-file list.
2. Run targeted tests.
3. Run the full suite.
4. Run `npx tsc --noEmit`.
5. Run `npm run build` in an environment capable of completing it.
6. Run `git diff --check`.
7. Reconcile test totals from the actual base.
8. Confirm no unrelated untracked file was included.
9. Commit locally with an intentional message.
10. Report branch, base, commit, root causes, files, tests, build, deviations, and remaining risks.
11. Stop before push/merge when instructed.

## 17. Current handoff statement

The validated and pushed baseline is `638a562` on `main` and `origin/main`.

The next corrective priority is the Screener trust package:

1. SCREENER-RESULTS-0001 — isolate scan sessions, reconcile ticker outcomes, preserve strategy identity, correct result presentation, and prevent rejected candidates from being presented as Best Opportunities.
2. SCREENER-ACCOUNT-0001 — remove the `$100,000` paper-account fallback from LIVE recommendations and enforce verified, fresh, strategy-appropriate account context.

Implement them as separate commits on one reviewed corrective branch, validate them together, and do not push or merge until Dean reviews the report.
