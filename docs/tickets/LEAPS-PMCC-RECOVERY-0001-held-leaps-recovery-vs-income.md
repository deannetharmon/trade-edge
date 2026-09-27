# LEAPS-PMCC-RECOVERY-0001 — Held LEAPS recovery vs PMCC income opportunity

> Repository copy of GitHub Issue #49.
>
> Canonical issue: https://github.com/deannetharmon/trade-edge/issues/49
>
> This document captures the finalized ticket so the implementation specification is available with the project source. If this file and Issue #49 diverge before implementation, reconcile them explicitly rather than silently choosing one.

# LEAPS-PMCC-RECOVERY-0001 — Held LEAPS recovery vs PMCC income opportunity

**Status:** Draft for Ian review. Do not begin implementation until Dean approves after review.

## Problem

TradeEdge can determine whether a broker-held LEAPS is structurally capable of supporting a PMCC and can find qualifying short calls. It also calculates the LEAPS expiration breakeven and an estimated PMCC start price.

Those answers do not answer the management question that matters after a LEAPS has moved against the trader:

> **Should I sell a short call now, or should I leave the LEAPS uncapped so it can participate fully in a recovery?**

A LEAPS may have been purchased deep ITM and later become barely ITM/ATM after an underlying drawdown. A technically valid short call may still exist, but selling it can cap or reduce participation in exactly the recovery the trader is holding the LEAPS to capture.

TradeEdge must therefore distinguish:

1. **Structural eligibility:** Can this exact held LEAPS support this short call under PMCC rules?
2. **Economic desirability:** Is the premium offered by this short call worth the recovery participation being surrendered during the short-call cycle?

The second question is the purpose of this ticket.

## Product principle

The optimization objective is **total LEAPS campaign return**, not maximum short-call premium.

A PMCC short call is optional income layered onto a bullish LEAPS thesis. Going weeks or months without selling a short call can be the correct management outcome when preserving upside is more valuable than the available premium.

Do not create a black-box 0–100 "Recovery Score." The product must expose the tradeoff and the evidence.

## Core design: scenario-based Recovery Cost engine

For every proposed short call against a verified held LEAPS, compare two portfolios at the **short-call expiration**:

- **A — LEAPS uncapped:** hold the long LEAPS only.
- **B — PMCC:** hold the same LEAPS and sell the proposed short call.

Reprice both structures across a common scenario grid and calculate:

**Opportunity Cost = modeled value of A − modeled value of B**

The UI must separately show the short-call credit received. This lets the trader see what premium is received in exchange for what modeled recovery participation is surrendered.

### Scenario grid

At minimum evaluate:

- −2σ expected move
- −1σ expected move
- unchanged underlying
- +1σ expected move
- +2σ expected move
- underlying entry-price recovery
- proposed short strike
- LEAPS expiration breakeven when relevant to the short-cycle range

Deduplicate overlapping scenario prices and clearly identify scenarios outside a reasonable display range.

The scenario horizon is the proposed **short-call expiration**, not the LEAPS expiration.

## Required inputs

Use broker/current market data and existing TradeEdge position history where available:

### Held LEAPS
- exact OCC identity and account
- long strike and expiration
- DTE
- quantity
- original debit / average open price
- current mark/bid/ask as available
- current long delta
- current IV when available
- underlying price at LEAPS entry
- current underlying price
- entry moneyness
- current moneyness
- current intrinsic value
- current extrinsic value
- current unrealized P/L

Entry delta/IV/extrinsic may be surfaced when historically available but are not required to invent a result. Missing historical values must never be guessed.

### Proposed short call
- exact OCC identity
- strike and expiration
- DTE
- executable credit
- current delta
- IV
- bid/ask quality
- OI/liquidity evidence already required by canonical PMCC policy

### Underlying movement envelope
Derive the short-horizon expected move from current market-implied volatility / option-chain data using one documented canonical method. This is a magnitude estimate, not a directional forecast.

Do not make RSI, moving averages, analyst price targets, news sentiment, or an AI bullish/bearish opinion part of the V1 core decision. Those may become supplemental context later.

## Core metrics

### 1. Upside Exposure Retained

At evaluation time:

