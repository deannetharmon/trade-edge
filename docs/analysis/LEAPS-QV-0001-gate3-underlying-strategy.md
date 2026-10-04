# LEAPS-QV-0001 Gate 3 — QV-v1.0 Underlying Strategy

Spec: ticket Section 45 (baseline `1a5c3f4da42c59226351f26b42bf85b93914d6ce`). Scope: underlying classification only.
Code: `lib/discovery/qv/`. Nothing outside `lib/discovery/` changed except one test guard (see Deviations).

## Architecture
- `policy.ts` — the ONLY home of thresholds and metric ids (`QV_V1_0_POLICY`, frozen, fingerprint-pinned in tests) and the assumptions A1–A8.
- `quality.ts`, `valuation.ts`, `fundamentals.ts`, `technical.ts`, `risk.ts`, `fcf.ts` — one classifier per domain; each returns a result plus structured reasons built from the same comparisons.
- `strategy.ts` — Data Sufficiency + lifecycle classification; `QV_V1_0_STRATEGY` (stateless) and `createQvStrategyFor(previousState)` (lifecycle-aware).
- `reasons.ts` — registry of every emitted code; `QV_SPEC_REASON_CONCEPTS` maps Section 45.12 names to emitted codes.
- Input is normalized metrics only. Only a VALID finite metric exposes a number; UNAVAILABLE / STALE / INVALID read as "not evaluable" and are named in the result. No provider, route, UI, clock or network code. No score and no ranking: a state is the conjunction of its gates (`rankings` is empty).

## Rules (order is fixed; later steps cannot undo earlier ones)
1. **Data Sufficiency** — Quality, Valuation, Fundamentals (integrity/momentum) and Technical must each be evaluable, otherwise INSUFFICIENT_DATA naming the blocking metric ids. Unfavorable evidence is never INSUFFICIENT_DATA.
2. **Thesis break** — three or more of the evaluable fundamental dimensions deteriorating => FUNDAMENTAL_THESIS_BROKEN; INVALIDATED if the candidate was previously WATCH/SETUP/ACTIONABLE, otherwise DISCOVERED.
3. **Quality FAIL** => DISCOVERED.
4. **SETUP / ACTIONABLE** — Quality PASS, valuation >= MODERATE, growth-adjusted INTACT/MIXED, integrity PASS, momentum STABILIZING/IMPROVING, no disqualifying risk; technical STABILIZING => SETUP, RECOVERING => ACTIONABLE.
5. **WATCH** — Quality PASS and thesis intact (growth-adjusted and momentum not DETERIORATING) but a SETUP requirement unmet (A8).
6. Otherwise DISCOVERED.
Technical regression only fails step 4, so ACTIONABLE falls to SETUP/WATCH, never INVALIDATED.

Domain rules (Technical State reflects review correction 1, see "Review round 1"): Quality fails on operating margin <= 0, HIGH leverage plus one other weakness, or two or more weaknesses (A4). Valuation: percentile and discount are independent criteria, stronger class wins; NONE needs both criteria; 3Y fallback at reduced confidence. Fundamentals: five dimensions, never-neutral NOT_EVALUABLE; growth-adjusted 0/1/2+ deteriorating; momentum per 45.7. Technical: STABILIZING = weekly RSI slope not negative + 4-week RSI change non-negative + relative-strength deterioration no longer accelerating; RECOVERING = rising weekly RSI slope + positive 4-week change + improving relationship to SMA50 + improving relative strength vs SPY. Levels are never read as directions. Evidence classes (review round 2): DECLINING = two or more INDEPENDENT bearish families (RSI momentum, SMA50 relationship, SMA200 trend, relative strength); OVERSOLD = weekly RSI <= 30 and stabilization not established; NOT_ESTABLISHED = evaluable but one contradicting signal supports no state (taxonomy gap, WATCH); NOT_EVALUABLE = unavailable direction evidence with nothing independently established (fails closed, INSUFFICIENT_DATA) (A5).

## Reason codes
Quality (21), Valuation (8), Fundamental (5 + 15 per-dimension trajectory codes), Technical (5, incl. TECHNICAL_STATE_NOT_ESTABLISHED), Risk (6), Data (5), Lifecycle (12). Full list: `QV_ALL_REASON_CODES`.

## Assumptions A1–A8 (review against Section 45)
A1–A8 are RATIFIED (round 4: final Ian/Paul rulings, recorded in the ticket ledger); every entry carries `ratification: 'RATIFIED'` and a `ratificationRecord` in `QV_V1_0_ASSUMPTIONS`. The "open question" column below is the historical question; the ratified ruling is in `docs/analysis/LEAPS-QV-0001-gate3-policy-decisions.md`.

