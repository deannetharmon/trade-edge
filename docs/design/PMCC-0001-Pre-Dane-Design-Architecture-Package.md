# PMCC-0001 — Pre-Dane Design & Architecture Package

**Status:** PRE-IMPLEMENTATION / REVIEW READY  
**Date:** 2026-08-09  
**Parent:** `docs/specifications/TradeEdge-PMCC-Capital-Cycle-Specification-v1.md`  
**Implementation authorization:** NONE — this package defines the safe first engineering slice; it does not authorize production PMCC behavior.

---

## 1. Executive Decision

The PMCC Capital Cycle is sufficiently defined to begin **foundation work**, but not sufficiently sourced to implement live strategy thresholds or lifecycle recommendations.

The smallest safe first Dane package is therefore **domain contracts + deterministic evidence primitives + tests**, not scanning, ranking, UI recommendations, broker execution, or Henry-rule thresholds.

The primary architectural discovery is a real blocker: the canonical `AutopilotStrategy` union currently supports only `BPS | BCS | IC | CSP | CC`; PMCC is not a canonical strategy in that model. `DecisionAction` likewise has no PMCC/LEAPS-specific establishment or long-leg lifecycle actions. The existing Recommendation Service only transports already-evaluated `DecisionAnalysis[]`; it intentionally does not evaluate, rank, filter, or understand capital. PMCC must therefore enter through canonical domain/decision contracts rather than being bolted into the UI or Recommendation Service.

---

## 2. Ian — Methodology Verification Ledger

Available connected sources were searched for Henry-specific PMCC/LEAPS material. No authoritative Henry source was located in connected Drive. Repository documents contain prior PMCC guidance, but those are TradeEdge design/reference material, not proof of Henry's methodology.

Accordingly, no unsupported Henry thresholds are promoted to policy.

| Topic | Current evidence | Classification | Implementation status |
|---|---|---|---|
| Long-leg delta ~0.70 | Dean's observed Henry examples | TARGET / TO VERIFY | Do not hard-code |
| Long-leg duration ~9–24 months | Existing TradeEdge design + Dean discussion | ELIGIBILITY ENVELOPE / TO VERIFY | Model bounds; no preferred DTE yet |
| Bollinger position matters for entry | Dean's observed Henry emphasis | TIMING SIGNAL / TO VERIFY | Model technical evidence; no buy/wait threshold |
| Bollinger parameters | Not sourced | NOT ESTABLISHED | OPEN |
| Preferred Bollinger region / %B rule | Not sourced | NOT ESTABLISHED | OPEN |
| Long-leg 30/40/50% realization behavior | Dean recollection | TO VERIFY | Do not hard-code |
| Short-call entry delta/DTE | Repo contains generic 0.20–0.35 / 21–45 DTE guidance, but not verified as Henry | NON-AUTHORITATIVE REFERENCE | Do not adopt as Henry policy |
| Short-call profit target | Not sourced | NOT ESTABLISHED | OPEN |
| Roll timing | Not sourced | NOT ESTABLISHED | OPEN |
| Roll contract selection | Not sourced | NOT ESTABLISHED | OPEN |
| Long-leg exit with active short | Safety requirement is clear; Henry handling not sourced | HARD SAFETY + OPEN METHOD | Never leave short uncovered; exact sequence OPEN |
| Capital recycling after exit | Product decision | FROZEN CONCEPT | Return realized capital to constructor |

### Methodology governance

Every eventual rule must be typed as one of:

- `HARD_RULE`
- `ELIGIBILITY_BOUND`
- `TARGET`
- `PREFERENCE`
- `TIMING_SIGNAL`
- `SAFETY_INVARIANT`
- `NOT_ESTABLISHED`

A numeric value may not enter Strategy Policy merely because it appeared in an old design document or educational reference.

---

## 3. Alan — Repository Contract Audit

### 3.1 Existing assets to REUSE

**Decision evidence model — REUSE/EXTEND**  
`lib/decision-engine/types.ts` already separates recommendation, supporting evidence, concerns, alternatives, review triggers, expected outcome, and metadata. This is directionally compatible with Decide → Verify → Audit.

