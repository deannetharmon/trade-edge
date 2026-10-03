# LEAPS-QV-0001 — Gate 3 Review Round 2 consolidated review

Date: 2026-10-03
Facilitator: Frank
Reviewed implementation: 7a913b41a6e7adbebf57607ac4a07f122251d092
Parent: 76dee263f0901fb33a51a9631d5bfa095579dabb
Spec baseline: 1a5c3f4da42c59226351f26b42bf85b93914d6ce

## Decision

**CHANGES REQUIRED. Gate 3 remains IMPLEMENTED — PENDING REVIEW. Gate 4 remains blocked. Gate 2c remains PROPOSED — NOT AUTHORIZED for implementation.**

These are independent AI role reviews using Ian, Alan, Quinn and Paul review responsibilities. They are recommendations, not external human signoffs or fabricated GitHub approvals. This review authorizes no merge, release, new provider, or Gate 4 work. The next authorized work is the correction/specification/fixture preparation below.

## Evidence reviewed

Repository Gate 2c specification, Gate 3 policy-decisions document, underlying-strategy document, technical.ts, policy.ts, fcf.ts, risk.ts, fundamentals.ts, quality.ts, strategy.ts and ticket Section 45 at the reviewed implementation SHA. Quinn additionally inspected loader/handler code.

The GitHub combined status tool returned Vercel success for the exact implementation. The commit workflow tool returned no matching runs (its documented filter is pull-request runs); that does not establish CI failure, but this review has not independently confirmed run 37153885000 or rerun the reported 6,594 tests. Those remain Dane-reported evidence.

## Ian — investment policy

| Assumption | Recommendation | Required disposition |
|---|---|---|
| A1 growth trajectory | CHANGES REQUIRED | Growth 1% versus 12% historical trend and contraction -2% versus -5% must not silently establish stability. Separate recent direction from long-term context; propose material-slowdown rules and examples. No new numerical cutoff is ratified here. |
| A2 margin band | Accept recommendation | Inclusive +/-1 pp stable band is acceptable as an explicit generic v1 heuristic. |
| A3 FCF | CHANGES REQUIRED | Do not count overlapping latest FY and TTM as independent persistence observations. Separate level from trajectory; distinguish zero from negative; address positive TTM 1 with annual history [10,20,30] currently classified IMPROVING. Do not concatenate overlapping periods as consecutive time samples. |
| A4 Quality composition | Conditional acceptance recommendation | Explicit spec amendment for two material weaknesses failing Quality and all five aspects evaluable; dependent on corrected A3. ELEVATED leverage remains a concern rather than another material weakness. |
| A5 technical taxonomy | Conditional acceptance recommendation | Prefer strict Option A: nonnegative RS change for STABILIZING, positive for RECOVERING. Explicitly amend wording to "relative strength no longer deteriorating." Accept recommendation for NOT_ESTABLISHED, <=30 depressed line, and two distinct feature groups, subject to confluence/trace corrections below. |
| A6 risk | Policy amendment proposed | 14-day ordinary earnings flag acceptable for underlying screening. Define material-event categories, coverage/source/freshness and verified empty-list semantics. Ian recommends unknown coverage cap WATCH; this is a proposed change to current missing-event behavior, NOT an engineering correction already authorized by Section 45.9. |
| A7 leverage trajectory | Accept limitation recommendation | Keep unavailable trajectory explicit; no neutral substitution. |
| A8 lifecycle | Accept recommendation | Quality PASS WATCH floor; failed quality DISCOVERED; INVALIDATED requires persisted prior state. |

Distinct bearish feature groups are not statistically independent signals. SMA50 and SMA200 remain correlated. SPY price-return comparison is acceptable as an explicit v1 convention; remove the unsupported dividend-immateriality claim because ex-dividend effects can flip zero-boundary decisions.

## Alan — formulas, observation dates, golden fixtures

1. Correct Gate 2c section 6.1: d>=0 does NOT imply a=d-d_prior>=0. R=[0,10,12] gives d=2,a=-8; R=[0,-10,-18] gives d=-8,a=2. Predicates are incomparable. Option B's OR is a broader union, not equivalence.
2. The stated 70/147/167 daily-bar minima and 16 completed weekly closes for RSI slope are arithmetically consistent. Benchmark lookup must be by required timestamps, not assumed equal array positions.
3. Define completed sessions using exchange timezone/calendar, regular/early closes, holidays and DST. Define Monday-week boundaries and late/missing completed-bar behavior; no guessed fixed closing-time shortcut.
4. Weekly evidence asOf must reflect its actual last completed weekly observation, or explicitly distinguish evaluation time from evidence time. A newer daily timestamp must not mask stale weekly evidence.
5. Specify whether the latest contiguous three-year FCF suffix remains usable after an older gap. Accommodate 52/53-week fiscal calendars, restatements, missing newest-year capex and ambiguous items.
6. Preserve independently evidenced adverse trace when required levels are missing, or narrow the claimed guarantee. Current assessTechnical levelBlocking exits before building signals.
7. Independent golden fixtures: 70 closes with first 50 at 100 and last 20 at 110 => SMA50-gap change 5.769230769... pp; 147 stock/SPY bars at 100 with final stock close 120 => RS change 20 pp. Add exact history, alignment, validity, freshness and session-calendar boundaries.

