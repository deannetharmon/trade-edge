# TradeEdge Autopilot — Specification v1.0

Automated (paper-mode first) portfolio manager for TradeEdge. Scans for and opens new positions, and manages existing ones, across BPS, BCS, IC, CSP, and CC — following the same methodology already encoded in the app's rule engine and AI analysis, made autonomous and fast-reacting.

**Status: Approved for implementation — Paper Mode v1.0. No open spec items remain.**

**Changelog from v0.3:** final round of cross-model review (Grok, Gemini, ChatGPT) evaluated the fully-integrated document. ChatGPT identified a genuine cross-section gap — a short call collateralizes the underlying shares, and combined with the v1 cron interval, a fast-breaking thesis-invalidation could leave shares involuntarily locked for the length of the cron cycle. Fixed with an Unlock Shares manual-override button. Decision Confidence Score fully specified (4-factor deterministic v1 design, default threshold 70, configurable). Covered call roll logic made deterministic per goal mode. This closes every open item carried since v0.1.

**Cleanup pass (same v0.4):** Gemini approved as written. ChatGPT flagged three leftover contradictions — a stale Section 1 open question and two Section 3 sub-headers ("new, proposed for your review") that still read as unresolved even though the actual content had been resolved elsewhere in the document. All three corrected; a full-document scan for similar stale language found no further instances.

---

## 1. What already exists vs. what's new