| ID | Area | Basis | Open investment-policy question |
|---|---|---|---|
| A1 | Revenue/EPS trajectory | POLICY | Is "negative and below its 5Y trend" what "materially deteriorating" means; is the 5Y trend the right reference? |
| A2 | Operating-margin trajectory | POLICY | What margin change (pp) is material? |
| A3 | FCF pattern definitions | POLICY | Are the persistent/deteriorating/isolated definitions and the 3-year window right? |
| A4 | Quality PASS composition | POLICY (partly DIRECT) | Margin <= 0 and HIGH-leverage-plus-weakness are spec text. "Two or more weaknesses fails Quality" and "all five aspects must be evaluable" are not. |
| A5 | Technical confluence | POLICY (partly DIRECT) | STABILIZING/RECOVERING indicator lists are spec text. How one relative-strength change expresses "no longer accelerating" (>= 0), the OVERSOLD line (weekly RSI <= 30), the DECLINING confirmation count, and the lookbacks of the three direction metrics are not. |
| A6 | Risk | POLICY | Earnings window; which events are reliable binary events. |
| A7 | Leverage trajectory | DATA | No prior-period leverage metric. |
| A8 | WATCH vs DISCOVERED | POLICY | Is Quality PASS the floor for WATCH; is DISCOVERED right for failed Quality? |

## Data limitations (not proxied)
- **Annual FCF history** has no normalized metric (`fcf_annual_history_5y` is the contract id, UNAVAILABLE today). Negative TTM FCF therefore yields INSUFFICIENT_DATA; positive TTM FCF works, but the FCF *trajectory* dimension is NOT_EVALUABLE without history.
- **Technical direction evidence** (review correction 1): the normalizer produces weekly RSI level, 4-week RSI change, price, SMA50, SMA200, SMA200 trend and 126d relative-strength LEVEL. It does not produce a one-week weekly-RSI slope, a change in the price-vs-SMA50 gap, or a change in relative strength. Contract ids (UNAVAILABLE today, no proxy): `rsi_weekly_slope_1w`, `price_vs_sma50_gap_change_4w_pp`, `relative_return_126d_change_4w_pp`. Effect in production until they exist: RECOVERING cannot be established, STABILIZING cannot be established, so the Technical domain is NOT_EVALUABLE (INSUFFICIENT_DATA) unless known adverse evidence already classifies it DECLINING/OVERSOLD (WATCH). **No candidate can reach SETUP or UNDERLYING ACTIONABLE until a normalizer supplies these metrics.** Specification for that change: `LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md` (proposed, not authorized). The audit also found the production loader does not fetch SPY or return technical metrics, so even the existing relative-strength level is UNAVAILABLE there.
- **Revenue/EPS trend reference** (review correction 2): non-negative growth with no 5Y trend is NOT_EVALUABLE, not STABLE. Negative growth stays DETERIORATING without a trend (independently supported adverse evidence).
- **Leverage trajectory**: no prior-period leverage metric (A7). Fundamental dimensions evaluable today: revenue, EPS, operating margin (FCF with history).
- **Corporate event flags / analyst revisions** are not produced yet; they stay explicitly UNAVAILABLE and never block.
- **Lifecycle context** (review item 5): lifecycle persistence stays outside Gate 3. The Gate 1 `StrategyInput` carries no previous state, so the registered stateless `QV_V1_0_STRATEGY` cannot invalidate: a thesis break is reported DISCOVERED with `LIFECYCLE_THESIS_BREAK_NO_PRIOR_THESIS`. `createQvStrategyFor(previousState)` / `evaluateQv(input, { previousState })` take the persisted state explicitly and are tested (INVALIDATED only from WATCH/SETUP/ACTIONABLE). **Gate 7 dependency:** the persistence layer must pass the candidate's current state into the strategy, or the stateless strategy will never produce INVALIDATED.

## Deviations
- Reason-code grammar requires a category prefix: `GROWTH_ADJUSTED_*` => `VALUATION_GROWTH_ADJUSTED_*`, `ANALYST_REVISION_DATA_UNAVAILABLE` => `DATA_…`, `REQUIRED_DATA_UNAVAILABLE` => `DATA_…`.
- `lib/discovery/__tests__/isolation.test.ts`: the investment-vocabulary guard now also excludes `lib/discovery/qv/` (as Gate 2 did for `normalized/`); `qv/__tests__/policy.test.ts` guards that numbers live only in `policy.ts`.