**Recommendation acquisition boundary — REUSE AS-IS**  
`lib/recommendations/RecommendationService.ts` is explicitly a transport/store for already-evaluated `DecisionAnalysis[]`. It must remain ignorant of PMCC calculations and portfolio construction.

**Opportunity Engine boundary — REUSE/EXTEND LATER**  
Existing adapters and ranking infrastructure consume `DecisionAnalysis`; PMCC should not bypass this architecture once canonical PMCC decisions exist.

**Option leg market fields — REUSE/EXTEND**  
`AutopilotLeg` already carries option type, strike, expiration, quantity, delta/gamma/theta/vega, bid/ask/mid and quote timestamp. PMCC economics should reuse canonical leg truth rather than create duplicate UI calculations.

**Educational PMCC reference — REUSE FOR DISCLOSURE ONLY**  
`lib/help/optionsStrategyReference.ts` / HELP-0001 deliberately avoids fabricated fixed PMCC max-profit and simple breakeven claims. That discipline should carry into the operational design.

### 3.2 Required EXTENSIONS

**Strategy taxonomy — BLOCKER / EXTEND**  
Current canonical `AutopilotStrategy = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC'`. PMCC is absent. A foundation ticket must decide the canonical representation without breaking existing strategy-keyed records/configuration.

**Decision actions — EXTEND**  
Current actions include WAIT, BUY_SHARES, SELL_CSP, WRITE_CC, OPEN_BPS/BCS/IC, ROLL, CLOSE, MANAGE, HOLD, AVOID. PMCC needs lifecycle-safe semantics for establishing a long call, writing the overlay, and exiting/resetting without overloading generic actions ambiguously.

**Decision subject/state — EXTEND**  
The conceptual PMCC strategy state (CANDIDATE, READY_TO_ESTABLISH, LONG_ONLY, PMCC_ACTIVE, SHORT_CLOSED, LONG_EXIT_READY, CYCLE_COMPLETE) should not be conflated with `DecisionAction`.

**Expected outcome/economics — EXTEND**  
Existing `ExpectedOutcome` is income-trade oriented. PMCC needs explicit long debit, initial short credit when applicable, capital required/max loss semantics, intrinsic/extrinsic value, delta-adjusted exposure, and stock-replacement comparison evidence.

**Provenance — EXTEND**  
PMCC recommendations require market timestamp, strategy-policy version, portfolio-policy version, universe version, and transaction override provenance. Existing `metadata.rulesEvaluated/rulesBlocked` is useful but insufficient by itself.

### 3.3 NEW capabilities

- `TechnicalEntryEvidence` (or equivalent canonical market-feature contract) for Bollinger values/parameters/data sufficiency.
- PMCC strategy-instance/lifecycle state representation separate from recommendation action.
- Long-leg qualification evidence contract.
- Short-call qualification/management evidence contract.
- Portfolio feasibility result distinct from strategy qualification.
- Transaction override provenance that reconstructs rather than mutates policy.

### 3.4 CONFLICTS / debt to avoid propagating

`DR-0001` contains generic PMCC numeric guidance (e.g. high delta commonly 0.70–0.85+, short call 21–45 DTE / 0.20–0.35). These are useful historical design context but conflict with the new governance requirement if treated as Henry-authoritative. The new PMCC specification governs; old numbers remain non-authoritative until sourced/adopted.

The old suggested unified opportunity model includes synthetic `liquidityScore`, `portfolioFitScore`, `riskScore`, `incomeScore`, and `opportunityScore`. PMCC v1 must not make an opaque synthetic score the material evidence for entry, roll, or exit.

---

## 4. Strategy Policy v1 — Frozen Structure, Open Thresholds

Strategy Policy v1 shall separate six decisions:

