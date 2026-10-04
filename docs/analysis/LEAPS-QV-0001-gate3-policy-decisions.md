# LEAPS-QV-0001 Gate 3 — Policy decisions (A1–A8)

**Status (round 4): A1–A8 are RATIFIED by the final Ian/Paul rulings recorded in the ticket ledger (Gate 3 review round 4).** The sections below keep the earlier proposals and counterexamples as history; the ratified rulings are:

| ID | Ratified ruling |
|---|---|
| A1 | Current negative growth is DETERIORATING regardless of a negative trend (-2% vs -5% trend ⇒ DETERIORATING). Positive growth below trend is NOT automatically DETERIORATING; the slowdown is reported separately (`FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT`). No new percentage threshold. |
| A2 | change < -1 pp DETERIORATING; -1 through +1 pp inclusive STABLE; > +1 pp IMPROVING. |
| A3 | Level (POSITIVE / BREAKEVEN / NEGATIVE; zero is not negative) is separate from annual trajectory. TTM sets the level and is never counted as another annual observation. Persistent negative = at least two negative non-overlapping annual periods in the three-year window. Fail closed without annual history. |
| A4 | Non-positive operating margin fails; HIGH leverage plus another material weakness fails; two material weaknesses fail; one weak ROIC or revenue dimension alone does not; all required Quality evidence must be evaluable for PASS. |
| A5 | OVERSOLD is never from RSI alone (RSI <= 30 plus at least one non-RSI bearish group); DECLINING evaluated first and needs two distinct (never "statistically independent") bearish groups; NOT_ESTABLISHED is an evaluation result, not a fifth investment state; four investment states DECLINING / OVERSOLD / STABILIZING / RECOVERING. Relative strength Option A ("relative strength no longer deteriorating"): STABILIZING change >= 0, RECOVERING change > 0; no second-difference metric in QV-v1.0. Convention: split-adjusted, dividend-unadjusted price returns for stock and SPY (explicit v1 convention, not a dividend-immateriality claim). |
| A6 | Earnings within 14 days informational, non-disqualifying; reliable material-event evidence may block SETUP/ACTIONABLE; UNKNOWN coverage stays UNKNOWN, never VERIFIED_EMPTY, and does NOT cap at WATCH in QV-v1.0. The typed event schema stays documented for later; no event provider in Gate 3. |
| A7 | NOT_EVALUABLE / data limitation until historical leverage exists; no proxy. |
| A8 | WATCH: Quality PASS + thesis intact but another SETUP requirement unmet. DISCOVERED: Quality fails or the evidence is materially weaker and there is no prior qualifying thesis. INVALIDATED: durable thesis break from a prior WATCH/SETUP/ACTIONABLE candidate. |

Historical status (round 2/3, superseded by the table above): **PROPOSALS ONLY.** Each proposal states what the code does today, so Ian can accept, change or reject it. The worked examples are executed in `lib/discovery/qv/__tests__/policyExamples.test.ts` (and `technicalDirection.test.ts`), so they cannot drift from the implementation. A decision that changes a value is a policy change (`policy.ts`, fingerprint re-pin, new strategy version if a published version has been used); a decision that changes a rule needs a code change in the matching classifier.

Questions are split below: **Part 1 — investment-policy** (Ian), **Part 2 — engineering/data** (Dane/Quinn/Paul).

## Part 1 — Investment-policy questions

### A1 Revenue / EPS trajectory ("materially deteriorating") — REVISED ALTERNATIVES (nothing ratified)
- **Current code (not ratified):** DETERIORATING when growth is negative and below trend; IMPROVING when non-negative and above trend; STABLE otherwise.
- **Counterexamples to the current rule (Ian):** growth +1% vs trend 12% reads STABLE; contraction −2% vs trend −5% reads STABLE (growth is *above* a worse trend, yet the business is shrinking). Neither should silently establish stability.
- **Alternative A1-a (separate direction from context):** *Recent direction* = sign and size of TTM growth (negative ⇒ contracting). *Long-term context* = relation to the 5Y trend (above / near / below). DETERIORATING when contracting, regardless of trend; a positive-but-far-below-trend case becomes a CONCERN flag, not STABLE. Needs X (pp below trend) from Ian.
- **Alternative A1-b:** keep three states, but add a fourth, NOT_STABLE-CONTRACTING, so −2 vs −5 is never STABLE.
- **Alternative A1-c:** keep current rule and document it as lenient. Not recommended.
- Missing trend with non-negative growth stays NOT_EVALUABLE under all alternatives.

