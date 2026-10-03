# LEAPS-QV-0001 Gate 3 — Policy decisions for review (A1–A6, A8)

**Status: PROPOSALS ONLY. Nothing here is approved or ratified; no reviewer approval is recorded.** Each proposal states what the code does today, so Ian can accept, change or reject it. The worked examples are executed in `lib/discovery/qv/__tests__/policyExamples.test.ts` (and `technicalDirection.test.ts`), so they cannot drift from the implementation. A decision that changes a value is a policy change (`policy.ts`, fingerprint re-pin, new strategy version if a published version has been used); a decision that changes a rule needs a code change in the matching classifier.

Questions are split below: **Part 1 — investment-policy** (Ian), **Part 2 — engineering/data** (Dane/Quinn/Paul).

## Part 1 — Investment-policy questions

### A1 Revenue / EPS trajectory ("materially deteriorating")
- **Proposed decision:** growth is DETERIORATING when TTM growth is negative and below the 5Y CAGR (or the CAGR is unavailable — negative growth is adverse on its own); IMPROVING when growth is non-negative and above the 5Y CAGR; STABLE otherwise; NOT_EVALUABLE when growth is non-negative and the 5Y CAGR is unavailable.
- **Examples:** growth −2 vs trend 5 ⇒ DETERIORATING. Growth 3 vs 5 ⇒ STABLE. Growth 7 vs 5 ⇒ IMPROVING. Growth 1 vs trend 12 ⇒ **STABLE** (positive but far below trend). Growth −2 with no trend ⇒ DETERIORATING. Growth 4 with no trend ⇒ NOT_EVALUABLE.
- **Open question:** is a large positive shortfall against trend (the 1 vs 12 case) "material deterioration"? Alternative: DETERIORATING when growth is more than X percentage points below trend even if positive. That would make more names reach growth-adjusted MIXED/DETERIORATING and thesis break sooner. Needs X from Ian; not implemented.

### A2 Operating-margin trajectory
- **Proposed decision:** year-over-year change beyond ±1 percentage point is material; within the band is STABLE.
- **Examples (pp):** −1.01 ⇒ DETERIORATING; −1 ⇒ STABLE; 0 ⇒ STABLE; +1 ⇒ STABLE; +1.01 ⇒ IMPROVING.
- **Open question:** is 1 pp the right materiality? Margin scale differs by sector (software versus distribution); a sector-relative band is an alternative.

### A3 Free-cash-flow pattern (isolated / persistent / deteriorating)
- **Proposed decision:** using TTM plus the last three fiscal years — PERSISTENT: TTM and the latest year both ≤ 0, or two or more of the points ≤ 0; DETERIORATING INTO NEGATIVE: TTM ≤ 0 after a strictly falling run; TEMPORARY (isolated): a single negative period otherwise. Persistent and deteriorating count as a material weakness; temporary does not.
- **Examples (TTM = −1):** history [5, −1, 4] ⇒ temporary (Quality can still PASS). [30, 20, 10] ⇒ deteriorating (with weak ROIC, Quality FAILS). [−5, −3, −2] ⇒ persistent. No history ⇒ NOT_EVALUABLE (INSUFFICIENT_DATA; see Part 2).
- **Open question:** are "two of three negative" and "strictly falling" the right tests; is a 3-year window right for long-duration LEAPS?

### A4 Quality PASS composition
- **Spec text (direct):** operating margin must be positive; HIGH leverage plus one other material weakness fails.
- **Proposed addition (not spec text):** two or more material weaknesses (revenue WEAK, ROIC WEAK, FCF persistent/deteriorating, leverage HIGH) fail Quality; PASS requires all five aspects evaluable.
- **Examples:** ROIC 5 alone ⇒ PASS. ROIC 5 + revenue CAGR −1 ⇒ FAIL. Leverage 3.5 alone ⇒ PASS. Leverage 3.5 + ROIC 5 ⇒ FAIL. Leverage 2.5 (ELEVATED) + ROIC 5 ⇒ PASS (ELEVATED is not a weakness).
- **Open question:** accept "two weaknesses fail"? Accept that one weak aspect passes? Should ELEVATED leverage count?