## Review round 1 (Gate 3 review: CHANGES REQUIRED at e0398a9)
1. **Technical State confluence.** Found: `technicalStateOf` returned STABILIZING on four-week RSI change >= 0 alone; present inputs (SMA50, relative strength) did not participate in the constructive states; levels stood in for directions. Corrected: STABILIZING and RECOVERING now use the Section 45.8 element lists with three direction metrics that do not exist in the normalizer; they are contract ids, UNAVAILABLE today, and the affected classification fails closed (see Data limitations). Known adverse evidence still classifies DECLINING/OVERSOLD.
2. **Missing fundamental-trend semantics.** Found: `growthTrajectoryOf(growth >= 0, null)` returned STABLE. Corrected: returns NOT_EVALUABLE; `DATA_TREND_REFERENCE_UNAVAILABLE` is emitted; adverse (negative) growth is preserved.
3. **Regression cases** added in `technicalDirection.test.ts`: flat/rising RSI with continuing adverse evidence is not STABILIZING; relative-strength level does not prove direction; price above SMA50 does not prove an improving relationship; missing/stale/invalid EPS trend is not STABLE; legitimate SETUP and ACTIONABLE still qualify.
4. **Assumptions A1–A8** reviewed against Section 45 and classified (table above). Ratified in round 4.
5. **Lifecycle persistence** kept outside Gate 3 (see Data limitations).
Policy fingerprint changed because the technical input contract gained three ids (pin updated deliberately). New reason codes: `DATA_TECHNICAL_DIRECTION_UNAVAILABLE`, `DATA_TREND_REFERENCE_UNAVAILABLE`.

## Review round 2 (baseline 76dee26)
1. **Adverse Technical State confluence.** Found: `technicalStateOf` returned DECLINING whenever any single stabilization-core condition was false. Corrected: four evidence classes are distinguished (DECLINING needs two or more distinct bearish feature groups (not statistically independent); OVERSOLD; NOT_ESTABLISHED = present-but-unsupported, WATCH, not forced; NOT_EVALUABLE = unavailable). Independently established adverse evidence stays visible when other inputs are missing. New reason code `TECHNICAL_STATE_NOT_ESTABLISHED`; policy `decliningMinOtherBearish` replaced by `decliningMinBearishFamilies` (fingerprint re-pinned). Taxonomy gap recorded for Ian (see policy decisions document).
2. **Gate 2c data amendment prepared (not authorized, nothing implemented):** `docs/analysis/LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md`. Audit found the production path is wider than three metrics: the loader never fetches SPY (the existing relative-strength metric is UNAVAILABLE in production), technical metrics are not returned by the loader, the completed-bar rule is not enforced at the fetch boundary, and annual FCF history is derivable from the existing SEC `annualSeries` without a new provider.
3. **Policy decisions made reviewable:** `docs/analysis/LEAPS-QV-0001-gate3-policy-decisions.md` — concrete proposals and worked examples for A1–A6 and A8, split into investment-policy questions and engineering/data questions. Examples are executed in `policyExamples.test.ts`. No approval is recorded.
4. Ticket ledger updated; Gate 3 stays pending, Gate 4 blocked.

**Production blocker:** until Gate 2c (or equivalent) is built, no candidate can reach SETUP or UNDERLYING ACTIONABLE in production.

## Review round 3 (team review CHANGES REQUIRED at 7a913b4; review document a33a14b)

### Status tracks (Paul) — four separate statuses
| Track | Status | Owner |
|---|---|---|
| Gate 3 algorithm acceptance | IMPLEMENTED — PENDING REVIEW (this round) | Dane / Quinn / Ian |
| Gate 2c data acceptance | SPECIFIED, NOT AUTHORIZED (scope decision is separate) | Paul |
| Production integration (StrategyInput assembler, event data, end-to-end) | NOT STARTED | Quinn (architecture review) |
| Gate 7 persisted previous-state | NOT STARTED | Frank (dependency ledger) |
Gate 4 remains blocked. Production has no path to SETUP/ACTIONABLE until Gate 2c and production integration exist.

### State-specific evidence requirements
| State | Requires | Missing evidence effect |
|---|---|---|
| RECOVERING | RSI slope > 0, 4w RSI change > 0, SMA50-gap change > 0, RS change > 0 | any missing: not RECOVERING (STABILIZING at best) |
| STABILIZING | RSI slope >= 0, 4w RSI change >= 0, RS change >= 0 (SMA50-gap change NOT required) | missing slope or RS change: NOT_EVALUABLE; missing gap change: SETUP still reachable, data completeness reports it |
| DECLINING | >= 2 distinct bearish feature groups (not statistically independent) | unavailable groups are not counted |
| OVERSOLD | weekly RSI <= 30 AND >= 1 non-RSI bearish group, DECLINING not established | RSI alone is NOT_ESTABLISHED |
| NOT_ESTABLISHED | stabilization contradicted, not DECLINING/OVERSOLD | WATCH only if Quality passes and the thesis is intact, else DISCOVERED |
| NOT_EVALUABLE | required level or direction metric unavailable | INSUFFICIENT_DATA; independently evidenced adverse readings still reported as `TECHNICAL_ADVERSE_EVIDENCE_PRESENT` (a trace, not a state) |

