> Repository copy of GitHub Issue #49.
>
> Canonical issue: https://github.com/deannetharmon/trade-edge/issues/49
>
> This document captures the finalized ticket so the implementation specification is available with the project source. If this file and Issue #49 diverge before implementation, reconcile them explicitly rather than silently choosing one.
>
> **Reconciled 2026-09-27** after they diverged: this copy still had the self-written "FINAL REVIEW SYNTHESIS" that the issue itself later corrected (self-approval removed, two factual corrections applied, scope split into issue #50 and #51). This copy is now a byte-for-byte pull of the issue body as of that date. Ian and Paul's rulings on the nine open questions are in `docs/tickets/LEAPS-PMCC-RECOVERY-0001-ian-paul-rulings.md`.

# LEAPS-PMCC-RECOVERY-0001 — Held LEAPS recovery vs PMCC income opportunity

**Status:** Draft for Ian and Paul review. Do not begin implementation until Dean approves after review, revision 2026-09-27 (self-synthesis removed, scope split, two corrections applied — see the note at the end).

---

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
- `features/portfolio/positions-workspace/model/breakeven.ts` — reuse for the **original** (single-leg) LEAPS expiration breakeven only. This file explicitly refuses a multi-leg/PMCC breakeven (see its own comments), so once a short call is open, the campaign-adjusted breakeven (LEAPS-PMCC-RECOVERY-0002, issue #50) must be computed independently in the new module, not derived from this file.
- `lib/scans/pmccHeldLeaps.ts`
- canonical PMCC decision authority (`lib/scans/pmccDecision.ts` — `evaluatePmccDecision`, `PMCC_DECISION_POLICY_VERSION`)
- existing broker foundation/capacity verification
- existing LEAPS position-intelligence data (`lib/leaps-position-intelligence/`: persistence, mandate types)
- existing PMCC history/cycle data

Suggested new pure domain module:

`lib/leaps-position-intelligence/pmccOpportunityCost.ts`

It should consume canonical PMCC candidate/evidence data; it must **not** become a second structural eligibility authority.

`lib/scans/pmccReadiness.ts` is confirmed deprecated (no live callers; its own JSDoc says production and UI code must consume `pmccDecision.ts` exclusively) and must not be resurrected as production eligibility authority.

The short-leg lifecycle (50% profit target, 21-DTE management, 2x-credit loss/review threshold) is **not one file**: the profit target and 21-DTE threshold live in `lib/portfolio-intelligence/policies/defaults.ts`, and the 2x credit stop lives separately in `lib/portfolio/stopLossPolicy.ts` (`DEFAULT_ENTRY_STOP_MULTIPLE`). Reuse both; do not duplicate either, and do not expect a single "lifecycle authority" module.

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
12. EXIT/REVIEW does not automatically mean roll the LEAPS.
13. Existing exact-OCC verification, account identity, capacity reservation, stale-data fail-closed behavior and order gates remain unchanged.
14. UBER and NFLX fixture tests demonstrate that a barely-ITM LEAPS with substantial DTE is not automatically treated as an income candidate.
15. No automated order submission or automatic short-call sale is introduced.
16. No black-box aggregate recovery score is required for V1; displayed conclusions are traceable to the underlying metrics/scenarios.


(Criteria for campaign-adjusted breakeven and total campaign P/L moved to LEAPS-PMCC-RECOVERY-0002, issue #50, split out 2026-09-27.)

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

## Scope and review note (2026-09-27)

This ticket originally carried a self-written "FINAL REVIEW SYNTHESIS" section that answered Ian's and Paul's own review questions below in the ticket's own voice and marked itself "READY FOR IMPLEMENTATION." That is not the ticket-writer's call to make. It has been removed. An independent review (Ian and Paul lenses, checked against the actual code) found the technical grounding accurate — no fabricated claims about the codebase — but flagged that self-approval, plus two corrections now folded into this ticket:

1. The lifecycle constants (50% profit target, 21-DTE, 2x credit stop) live in two files, not one "authority" — corrected above.
2. `breakeven.ts` cannot produce a campaign-adjusted (multi-leg) breakeven — corrected above.

Scope was also split. Two follow-ups carry work that does not gate the core recovery-vs-income decision:

- **Campaign accounting** (realized/unrealized income tracking, campaign-adjusted breakeven): LEAPS-PMCC-RECOVERY-0002, issue #50.
- **Premium/recovery frontier UI** (non-dominated candidate set instead of one winner; needs Diane's mock first): LEAPS-PMCC-RECOVERY-0003, issue #51.

**The nine "Ian review questions" below are genuinely open.** Ian and Paul have not yet ruled on them in this session. Do not begin implementation until Dean has that ruling and approves.