1. **Underlying eligibility** — approved ownership universe/thesis validity.
2. **Entry timing** — FAVORABLE / WAIT / UNAVAILABLE from deterministic evidence.
3. **Long-leg qualification and selection** — QUALIFIED / NOT_QUALIFIED / UNAVAILABLE, then preferred eligible contract.
4. **Short-call write timing and selection** — WRITE / WAIT / UNAVAILABLE, then preferred short contract.
5. **Short-call management** — HOLD / TAKE_PROFIT / ROLL / CLOSE / UNAVAILABLE.
6. **Long-leg exit/reset** — HOLD / EXIT_READY / UNAVAILABLE, with short-call-safe sequencing.

Policy fields must distinguish hard bounds, targets and preferences. A target is not silently enforced as a hard minimum.

No threshold currently marked TO VERIFY may become executable behavior in Dane Package #1.

---

## 5. Paul — Portfolio Policy Calibration Framework (~$50K)

Numeric limits remain a product-owner decision; the architecture can be frozen without inventing them.

For a portfolio equity value `E` and a proposed one-contract PMCC with long debit `D`, initial short credit `C` (zero if LONG ONLY), and defined premium-at-risk `R`:

- `capitalCommitted = D - C` for the initial construction shown, with subsequent short-call cashflows tracked separately rather than rewriting original entry truth.
- `premiumAtRisk` must be explicit and must not be mislabeled as stock-equivalent exposure.
- `deltaAdjustedShares = longDelta × 100` before considering short overlay; combined net delta exposure is a separate derived metric.
- `sameUnderlyingRiskAfter` and `sameUnderlyingDeltaExposureAfter` must include existing positions.

Calibration screen/test cases for a representative $50,000 portfolio should evaluate at least:

- one proposed contract consuming 10%, 20%, 30%, 40% and 50% of portfolio capital;
- largest-position-to-zero stress;
- two-largest-positions-to-zero stress;
- same-underlying exposure before/after;
- partial deployment when the next indivisible contract violates policy;
- zero deployment when no contract fits.

These percentages are **test scenarios, not adopted limits**.

Dean decision required later: adopted max premium-at-risk per new PMCC, same-underlying risk/exposure limits, and any minimum cash reserve. The engine must support these as versioned Portfolio Policy rather than strategy rules.

---

## 6. Diane — Decide → Verify → Audit UX Contract

### Level 1 — DECIDE

Show one current action and enough information to act:

```text
MSFT — PMCC
CURRENT ACTION: WAIT
Entry timing is not favorable under Strategy Policy v1.
[Why wait?]
```

or

```text
MSFT — PMCC
CURRENT ACTION: ENTER LONG
Jan 2028 $___ Call · Δ ___ · Debit $___
Capital required $___
[Review recommendation]
```

No opaque score is required.

### Level 2 — VERIFY

Expanded evidence groups:

- Underlying eligibility
- Entry timing (including Bollinger facts when available)
- Long-leg contract qualification
- Short-call decision
- Portfolio fit
- Capital efficiency / stock-replacement comparison
- Risks / concerns

Every group exposes rule, observed value, status, and explanation.

### Level 3 — AUDIT

Expose provenance:

- quote/market timestamp
- policy version(s)
- ownership-universe version
- portfolio snapshot/version
- transaction overrides
- evaluated/blocked rule identifiers
- recommendation generated timestamp

### Lifecycle UX

A position may prominently show two independent recommendations when necessary:

```text
LONG LEG: HOLD
SHORT LEG: ROLL
```

The system must not collapse this into a single ambiguous "MANAGE" label when the user needs an executable action.

---

## 7. Quinn — Pre-Dane Safety / Invariant Review

**PASS — architecture principles:**

- WAIT/HOLD are first-class outcomes.
- Strategy qualification is separate from portfolio feasibility.
- Missing required evidence cannot become zero/PASS.
- Recommendation Service remains transport, not decision logic.
- UI must not own financial calculations.
- Long and short legs are evaluated independently.
- Policy and transaction overrides are distinct.
- No broker execution is in this scope.

**BLOCKING acceptance tests for future implementation:**

