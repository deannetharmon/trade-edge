# ADVISOR-REQ-0001: Portfolio decision engine, requirements

Status: DRAFT v1 (2026-10-23). Authors: Paul (scope), Ian (trading logic). Input: Dean's request of 2026-10-23, DATA-AUDIT-0001, PORTFOLIO-AI-0003 v2, RECO-UNIFY-0001 (prerequisite).
This document defines what the engine must do. It does not change code. It extends PORTFOLIO-AI-0003 (which covers a balanced, intent-aware report on the data we already hold) with the three things Dean added: look at the whole book against the opportunities available, take the long view (fundamentals and market, not only option math), and answer the real questions: hold and sell calls, cut and redeploy, or leave it alone.

## 1. User story

As the only trader on this book, I open the Portfolio page and ask "what should I do with my portfolio?" I get a short ranked list of actions, each with the dollars it moves, why, the strongest case against it, and what would change the call. The list weighs my intent for each position, the company and the market, and what I could do with the capital instead. It tells me plainly when the right answer is to do nothing.

## 2. Principles (Ian)

1. **One verdict.** The app's rules and the AI read the same facts snapshot and must agree. Where they disagree the report flags it as a difference for Dean to judge; it never hides it (RECO-UNIFY-0001).
2. **Code computes, the AI judges.** Every figure (breakeven, return on capital, concentration, cycles to recover) is computed in deterministic code and enters the snapshot. The model may only cite snapshot figures (existing figure guard). It may not do arithmetic.
3. **Two horizons, both visible.** Every position gets a near-term read (days to weeks: DTE, RSI, buffer, earnings, IV) and a thesis read (quarters to years: fundamentals, valuation against its own history, trend). The verdict says which horizon drove it. When they conflict, the report says so (for example "thesis intact, near-term broken: Manage, not Close").
4. **Honest about what it does not know.** Missing data prints "not available", lowers confidence, and is never filled in. No numeric estimate or forecast comes from the model.
5. **Balanced.** No bias toward safety or optimism. "Do nothing" is a valid, expected verdict. Every verdict carries a case against it.
6. **Advises, never acts.** Read-only: no order, scan or portfolio state is changed.

## 3. Requirements

### A. Output

- A1. **Action list first.** The top of the report is a ranked list (maximum 5 items) of actions worth taking now. Each item: the position, the verdict, the dollar effect (capital freed, premium, risk removed), confidence (Low, Medium, High), case for, case against, and an invalidation line (a stated price, RSI, DTE or date condition that changes the verdict).
- A2. **Verdict set.** Hold, Hold and write calls, Manage, Roll, Close, Close and redeploy. Definitions:
  - Hold: no action.
  - Hold and write calls: keep the shares and sell covered calls (applies to stock and PMCC long legs).
  - Manage: act on risk without closing (adjust, add a GTC or stop).
  - Roll: move the same exposure out in time.
  - Close: exit now.
  - Close and redeploy: exit and name the specific candidate or use of the capital (A4).
- A3. **Per-position entry**: verdict, horizon that drove it, confidence, case for, case against, invalidation line, indicators used, intent used and its source (label set, label default, note), data gaps.
- A4. **Redeploy names a destination.** "Close and redeploy" must name the top candidate(s) from the latest scan and the comparison that justifies the move (E2). It does not size or place the order. Opening new positions is out of scope for v1 (see 6).
- A5. **Portfolio section**: overall read, concentration against the 15% amber and 25% red tiers, the leveraged-ETF cluster, cash and buying power, and the top three issues.
- A6. **Dashboard style** (Dean, 2026-09-20): key numbers as tiles, short callouts, full reasoning collapsed. Diane produces the mock; no UI is built before Dean approves it.

### B. Intent

- B1. Intent comes from the position's label by default and is overridden only by a note that states a plan (PORTFOLIO-AI-0003 v2 rules stand: source is always shown, defaulted intent lowers confidence).
- B2. **Stock intents are extended** so Dean can say what he means. Today stock offers only Hold, Wheel, Undecided. Add: "Hold and write calls" (wait for recovery, collect premium) and "Cut if" (exit if a stated price or date is hit, with the trigger stored with it). Option vocabularies are reviewed by Ian for equivalent gaps. Diane mocks the control; it reuses the existing intent control and wording.
- B3. A position with no stated intent is analysed as Undecided and the report says so once, near the top, rather than guessing a plan.

### C. Hold and write calls (Ian)

- C1. For shares held below cost the snapshot includes, computed in code: cost basis, price versus cost, the nearest strike at or above cost basis with its premium and annualized return on the capital, and the number of cycles at that premium to reach breakeven. These are labelled as estimates from today's quotes, not forecasts.
- C2. The engine never recommends a call strike below cost basis unless Dean has set that policy (decision D1).
- C3. The report must show the opportunity cost of staying in: the capital tied up in the shares against the best redeploy candidate (E2), and what the thesis read says about the odds of recovery in words, from fundamentals and trend only.
- C4. The case for exiting is always shown alongside the case for holding, for any position more than 20% under cost.

### D. Cut and redeploy (Ian)

- D1. **Stops stay rules, not opinions**: the app's existing mechanical rules (21 DTE management where it applies, 50% profit target, 2x credit stop, RSI entry rule) are inputs the report cites, not things the model overrides. The assignment-is-acceptable rule for CSP and CC stands.
- D2. A Close verdict requires at least one of: a stop or management rule triggered, the thesis read broken (fundamentals or trend, with evidence), or a clear redeploy gain (E2). "Looks risky" alone is not enough.
- D3. Realized-loss exits carry a flag if Dean already holds or has just traded the same name (wash-sale risk). The flag is informational; no tax advice.