### A2 Operating-margin trajectory — REVIEW RECOMMENDATION (Ian conditionally accepts the ±1 pp band; not a specification decision until recorded)
- **Proposed decision:** year-over-year change beyond ±1 percentage point is material; within the band is STABLE.
- **Examples (pp):** −1.01 ⇒ DETERIORATING; −1 ⇒ STABLE; 0 ⇒ STABLE; +1 ⇒ STABLE; +1.01 ⇒ IMPROVING.
- **Open question:** is 1 pp the right materiality? Margin scale differs by sector (software versus distribution); a sector-relative band is an alternative.

### A3 Free-cash-flow pattern — REVISED ALTERNATIVES (nothing ratified)
- **Current code (not ratified):** PERSISTENT when TTM and latest FY both ≤ 0 or two or more points ≤ 0; DETERIORATING into negative when TTM ≤ 0 after a strictly falling run; TEMPORARY otherwise; trajectory from TTM versus history.
- **Counterexamples (Ian):** TTM +1 with history [10,20,30] reads IMPROVING although FCF has collapsed 97% (level and trajectory are conflated). TTM −1 with history [20,10,−5]: the latest FY and TTM overlap, so one weak year is counted twice as "persistent". TTM 0 with [5,4,3] reads DETERIORATING because zero is counted as non-positive, which merges zero with negative.
- **Alternative A3-a:** separate **level** (positive / zero / negative) from **trajectory** (rising / falling / flat), reported as two facts; PERSISTENT requires negative FCF in at least two **non-overlapping** periods (latest FY and TTM overlap and count once).
- **Alternative A3-b:** zero is its own band (BREAKEVEN), neither negative nor positive.
- **Alternative A3-c:** trajectory must be compared on non-overlapping annual points only (TTM is used for the level, not as an independent persistence observation).
- Persistence evidence: Ian to choose the window (3 years vs 5) and the strictness of "falling".

### A4 Quality PASS composition — REVIEW RECOMMENDATION (conditional acceptance; not a specification decision until recorded)
- **Spec text (direct):** operating margin must be positive; HIGH leverage plus one other material weakness fails.
- **Proposed addition (not spec text):** two or more material weaknesses (revenue WEAK, ROIC WEAK, FCF persistent/deteriorating, leverage HIGH) fail Quality; PASS requires all five aspects evaluable.
- **Examples:** ROIC 5 alone ⇒ PASS. ROIC 5 + revenue CAGR −1 ⇒ FAIL. Leverage 3.5 alone ⇒ PASS. Leverage 3.5 + ROIC 5 ⇒ FAIL. Leverage 2.5 (ELEVATED) + ROIC 5 ⇒ PASS (ELEVATED is not a weakness).
- **Open question:** accept "two weaknesses fail"? Accept that one weak aspect passes? Should ELEVATED leverage count?

### A5 Technical State — REVIEW RECOMMENDATION (strict Option A preferred; wording "relative strength no longer deteriorating"; OVERSOLD resolved below)
- **Spec text (direct):** the STABILIZING and RECOVERING indicator lists in Section 45.8.
- **Proposed decisions (not spec text):**
  1. OVERSOLD (confluence, Section 45.8 "RSI alone must not determine state"): weekly RSI ≤ 30 **and** at least one non-RSI bearish group, stabilization not established, DECLINING not established. A depressed RSI alone is NOT_ESTABLISHED. Open for Ian: whether a depressed RSI level alone should be OVERSOLD (a spec amendment; no threshold invented). Consequence: OVERSOLD is narrow; with RSI momentum bearish plus any non-RSI group the state is DECLINING.
  2. DECLINING needs at least two distinct bearish feature groups (distinct measurements, NOT statistically independent: SMA50 and SMA200 are correlated) among RSI momentum, SMA50 relationship, SMA200 trend, relative strength (two RSI-derived readings are one family).
  3. A stabilization-contradicted, not-depressed, single-family case is **NOT_ESTABLISHED** (see taxonomy gap).
  4. Relative-strength condition for STABILIZING is `change ≥ 0`, stricter than "no longer accelerating" (Gate 2c section 6.1).