1. Missing delta, bid/ask, expiration or required quote evidence produces UNAVAILABLE/NOT_QUALIFIED as policy specifies; never zero substitution.
2. Long-leg close is rejected/blocked while an uncovered short would remain.
3. Transaction delta override reconstructs the candidate and records provenance; base policy remains unchanged.
4. WAIT is returned when timing evidence is valid but timing rule says no action.
5. UNAVAILABLE is returned when timing evidence is insufficient/stale rather than interpreted as WAIT.
6. Portfolio NOT_FEASIBLE cannot be converted to QUALIFIED by ranking/score logic.
7. One-contract granularity can result in zero deployment.
8. Original entry economics remain immutable after subsequent short-call income/rolls.
9. PMCC max profit/simple breakeven are not fabricated where the construction does not support a single fixed figure.
10. All material recommendation evidence can be inspected without reverse-engineering an aggregate score.

---

## 8. Dane Work Package #1 — Recommended Scope

### Name

**PMCC-0002A — Canonical PMCC Domain & Evidence Foundation**

### Objective

Create the canonical, non-UI domain contracts required to represent PMCC/long-LEAPS decisions safely, without implementing Henry thresholds, scanning, ranking, lifecycle recommendation logic, or execution.

### In scope

1. Extend canonical strategy taxonomy to represent PMCC safely, including all exhaustive mappings/tests affected by the union change.
2. Define PMCC lifecycle state as a concept separate from DecisionAction.
3. Extend/add decision-action semantics needed for long-leg establishment, short-call overlay, and exit/reset; avoid ambiguous overloading.
4. Define canonical PMCC evidence/economics types, including:
   - long and optional short legs
   - underlying/quote timestamps
   - long debit / short credit / initial net debit
   - intrinsic/extrinsic value
   - capital required / premium at risk
   - delta-adjusted shares/exposure
   - qualification availability/status
5. Define `TechnicalEntryEvidence` capable of representing Bollinger middle/upper/lower, parameters, normalized position/%B if computed, timestamp, and data sufficiency — **no timing threshold**.
6. Define strategy-policy and portfolio-policy provenance/version references and transaction override provenance.
7. Add deterministic pure calculation helpers only where formulas are strategy-independent and uncontroversial (e.g. intrinsic/extrinsic decomposition, delta-adjusted share equivalents), with null/unavailable behavior for invalid inputs.
8. Add comprehensive unit/type tests.
9. Update architecture documentation with actual final type/file locations and any compatibility decisions.

### Explicitly out of scope

- Henry numeric thresholds or Bollinger buy/wait rules
- PMCC scanning
- option contract ranking
- Portfolio Constructor optimization
- UI pages/components
- Recommendation Service behavior changes beyond compile-safe type propagation if required
- broker/paper execution
- roll algorithms
- long-leg profit-taking algorithms
- automated strategy-policy mutation
- new synthetic scoring

### Acceptance criteria

- Existing BPS/BCS/IC/CSP/CC behavior remains unchanged.
- PMCC can be represented canonically without `any`, UI-local duplicate truth, or fabricated economics.
- Missing required evidence is represented explicitly as unavailable/null rather than zero.
- Lifecycle state and recommended action are separate types.
- Technical evidence carries parameters and timestamp/provenance.
- Existing exhaustive strategy mappings are intentionally updated and tested; no silent default fallthrough.
- `npx tsc --noEmit` passes.
- Targeted tests pass.
- Full Vitest suite passes.
- `next build` passes.
- Implementation report documents changed files, tests, deviations, and confirms no production strategy thresholds were introduced.

---

## 9. Gate After PMCC-0002A

Only after the foundation is reviewed should the team authorize the next slices:

- **PMCC-0002B:** deterministic long-leg candidate qualification + stock-replacement evidence using an explicitly adopted Strategy Policy.
- **PMCC-0002C:** deterministic entry-timing feature calculation/evaluation once Henry's Bollinger methodology is sourced/adopted.
- **PMCC-0002D:** short-call write/management lifecycle.
- **PMCC-0002E:** portfolio feasibility/constructor.
- **PMCC-0002F:** Decide → Verify → Audit UX.

This ordering keeps implementation moving while preventing unresolved trading methodology from leaking into code as accidental policy.
