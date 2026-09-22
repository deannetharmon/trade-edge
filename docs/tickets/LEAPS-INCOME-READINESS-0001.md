# LEAPS-INCOME-READINESS-0001 — Explainable PMCC readiness on broker-held LEAPS

## Owner

Dane

## Status

Draft for Ian, Alan, Quinn, Diane, and Paul review. Do not begin implementation until the ticket is approved.

## Problem

The product can discover PMCC short-call candidates for broker-held LEAPS, but a trader has to know to leave the LEAPS/Portfolio context and open that scan. The LEAPS entry score also risks being read as a signal that it is time to sell a short call.

These are different decisions:

1. Whether a new long call is an efficient way to express an underlying thesis.
2. Whether a **broker-held** long call is currently suitable to review for a short income call.

The second decision must never be called a conventional covered call: a true covered call is covered by stock; a short call against a LEAPS is a PMCC/diagonal structure with distinct assignment and structural risks.

## Product decision

Add an **Income Call Readiness** section to a broker-verified standalone LEAPS position in Portfolio. It is an explainable routing aid, not a forecast and not a trade recommendation.

The section has one possible action:

> Review PMCC short calls

That action opens the existing held-LEAPS PMCC discovery for the exact broker-verified long-call foundation. It must never submit an order, create a local position, or use a generic ticker-only handoff.

## Scope

### 1. Where readiness appears

- Show the section only on a broker-verified, currently held long call that is eligible to be identified as a standalone LEAPS foundation.
- Do not show it on a Screener candidate, a submitted-but-unfilled LEAPS order, Long Book-only data, a generic equity holding, or a local browser record.
- Keep it visually separate from the LEAPS entry-quality score and from conventional stock covered-call controls.
- Existing Portfolio data remains the source of truth; no new local persistence is introduced.

### 2. Trader-facing states

Use exactly one primary state, with a concise reason and an expandable evidence list:

| State | Meaning | Action |
|---|---|---|
| Not applicable | The record is not a broker-verified held long-call foundation. | None |
| Not ready | A required structural, account, capacity, or market-data condition is not satisfied. | Show reasons |
| Monitor | The foundation is valid, but a current short-call review is not actionable for one named, non-blocking market or candidate reason. | Show the named reason and what to monitor |
| Review income call | A current PMCC short-call candidate meets the configured readiness policy. | Review PMCC short calls |
| Market closed | The structure may qualify, but no current actionable quote is available. | Refresh during market hours |

The UI must not use language such as “best time,” “sell now,” “safe,” or “covered call” for a LEAPS-based structure.

`Monitor` is not a catch-all state. It must carry exactly one standardized primary reason, with optional supporting evidence:

- No qualifying short-call candidate currently available.
- Best available candidate exceeds the configured bid/ask-quality limit.
- Available foundation capacity is reserved by an existing or working short call.
- A configured preference is not currently met (for example, selected DTE or delta preference), while the structure remains valid.

Structural failure, account ambiguity, stale/incomplete data, or a closed market must use their respective **Not ready** or **Market closed** states instead of `Monitor`.

### 3. Evidence and readiness policy

Reuse the current PMCC broker verification and pairing policy; do not invent a parallel calculation in Portfolio.

The readiness disclosure must identify:

- Exact long OCC identity, account, contract count, available/unreserved capacity, and snapshot/quote freshness.
- Whether the long and proposed short share the underlying/deliverable, the long expiration is later, and the long strike is lower.
- Proposed short-call DTE, delta, OI, bid/ask quality, strike, executable credit, and quote timestamp when a candidate exists.
- Whether market session, data completeness, account ambiguity, stale snapshot, or an existing/working short call blocks review.
- The trader-facing tradeoff: the short call produces income but caps upside while open; assignment/early-assignment considerations remain visible.

All amounts and labels must be derived from the same fresh broker snapshot and PMCC evaluation used by the handoff. Missing or stale evidence fails closed to **Not ready**, **Monitor**, or **Market closed**; it must not produce **Review income call**.

### 4. Handoff behavior

- The CTA routes with exact account number, position key, OCC symbol, underlying, and foundation contract count.
- The held-PMCC scan revalidates the foundation, capacity, quotes, and current rules before it displays an order-review path.
- A changed, missing, stale, partial, or mismatched foundation returns an explicit blocked state; it never falls back to a ticker-level PMCC scan.
- Submission stays entirely inside the existing broker-verified PMCC review/order flow and retains its lifecycle rules.

### 5. LEAPS ranking correction

Correct the LEAPS result sort defaults so they convey the intended direction:

- Score: descending by default.
- Open interest: descending by default.
- Delta and DTE: explicit preference ordering; do not imply that larger is automatically better.
- Spread %, extrinsic dollars, and extrinsic % of cost: ascending by default.
- The active sort label must show the direction. Missing values always sort after comparable values.

The LEAPS entry score remains a **contract-efficiency and liquidity** score. It must not be relabeled or presented as PMCC income readiness, a market forecast, or a complete trade thesis.

## Non-goals

- No automatic short-call suggestion, order placement, roll, profit target, stop, or recurring income automation.
- No new PMCC qualification thresholds in this ticket; reuse versioned current policy and surface it.
- No change to true stock covered-call eligibility or UI.
- No change to standalone LEAPS entry-scoring weights beyond the sort-direction correction.
- No Long Book write, redirect, or browser-local position authorization.

## Acceptance criteria

1. A Screener LEAPS candidate has no Income Call Readiness section.
2. A broker-held long call with no verified PMCC foundation renders a truthful blocked/not-applicable state with a reason.
3. A broker-held valid foundation with a currently qualifying short candidate renders **Review income call**, shows its evidence/freshness, and routes the exact foundation into held-PMCC review.
4. Stale, incomplete, ambiguous, or unavailable broker data never renders a ready state or enables the CTA.
5. Existing/working short calls reduce available foundation capacity and the UI discloses that capacity outcome.
6. Market-closed and no-current-quote cases use **Market closed**, never a false ready state.
7. Every **Monitor** state displays one standardized primary reason; structural failure, missing/stale data, account ambiguity, and market closure cannot be labeled **Monitor**.
8. The CTA does not submit an order; final PMCC order validation continues to recheck broker evidence.
9. Conventional stock covered-call controls are unchanged and never label a LEAPS-based PMCC as a covered call.
10. Score/OI and cost/liquidity sort directions follow the stated defaults; missing metrics sort last.
11. Tests cover all readiness states, exact-foundation handoff, stale/partial snapshot blocking, capacity reservation, standardized Monitor reasons, and every sort direction.

## Review questions

- **Ian:** Confirm the readiness state policy uses current PMCC structural gates without turning preferences into hidden safety rules.
- **Alan:** Confirm every state is explainable from broker evidence and distinguishes unavailable data from a failed rule.
- **Quinn:** Confirm snapshot freshness, exact OCC/foundation identity, capacity reservation, and handoff contracts are sufficient for fail-closed operation.
- **Diane:** Confirm the labels, hierarchy, and progressive disclosure distinguish entry quality from income readiness without overloading the position card.
- **Paul:** Confirm this remains a review-routing feature, not an automated income-trading feature, and approve the scope boundary with PMCC-0001.

## Dependencies

- `PMCC-0001 — Broker-Verified Covered Calls Against Existing LEAPS` for the canonical broker snapshot, exact foundation, capacity, and order lifecycle contracts.
- Existing held-LEAPS PMCC handoff and pairing policy in the Screener.
