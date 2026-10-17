# SALVAGE-0001 — Salvage: forward-looking options for a losing position (phase 1: long options)

Status: DRAFT v3 (2026-10-16). Review changes folded in (Ian, Alan, Dane, Paul approve; Quinn approves with the added gates below). Awaiting Dean's approval; Diane's mock held until then.
Owner: Dane (build) | Reviewers: Ian (trading logic and wording), Alan (payoff math, fixtures), Paul (scope), Quinn (QA), Diane (screens)
Origin: Dean, 2026-10-16, on the MRNA long put. Companion to LEAPS-PMCC-RECOVERY-0001 (held LEAPS that are PMCC candidates stay there).

## Problem
When a position has moved against Dean there is no place in the app that lays out his real choices side by side. For a short put the choices exist but are scattered (take assignment, roll, convert to a spread). For a long option that is far out of the money (MRNA 140P: $2,574 paid, worth about $208) the only visible choices are "close" and "wait". Dean asked whether there is a valid "save the position" move.

## Principles (Ian)
1. Forward-looking. The question is "what is each choice worth from today", never "how do I get back to even". The original debit is shown as context, not as the goal.
2. No promise. Nothing here is called recovery or loss prevention. The feature is named **Salvage**: what can still be done with what is left.
3. Honest about what a move is. Selling a lower-strike put against a long put (a "sell the wing" conversion into a bear put spread) is, at fair prices, value-neutral: it turns part of the position's future value into cash today and caps the rest. The screen says so. It does not raise the chance of finishing in the money.
4. Proposal only. The feature never places, changes or cancels an order; it prefills the existing review dialog.
5. Deterministic. Every figure comes from the live chain and the position. No AI-generated numbers, no new score.

## Scope: phase 1
Eligible: a position that is exactly one long option leg (put or call), not part of a PMCC pair or a spread, quantity 1 or more, with a live chain and quotes. Not eligible: PMCC LEAPS (LEAPS-PMCC-RECOVERY-0001), spreads, short options.
Entry point: a "Salvage" action on the row in Position Analysis (and the symbol detail), shown only for eligible positions whose mark is 50% or less of the entry debit (Ian). It must never appear on an ineligible position, including from a stale cache (Quinn).

## The three choices shown, in dollars from today
| Choice | What it does | Cash today | At expiry |
|---|---|---|---|
| Close now | Sell the long option at the bid | bid x 100 x qty, less fees | nothing further |
| Hold | Do nothing | none | the option's payoff, or zero |
| Sell the wing | Keep the long option, sell one lower-strike put (calls: higher-strike call) in the same expiration, same quantity, defined risk | credit at the bid, less fees | capped payoff of the vertical: (long strike - short strike) x 100 x qty at most |

For each candidate wing strike the screen shows: short strike, credit (bid), fees, effective width, the most the spread can pay at expiry, short-leg delta, and the underlying price at which the position starts to pay. Candidates must be strictly below the long put (above the long call), same expiration, quantity no larger than the long leg, so risk stays defined.

### "Gives up" line (Ian)
Every wing candidate states what it gives away: "Above/below $K per share the long put no longer adds value; you keep at most $X per contract." Early assignment of the short leg is possible (American style); the long put covers it, and the screen notes this.

### Scenario table (replaces a probability headline)
For underlying prices at expiry (now, -10%, -25%, -35%, -45%, -60%; calls mirrored upward) show total dollars from today for Close, Hold and the chosen wing: cash received now plus payoff. Probability of finishing in the money uses the existing engine (`calcPositionPop` family) and is labelled an estimate.

### Objectives (what Dean selects before screening)
- Default: "most dollars from today in the scenarios I care about" (ranking by cash now, by dollars at a chosen underlying price, or by lowest breakeven price).
- "Reach a dollar amount from today" (custom): each strike is labelled **can meet**, **partial only**, or **cannot meet** against the amount, with the underlying price needed.
- "Recover the original debit" is available but never the default; when impossible the screen says so plainly. It is the central honesty control: a credit adjustment must never read as a recovery plan.
- Original-trade P&L and incremental-from-today P&L are shown separately and labelled.