`netDelta = longDelta − shortDelta`

`upsideExposureRetained = netDelta / longDelta`

Example: long delta .62 and short delta .18 produces net delta .44 and approximately 71% of current directional exposure retained.

This is a current sensitivity metric, not a claim that delta remains constant through the cycle.

### 2. Expected-Move Headroom

`headroom = shortStrike − currentUnderlyingPrice`

`expectedMoveHeadroom = headroom / expectedMove`

Examples:
- 0.6× means the short strike lies inside a one-standard-deviation expected move.
- 1.5× means the strike lies substantially beyond the one-standard-deviation expected move.

Do not turn these values into undocumented "safe/unsafe" labels.

### 3. Recovery-to-Entry Headroom

Compare the proposed short strike with the underlying price when the LEAPS was opened.

Expose:
- dollars/% from current spot back to entry
- dollars/% from current spot to short strike
- whether short strike is below, at, or above underlying entry price

The entry price is a reference point, not a forecast or mandatory target.

### 4. Premium vs Upside at Risk

Do not show only "Credit = $X."

Also state the economic exchange:

> Receive $X credit to cap/reduce participation above $Y through DATE.

The scenario engine must quantify modeled PMCC underperformance versus uncapped LEAPS at each upside scenario.

### 5. Scenario Opportunity Cost

For each scenario price at short expiration show:
- modeled LEAPS-only value/P&L
- modeled LEAPS + short-call value/P&L
- short-call credit
- modeled opportunity cost/benefit of adding the short call

The repricing model must account for the long LEAPS still having substantial time remaining after the short call expires. Do not value the LEAPS as intrinsic-only at the short expiration.

Document assumptions for volatility, rates, dividends and remaining time. If required market inputs are unavailable or stale, fail to an explicit unavailable/monitor state rather than fabricate precision.

## Management states

Every verified standalone held LEAPS may expose one of these management states:

| State | Meaning | Objective |
|---|---|---|
| **RECOVERY / MONITOR** | Current short-call candidates materially interfere with plausible recovery relative to the premium offered, or evidence is insufficient | Preserve upside / monitor |
| **INCOME OPPORTUNITY** | At least one structurally valid candidate has an explainable premium/recovery tradeoff suitable for review | Review income opportunity |
| **INCOME ACTIVE** | A short call is already open/reserved against the LEAPS | Manage existing diagonal |
| **EXIT / REVIEW** | LEAPS thesis/return objective or DTE/decay conditions warrant reviewing the long position itself | Review long LEAPS |

These states are decision support, not automatic trading instructions.

The exact V1 policy that maps scenario evidence to RECOVERY/MONITOR vs INCOME OPPORTUNITY must be **versioned, centralized, explainable and reviewed by Ian**. Do not scatter thresholds through React components.

Structural PMCC eligibility remains authoritative and separate. A structurally invalid candidate can never become an income opportunity. A structurally valid candidate does **not** automatically become one.

## Campaign economics

Track/display strategy-level economics without rewriting historical broker cost basis:

- original LEAPS debit
- realized short-call opening credits
- realized short-call closing debits
- **net realized PMCC income**
- current open short-call P/L
- current LEAPS liquidation P/L
- total campaign P/L

Calculate:

`adjustedLeapsCost = originalLeapsDebit − cumulativeNetRealizedShortCallIncome`

`campaignAdjustedExpirationBreakeven = longStrike + adjustedLeapsCostPerShare`

Open/unrealized short-call P/L must not be treated as realized income.

Keep these distinct:
1. underlying entry price
2. original LEAPS expiration breakeven
3. campaign-adjusted expiration breakeven
4. current LEAPS liquidation breakeven/profitability context

Do not imply that the expiration breakeven is the stock price required for the LEAPS to be profitable today.

## Portfolio UX

For a recovery-state position, prefer an evidence-driven presentation such as:

> **RECOVERY — MONITOR**
>
> Stock is 11.5% below its entry price. LEAPS moved from 14.2% ITM to 3.1% ITM. 354 DTE remain.
>
> Proposed $75 short call: $165 credit; retains 68% of current directional exposure; strike is 0.7× the 30-day expected move above spot and below the $78.67 underlying entry price.
>
> If UBER reaches $80 by short-call expiration, modeled PMCC value is approximately $X less than holding the LEAPS uncapped.

