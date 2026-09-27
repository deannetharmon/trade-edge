# LEAPS-PMCC-RECOVERY-0001 — Ian and Paul rulings on the nine open questions

**Ruled 2026-09-27.** GitHub issue #49. Closes the eight questions still open after the self-written synthesis was removed (question 8, campaign accounting scope, was already resolved by splitting issue #50). Alan to confirm the fixtures below before build; this does not replace his review of the scenario repricing math.

## 1. Is scenario opportunity cost the right framework, rather than a fixed "recovery threshold"?

**Yes.** No outcome data exists yet on real PMCC-vs-uncapped-LEAPS results, so a numeric threshold now would be invented, not calibrated — the same reasoning behind CUT-LOSSES-REVIEW-0001's "no scoring change until outcome data exists" and KEEP-CREDIT-0001's calibration requirement (100+ trades before any hurdle is trusted). Show the scenario evidence; let Dean judge per position until there is enough campaign history to calibrate a real threshold.

## 2. Canonical expected-move calculation for V1

**Reuse `computeExpectedMove` in `lib/scans/expectedMove.ts` exactly**, with no second implementation: `underlyingPrice × (expirationIvx / 100) × sqrt(DTE / 365)`, using the proposed short-call expiration's own IVx. Confirmed live and already used elsewhere (EXPECTED-MOVE-CALC-0001, Ian's own formula). No ATM-straddle-derived move, no new source. When the expiration has no IVx, expected move is unavailable, and Expected-Move Headroom is unavailable for that candidate — never guessed.

## 3. Minimum scenario set

The set already proposed is authoritative and required, not optional: −2σ, −1σ, unchanged, +1σ, +2σ, underlying entry-price recovery, the proposed short strike, and the LEAPS expiration breakeven when it falls inside a reasonable display range. All must be computed for a candidate to receive a state; a scenario that cannot be priced (missing IV, stale quote) makes that one scenario unavailable, not the whole candidate — but if enough of the set is unavailable that no upside scenario (+1σ, +2σ) can be judged, the candidate's state is REVIEW TRADEOFF / MONITOR, not a guess. Deduplicate scenario prices that land within one cent of another, and drop from display any scenario more than 3× the expected move from spot (Paul: not because it's impossible, but because it clutters the table without adding a real decision point).

## 4. Explicit thresholds for Upside Exposure Retained and Expected-Move Headroom, or evidence only?

**Evidence only for those two metrics.** Neither gets a hard numeric cutoff in V1. They are inputs a trader reads alongside the scenario table, not a pass/fail gate — consistent with "trust the qualified realm."

The **management state itself** still needs a deterministic rule (it can't be pure vibes, or two runs of the same data would disagree). Use the same integer-margin convention DECIDE-0001 already established for judgment confidence (`m = |x − T| / |T|`), applied here to the opportunity-cost sign, not to UER or EMH: see question 7.

## 5. Volatility assumption for repricing the remaining LEAPS at short-call expiration

**Current IV held constant.** No term-structure interpolation in V1 — nothing in this codebase does that today, and building it would be a second volatility-modeling authority the ticket already says to avoid. State the assumption on screen exactly as the ticket's own draft copy already does: "Scenario estimate; current volatility held constant." Document it as a named, versioned assumption in the pure module (`pmccOpportunityCost.ts`) so it can be revisited later without silently changing old evidence records.

## 6. Should underlying entry price remain evidence only, not a hard recovery target?

**Yes, evidence only.** It is a reference point a trader recognizes ("I paid up when it was at $78.67"), not a target the engine chases. Never gates a state, never appears as a claim about where the stock "should" go.

## 7. What moves a position from RECOVERY/MONITOR to INCOME OPPORTUNITY, without becoming a market-direction forecast?

**Rule (deterministic, no forecast):** a candidate is **INCOME OPPORTUNITY** when the modeled opportunity cost is zero or negative (the PMCC is at least breakeven, or ahead) at **every** evaluated upside scenario (+1σ and +2σ, plus entry-price recovery if that price sits above spot). Otherwise it is **RECOVERY/MONITOR** (a real tradeoff exists: the candidate would cost something in at least one plausible upside case, weighed against the credit).

This makes no claim about which scenario is more likely — it only asks whether the trade is free-or-better in the upside cases already being shown, which is the same test a trader reading the scenario table would run by eye. It also naturally produces the premium/recovery frontier's split (higher income/lower headroom candidates cluster in RECOVERY/MONITOR; lower income/higher headroom candidates cluster in INCOME OPPORTUNITY) without a separate threshold on Upside Exposure Retained or Expected-Move Headroom.

**Fixture for Alan** (illustrative, not exact broker numbers): a candidate priced with opportunity cost +$40 at +1σ and −$475 at +2σ is RECOVERY/MONITOR (positive cost exists at +2σ). A candidate priced at −$10 at +1σ and −$5 at +2σ (PMCC ahead or tied in both) is INCOME OPPORTUNITY. A candidate missing a usable +2σ price (IV or quote unavailable) cannot be marked INCOME OPPORTUNITY — it falls to RECOVERY/MONITOR with an "unavailable" note on that scenario, never silently passes on partial evidence.

## 8. Campaign accounting scope

**Already resolved 2026-09-27**: split into issue #50 (LEAPS-PMCC-RECOVERY-0002). Does not gate this ticket.

## 9. Is "no short call" an intentional, valid outcome?

**Confirmed, and expected to be the common outcome**, not the exception. Ian: on a LEAPS held for recovery, most candidates most of the time should show RECOVERY/MONITOR with no trade taken — that is capital preservation working as intended, the same posture behind the 2x credit stop and the 21-DTE rule elsewhere in this app. A build that produces a short-call recommendation on most positions most of the time is very likely wrong, not aggressive.

## What this unblocks

All nine questions are now ruled. `pmccOpportunityCost.ts` can be built against: the reused expected-move formula (Q2), the required scenario set (Q3), evidence-only UER/EMH with the deterministic state rule in Q7 (Q4, Q6, Q7), current-IV-held-constant repricing (Q5), and WAIT as the expected default outcome (Q1, Q9). Diane still needs a mock (per the ticket's own required presentation) before any of this becomes code; issue #49's presentation examples are draft copy, not an approved mock. Alan confirms the fixture in question 7 and the scenario repricing arithmetic before Dane's pre-development review.