| Piece | Status |
|---|---|
| TastyTrade auth, position data, screener scan logic | Exists — reused as-is |
| BPS/BCS/IC entry rules (IVR≥30, DTE 30-45, credit≥1/3 width, OI≥500, bid-ask≤$0.10, delta 0.20-0.30) | Exists — reused as-is |
| CSP entry rules | **Partially exists** — CSP appears in management logic (assignment-acceptable framing) but the screener's *entry* filter set is written for spreads; CSP-specific entry criteria (assignment basis, cash-secured sizing) need confirming |
| BPS/BCS/IC management rules (50% target, 21-DTE close, 2x-credit entry-stop, net-edge fade) | Exists — reused as-is |
| CSP management rules (intent-aware, assignment-acceptable, no auto-close on DTE/buffer) | Exists — reused as-is |
| **CC (Covered Call) strategy** | **Does not exist anywhere in the codebase** — no detection, no entry rules, no management rules |
| **PMCC (Poor Man's Covered Call)** | **Does not exist anywhere in the codebase** — same |
| Order placement (multi-leg, GTC, stop) | Exists — reused as-is |
| Autonomous decision loop / scheduler | **New** |
| Paper-trade ledger (simulated fills, simulated P&L, no real orders) | **New** |
| Portfolio-level risk gates (sector concentration, aggregate delta, BP utilization) | **New** — no aggregate/portfolio-level constraint exists today; current rules are all per-position |
| Autopilot UI (top-level nav page) | **New** |

**Resolved (v0.4):** CC ships in v1 with the stock+call management rules in Section 3. PMCC is deferred to Phase 2 (rules preserved for reference only — see Section 3 PMCC).

---

## 1.5. Goals — what Autopilot is optimizing for

Sections 2–4 are mechanical filters. None of them say what to *prefer* when multiple valid actions conflict (e.g. two entries clear filters but there's only buying power for one; a position hits 45% profit with fading net edge — bank now or let it run). Two independent dials:

**A. Per-strategy goal** — set separately for each of BPS/BCS/IC/CSP/CC, since CSP/CC are structurally acquisition-friendly (assignment is an acceptable outcome) while BPS/BCS/IC are pure premium-selling with no "acquire" concept.

| Goal | Behavior |
|---|---|
| **Conserve Capital** | Bank profit early, avoid stretching toward 75%, prefer CSP/CC over undefined-risk-adjacent stretches |
| **Income Steady-State** (default) | Matches current manual rules as-is — 50% target, 21-DTE, standard delta bands |
| **Acquire** (CSP/CC/PMCC only) | Prefers entries likely to result in owning quality shares at a good basis; deprioritizes early profit-taking when assignment is the actual goal |
| **Maximize Return** | Stretches toward 75% targets, wider risk bands, more concurrent positions — opposite of preservation-first; include only if you actually want this lever available |

**B. Portfolio-wide risk posture** — a single dial (Conserve / Steady / Maximize) layered on top, acting as a multiplier on the Section 4 gates (concentration caps, BP utilization, max entries/day) regardless of per-strategy goal.

**C. Opportunity scoring engine (added in v0.2 — cross-model consensus: Grok, Gemini, ChatGPT all independently flagged this as missing).** Goal modes alone don't resolve conflicts when multiple valid candidates compete for limited capital. Every candidate that clears its Section 2 filters gets a composite score before any capital is committed:

```
score = (edge_score × goal_alignment_factor) − (risk_contribution_penalty × posture_multiplier)
```

- `edge_score` — POP, credit/width or ROC, IVR quality, technical fit
- `goal_alignment_factor` — bonus for candidates matching the strategy's current goal mode (e.g. an Acquire-mode CSP near strong support scores higher than one chosen on delta alone)
- `risk_contribution_penalty` — marginal contribution to portfolio concentration, correlation, and aggregate delta/gamma
- `posture_multiplier` — scales the penalty up/down based on the portfolio-wide risk posture dial

Rank all candidates by score, take highest-first, stop when Section 4 gates are hit. This is the actual decision layer — goal modes set *intent*, the scoring engine makes the *choice*.

**Resolved:** all four goal modes confirmed as the right set. Per-strategy assignment confirmed (CSP/CC can run Acquire while BPS/BCS/IC stay Income Steady-State).

---

## 1.6. Configurable overrides — new in v0.3

Every numeric threshold and select decisions across Sections 2–4 must be **config-driven, not hardcoded** — editable without a code deploy. Matches your existing "on the horizon" note (rule configuration panel, thresholds editable without redeploying).

**Data model:**
```
AutopilotConfig {
  perStrategyGoal: { BPS: Goal, BCS: Goal, IC: Goal, CSP: Goal, CC: Goal },
  portfolioRiskPosture: 'conserve' | 'steady' | 'maximize',

  thresholds: {
    perTradeMaxLossPctEquity: 2.5,
    dailyLossPausePct: 2,
    monthlyDrawdownDefensivePct: 8,
    bpUtilizationMaxPct: 65,
    bpUtilizationHighVixPct: 50,
    singleTickerMaxPct: 10,
    sectorMaxPct: 25,
    maxEntriesPerDay: 3,
    maxEntriesPerWeek: 10,
    correlationSkipThreshold: 0.65,
    ccIvrReplacementYieldPct: 12,      // annualized call yield floor, replaces IVR>=30 for CC
    netEdgeFadeOffPeakPct: 25,
    decisionConfidenceMinimum: 70,     // below this, candidate is logged but execution suppressed
  },

  ccStockManagement: 'never-sell-escalate-on-thesis-break',  // v0.3 default; see Section 3 CC

  updatedAt: string,
}
```

- Stored server-side (Redis, keyed by user ID — same pattern as everything else in this app)
- A settings UI (part of Section 7) reads/writes this object; the decision loop (Section 6) reads it fresh at the start of every cycle — no redeploy needed to tune any number in this spec
- Config changes are logged (who/when/old value/new value) in the same managementLog used for trade decisions, so threshold tuning has an audit trail too
- **Not** overridable via config: the CC stock-management *mechanism itself* (Section 3) — i.e. you can tune numeric thresholds freely, but switching from "never sell except assignment" to "hard trailing stop" is a strategy-identity change, not a threshold, and should require deliberate spec revision, not a settings-panel toggle

---

## 2. Entry rules by strategy

### BPS / BCS / IC — updated in v0.2
- Short strike delta, now **regime-aware** (unanimous consensus: static delta bands are wrong across VIX regimes):

  | VIX regime | Delta band |
  |---|---|
  | < 18 | 0.15–0.20 |
  | 18–30 | 0.18–0.25 |
  | > 30 | 0.10–0.18 |

- DTE 30–45 (standard entries)
- Credit ≥ 1/3 of spread width
- Open interest ≥ 500 (both legs)
- Bid-ask ≤ $0.10 (each leg)
- No earnings within expiry
- **New — macro event gate:** no new entries within 24–48h of FOMC, CPI, NFP, or other high-impact scheduled macro events
- **New — liquidity-stress gate:** no new entries if bid-ask on either leg has widened materially beyond its normal range (flash-event protection)

### CSP — resolved in v0.2 (ChatGPT's answer, adopted)
- Same IVR/DTE/OI/bid-ask filters as BPS
- **Delta: 15–25 delta, not the same band as BPS** — assignment quality should outweigh premium size
- Strike selection weighted by: technical support level, valuation, and genuine willingness to own — not pure delta
- Cash secured 100% (no margin assumptions) — hard gate at the risk-gate layer (Section 4)
- Same macro event gate and liquidity-stress gate as BPS/BCS/IC

### CC — resolved in v0.2, ships in v1 (ChatGPT's answer, adopted; Grok/Gemini both recommended deferring — see note below)
- Own ≥ 100 shares of underlying (or open simultaneously with a paper "buy stock" fill in paper mode)
- Delta selectable by goal mode, not fixed:
  - Income mode: ~0.15 delta
  - Growth mode: ~0.25 delta
  - Maximize Return mode: ~0.35 delta
  - Acquire mode: don't sell a call at all if upside outweighs premium
- DTE 30–45
- IVR ≥ 30 → **removed in v0.3 (resolved).** Replaced with a minimum annualized call-yield threshold, default **12%** (config-driven, see Section 1.6 `ccIvrReplacementYieldPct`) — chosen as the middle ground between too-permissive (8%, risks selling calls for pennies) and too-restrictive (15-20%, excludes legitimate low-beta/index CC candidates)
- Strike selection: not strictly "above cost basis" — weighted by whether you'd buy the stock today at current price, so assignment isn't blocked by a stale cost basis on a name whose thesis has changed
- No earnings within expiry
- Avoid initiating new short calls immediately after a large selloff (IV spike inflates premium but also inflates rebound odds — don't cap upside exactly when recovery probability is highest)
- Dividend/early-assignment awareness required near ex-div dates
- Overwrite ratio configurable (not always 100% of shares — 40/60/80% partial overwrite options)

**Management — resolved in v0.3 (Dean's decision, default `ccStockManagement: 'never-sell-escalate-on-thesis-break'`):**

Autopilot has full authority over the short call leg (entry, 50% target, roll, close on assignment or target).

For the underlying shares:
- Autopilot never initiates or executes a sale of the shares except when the short call is assigned
- No automatic price-based stop-loss or trailing stop on the shares
- **Thesis-invalidation trigger** (reuses the app's existing per-symbol memory/AI classification): if the position's symbol is flagged as thesis-broken (fundamental deterioration, confirmed technical breakdown, negative catalyst, or manual flag), Autopilot immediately:
  1. Closes or stops writing the short call (even at a loss to original credit if needed)
  2. Blocks new CC entries on that symbol
  3. Logs full reasoning + timestamp in the managementLog
  4. Surfaces a high-priority alert: does not sell shares, escalates for manual review

**Why this over the alternatives considered:** a hard mechanical trailing stop (proposed by two of three AI reviewers in cross-model review) was rejected — it guarantees selling into whipsaws/temporary weakness on positions meant to be held, and discards the per-symbol memory/AI infrastructure this app already has in favor of blind price action. Doing nothing on thesis break was also rejected — it leaves Autopilot writing calls indefinitely on a position that's already deteriorating. This design stops new risk immediately (no more premium exposure) without selling shares on a signal that could be wrong.

**Gap found and fixed in v0.4 — cron-cycle lockup risk:** a short call collateralizes the underlying shares — you cannot manually sell shares while a call against them is open, even in your own brokerage UI. Combined with the v1 scheduler running on a 5-15 minute cron (Section 6), a fast-breaking situation could leave shares involuntarily locked for up to the cron interval before Autopilot's next cycle closes the call. Fix: **Unlock Shares button**, one per active CC position on the Autopilot dashboard (Section 7) — bypasses the cron loop entirely, forces an immediate synchronous buy-to-close of the short call at current market mid-price, releasing the shares for manual action without waiting for the next scheduled cycle.

### PMCC — deferred to Phase 2 (unanimous consensus: Grok, Gemini, ChatGPT all recommend deferring)
Not built in v1. Rules below preserved for future reference only:
- Long leg: deep ITM LEAP call, delta ≥ 0.80, 6–12+ months out (stock-replacement)
- Short leg: OTM call sold against it, delta 0.20–0.30, DTE 30–45
- Short strike above long strike (avoid inverting the structure)
- Net debit paid must be strictly less than strike width (early-assignment loss guard — Grok's addition)
- Roll trigger: long delta falls below ~0.70–0.75, or DTE drops below ~180, or remaining extrinsic value drops below a set threshold — any one triggers evaluation
- IVR ≥ 30 on the short leg entry
- No earnings within short-leg expiry

**Why deferred:** PMCC requires active coordinated management of two legs with fundamentally different decay/risk profiles, undefined assignment-cascade handling, and diagonal-spread margin implications the current codebase has no precedent for. All three independent reviews flagged this as the single highest-risk item to automate first.

---

## 3. Management rules by strategy

### BPS / BCS / IC — confirmed, no changes
- 50% profit target, GTC placed at entry
- Hard close at 21 DTE regardless of P&L — **only** if entry DTE was > 21
- Short-dated entries (entered ≤ 21 DTE): lower take-profit to 30-40%, tighter loss tolerance, exit before expiry
- ~~2× original credit stop~~ **REMOVED in v0.2 — unanimous cross-model consensus (Grok, Gemini, ChatGPT) that this rule is dangerous as written.** Options stops do not fill at their trigger during overnight gaps; a spread can open past max loss before the stop ever executes, creating false confidence rather than real protection. Replaced with:
  - The defined-risk structure itself is the real stop (max loss is already capped by spread width at entry — Section 4 sizing is what actually limits damage, not a price-based stop)
  - **Pre-market gap detector:** if opening mark exceeds the theoretical 2× threshold by a wide margin, suspend automatic action and flag for manual review instead of market-ordering into a blown-out spread
  - **Liquidity-stress detector:** if bid-ask on a leg has widened dramatically vs. its normal range, suppress new entries and delay exits until liquidity normalizes — don't become exit liquidity for market makers during a flash event
- Net edge (theta vs. gamma) fading >25% off peak → favor banking at 50% target over stretching to 75%; not a standalone close trigger unless corroborated by another factor. **Formula, defined explicitly in v0.2 (Gemini flagged this as undefined/ungameable as written):** `net_edge = theta − (0.5 × |gamma| × expected_daily_move² )`, tracked per-position each cycle; "peak" = highest value observed since entry; "% off peak" = `(peak − current) / peak`.
- Net edge negative → favor close/roll unless comfortably profitable and deep OTM

### CSP — confirmed, no changes
- Assignment is an acceptable outcome, not a failure — 21-DTE and tight-buffer are **not** automatic close/roll triggers for CSP
- Compare remaining premium vs. theta/day and assignment-basis attractiveness
- Roll only if it improves basis for a net credit, or trader no longer wants the shares, or support has failed badly enough to change assignment desirability, or unacceptable earnings risk

### CC — resolved in v0.4
- Take profit at ~50% of credit captured, same cadence as BCS
- Roll logic — deterministic by goal mode (Section 1.5):
  - **Acquire:** never roll solely to avoid assignment — let it happen
  - **Income:** roll only if the roll is both net-credit and improves annualized return
  - **Growth:** roll up/out only if expected upside exceeds remaining premium
  - Otherwise: allow assignment
- Stock-side management: see Section 2 CC ("Management" subsection) for the full escalate-on-thesis-break rule and the Unlock Shares override — Autopilot manages both legs together, never auto-sells shares outside assignment

### PMCC — Phase 2 reference only, not built in v1
- Short leg managed like a standalone BCS (50% target, roll/close logic)
- Long leg (LEAP): roll to a new long-dated call as time/delta decays below a threshold — **needs a specific delta or DTE trigger from you**
- Assignment risk on the short leg is more dangerous here than in a true CC (long leg may not have enough value to cover) — needs an explicit assignment-risk guard
- Preserved for future Phase 2 scoping only; not part of the v1 build

---

## 4. Portfolio-level risk gates — resolved in v0.2 (ChatGPT's thresholds, adopted)

None of this exists today; current rules operate purely per-position. Resolved thresholds for v1:

- **Buying power utilization:** max 65% of available options BP in normal conditions; drop to 50% when VIX is elevated
- **Single-ticker concentration:** max 10% of net liq / BP per underlying
- **Sector concentration:** max 25% per sector
- **Max new entries:** 3/day, 10/week
- **Aggregate portfolio delta band:** beta-weighted to SPY, not raw summed delta (Grok's correction, adopted — raw delta across unrelated tickers doesn't measure real market exposure)
- **Correlation check:** skip new entries with recent correlation >0.65 to existing positions unless materially higher edge; factor-based, not just static sector labels (a basket of semiconductor names is effectively one trade even across "different" tickers)
- **Macro event calendar gate:** block all new entries 24–48h before/after FOMC, CPI, NFP, and other high-impact scheduled events
- **Liquidity-stress detector:** suppress new entries and delay exits when bid-ask on any relevant leg has widened materially beyond its normal range

**New — drawdown circuit breaker (unanimous consensus, the most-repeated "this could blow up the account" flag across all three reviews):**
- Daily loss ≥ 2% of paper equity → pause all new entries for the remainder of that day
- Monthly drawdown ≥ 8% from peak → Autopilot enters defensive mode: pause all new entries until manual review and reset

**Resolved in v0.3:** locked at **2.5% of current paper equity** (config-driven, see Section 1.6 `perTradeMaxLossPctEquity`) — two of three cross-model reviews independently proposed 2.5%; enforced inside the Section 1.5 scoring engine before any capital is committed. A candidate whose theoretical max loss would exceed this is penalized or skipped, regardless of how well it scores otherwise.

---

## 5. Paper-trade data model (draft)

A new, clearly-separated store — never mixed with real positions — so paper and live can't accidentally cross-contaminate.

```
PaperPosition {
  id, strategy, symbol, legs[], entryDate, entryCredit,
  simulatedFillPrice,      // no real order sent; price simulated from live mid/mark at "execution" time
  status: 'open' | 'closed' | 'rolled',
  managementLog[],          // every rule evaluation + decision, timestamped, with reasoning
  closedDate, closeCredit, realizedPnl
}

PaperAccount {
  startingBalance,          // user-set hypothetical starting capital
  currentBalance,
  openPositions[],
  closedPositions[],
  dailyEquityCurve[]         // for a paper-mode performance graph
}
```

Stored server-side (Redis, keyed by user ID — same pattern as everything else in this app), not localStorage, so it survives across devices like the rest of TradeEdge.

**Resolved in v0.2 (ChatGPT's answer, adopted):** paper mode uses **real buying-power constraints from your live account**, with simulated fills (no real orders sent). Rejected the hypothetical-starting-balance approach that Grok/Gemini both proposed — training under the same constraints you'll actually face in production is more valuable than a mathematically cleaner but less realistic isolated ledger. P&L and position state remain fully isolated from real positions; only the BP/margin *numbers* are shared as a live constraint check.

---

## 6. Decision loop / scheduler — resolved in v0.3 (unanimous cross-model consensus after direct debate)

**v1 (paper mode): scheduled evaluator, Vercel Cron.** All three reviewers initially split on this; after being forced to respond directly to each other's arguments, all three converged: a fixed-interval cron is honest "scheduled evaluation," not true "react quickly" — but for paper mode specifically (no real execution risk, and the priority is validating rules/logs/scoring/gates), the added infrastructure of an always-on streaming worker isn't justified yet.

- Cron interval: 5-15 minutes during regular trading hours, denser (5 min) in the first/last 30 minutes of the session
- Each cycle: re-fetch quotes/Greeks for all open Autopilot positions + scan candidates, evaluate every rule in Sections 2–4 including gap/liquidity/macro-event/drawdown gates, run the Section 1.5 scoring engine, log every decision with full reasoning (including "no action needed"), execute (paper-fill only) anything that clears all gates and scores highest
- Kill switch checked at the start of every cycle
- **Spec language correction:** "react quickly to changes in the market" (the feature's original framing) applies to v2/live, not v1. v1's actual behavior is scheduled evaluation, and the spec should describe it as such rather than overpromising real-time reaction.

**v2 (before live trading is unlocked): persistent streaming evaluator required, not optional.** A background worker (not Vercel Cron — cold-start and frequency limits make it structurally unsuited to this) maintaining a persistent WebSocket connection to TastyTrade's streaming market data, evaluating tick-by-tick rather than on a timer. This is a hard prerequisite for Live Mode (Section 7), not a nice-to-have — the entire premise of autonomous *live* risk management depends on it.

---

## 7. UI — new top-level nav page

- Autopilot dashboard: paper account balance, equity curve, open paper positions, recent decision log
- Toggle: Paper Mode (default, locked at first) / Live Mode (disabled until unlock bar below is met)
- Rule configuration panel — full read/write UI for the `AutopilotConfig` object (Section 1.6): every threshold editable without redeploying
- Kill switch — immediately halts all Autopilot activity, paper or live
- **Unlock Shares button — new in v0.4.** One per active CC position. Bypasses the cron cycle entirely; forces an immediate synchronous buy-to-close of the short call at current market mid-price, releasing the underlying shares so the user isn't stuck waiting for the next scheduled cycle during a fast-moving situation. See Section 3 CC for the gap this closes.
- Decision Confidence Score — each logged decision shows a 0-100 score, surfaced in the decision log alongside the reasoning

**Live-mode unlock bar — resolved in v0.3 (Dean's decision):**
Live Mode becomes selectable only after **both**:
- Minimum 30 calendar days of continuous paper-mode operation
- Minimum 50 completed paper trades generated by Autopilot

Deliberately the least strict of the three cross-model proposals (which ranged up to 250 trades / 6 months) — chosen as the starting bar; can be tightened later based on actual paper performance once real data exists.

---

## 8. Decision Confidence Score — resolved in v0.4

Separate from the Section 1.5 opportunity score. Opportunity asks "how good is this trade"; Confidence asks "how trustworthy are current conditions for making any decision right now." A trade can score high on opportunity and low on confidence — the trade is still valid, but the engine knows the environment is noisy.

**v1 design (ChatGPT's 4-factor version, adopted — deterministic, no sub-scoring-system required):**

```
DecisionConfidence = LiquidityScore(40) + LatencyScore(20) + MacroProximityScore(20) + VolatilityStabilityScore(20)
```

| Factor | Weight | Measures |
|---|---|---|
| Liquidity | 40 | Current bid-ask spread vs. 20-period average, per leg |
| Latency / data freshness | 20 | Time since last exchange quote timestamp |
| Macro proximity buffer | 20 | Time to next scheduled high-impact macro event (graduated zone just outside the hard 24-48h gate in Section 4) |
| Volatility stability | 20 | VIX (or underlying IV) rate of change over the trailing 30 minutes |

Each factor scores in discrete bands (e.g. spread ratio ≤1.1× average = full 40 points, >2.0× = 0 points and also trips the liquidity-stress gate independently). Full point tables to be finalized during implementation — the factors and weights above are locked.

**Minimum-to-trade threshold — resolved:** configurable (`AutopilotConfig.thresholds.decisionConfidenceMinimum`, see Section 1.6), **default 70**. Below the threshold, the candidate is logged but execution is suppressed — existing position management continues regardless of score, since risk management shouldn't pause just because conditions are noisy.

**Deferred to v2:** Gemini's two additional factors (Rule Agreement — do technical/IV/support/trend/AI signals concur; Portfolio Context — correlation/diversification/delta fit) were not adopted for v1 because Rule Agreement requires its own sub-scoring logic to compute, adding real implementation complexity before any paper data exists to justify it. Revisit once v1's 4-factor version has a track record.

---

---

## 9. Implementation Architecture — added for Paper Mode v1.0

This section defines the implementation architecture for the approved paper-mode Autopilot build. The purpose is to preserve the architectural decisions before code implementation begins, so the repository contains both the trading specification and the software structure that the implementation is expected to follow.

### 9.1 Guiding Principles

Autopilot is intentionally designed as a collection of small, focused modules rather than a single monolithic engine.

The implementation shall prioritize:

- Single responsibility
- Strategy isolation
- Deterministic execution
- Config-driven behavior
- Auditability
- Testability
- Incremental deployability
- Extensibility for future PMCC and live-mode support

The paper-mode implementation must not contain any live-order execution path.

### 9.2 Recommended Project Structure

The implementation should be organized approximately as follows:

```text
lib/
└── autopilot/
    ├── config/
    │   ├── defaults.ts
    │   ├── schema.ts
    │   └── validation.ts
    │
    ├── models/
    │   ├── types.ts
    │   ├── paperAccount.ts
    │   ├── paperPosition.ts
    │   └── decisionLog.ts
    │
    ├── scoring/
    │   ├── opportunity.ts
    │   ├── confidence.ts
    │   └── netEdge.ts
    │
    ├── risk/
    │   ├── portfolio.ts
    │   ├── correlation.ts
    │   ├── sizing.ts
    │   ├── drawdown.ts
    │   └── buyingPower.ts
    │
    ├── strategies/
    │   ├── bullPutSpread.ts
    │   ├── bearCallSpread.ts
    │   ├── ironCondor.ts
    │   ├── cashSecuredPut.ts
    │   └── coveredCall.ts
    │
    ├── management/
    │   ├── exits.ts
    │   ├── rolls.ts
    │   ├── assignments.ts
    │   ├── coveredCallManager.ts
    │   └── unlockShares.ts
    │
    ├── engine/
    │   ├── scan.ts
    │   ├── rank.ts
    │   ├── evaluate.ts
    │   ├── executePaper.ts
    │   └── manageExisting.ts
    │
    ├── persistence/
    │   ├── redis.ts
    │   ├── configStore.ts
    │   ├── history.ts
    │   └── telemetry.ts
    │
    └── scheduler/
        ├── cron.ts
        ├── runner.ts
        └── locking.ts
```

The exact file names may evolve during implementation, but the separation of concerns should remain intact.

### 9.3 Strategy Isolation

Each strategy module — BPS, BCS, IC, CSP, and CC — shall be responsible only for strategy-specific logic:

- Candidate evaluation
- Entry validation
- Strategy-specific calculations
- Management recommendations

Individual strategy modules shall not make final portfolio allocation decisions. They submit candidates or management recommendations to the portfolio-level engine.

### 9.4 Portfolio Decision Engine

The Portfolio Decision Engine is the central authority for deciding whether a candidate should be accepted, suppressed, or rejected.

Responsibilities include:

- Opportunity Score
- Decision Confidence
- Risk posture adjustments
- Portfolio concentration
- Buying-power limits
- Correlation checks
- Drawdown circuit breakers
- Candidate prioritization
- Paper execution approval

No strategy module may bypass portfolio-level controls.

### 9.5 Configuration Rules

All thresholds must be loaded from `AutopilotConfig`.

No strategy module should contain hard-coded trading thresholds for:

- Delta bands
- DTE ranges
- IVR thresholds
- Profit targets
- Stop/exit logic
- Buying-power limits
- Drawdown limits
- Opportunity thresholds
- Decision Confidence thresholds
- Covered Call annualized yield floor

Hard-coded constants are allowed only for structural logic that is explicitly non-configurable in the approved specification, such as the CC stock-management mechanism.

### 9.6 Deterministic Execution Order

Each Autopilot run shall execute in this order:

1. Load configuration
2. Check kill switch
3. Acquire run lock
4. Load paper account state
5. Load real buying-power constraints
6. Load market data
7. Build candidate list
8. Calculate Opportunity Scores
9. Calculate Decision Confidence
10. Apply portfolio risk gates
11. Rank candidates
12. Execute paper trades, if allowed
13. Manage existing paper positions
14. Persist paper account state
15. Write decision logs
16. Update telemetry
17. Release run lock

The execution order should remain deterministic to ensure repeatable paper-trading results and clean debugging.

### 9.7 Auditability

Every Autopilot decision shall produce a persistent audit record containing at minimum:

- Timestamp
- Symbol
- Strategy
- Candidate or position ID
- Opportunity Score
- Decision Confidence
- Rules triggered
- Rules preventing execution
- Portfolio state summary
- Configuration snapshot or version
- Final action
- Human-readable explanation

This audit trail is required for decision replay, debugging, and future strategy tuning.

### 9.8 Phased Implementation Plan

Implementation should proceed in controlled phases:

1. Core infrastructure
2. Framework and scoring utilities
3. Scoring and risk engine
4. Candidate engine
5. Paper execution engine
6. Position management engine
7. Scheduler and automation
8. Dashboard
9. Configuration UI
10. Telemetry and analytics
11. Hardening and paper beta

The detailed sprint plan is tracked separately in `planning/AUTOPILOT_RELEASE_PLAN_v1.0.md`.

### 9.9 Documentation Baseline

The repository shall maintain these planning documents:

```text
planning/
├── README.md
├── AUTOPILOT_SPEC_v1.0.md
├── AUTOPILOT_RELEASE_PLAN_v1.0.md
├── AUTOPILOT_TECHNICAL_DESIGN.md
└── AUTOPILOT_CHANGELOG.md
```

The specification defines required behavior.  
The release plan defines implementation sequencing.  
The technical design records implementation details as they evolve.  
The changelog records material changes after this baseline.

## Summary — v1.0 status

All items from prior versions are resolved. Full resolution list:

- Six v0.1→v0.2 consensus fixes (2× credit stop replaced, drawdown circuit breaker, macro event gating, regime-aware deltas, net-edge formula, opportunity scoring engine)
- CC ships in v1, manages stock + call together with escalation-not-liquidation logic (Section 3)
- CSP delta band, paper mode uses real BP constraints (Section 5), scheduler is cron-for-paper/streaming-required-for-live (Section 6)
- Per-trade max loss 2.5%, CC IVR replaced with 12% annualized yield, live-mode bar 30 days/50 trades (Section 7)
- CC roll logic deterministic by goal mode (Section 3)
- Cron-cycle share-lockup gap closed with Unlock Shares button (Sections 3 & 7)
- Decision Confidence Score fully specified, 4-factor v1 design, default threshold 70 (Section 8)
- Every numeric threshold is config-driven via `AutopilotConfig` (Section 1.6), editable without a redeploy

**No open spec items remain.** Ready to move to implementation: config schema + Redis storage + settings UI, then the scoring/decision engine itself.