For a candidate with more recovery room:

> **INCOME OPPORTUNITY**
>
> Proposed $82.50 short call: $95 credit; retains 82% of current directional exposure; strike is 1.6× expected move above spot and above the original underlying entry price.
>
> Scenario table shows the modeled tradeoff through +1σ/+2σ recovery.

"Find/Review PMCC short calls" may remain available for analysis during RECOVERY/MONITOR, but it must not imply that selling a call is required.

## LEAPS exit/review

Do not automatically roll/replace a LEAPS merely because DTE declines.

EXIT / REVIEW should support the question:

> Has the bullish LEAPS investment accomplished its objective, or is continued long exposure still desired?

Potential evidence includes:
- current LEAPS P/L / configured profit objective
- underlying thesis/target if one exists
- DTE entering configured management window
- moneyness/delta deterioration
- extrinsic/theta exposure

Rolling to a new LEAPS is a separate decision only when continued bullish exposure is desired.

## Architecture constraints

Reuse existing authorities and plumbing rather than creating parallel calculations:

- `features/portfolio/positions-workspace/PositionsWorkspace.tsx`
- `features/portfolio/positions-workspace/model/breakeven.ts`
- `lib/scans/pmccHeldLeaps.ts`
- canonical PMCC decision authority
- existing broker foundation/capacity verification
- existing LEAPS position-intelligence data
- existing PMCC history/cycle data

Suggested new pure domain module:

`lib/leaps-position-intelligence/pmccOpportunityCost.ts`

It should consume canonical PMCC candidate/evidence data; it must **not** become a second structural eligibility authority.

`lib/scans/pmccReadiness.ts` is deprecated and must not be resurrected as production eligibility authority.

Preserve the principle:

**structural eligibility ≠ economic desirability**

## Regression fixtures

Use Dean's current positions as deterministic fixture shapes with mocked market inputs.

### UBER 67.50C 2027-09-17
- underlying at entry: $78.67
- current snapshot underlying: $69.64
- entry moneyness: 14.2% ITM
- current moneyness: 3.1% ITM
- original expiration B/E: $88.80
- DTE snapshot: 354
- original debit/capital at risk: $2,130

### NFLX 70C 2027-09-17
- underlying at entry: $79.95
- current snapshot underlying: $71.18
- entry moneyness: 12.4% ITM
- current moneyness: 1.7% ITM
- original expiration B/E: $90.85
- DTE snapshot: 354
- original debit/capital at risk: $2,085

Tests must prove that structural PMCC eligibility alone cannot force either fixture into INCOME OPPORTUNITY. Current Greeks, expected move, actual candidate economics and recovery interference must be evaluated.

## Acceptance criteria

1. Every broker-verified standalone held LEAPS can expose a management state with explicit evidence.
2. Structural PMCC eligibility alone never produces INCOME OPPORTUNITY.
3. Each candidate exposes long delta, short delta, net delta and Upside Exposure Retained when inputs are available.
4. Each candidate exposes expected move and Expected-Move Headroom using a documented canonical calculation.
5. Each candidate compares short strike with current spot and underlying entry price.
6. Scenario engine compares uncapped LEAPS vs LEAPS + short call at short expiration across −2σ, −1σ, flat, +1σ, +2σ and relevant position-specific reference prices.
7. Scenario repricing preserves remaining LEAPS time value and documents IV/rate/dividend assumptions.
8. UI exposes short-call credit separately from modeled opportunity cost.
9. RECOVERY/MONITOR can intentionally result in no short-call trade.
10. Missing/stale Greeks, quotes, IV, identity or required history fail to an explicit unavailable/monitor state; no guessed precision.
11. Original expiration B/E remains unchanged and clearly labeled.
12. Campaign-adjusted B/E uses only net **realized** short-call income.
13. Open short-call P/L is not counted as realized income.
14. Portfolio exposes total campaign economics without modifying broker cost basis.
15. EXIT/REVIEW does not automatically mean roll the LEAPS.
16. Existing exact-OCC verification, account identity, capacity reservation, stale-data fail-closed behavior and order gates remain unchanged.
17. UBER and NFLX fixture tests demonstrate that a barely-ITM LEAPS with substantial DTE is not automatically treated as an income candidate.
18. No automated order submission or automatic short-call sale is introduced.
19. No black-box aggregate recovery score is required for V1; displayed conclusions are traceable to the underlying metrics/scenarios.