## Guardrails
- Wide or stale market: the credit uses the bid, never the mid. Wide-market warning when the bid/ask gap is more than 25% of the mid, or more than $0.10 on options priced under $1. No proposal when the bid is zero or the quote is older than 60 seconds.
- Small numbers are shown as they are: far out of the money, low-delta wings bring in little (MRNA delta -0.074), and the screen says so rather than dressing it up.
- No "recovery" wording in the UI; "recover original debit" is labelled as a sunk-cost check.
- Earnings before expiration: warning with the date. The app has no event-volatility model, so the screen says "event volatility impact not available" and does not imply precision.
- Fees: reuse the fee constants in `lib/portfolio/rollExplanation.ts` (estimates, labelled as such). A wing whose credit does not clear the fees is not offered.
- Ticks: prices on the option root's tick table (`lib/portfolio/tickSize.ts`, ORDER-TICK-0001).
- Fail closed: if the chain, quotes or position data are missing, show "Salvage unavailable" with the reason, never a partial table.

## Order proposal
Prefilled one-click review dialog only: keep the long leg, sell one selected lower-strike put (or higher-strike call) to open, same expiration, limit at the bid-based price. Confirmation states the credit, the spread's maximum value, the chosen objective and whether it is met. Uses the existing dry-run and order-safety path. Dean submits; nothing is placed automatically.

## Fixture (acceptance)
MRNA long 1 Nov 20 2026 140 put: opened for a $2,574 debit, mark about $208, underlying $215.90 (about 35% out of the money), 35 DTE, delta about -0.074, earnings Nov 6 (before expiry). Expected: the position is identified as eligible; every candidate below 140 is listed with live prices; "recover the original debit" is flagged **cannot meet** for every strike; a custom amount such as $100 shows which strikes can meet it; the earnings warning and "event volatility not available" appear; original and from-today figures are both shown.

## Math (Alan to confirm)
- Vertical at expiry, long strike L, short strike K < L (puts): payoff = (L - S) x 100 for K <= S < L; (L - K) x 100 for S < K; 0 for S >= L. Calls mirrored.
- Fixtures use synthetic, labelled chain prices (the live chain is only available in market hours). Dollars from today (wing) = credit x 100 x qty - fees + payoff. Hold = payoff at expiry only (no remaining time value is modeled; the screen labels Hold "at expiry"). Close = bid x 100 x qty - fees.
- The short put leg cannot create a loss beyond the cash already received, because the long put is above it; margin treatment must be confirmed by dry run (open item).

## Later phases (separate tickets, same menu pattern)
- SALVAGE-0002: short puts (Wheel and Acquire): take assignment and the cash needed, roll out (and down) for a credit using the existing roll math, convert to a put spread. Judge a roll as a new trade, not as a way back to even.
- SALVAGE-0003: credit spreads: close, roll, adjust.

## Rulings (2026-10-16)
- Ian: thresholds above; wording as above.
- Alan: formulas confirmed. Golden fixtures (MRNA case, mirrored call, quantity 2) are written and frozen before Dane builds. Fees are estimates from the roll fee constants, labelled as such.
- Dane: pricing and chain data load browser-side only (TastyTrade constraint); `lib/salvage` stays pure so it runs client-side. Slice A (pure math, no UI, no broker calls) starts on approval. A bear put spread's risk is the debit already paid; expected no added buying power, confirmed by dry run before slice D. Slice D reuses the existing review dialog and dry-run path.
- Paul: phase 1 long options only; PMCC LEAPS, spreads and short options excluded.

## Open items
- Dean: live check in market hours on MRNA (prices, ticks, dry-run response). The actual MRNA wing credit cannot be quoted without the live chain.
- Boundary with LEAPS-PMCC-RECOVERY-0001 and `standaloneLeapsStop.ts`: neither changes.

## Quinn gates
- Never places, changes or cancels an order without Dean's submit.
- Revalidate quotes, position and quantity at confirm; if anything changed since the panel opened, block and refresh.
- A working closing order on the long leg is shown as a conflict and blocks the proposal.
- Partial quantity (wing smaller than the long leg) is covered by fixtures; wing larger is blocked.
- Salvage never appears on an ineligible position, even from a stale cache.
- Eligibility fixtures: MRNA long put (eligible), PMCC LEAPS (excluded), vertical spread (excluded), short put (excluded), quantity larger than the long leg (blocked).
- Math fixtures: Close, Hold and wing across the scenario table; "cannot meet" for the original debit; partial and full custom amounts.
- Stale quote, zero bid, missing chain, wide market, earnings-before-expiry each show the right warning or fail closed.
- Sibling check: the Cut Losses, stop and roll paths are untouched.

## Delivery
Slices after approvals: A pure math and fixtures (`lib/salvage`), B chain and quote loader with eligibility, C UI after Diane's mock is approved, D order proposal through the existing review dialog with dry run, E live check by Dean. One push per slice, CI green and Vercel preview Ready before merge.