### E. Opportunity set

- E1. The latest ranked scan results (top N, default 10) are persisted per user with timestamp so the engine can read them. The report states the age of the scan and lowers confidence if it is more than one trading day old.
- E2. **Redeploy test**: compare return on capital per day for the existing position's remaining potential against the best candidate's, both computed in code on the same basis. A redeploy verdict needs the candidate to beat the position by a margin (starting value 25%, Ian and Alan to set), to avoid churn. The comparison is shown as two tiles.
- E3. A candidate that fails any app qualification gate (for example earnings before expiry, RSI rule, concentration over the red tier) may not be offered as a destination.

### F. Data (from DATA-AUDIT-0001; free sources only)

- F1. **Facts snapshot** per held ticker, built once and shared by the rules and the AI (HOLDING-FACTS-0001): position and cost basis, intent and source, balances and concentration, price, IV, IVR, HV30, beta, next earnings date, daily RSI current and previous with turn state, trend and moving averages, relative strength, fundamentals (SEC) and valuation against its own 3y/5y history, scan candidates.
- F2. **Every field carries a status and provenance** (HAVE, PARTIAL, MISSING, with source and as-of). The report shows a "data used" strip per position and the list of gaps. Missing fields stay missing; nothing is substituted.
- F3. **Leveraged ETFs and index funds** (TQQQ, SOXL, MULL, METU, NVDL) have no company fundamentals. The thesis read uses the underlying stock or index (trend, RSI, and the underlying's fundamentals where the fund tracks one stock) and the report labels it as an underlying read. It also flags decay and gap risk for leveraged funds.
- F4. **Known holes are stated, not hidden**: no consensus estimates, price targets, forward P/E, short interest or IV history. The report may not imply it considered them.
- F5. **Qualitative research is optional and clearly separated** (decision D3): headlines and company news for held tickers, shown as "web-sourced, unverified", never inside numeric fields, never able to override a rule.
- F6. Start storing daily IV and IVR per held ticker now so a history exists in a month.

### G. Consistency and learning

- G1. Rules and AI disagreements are logged with the snapshot (disagreement log, per RECO-UNIFY-0001) and shown in the report as flagged differences.
- G2. **Decision journal**: each report's verdicts and snapshot are saved. At 30 days the engine can show what each verdict was and what happened since. No automatic tuning; Ian reviews the journal to adjust rules.

### H. Quality gates (Quinn)

- H1. Fixture books with known correct verdicts set by Ian, including: shares 25% under cost with decent call premium (Hold and write calls), shares under cost with a broken thesis (Close and redeploy), healthy CSP, tested CSP with Acquire intent, spread near its stop, LEAP with PMCC, leveraged ETF cluster over the red tier, a book that is mostly fine (mostly Hold).
- H2. The report must match the expected verdicts, include a case against on every one, cite only snapshot figures, and handle missing data and defaulted intent as specified.
- H3. Churn test: running the report twice on the same data gives the same verdicts; a small price change must not flip a verdict inside the margin in E2.
- H4. Cost and safety: gateway auth, kill switch and the soft monthly limit apply (D6, starting $25). A cost line per report is recorded so the threshold is set from real numbers.
- H5. Fail closed: if the model or data is unavailable the deterministic tiles and rule verdicts still show.

## 4. Dependencies and order

1. DATA-CACHE-0001, QV-COVERAGE-0001, EVENTS-0002 (from the audit).
2. RECO-UNIFY-0001 (one verdict, shared snapshot): approved prerequisite.
3. HOLDING-FACTS-0001 (the facts snapshot in F1), including RSI in verdict inputs (Ian signs off on weighting).
4. INTENT-0002 (B2), with Diane's mock.
5. SCAN-PERSIST-0001 (E1).
6. PORTFOLIO-AI-0003 slices A0 to D, extended with this document (verdict set, hold-and-write-calls, redeploy test).
7. RESEARCH-0001 and the AI provider decision (AI-POLICY D3: Claude models per Dean's 2026-10-17 direction).

Nothing is built before Diane's mock is approved, Ian signs the rubric and Alan the thresholds.

## 5. Decisions

Settled by the team (Dean may override):
- Opening new positions is out of v1; redeploy names a destination only.
- Redeploy margin starts at 25% better return on capital per day.
- Wash-sale is a flag only.
- Decision journal is review-only, no auto-tuning.

Needs Dean:
- **D1. Calls below cost basis.** Ian recommends: never recommend a strike below cost basis unless Dean opts in per position. Dean confirms or states his policy.
- **D2. Web research cost and use.** Ian and Paul recommend on-demand only, held tickers only, labelled unverified, inside the soft spend limit. Dean confirms.
- **D3. Research route.** Policy question for Alan: a separate research step outside the gateway feeding text in, or a gateway exception for web search. Team recommends the separate step. Dean confirms with the provider switch.

## 6. Out of scope (v1)

Order placement, opening new positions or sizing orders, changing scan scoring or qualification, changing app recommendation rules (RECO-UNIFY-0001 owns alignment), tax advice, estimates or price targets (no free source), mobile layout (follows the phone layer), a visual refresh.