## Non-goals

- Predicting whether the underlying will rise or fall.
- Technical-analysis or fundamental-analysis forecasting in V1.
- Analyst targets/news sentiment as decision authority.
- Automatic PMCC entry, rolling or exit.
- Replacing canonical PMCC structural rules.
- Rewriting broker-reported cost basis.
- Treating expected move as a directional forecast.

## Dependencies / relationship to existing work

- **LEAPS-PMCC-START-0001** answers when a structurally acceptable short call becomes possible relative to LEAPS breakeven. This ticket answers whether selling that call is economically attractive given the held LEAPS's current recovery state.
- **LEAPS-INCOME-READINESS-0001 / LEAPS-POS-0001** provide held-position readiness/dashboard concepts that this ticket should extend rather than duplicate.
- **PMCC-0002** remains the exact-held-foundation launch/handoff authority.

## Ian review questions

1. Is **scenario opportunity cost** the right primary decision framework rather than a fixed "recovery threshold"?
2. What should be the canonical expected-move calculation for V1: IV-based formula, ATM straddle-derived move, or existing chain data if TradeEdge already exposes one?
3. What minimum set of scenarios should be authoritative for the management state?
4. Should the V1 state policy use explicit thresholds for Upside Exposure Retained and Expected-Move Headroom, or present them as evidence while scenario economics drives the state?
5. What volatility assumption should reprice the remaining LEAPS at short-call expiration: current IV held constant, term-structure interpolation, or another deterministic policy?
6. Should underlying entry price remain evidence only, rather than a hard recovery target?
7. What conditions should move a position from RECOVERY/MONITOR to INCOME OPPORTUNITY without turning the engine into a market-direction forecast?
8. Are campaign-adjusted breakeven and total campaign P/L appropriate in this ticket, or should campaign accounting be a separately scoped dependency?
9. Confirm that "no short call" is an intentional valid outcome when modeled recovery cost is unattractive relative to premium.


---

# FINAL REVIEW SYNTHESIS — Ian / Alan / Paul lenses

**Status: READY FOR IMPLEMENTATION**

This section resolves the open investment, quantitative, execution, and product-governance questions above. Where this final synthesis conflicts with earlier exploratory wording, **this section governs**.

## Final investment-policy ruling

The engine does not forecast whether the stock will recover. It answers:

> **For this held LEAPS, does a currently executable short call offer enough income to merit review after explicitly showing how much near-term recovery participation it can remove?**

Decision layers remain separate: **canonical structural eligibility → compensation/recovery analysis → trader decision**. WAIT/no short call is a first-class valid outcome.

## Ian — portfolio-management decisions

### Compensation
For every structurally valid candidate calculate/display:
- executable credit;
- credit/current LEAPS liquidation value;
- credit/original LEAPS debit;
- annualized cycle yield for comparison only;
- long delta, short delta, net delta and Upside Exposure Retained;
- modeled opportunity cost at each scenario;
- net compensation after existing execution-friction evidence;
- premium-to-recovery-cost at upside scenarios where opportunity cost is positive.

**Premium-to-recovery-cost = net executable credit / modeled opportunity cost.**

Do **not** invent a universal numeric hurdle in V1. Persist the evidence so future policy can be calibrated from Dean's actual PMCC outcomes.

### Probability
Keep −2σ/−1σ/flat/+1σ/+2σ and position-specific prices as deterministic scenarios. **No probability-weighted expected-return score in V1.** Short-call delta may be shown as market evidence but is not an exact assignment/ITM probability.

### Convexity
Current delta is a snapshot, not the risk model. Scenario repricing is authoritative for recovery-cost display because Greeks change as spot moves. Where canonical leg data already exposes gamma/vega/theta, carry them into detailed evidence; do not build duplicate Greek calculations.

