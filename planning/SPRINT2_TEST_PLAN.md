# Sprint 2 Validation Test Plan — Decision Engine

**Branch:** `feature/autopilot-decision-engine`
**Scope:** Validate the current Sprint 2 implementation (shared `lib/decision-engine/` + Autopilot orchestration in `lib/autopilot/decision/`) before starting Sprint 3. Recommendation-only. No paper execution, no live execution, no architecture changes.

**Test runner:** [Vitest](https://vitest.dev/) — chosen because it needs zero config beyond `vitest.config.ts`, runs TypeScript directly (no separate transpile step), and resolves the existing `@/*` path alias via `vite-tsconfig-paths`. Nothing else in this repo required a test runner before now.

Run locally with:
```
npm install
npm test
```

---

## 1. Build validation

| Check | Method | Status |
|---|---|---|
| Vercel build succeeds | **Manual** — push branch, confirm Vercel preview build is green | ☐ Manual |
| TypeScript compiles cleanly | `npx tsc --noEmit` — confirmed clean locally against this branch as of this delivery | ✅ Automated (verified) |
| No duplicate Decision Engine implementations | `evaluateSingleCandidate` is exported once from `lib/decision-engine/index.ts`; automated test asserts the import resolves to a single function | ✅ Automated |
| No invalid imports | Covered implicitly by `tsc --noEmit` (unresolvable imports fail the compile) | ✅ Automated |

**Gap:** `tsc --noEmit` here is not identical to `next build` (Next does additional page/route-level checks, e.g. `app/api/autopilot/*` route handler signatures). Vercel preview remains the authoritative check per repo convention — treat the local `tsc` pass as a fast pre-check, not a replacement.

---

## 2. DecisionAnalysis contract

**File:** `lib/decision-engine/__tests__/evaluateSingleCandidate.test.ts` → `describe('DecisionAnalysis contract')`

Verifies every `DecisionAnalysis` includes `recommendation`, `confidence` (all 5 sub-dimensions), `rationale`, `supportingEvidence`, `concerns`, `alternatives`, `reviewTriggers`, `expectedOutcome`, `metadata`. Separately verifies `executionAllowed === false` and `paperExecutionAllowed === false` hold under both a `recommended` and an `AVOID` path (not just the default case).

Status: ✅ Automated, 7 tests, passing.

---

## 3. Strategy recommendation scenarios

**File:** `lib/decision-engine/__tests__/evaluateSingleCandidate.test.ts` → `describe('strategy recommendation scenarios')`

Deterministic fixtures (`test/fixtures/autopilotFixtures.ts`) for:
- **CSP** → `SELL_CSP`, recommended
- **BPS** → `OPEN_BPS`, recommended
- **BCS** → `OPEN_BCS`, recommended
- **WAIT** — two independent triggers tested: low opportunity score + uncertain market bias; confidence below configured minimum
- **AVOID** — three independent triggers tested: earnings inside expiry, insufficient buying power, CSP proposed against an unwilling-to-own preference

Each fixture includes portfolio state, market assumptions, the candidate, and asserts the expected `recommendation.action` / `recommendation.status`. IC was not given a dedicated scenario — `evaluateSingleCandidate` treats IC identically to BPS/BCS through `actionForStrategy()`, so an IC-specific test would be redundant with the BPS/BCS coverage. **Recommended next step:** add one IC fixture anyway once IC-specific evidence/concern logic (if any) is added, to guard against future divergence.

Status: ✅ Automated, 8 tests, passing.

---

## 4. Risk validation

**Files:**
- `lib/decision-engine/__tests__/riskValidation.test.ts` (shared-engine concerns: buying-power/max-loss, ticker concentration, sector concentration, earnings, missing metadata)
- `lib/autopilot/decision/__tests__/riskGateEngine.test.ts` (Autopilot-layer pre-gates: per-trade max loss %, drawdown circuit breaker, correlation, plus `single_ticker`/`sector_metadata` which are computed but intentionally *not* used as blocking pre-gates — see the `PORTFOLIO_PRE_GATE_RULES` comment in `recommendationEngine.ts`)

Explicitly covers boundary behavior (max-loss exactly equal to buying power passes) and missing-metadata resilience (`pop`/`roc`/`ivr`/`correlationPenalty`/`sector` all `undefined` → no crash, no fabricated positive signal, evidence entries simply omitted).

Status: ✅ Automated, 12 + 12 tests, passing.

---

## 5. Decision Confidence

**File:** `lib/autopilot/scoring/__tests__/confidence.test.ts`

Tests `calculateDecisionConfidence()` directly, dimension by dimension:
- **Stale quotes** (latency, 0–20 pts): fresh quote → 20; >5 min stale → 0 with a note; missing `quoteTimestamp` entirely → 0 with a distinct "missing quote timestamps" note (this is a real behavior distinction in the code — verified as its own case, not just "quote is stale").
- **Wide bid/ask spreads** (liquidity, 0–40 pts): spread-vs-20-period-average ratio scored in bands; the worst leg in a multi-leg spread determines the score, not an average across legs.
- **Macro events** (0–20 pts): inside the configurable hard-gate window → 0; a shorter custom `hardMacroGateHours` moves the same event out of the gate.
- **Unstable volatility** (0–20 pts): ≤2% 30-min swing → 20; >10% swing → 0; VIX fields absent → falls back to underlying IV fields; both absent → neutral 12/20 (not 0 — the code treats "no data" differently from "bad data," which is worth knowing).
- **Poor liquidity**: covered under bid/ask spread above (this framework has no separate "open interest" or "volume" dimension — liquidity is entirely spread-ratio-based today).

Status: ✅ Automated, 19 tests, passing.

---

## 6. Explanation quality

**File:** `lib/decision-engine/__tests__/evaluateSingleCandidate.test.ts` → `describe('explanation quality')`

- Asserts `rationale` is never a bare `"Score is high."`-style sentence, across recommended/conditional/not_recommended paths.
- Asserts every `concern.explanation` is substantive (not just a rule name).
- Asserts every `alternative.reasons` entry is non-trivial (covers "why not the alternatives").
- Asserts every `reviewTrigger.explanation` is substantive (covers "what would change the recommendation").

**Known gap (documented, not silently passed):** `rationale` is currently one of exactly three fixed sentences (`recommended` / `conditional` / `not_recommended`), not a per-candidate narrative. Two different candidates that land in the same status bucket get byte-identical rationale text. This satisfies "why this action" and partially "why now" only in the generic sense — it does not read as candidate-specific reasoning. A test (`FLAGS A GAP: ...`) asserts this current behavior explicitly so it can't regress silently *or* be "fixed" without someone noticing the assertion needs updating.

Status: ✅ Automated, 5 tests, passing (1 of which documents a gap rather than proving correctness).

---

## 7. Autopilot orchestration

**File:** `lib/autopilot/decision/__tests__/recommendationEngine.test.ts`

All Redis-backed persistence (`configStore`, `paperAccountStore`, `decisionLogStore`, `auditTrailStore`, `scheduler/locking`) is mocked with in-memory fakes via `vi.mock`, so these tests need no live Redis and are fully deterministic.

- **Multiple candidates:** N candidates in → N `DecisionAnalysis` out (including validation-failure candidates).
- **Deterministic ranking:** `recommended` sorts before `conditional` before `not_recommended`; two runs with identical inputs produce identical output ordering.
- **Duplicate handling:** two candidates with identical symbol/strategy/legs collapse to one recommendation (this happens in `candidatePipeline.ts`'s `dedupeCandidates`, silently, before validation — worth knowing if you ever need per-duplicate visibility).
- **Decision logging:** one log entry per processed candidate; recommended entries carry `paper_execution_disabled_until_sprint_3` in `rulesBlocked`.
- **Audit logging:** one `recommendation_generated` event per candidate.

Status: ✅ Automated, 12 tests, passing.

---

## 8. Safety

**File:** `lib/autopilot/decision/__tests__/recommendationEngine.test.ts` → `describe('safety')`

- Every recommendation returned carries `executionAllowed: false` / `paperExecutionAllowed: false`.
- `RecommendationRunResult.mode === 'paper'` and `liveTradingEnabled === false` are hard-coded, not conditional.
- A recommendation run does not add/remove open paper positions or change `currentBalance` as a side effect (the mocked account is asserted unchanged except for `lastRunAt`).
- **No live orders submitted:** there is currently no code path in `lib/autopilot/decision/` or the `app/api/autopilot/*` routes that calls the TastyTrade order-submission client at all — this was confirmed by inspection (`grep` for order-submission calls returned nothing in this branch), not by a runtime test, since there's no execution code to exercise. Documented here as a **manual verification item**: re-run this grep before every merge to `main` to catch any future addition of execution code on this branch.
- **Kill switch — KNOWN GAP:** `AutopilotConfig.killSwitchEnabled` is persisted, sanitized on save, and surfaced by `GET /api/autopilot/status`, but it is **never read** by `runRecommendationEngine()` or by `app/api/autopilot/run/route.ts` / `app/api/autopilot/recommendations/route.ts`. Setting the kill switch today has no effect on whether a recommendation run executes. A test documents this explicitly (`KNOWN GAP: killSwitchEnabled=true does not currently block a recommendation run`) so it fails loudly (by design, as a reminder) rather than silently passing once someone wires up the enforcement — at that point, update the test to assert the new blocking behavior.

Status: ✅ Automated, 5 tests, passing (1 documents a real gap, not a false-positive pass).

---

## 9. Regression

Manual validation checklist — these are existing runtime features that this Sprint 2 test suite does **not** exercise automatically, because they require a running Next.js server, an authenticated session, and a live or mocked TastyTrade connection (none of which are available in this sandboxed unit-test pass). Verify these against the Vercel preview deployment for this branch before merging:

- [ ] **Portfolio** — position cards render, AI analysis panel loads, pending orders section unaffected
- [ ] **Screener** — Filter/Rank/Targeted scan modes run; results render
- [ ] **Repeat Trades** — page loads and existing repeat-trade flows work
- [ ] **Pending Orders** — Cancel / Replace / Re-screen actions still function (these predate this branch and don't touch `lib/decision-engine/` or `lib/autopilot/decision/`, but confirm no accidental shared-type collision)
- [ ] **Background tasks** — status bar / task drawer still reflects running scans
- [ ] **Existing Autopilot endpoints** — `GET /api/autopilot/status`, `GET /api/autopilot/state`, `GET /api/autopilot/decisions`, `POST /api/autopilot/config`, `POST /api/autopilot/paper-account` all respond as before
- [ ] `POST /api/autopilot/recommendations` (the screener-bridge route added in a prior session) still converts `ScreenResult[]` → candidates and returns a `RecommendationRunResult` with `success: true`

---

## Summary

**Tests implemented:** 89 automated tests across 6 files (`evaluateSingleCandidate.test.ts`, `riskValidation.test.ts`, `confidence.test.ts`, `riskGateEngine.test.ts`, `candidatePipeline.test.ts`, `recommendationEngine.test.ts`), plus one shared fixture module.

**Tests passing:** 89 / 89, verified locally with `npx vitest run` against this branch. `npx tsc --noEmit` also passes clean, including the new test files.

**Tests requiring manual verification:**
- Vercel preview build (item 1)
- All of item 9 (Regression) — requires a running server + auth + TastyTrade context
- Re-confirming no execution code path exists, before every merge to `main` (item 8)

**Known gaps (found during this validation pass, not pre-existing knowledge):**
1. `AutopilotConfig.killSwitchEnabled` is stored and displayed but never enforced anywhere in the recommendation-generation path.
2. `DecisionAnalysis.rationale` is one of three fixed, non-candidate-specific sentences rather than a true per-candidate narrative — it satisfies the letter of "why this action" but not "why now" as distinct, candidate-specific text. Evidence/concerns/alternatives/review-triggers do carry candidate-specific detail, so the *information* exists, just not consolidated into `rationale` itself.
3. No dedicated IC (iron condor) fixture — IC currently behaves identically to BPS/BCS through `actionForStrategy()`, so this is low-risk today but should get its own fixture once/if IC gets distinct evidence or concern logic.
4. `dedupeCandidates()` in `candidatePipeline.ts` silently drops duplicates before validation runs — there's no way for a caller to see *which* duplicate was dropped or why, only that `totalReceived > totalAccepted + totalRejected`.

**Recommended next steps before Sprint 3:**
1. Decide whether the kill switch gap (#1 above) needs to close before Sprint 3, since Sprint 3 is where paper execution presumably gets added — a kill switch that doesn't switch anything off is a meaningfully bigger problem once there's something to execute.
2. Wire this test suite into CI (or at minimum run `npm test` locally before every push) alongside the existing Vercel-build-is-the-TypeScript-check convention.
3. Add the IC fixture (#3) opportunistically when touching IC logic next.
4. Consider whether `rationale` should become per-candidate narrative text before Sprint 3's UI surfaces it more prominently to the trader — right now it's the least informative field in an otherwise thorough contract.