### Claims narrowed
- Gate 3 does not implement Section 45.8 "faithfully": the relative-strength rule is a stricter first-difference reading, and NOT_ESTABLISHED is an added state. Both are review items, not spec text.
- Adverse evidence is preserved as a trace when required data is missing; the STATE is still never classified from partial evidence.
- "Independent bearish families" is now "distinct bearish feature groups" (SMA50 and SMA200 are correlated).
- Unknown event coverage is reported UNKNOWN and the risk gate is NOT_EVALUABLE; it is never "verified no events".

### Strategy version
QV-v1.0 has not been published or persisted (Gate 3 is pending), so these changes stay inside QV-v1.0 (A5 assumption wording changed; fingerprint re-pinned). Any change after Gate 3 closure requires a version bump.

### Review-item disposition
| Item | Disposition |
|---|---|
| Correct false Gate 2c 6.1 implication, "faithfully", dividend claim, dependency ledger | DONE (docs) |
| A1/A3 alternatives with counterexamples | DONE (policy doc); nothing ratified; counterexamples pinned as current behavior in `reviewRound3.test.ts` |
| A2/A4/A5/A7/A8 as REVIEW RECOMMENDATIONS | DONE (policy doc) |
| OVERSOLD confluence vs 45.8 | DONE (code + tests); open question for Ian: RSI-alone OVERSOLD |
| Preserve adverse evidence with missing data | DONE (trace reason); strict sufficiency kept |
| Typed event schema / coverage; nonblocking absence kept | PROPOSED (policy doc); risk gate NOT_EVALUABLE when UNKNOWN (code); classification unchanged |
| Gate 2c calendar/date/alignment/FCF contract, fixtures | DONE (spec only; no provider/data-layer implementation) |
| Regression tests for changed behavior | DONE (`reviewRound3.test.ts`, updated taxonomy tests) |
| Exact-head CI/Vercel evidence | see completion report |

## Review round 4 (baseline 9a0e029 accepted; policy ratification)
| Item | Disposition |
|---|---|
| A1 | `growthTrajectoryOf`: negative growth is DETERIORATING regardless of trend; positive-below-trend is not DETERIORATING; new `FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT` reason (no threshold) |
| A2 | Ratified ±1 pp; exact boundary tests |
| A3 | `fcf.ts`: level (POSITIVE/BREAKEVEN/NEGATIVE), annual non-overlapping persistence (2+ negative annual points), TTM never counted as an annual observation, fail closed; new `QUALITY_FCF_BREAKEVEN`; `Quality` reads history only for a NEGATIVE level |
| A4, A8 | Ratified; behavior unchanged (confirmed by existing and new tests) |
| A5 | Ratified; wording changed to "relative strength no longer deteriorating"; NOT_ESTABLISHED documented as an evaluation result, not an investment state; price-return convention documented |
| A6 | Ratified; UNKNOWN stays UNKNOWN, nonblocking, no WATCH cap, never VERIFIED_EMPTY (test) |
| A7 | Ratified data limitation |
| Ratification records | `QvAssumption.ratification` is now `RATIFIED` with `ratificationRecord` for A1–A8 |
| Gate 2c | AUTHORIZED, implementation NOT STARTED; Option B / acceleration metric rejected for QV-v1.0 |

The limitation recorded here in round 4 (collapsed TTM with rising annual history reading IMPROVING) is resolved in round 5 below.

## Review round 5 (baseline 5f9f7f8 accepted except one A3 item)
A3 clarification only: current-vs-latest-FY guard in `fcf.ts` (`fcfBelowLatestFiscalYear`). For a positive TTM, rising annual history gives IMPROVING only if TTM is not below the latest fiscal-year FCF; otherwise STABLE with the new reason `FUNDAMENTAL_FCF_BELOW_LATEST_FY_CONTEXT` (CONCERN, structured: ttmFcf, latestFiscalYearFcf). No percentage threshold; never DETERIORATING from this comparison alone. TTM remains a level: not an annual observation, not counted toward persistence; persistent-negative, BREAKEVEN and fail-closed behavior unchanged. A1, A2, A4-A8 untouched. Gate 2c not implemented; Gate 4 blocked.

## Tests (`lib/discovery/qv/__tests__`)
boundaries (9), behavior (12), hardGates (15), policy (12), technicalDirection (21), policyExamples (7), reviewRound3 (9), round4Policy (23) = 108.