### Candidate frontier
Do not return only one opaque winner. Return a small **premium/recovery frontier** representing materially different tradeoffs (higher income/lower headroom, balanced, lower income/higher headroom). A candidate may be omitted as dominated when another candidate provides at least as much net executable credit and at least as much modeled recovery preservation, with one strictly better, under the same horizon. Do not label frontier choices Best/Worst.

## Alan — quantitative/model decisions

### Expected move
Reuse the existing canonical implementation in lib/scans/expectedMove.ts:

**Expected move = underlying price × expiration IVx × sqrt(DTE / 365)**

Use the proposed short-call expiration's DTE/IVx. Do not build another expected-move engine. Expected move remains scenario/context evidence consistent with EM-CONTEXT-0001, not a newly invented universal PMCC gate.

### Scenario repricing
Create a versioned opportunity-cost model. V1 must:
- value both structures at the proposed short-call expiration;
- preserve remaining LEAPS time value;
- use identical pricing assumptions for A and B;
- use current observable volatility under a documented deterministic V1 assumption rather than predicting future IV;
- use rate/dividend inputs only when reliably supplied by the existing pricing path;
- return partial/unavailable evidence instead of fabricated defaults.

The UI must state the assumption, e.g. **“Scenario estimate; current volatility held constant”** if that is the implemented V1 model.

### Premium accounting
Do not double-count opening credit. PMCC modeled value includes the opening credit exactly once.

**Opportunity cost = modeled value(LEAPS only) − modeled value(LEAPS + short call, including opening credit).**

Negative opportunity cost means the PMCC is ahead in that scenario; preserve/display it as a benefit rather than clipping to zero.

Underlying entry price, original expiration B/E and campaign-adjusted B/E are reference/scenario points, never directional forecasts or hard gates.

## Execution / liquidity

Reuse canonical PMCC liquidity, quote-quality and freshness authorities. For a held LEAPS, only the **new short call** is being transacted for this entry decision; do not reject the candidate because the already-owned LEAPS has a wide bid/ask spread.

Use the candidate's existing **executable price**, not optimistic mid-price, for compensation math. Preserve quote timestamp. Reuse existing slippage/friction evidence where available; do not create a competing execution model.

## Volatility

Expected move is not the same thing as premium richness. Where available, expose/persist short-call IV, expiration IVx, IVR, long LEAPS IV and term relationship as contextual evidence. They do not gain a new arbitrary V1 hard gate unless the canonical PMCC policy already uses one.

## Event risk

Reuse the canonical PMCC earnings authority. Earnings inside the short-call holding window must remain prominent and the recovery engine may not override the canonical earnings state.

For ex-dividend/early-assignment risk: when reliable dividend evidence exists, surface an early-assignment review warning for an ITM short call when remaining extrinsic becomes small relative to the dividend. Do not fabricate dividend dates/amounts. A new dividend-calendar integration is not required for V1 if no reliable canonical source exists.

Corporate actions/splits continue through existing broker/OCC identity handling; no custom adjustment math here.

## Short-call management policy

The repo already records the short-leg lifecycle of **50% profit target, 21-DTE management and 2×-credit loss/review threshold**. Reuse the canonical lifecycle authority wherever approved/implemented; do not duplicate constants.

For a stable apples-to-apples entry comparison, the scenario engine uses a **hold-to-short-expiration counterfactual** and labels that assumption. Actual realized opportunity cost may differ because a short call can later be closed or rolled.

Do **not** make an aggressive entry appear safer by assuming a future roll will succeed. HOLD / TAKE_PROFIT / ROLL / CLOSE remains downstream lifecycle management.

## Campaign accounting

Campaign economics remain in scope because repeated income must be tied to the LEAPS campaign. Keep broker basis immutable and separately show original LEAPS debit, realized net short-call income, current LEAPS liquidation P/L, open short-call P/L, total campaign P/L and campaign-adjusted expiration B/E. Only **realized** short-call income reduces campaign-adjusted LEAPS cost.

## Paul — product/architecture decisions

pmccOpportunityCost.ts is a pure analytical layer downstream of canonical eligibility. It must not reproduce pmccDecision.ts, pairing, liquidity, earnings, broker identity, capacity or order safety.