- **Examples:** weekly RSI 30, slope 0, RS change −1 ⇒ OVERSOLD; weekly RSI 30 and falling with no non-RSI confirmation ⇒ NOT_ESTABLISHED; 31 with RS change −1 ⇒ NOT_ESTABLISHED. One contradicting signal with otherwise favorable evidence ⇒ NOT_ESTABLISHED (WATCH). RSI falling plus price below SMA50 ⇒ DECLINING. Relative strength change −3 (decline decelerating from −5, say) with everything else favorable ⇒ NOT_ESTABLISHED under the strict rule (it would be STABILIZING under an acceleration rule).
- **Taxonomy gap for Ian:** Section 45.8 defines four states. Evidence exists for a fifth situation — stabilization contradicted by one signal, no multi-indicator deterioration, not depressed. Gate 3 reports it as NOT_ESTABLISHED (evaluable, unmet requirement, WATCH) rather than forcing DECLINING or OVERSOLD. Options: keep as is; map it into WATCH-only "TECHNICAL_MIXED" language; or redefine DECLINING to need only one family (which would also call a single contradicting signal DECLINING).

### A6 Risk — classification unchanged; typed schema and coverage proposal
- **Current behavior (nonblocking absence):** earnings within 14 days flagged, never disqualifying; a VALID non-empty `corporate_event_flags` list blocks SETUP/ACTIONABLE; absent event data stays explicitly unavailable. **Added in round 3:** the risk gate outcome is NOT_EVALUABLE (not PASS) when event coverage is UNKNOWN; PASS only for VERIFIED_EMPTY; FAIL when events are present. Classification is unchanged.
- **Proposed typed event schema (not implemented, not authorized):** `corporate_event_flags` becomes a typed record list `{ category, source, observedAt, effectiveDate|null, status }` plus a coverage object `{ coverage: VERIFIED_EMPTY | EVENTS_PRESENT | UNKNOWN, categoriesChecked[], source, asOf }`.
- **Material-event categories (for Ian to confirm):** tender offer / merger or acquisition announcement, spin-off, bankruptcy or delisting notice, trading halt, going-concern language, guidance withdrawal. Source, freshness window and which categories must be checked for VERIFIED_EMPTY are decisions, not defaults.
- **Proposed stricter amendment (NOT authorized):** UNKNOWN coverage caps the state at WATCH. Until accepted, absence stays nonblocking and is reported UNKNOWN, never as verified "no events".
- Earnings 14-day window: acceptable per Ian.

### A8 WATCH versus DISCOVERED — REVIEW RECOMMENDATION (conditional acceptance; not a specification decision until recorded)
- **Proposed decision:** WATCH when Quality PASSES and the fundamental thesis is intact (growth-adjusted and momentum not DETERIORATING, no thesis break) but a SETUP requirement is unmet; otherwise DISCOVERED. INVALIDATED only for a candidate previously in WATCH/SETUP/ACTIONABLE.
- **Examples:** Quality PASS + percentile 50 / discount 2 ⇒ WATCH. Quality FAIL (margin −3) ⇒ DISCOVERED. Revenue and EPS both deteriorating ⇒ DISCOVERED (growth-adjusted DETERIORATING). Three dimensions deteriorating, no prior thesis ⇒ DISCOVERED; the same from SETUP ⇒ INVALIDATED.
- **Open question:** is "Quality PASS" the right floor for WATCH, and is DISCOVERED the right home for a failed-Quality name?

### A7 (not policy until data exists) — REVIEW RECOMMENDATION to keep as a data limitation
Leverage trajectory is a data limitation (no prior-period leverage metric). It becomes a policy question (what change is material) only after data exists.

## Part 2 — Engineering / data questions (not investment policy)
1. **Technical direction metrics, SPY benchmark, loader exposure, completed-bar enforcement:** Gate 2c amendment (`LEAPS-QV-0001-gate2c-technical-direction-and-fcf-history.md`). Needs authorization and scope review. Until built, SETUP/ACTIONABLE are unreachable in production.
2. **Annual FCF history:** derivable from the existing SEC `annualSeries` without a new provider (Gate 2c section 8).
3. **Lifecycle state to the strategy:** Gate 7 must pass the candidate's persisted state; the stateless strategy cannot produce INVALIDATED.
4. **Event flags source and schema** (`corporate_event_flags`) and **a StrategyInput assembler** from SEC + technical + risk metrics: not produced anywhere; separate gate/ticket.
5. **Analyst revisions:** optional, remain UNAVAILABLE; no engineering dependency for Gate 3.
