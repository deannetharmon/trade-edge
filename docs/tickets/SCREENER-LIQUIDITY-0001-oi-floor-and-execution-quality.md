# SCREENER-LIQUIDITY-0001 — OI Floor and Execution-Quality Ranking

## Owner

Dane

## Status

Implemented on `main` in `b6ed7e12` — validation complete

## Decision

Treat **100 open interest (OI) as the default eligibility floor**, not as the point at which a contract begins to earn a meaningful liquidity score. Treat **500+ OI as strong liquidity**, not as the minimum usable contract.

Open interest alone does not establish execution quality. A candidate must also have fresh, two-sided, non-crossed quotes within the configured spread-width rule. Ranking must consider OI alongside those execution signals without allowing OI to dominate the decision.

## Problem

The current liquidity score normalizes minimum-leg OI against 500. This makes a contract with 100–249 OI, which already meets Trade Edge's default minimum, lose too much rank even when quotes are current and executable. The UI can then describe a valid 100-OI candidate as questionable liquidity, which conflicts with the configured eligibility rule.

For example, a 102/160 OI bull put spread clears the minimum for both legs but receives only about one-third of the OI component before other liquidity inputs are considered.

## User value

Traders can distinguish:

- a candidate that is not eligible because it lacks verifiable execution conditions;
- a candidate with adequate liquidity at the configured 100-OI floor; and
- a comparable candidate with stronger 500+ OI liquidity.

This keeps sound, executable candidates in the qualified universe while still ranking deeper markets higher.

## Scope

### Eligibility

Use the configured default OI floor of 100 contracts:

| Strategy | Required OI for default eligibility |
|---|---:|
| Cash-secured put | Short put >= 100 |
| Stock covered call | Short call >= 100 |
| Bull put spread | Each leg >= 100; use the weaker leg for ranking |
| New PMCC | Purchased long call and sold short call each >= 100; use the weaker leg for ranking |
| Existing-LEAP PMCC roll | New short call >= 100; do not penalize an already-held LEAP for its current/legacy OI |

All candidates must additionally satisfy the existing configured requirements for fresh, two-sided, non-crossed quotes and maximum quote width. Failure of any of those execution checks is a clear qualification reason, not a ranking deduction.

### Ranking

Use the weaker required leg's OI for multi-leg strategies. The OI contribution to the liquidity dimension follows this auditable curve:

| Minimum required-leg OI | OI factor | Trader-facing meaning |
|---|---:|---|
| Below 100 | 0.00 | Below default floor |
| 100 | 0.70 | Adequate |
| 250 | 0.85 | Good |
| 500 or more | 1.00 | Strong |

Interpolate monotonically between those points. Combine that factor with existing quote-spread, quote-freshness, credit, and return-on-capital inputs using documented weights. OI must not by itself qualify a candidate or overpower current quote quality.

### Presentation

- Show `Adequate liquidity` for a qualifying candidate whose required-leg OI is 100–249.
- Show `Good liquidity` for 250–499 and `Strong liquidity` for 500+.
- Show the required-leg OI values and identify the weaker leg for spreads/PMCCs.
- For below-floor candidates shown in a near-miss view, state `Below OI floor` and the applicable required leg. Do not present them as qualified.
- Include a decision-details view that exposes the active OI floor, OI factor, quote checks, data timestamp, and ruleset version.

## Non-goals

- Changing the default OI floor from 100.
- Treating OI as a substitute for executable bid/ask quotes.
- Automatically submitting trades or relaxing final quote-freshness checks at order time.
- Retrofitting historical reports without an explicitly selected historical ruleset.

## Acceptance criteria

1. A single-leg CSP or covered call with OI 100, a fresh two-sided quote, and an acceptable spread is eligible and receives an `Adequate liquidity` label.
2. A BPS or new PMCC is eligible only when every required leg has OI >= 100 and meets quote-quality rules; its OI score uses the weaker required leg.
3. An existing-LEAP PMCC roll evaluates the proposed short call's current OI and does not reduce its score because of the held LEAP's current OI.
4. Candidates with OI below 100 are rejected or shown as near misses with an explicit `Below OI floor` reason; they cannot appear in the qualified-ranked list.
5. A 100-OI candidate receives an OI factor of 0.70, 250 receives 0.85, and 500+ receives 1.00; intermediate scores are monotonic.
6. One-sided, crossed, stale, or too-wide quotes fail qualification even when OI is >= 100.
7. The liquidity UI does not call a qualifying 100–249 OI candidate `Moderate`, `Poor`, or otherwise imply that it failed the configured floor.
8. Decision details record active OI floor, per-leg OI, limiting leg, OI factor, quote checks, quote timestamp, and rule/configuration version.
9. Unit tests cover every curve boundary, interpolation, each strategy's required-leg rule, and quote-quality failures. Existing screener, covered-call-capacity, and PMCC suites remain green.

## Implementation notes

- Preserve configurable thresholds; do not hard-code 100 or 500 in strategy components. The defaults belong in the shared, versioned screener configuration.
- Keep qualification and ranking separate. The candidate pipeline must finish execution-quality gates before computing a rank.
- Reuse one shared liquidity evaluator across CSP, covered call, BPS, new PMCC, and existing-LEAP PMCC roll flows so labels and calculations cannot drift.
- Retain the exact per-leg reason codes and input timestamps for support/audit exports.
- Recheck current quote quality immediately before order review/submission; scanner ranking is not execution authorization.

## Validation steps

1. Run unit tests with fixtures at OI 99, 100, 101, 249, 250, 499, and 500 for each applicable strategy.
2. Verify a 102/160 BPS displays `Adequate liquidity`, shows both leg values, and ranks below an otherwise identical 500/500 BPS without being removed from qualified results.
3. Verify a 500-OI contract with a stale, one-sided, crossed, or wide quote is not eligible.
4. Verify an existing-LEAP PMCC roll can rank based on the proposed short call even if the legacy LEAP's present OI is below 100.
5. Verify decision details are consistent with the configured ruleset and the candidate's market-data timestamp.

## Review and approval gate

Ian's recommendation is incorporated: 100 OI is adequate; 500+ is strong; current two-sided quote, width, and freshness are co-equal execution evidence. Paul, Diane, and Quinn should confirm the final configuration, trader language, audit fields, and regression coverage before production-code implementation begins.