## Quinn — architecture and conformance

Production audit confirmed: benchmark not passed to technical builder, technical metrics discarded except last close, and fetch boundary lacks completed-session filtering. Gate 2c is necessary but does not deliver the StrategyInput assembler, event contract/source, or Gate 7 lifecycle persistence.

Technical code still requires review against "RSI alone must not determine state": OVERSOLD can be selected from weeklyRsiDepressed without independent depressed-price confirmation. Dane must make the conflict explicit and propose either confluence evidence or an explicit specification amendment; do not invent a threshold.

Known adverse evidence is preserved for missing direction metrics but can be erased by missing level metrics. Keep overall strict sufficiency while retaining supported adverse component evidence/reasons. Do not report unconditional conformance before correcting the documented guarantee.

State-specific evidence requirements must be explicit: missing SMA50-gap change can still permit STABILIZING/SETUP because that metric is required for RECOVERING, not STABILIZING. Do not conflate full dataset completeness with sufficient evidence for a particular state. NOT_ESTABLISHED leads to WATCH only when the other WATCH requirements are met.

Gate 2c must isolate SPY fetch failure to benchmark-derived metrics, preserve SEC/stock-only results, and return the additive technical contract consistently on NOT_COVERED/provider-failure paths. Handler/loader contract tests must demonstrate actual completed-bar wiring rather than just pure formula correctness.

Risk absence must remain visibly unknown rather than described as verified no-event coverage. Section 45.9 does not currently require missing-event coverage to block qualification; Ian's stricter WATCH cap requires a recorded policy amendment before implementation.

## Paul — scope and acceptance

Gate 2c bounded scope is justified: approved three direction metrics/catalog/provenance; SPY acquisition/alignment; completed bars; additive technical exposure; FCF history from existing SEC annualSeries; meaningful formula/wiring regressions. No acceleration metric unless selected, no UI/ranking/contract engine/new provider work.

Separate statuses:
- Gate 3 algorithm acceptance: resolved assumptions, spec/code/examples aligned, intentional fingerprint/version decision.
- Gate 2c data acceptance: independent fixtures plus real loader/endpoint output and backwards compatibility.
- Production integration acceptance: owned StrategyInput assembler, explicit event-data behavior, representative end-to-end evaluations.
- Gate 7: persisted previous-state wiring and lifecycle regressions.

Gate 2c completion alone is not production readiness. Dane owns implementation preparation; Quinn owns integration architecture review; Paul owns scope acceptance; Frank maintains the dependency ledger and review routing.

## Dane — next correction order

Proceed on the existing feature branch with a correction round; do not start Gate 2c implementation or Gate 4.

1. Correct the false implication, "faithfully" conformance claim, adverse-evidence guarantee, dividend claim, and complete dependency/status ledger.
2. Prepare revised A1/A3 policy alternatives with counterexamples and no invented ratification. Record the conditional recommendations for A2/A4/A5/A7/A8 as REVIEW RECOMMENDATIONS until matching accepted specification decisions exist.
3. Resolve OVERSOLD confluence explicitly against Section 45.8. Preserve adverse evidence alongside missing-data diagnostics; maintain required-domain insufficiency.
4. Provide typed event schema/coverage proposals. Keep current nonblocking absence semantics until the stricter A6 policy amendment is accepted. Do not silently promote risk absence to verified PASS/no events.
5. Freeze a reviewable Gate 2c calendar/date/alignment/FCF contract and independent expected fixtures. No provider/data-layer implementation yet.
6. Add meaningful regressions for changed Gate 3 behavior and newly approved policies only; align policy examples, reasons, fingerprint and strategy-version decision.
7. Return exact SHA, changed files, each review-item disposition, relevant tests, TypeScript, required full suite, exact-head CI/deployment evidence, and remaining decisions.

Return status IMPLEMENTED — PENDING REVIEW. Frank routes the corrected package to these same review responsibilities. Gate 2c scope authorization is a separate recorded decision after entry requirements are satisfied; Gate 4 remains blocked.

No routine sponsor reconfirmation is required. Uncalibrated investment rules must be settled through Ian/Paul review rather than guessed in engineering.