**broker/market truth → canonical PMCC eligibility → opportunity-cost analysis → frontier/evidence → user review**

No hidden composite Recovery Score is required. Every state must be traceable to visible evidence. If V1 lacks enough calibrated evidence for a defensible binary compensation judgment, use **REVIEW TRADEOFF** rather than inventing thresholds.

Persist decision-time evidence: policy/model version, candidate OCC, spot, expected move, Greeks available, executable credit, quote spread/timestamp, IV/IVR evidence, scenario outputs, selected candidate or WAIT, management state, and eventual realized short-call/campaign outcome through existing history plumbing.

## Required user-facing answer

For each held LEAPS the user must be able to answer:
1. **What state am I in?** Recovery/Monitor, Review Tradeoff, Income Active, or Exit/Review.
2. **What am I being paid?** Net executable credit and cycle-return context.
3. **How much recovery am I giving up?** Retained exposure plus scenario opportunity cost.
4. **What alternatives do I have?** Non-dominated premium/recovery frontier, including WAIT.

Illustrative presentation:

> **RECOVERY / MONITOR**  
> $145 executable credit · 28 DTE · 3.8% of current LEAPS value.  
> 73% of current delta exposure retained. Strike = 0.74× 1-SD expected move above spot.  
> Modeled PMCC vs uncapped LEAPS: +$145 flat · +$40 at +1σ · −$475 at +2σ.  
> Earnings: none inside short cycle. Quote: current / passes canonical PMCC liquidity policy.  
> **Tradeoff:** income is available, but this candidate materially reduces recovery in upper scenarios. Review farther-OTM alternatives or WAIT.

Values above are illustrative UI copy, not test expectations.

## Additional final acceptance criteria

20. Compensation uses executable short-call credit, not optimistic mid-price.
21. Scenario PMCC value includes opening credit exactly once.
22. Negative opportunity cost is preserved/displayed as PMCC benefit.
23. Existing computeExpectedMove() is reused; no duplicate expected-move implementation.
24. No normal-distribution probability-weighted expected-return score is introduced in V1.
25. Entry price and both breakevens remain context/scenario points, not gates.
26. Current Greeks are labeled current sensitivities; scenario repricing handles nonlinearity.
27. Canonical PMCC earnings/liquidity/quote-freshness authorities remain authoritative.
28. Held-long bid/ask spread does not gate the new short-call decision.
29. IV/IVR/term evidence is displayed/persisted when available but gains no arbitrary new V1 gate.
30. Short-call management reuses canonical lifecycle rules; entry analysis does not assume a successful future roll.
31. Candidate results expose a non-dominated premium/recovery frontier rather than one opaque winner.
32. WAIT/no short call is a first-class alternative.
33. Decision-time evidence and eventual outcomes are persistable for calibration.
34. Missing required model inputs produce partial/unavailable evidence, never fabricated precision.
35. Ex-dividend/early-assignment evidence is surfaced when reliable data exists; missing dividend data is not fabricated.
36. No automatic order submission is introduced.

## Implementation sequence

1. Domain/model: opportunity-cost types, canonical expected-move reuse, deterministic scenario repricing, campaign accounting, frontier dominance.
2. Fixtures/tests: UBER/NFLX plus missing Greeks/IV, stale quote, negative opportunity cost, duplicate-scenario and dominated-candidate boundaries.
3. Composition: consume canonical pmccDecision/held-LEAPS evidence; no new structural authority.
4. Portfolio UI: state + compensation + recovery cost + frontier + campaign economics.
5. Telemetry/outcomes: persist decision evidence for calibration.
6. Order launch remains the existing explicit user flow; no automation.

## Final sign-off

**Ian lens:** approved with the compensation/recovery framework above; no arbitrary premium hurdle until outcome data supports one.  
**Alan lens:** approved with canonical expected move, deterministic/versioned repricing, no probability-weighted V1 forecast, and fail-closed/partial evidence semantics.  
**Paul lens:** approved provided this remains downstream analysis and does not create a second PMCC eligibility/recommendation authority.

**Final disposition: READY FOR IMPLEMENTATION.**