### A5 Technical State
- **Spec text (direct):** the STABILIZING and RECOVERING indicator lists in Section 45.8.
- **Proposed decisions (not spec text):**
  1. OVERSOLD line: weekly RSI ≤ 30.
  2. DECLINING needs at least two independent bearish families among RSI momentum, SMA50 relationship, SMA200 trend, relative strength (two RSI-derived readings are one family).
  3. A stabilization-contradicted, not-depressed, single-family case is **NOT_ESTABLISHED** (see taxonomy gap).
  4. Relative-strength condition for STABILIZING is `change ≥ 0`, stricter than "no longer accelerating" (Gate 2c section 6.1).
- **Examples:** weekly RSI 30 and falling ⇒ OVERSOLD; 31 and falling ⇒ NOT_ESTABLISHED. One contradicting signal with otherwise favorable evidence ⇒ NOT_ESTABLISHED (WATCH). RSI falling plus price below SMA50 ⇒ DECLINING. Relative strength change −3 (decline decelerating from −5, say) with everything else favorable ⇒ NOT_ESTABLISHED under the strict rule (it would be STABILIZING under an acceleration rule).
- **Taxonomy gap for Ian:** Section 45.8 defines four states. Evidence exists for a fifth situation — stabilization contradicted by one signal, no multi-indicator deterioration, not depressed. Gate 3 reports it as NOT_ESTABLISHED (evaluable, unmet requirement, WATCH) rather than forcing DECLINING or OVERSOLD. Options: keep as is; map it into WATCH-only "TECHNICAL_MIXED" language; or redefine DECLINING to need only one family (which would also call a single contradicting signal DECLINING).

### A6 Risk
- **Proposed decision:** earnings within 14 days is flagged and never disqualifying; a VALID non-empty `corporate_event_flags` list blocks SETUP/ACTIONABLE (state WATCH); unavailable event data stays explicitly unavailable.
- **Examples:** 14 days ⇒ flagged; 15 ⇒ not flagged. Earnings in 3 days with everything else qualifying ⇒ still ACTIONABLE. `['TENDER_OFFER']` ⇒ WATCH.
- **Open questions:** window length; which event types are "reliable binary events" (any listed flag blocks today); the flag source and schema do not exist yet (Part 2).

### A8 WATCH versus DISCOVERED
- **Proposed decision:** WATCH when Quality PASSES and the fundamental thesis is intact (growth-adjusted and momentum not DETERIORATING, no thesis break) but a SETUP requirement is unmet; otherwise DISCOVERED. INVALIDATED only for a candidate previously in WATCH/SETUP/ACTIONABLE.
- **Examples:** Quality PASS + percentile 50 / discount 2 ⇒ WATCH. Quality FAIL (margin −3) ⇒ DISCOVERED. Revenue and EPS both deteriorating ⇒ DISCOVERED (growth-adjusted DETERIORATING). Three dimensions deteriorating, no prior thesis ⇒ DISCOVERED; the same from SETUP ⇒ INVALIDATED.
- **Open question:** is "Quality PASS" the right floor for WATCH, and is DISCOVERED the right home for a failed-Quality name?

### Not policy: A7
Leverage trajectory is a data limitation (no prior-period leverage metric). It becomes a policy question (what change is material) only after data exists.

## Part 2 — Engineering / data questions (not investment policy)
1. **Technical direction metrics, SPY benchmark, loader exposure, completed-bar enforcement:** Gate 2c amendment (`LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md`). Needs authorization and scope review. Until built, SETUP/ACTIONABLE are unreachable in production.
2. **Annual FCF history:** derivable from the existing SEC `annualSeries` without a new provider (Gate 2c section 8).
3. **Lifecycle state to the strategy:** Gate 7 must pass the candidate's persisted state; the stateless strategy cannot produce INVALIDATED.
4. **Event flags source and schema** (`corporate_event_flags`) and **a StrategyInput assembler** from SEC + technical + risk metrics: not produced anywhere; separate gate/ticket.
5. **Analyst revisions:** optional, remain UNAVAILABLE; no engineering dependency for Gate 3.
