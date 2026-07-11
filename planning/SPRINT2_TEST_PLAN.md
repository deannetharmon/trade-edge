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

**File:** `lib/decision-engine/__tests__/evaluateSingleCandidate.test.ts` → `describe('strategy recommendation scenarios')` and `describe('IC scenario (deterministic fixture)')`

Deterministic fixtures (`test/fixtures/autopilotFixtures.ts`) for:
- **CSP** → `SELL_CSP`, recommended
- **BPS** → `OPEN_BPS`, recommended
- **BCS** → `OPEN_BCS`, recommended
- **IC** → `OPEN_IC`, recommended (closed 2026-07-11 — see below)
- **WAIT** — two independent triggers tested: low opportunity score + uncertain market bias; confidence below configured minimum
- **AVOID** — three independent triggers tested: earnings inside expiry, insufficient buying power, CSP proposed against an unwilling-to-own preference

Each fixture includes portfolio state, market assumptions, the candidate, and asserts the expected `recommendation.action` / `recommendation.status`.

**Gap closed (2026-07-11): Iron Condor fixture.** IC previously had no dedicated scenario — it happened to route through the same `actionForStrategy()` logic as BPS/BCS, so risk was low, but there was no fixture guarding against future divergence. A 4-leg IC fixture (short put, long put, short call, long call on AMD) now has its own `describe` block covering:
- `OPEN_IC` action, `recommended` status, `recommendation.strategy === 'IC'`
- Full `DecisionAnalysis` shape (all required top-level fields present, confidence sub-dimensions present)
- Explanation quality (rationale is not a bare score statement, is ≥8 words, names the candidate's symbol)
- Alternatives carry non-trivial reasons; review triggers carry non-trivial explanations
- Both execution flags (`executionAllowed`, `paperExecutionAllowed`) remain `false` on both the recommended path and a forced-AVOID (earnings-block) path

Status: ✅ Automated, 9 + 7 tests, passing.

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
- Asserts two different candidates landing in the same status bucket produce **different** rationale text, each naming its own symbol.
- Asserts a `not_recommended` rationale names the specific blocking concern (e.g. "earnings"), and a `conditional` rationale names the specific confidence/threshold numbers that triggered the wait.

**Gap closed (2026-07-11):** `rationale` was previously one of exactly three fixed sentences (`recommended` / `conditional` / `not_recommended`), with no per-candidate detail beyond an interpolated strategy name. It's now built by a `buildRationale()` helper inside `evaluateSingleCandidate.ts` that composes the *already-computed* concerns, alternatives, confidence, and opportunity score into candidate-specific prose — no new reasoning logic was added, this is purely textifying data the function already derives. It now:
- Names the candidate's symbol and action.
- For `not_recommended`: names the specific critical concern(s) that blocked it.
- For `conditional`: names the specific reason (confidence below minimum, uncertain market bias, or a specific high-severity concern) and the actual numbers involved.
- For `recommended`: cites the confidence and opportunity-score numbers and confirms no blocking concerns.
- All three paths reference the strongest alternative actually considered (`topAlternativeSummary()`), addressing "why not the alternatives" directly in the rationale text itself rather than only in the separate `alternatives` array.

Status: ✅ Automated, 7 tests, passing (was 5; two replaced, three added).

---

## 7. Autopilot orchestration

**File:** `lib/autopilot/decision/__tests__/recommendationEngine.test.ts`, `lib/autopilot/decision/__tests__/candidatePipeline.test.ts`

All Redis-backed persistence (`configStore`, `paperAccountStore`, `decisionLogStore`, `auditTrailStore`, `scheduler/locking`) is mocked with in-memory fakes via `vi.mock`, so these tests need no live Redis and are fully deterministic.

- **Multiple candidates:** N candidates in → N `DecisionAnalysis` out (including validation-failure candidates).
- **Deterministic ranking:** `recommended` sorts before `conditional` before `not_recommended`; two runs with identical inputs produce identical output ordering.
- **Duplicate handling:** two candidates with identical symbol/strategy/legs collapse to one recommendation, and the dropped candidate is now recorded (see below), not silently discarded.
- **Decision logging:** one log entry per processed candidate; recommended entries carry `paper_execution_disabled_until_sprint_3` in `rulesBlocked`.
- **Audit logging:** one `recommendation_generated` event per candidate.

**Gap closed (2026-07-11): duplicate candidates are now observable.** `candidatePipeline.ts`'s `dedupeCandidates()` previously dropped duplicates with zero record of what was dropped or why — only visible indirectly as `totalReceived > totalAccepted + totalRejected`. It now emits a `DuplicateCandidateRecord` per dropped candidate:

```ts
interface DuplicateCandidateRecord {
  droppedCandidateId: string;
  retainedCandidateId: string;
  dedupeKey: string;
  reason: 'duplicate_candidate';
}
```

- `CandidatePipelineResult` gained `duplicates: DuplicateCandidateRecord[]` and `totalDuplicates: number`.
- `RecommendationRunResult` gained `duplicates: DuplicateCandidateRecord[]`, wired through from the pipeline (empty array on the kill-switch short-circuit path, since no pipeline runs there).
- **Count reconciliation is exact and tested:** `totalReceived === totalAccepted + totalRejected + totalDuplicates` always holds, including in a mixed batch (one duplicate pair, one validation failure, one clean candidate) — not just in the simple two-candidate case.
- A duplicate does **not** get a full `DecisionAnalysis` (it never reaches the shared Decision Engine — that's still owned entirely by `lib/decision-engine`), only the four tracking fields above. A test explicitly locks this shape down so nobody later "upgrades" a duplicate record into something that duplicates Decision Engine reasoning.
- With three candidates colliding on the same key, the first is retained and the other two are each recorded as separate duplicates pointing at the same `retainedCandidateId` — tested.

Status: ✅ Automated, 16 + 18 tests, passing (was 12 + 14; net +4 orchestration, +4 pipeline).

---

## 8. Safety

**File:** `lib/autopilot/decision/__tests__/recommendationEngine.test.ts` → `describe('safety')`

- Every recommendation returned carries `executionAllowed: false` / `paperExecutionAllowed: false`.
- `RecommendationRunResult.mode === 'paper'` and `liveTradingEnabled === false` are hard-coded, not conditional.
- A recommendation run does not add/remove open paper positions or change `currentBalance` as a side effect (the mocked account is asserted unchanged except for `lastRunAt`).
- **No live orders submitted:** there is currently no code path in `lib/autopilot/decision/` or the `app/api/autopilot/*` routes that calls the TastyTrade order-submission client at all — this was confirmed by inspection (`grep` for order-submission calls returned nothing in this branch), not by a runtime test, since there's no execution code to exercise. Documented here as a **manual verification item**: re-run this grep before every merge to `main` to catch any future addition of execution code on this branch.

**Gap closed (2026-07-11): kill switch enforcement.** `AutopilotConfig.killSwitchEnabled` was previously persisted, sanitized on save, and surfaced by `GET /api/autopilot/status`, but never read anywhere in the recommendation-generation path. `runRecommendationEngine()` now checks it first, before the candidate pipeline or the shared decision engine ever run:
- When `killSwitchEnabled` is `true`, the function returns immediately with `killSwitchActive: true`, `recommendations: []`, `candidatesScanned: 0`, and **zero** decision log entries (no candidate reasoning ran, so there's nothing to log per-candidate). Exactly one `autopilot_paused` audit event is written instead, recording how many candidates were supplied but not evaluated.
- This is the single enforcement point — deliberately not duplicated in `app/api/autopilot/run/route.ts` or `app/api/autopilot/recommendations/route.ts`, both of which just relay whatever `runRecommendationEngine()` returns. That keeps the "don't duplicate reasoning logic" constraint intact: there's exactly one place that can let a run through when the switch is on.
- The run lock is still correctly acquired and released on the kill-switch path (verified — a stuck lock would have silently blocked all future runs for that user).
- `RecommendationRunResult` gained a new field, `killSwitchActive: boolean`, so callers (eventually the UI) can distinguish "ran and found nothing" from "didn't run because you paused it." Additive, non-breaking change to the existing type.
- **Not yet done:** no UI surfaces `killSwitchActive` today (`app/autopilot/page.tsx` is a minimal 119-line status view that doesn't read it). Recommended as a small follow-up, not done here to keep this change scoped to the Decision Engine / Autopilot orchestration layer per the sprint's stated boundaries.

Status: ✅ Automated, 8 tests, passing (was 5; 1 replaced with 3 that assert real enforcement).

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

**Tests implemented:** 107 automated tests across 6 files (`evaluateSingleCandidate.test.ts`, `riskValidation.test.ts`, `confidence.test.ts`, `riskGateEngine.test.ts`, `candidatePipeline.test.ts`, `recommendationEngine.test.ts`), plus one shared fixture module.

**Tests passing:** 107 / 107, verified locally with `npx vitest run` against this branch. `npx tsc --noEmit` clean. `npx next build` succeeds (all static/dynamic routes generate, including `/autopilot`).

**Gaps closed (all four Product Owner closure items, 2026-07-11):**
1. ✅ **Kill switch enforcement.** `runRecommendationEngine()` checks `killSwitchEnabled` before any candidate reaches the pipeline; when on, zero recommendations, zero decision-log entries, one `autopilot_paused` audit event, `duplicates: []`, `killSwitchActive: true`.
2. ✅ **Per-candidate rationale.** Built from data the shared engine already computes (concerns, alternatives, confidence, opportunity score) — no new reasoning path.
3. ✅ **Iron Condor fixture.** Dedicated 4-leg IC scenario covering `OPEN_IC`, full contract shape, explanation quality, alternatives/review triggers, and both execution flags false on both a recommended and an AVOID path.
4. ✅ **Observable duplicate handling.** `DuplicateCandidateRecord` (dropped id, retained id, dedupe key, `reason: 'duplicate_candidate'`) emitted per dropped candidate; `totalDuplicates` on the pipeline result and `duplicates[]` on `RecommendationRunResult`; count reconciliation (`totalReceived === accepted + rejected + duplicates`) tested exact, including mixed batches.

Also carried forward from the prior session: kill-switch UI toggle on `/autopilot` (status badge + toggle, reading/writing through the full config to avoid clobbering other settings).

**No new functionality was added beyond these four items** — no audit-trail viewer, no paper execution, no additional dashboard UX, no live execution. Canonical architecture unchanged: `lib/decision-engine` still owns single-candidate reasoning and `DecisionAnalysis`; `lib/autopilot/decision` still owns validation/orchestration/ranking/persistence/audit only; `executionAllowed`/`paperExecutionAllowed` remain hard-coded `false` everywhere, including on duplicate records (which don't get a `DecisionAnalysis` at all) and the IC path.

**Manual validation checklist (the only items not covered by the automated suite):**
- [ ] Vercel preview build for this branch is green (local `next build` already confirmed clean; this is the platform-level check)
- [ ] `/autopilot` page loads in a browser with an authenticated session; Kill Switch badge shows the correct live state and the toggle actually flips it end-to-end (not just against mocks)
- [ ] Existing Autopilot API endpoints still respond as before: `GET /api/autopilot/status`, `GET /api/autopilot/state`, `GET /api/autopilot/decisions`, `POST /api/autopilot/config`, `POST /api/autopilot/paper-account`
- [ ] `POST /api/autopilot/recommendations` still converts `ScreenResult[]` → candidates and returns a `RecommendationRunResult` with the new `duplicates` field present (even if empty) and `success: true`
- [ ] No regression on Portfolio, Screener, Repeat Trades, Pending Orders, or background task status — none of this branch's changes touch those files, but this needs a running server + TastyTrade session to confirm, which unit tests can't reach
