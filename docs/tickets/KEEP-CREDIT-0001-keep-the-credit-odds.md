# KEEP-CREDIT-0001 — Keep-the-credit odds and a first-time-roll explanation

**Status:** DRAFT 1 (2026-09-26). **Not approved to build.** Written from Dean's questions on 2026-09-26. Needs the reviews in the table below; nothing is built until every row is done.
**Sponsor:** Dean. **Relationship:** a follow-on to DECIDE-0001 (`docs/tickets/DECIDE-0001-decisive-position-recommendations.md`). It adds two things to the recommendation cell and changes no rule, threshold or action. It can ship after DECIDE-0001's safety slices (S3-0) and needs no new data source.

## Problem (Dean, in his own words, 2026-09-26)

1. *"When a roll is recommended, is the information there enough to act? I have never rolled a position so I am hesitant, because to me it is the same thing as closing a position for a loss and opening a new position and just getting the premium offset."*
2. *"I have been bitten by closing positions, particularly spreads, that would have closed OTM and I would have been able to keep my premium. I am looking for help to stop panicking about that and actually winning. That is my biggest issue."*

Evidence: Trade Log (65 closed trades, Apr 29 to Sep 21 2026): 21 of 28 losses were closed before the position reached twice the credit; CSPs net +$2,957 over 13 trades, spreads net −$530 over 52. The Trade Log cannot say how many of those closes would have expired worthless, because it has no stock price at expiry (DECIDE-0001D owns that capture).

## What a roll is (the plain answer Dean was given)

A roll is two things done together: close the current position, then open a new one with a later expiry, usually for a net credit. **The loss on the old position is real; the new credit only offsets it.** A roll buys time and sometimes a lower maximum loss. It does not fix a losing trade, and rolling only to avoid taking the loss is a bad reason. Dean's rules roll only losers at the 21-day time limit, and only when the roll pays at least $0.10 a share after fees; winners are closed, not rolled.

## Outcome

1. **Part A — a roll a first-timer can act on.** The roll suggestion lays out both halves and the net, in dollars, in plain words, before Dean clicks Roll.
2. **Part B — the odds line.** Where a position is at risk of a panic close, the cell says the chance the short strike expires out of the money, what closing now locks in, what holding risks at worst, and how far the stock is from the short strike. It is information, never a gate and never a reason to hold. The rules (stop at twice the credit, time limit, gates) do not change.

## Part A — first-time roll explanation

Shown in the roll suggestion's detail (state "Consider rolling"; DECIDE-0001 G2) and in the roll dialog's summary:

| Line | Example (put spread, C $1.65, 570/565, roll to 568/563, later expiry) |
|---|---|
| Close the old spread | "Pay $2.10 a share to close. That realizes a $45 loss." |
| Open the new spread | "Sell the 568/563 put spread expiring Nov 20 and collect $2.24 a share." |
| Net | "Net credit $0.14 a share ($14). New maximum loss $321 (was $335). New breakeven $566.21 (was $568.35)." |
| The honest line | "Rolling keeps you in this trade. It does not undo the $45 loss." |
| If the new spread is wider | "The new spread is wider, so the most you can lose goes up to $821 even though you collect a credit." |

Formulas are DECIDE-0001's "Qualifying roll and roll cost" (new credit `C' = C + r`; new maximum loss `(W' − C')·100`; new breakeven `K_s' − C'` for a put spread; fees included). The "realized loss" is the old position's P&L at the closing mid, per share and per contract. The roll dialog's mechanics are unchanged.

## Part B — the odds line

**What it says (three numbers and one distance):**

- **Chance to keep the whole credit:** the probability the short strike expires out of the money (for a put spread, the stock finishes above the short put; a call spread, below the short call; an iron condor, between both). "About 53% chance this expires worthless."
- **What closing now locks in:** the position's P&L at the closing mid. "Closing now locks in −$45."
- **Best and worst if held:** "If it expires worthless you keep +$165. The most you can lose is $335."
- **How far it has to go:** "The stock is $4 above your $570 strike; a typical move over the 19 days left is about ±$39 (1 SD)." This uses the expected move (price × IV × √(DTE/365)), the same figure the order window shows.

**Where it shows (proposal for Diane):** one note line in the recommendation cell on states where a panic close is likely: Hold with a loss (D1), "Stock has weakened" (F), the time-limit states (G0, G1, G2), and the stop states (B, E, "Loss limit reached", N). The four numbers sit in the fold-out; the note carries only the first number. It never appears on "Take profit" (nothing to protect) and never on an Acquire or Wheel put (the relevant number there is the chance of assignment; a second ticket if wanted). The line fits the cell's text caps (notes ≤ 72 characters).

**Where the number comes from (already in the app):** `calcPositionPopVsStrike` (`lib/portfolio/positionMetrics.ts:419`) computes it with a lognormal model from the stock price, the short strike, days to expiry and implied volatility; the Positions table's Risk view already shows it in the POP column as "Strike" (`PositionsWorkspace.tsx:726-731`), next to the breakeven-based `pop` (`positionMetrics.ts:361`). Nothing new is fetched. **Two facts the team must fix before building:**

1. **The code comment says "will price ever touch my strike" but the function is the probability of finishing beyond the strike at expiry.** The chance the stock *touches* the strike at some point is roughly double the chance it *finishes* beyond it. Dean's problem is exactly this gap: a position that touches or crosses the strike mid-trade can still expire out of the money. The ticket must use the finishing probability for "keep the credit" and must also show the touch probability as a separate, plainly labeled line ("It has about an X% chance of touching your strike before expiry, and about Y% of finishing beyond it") so a scary mid-trade move is put in context. Alan defines and tests the touch formula; the comment in the code is corrected.
2. **The model is a rough estimate, not a forecast.** It ignores gaps (a 10% overnight drop on earnings), fat tails and skew, and uses one IV number. The line must say "estimate" and show the volatility used. It must be hidden (never "unknown, so 50%") when price, IV or DTE is missing, when DTE is 0, or when earnings fall before expiry (a stated exception: "Earnings on Oct 22 before expiry: the estimate is unreliable").

**Why it helps and what it must not do.** It puts the trade-off in numbers at the moment of panic. It must not become a reason to hold a position that has reached its stop. The stop at twice the credit is a risk limit, not a forecast; when the stop is met the state still says "Stop level reached", and the odds line sits beneath it as information. Wording is neutral ("about 53% chance"), never "safe" or "likely to recover".

## Validating it against Dean's own history (later)

Once DECIDE-0001D's price-at-close and price-at-expiry capture exists, run a read-only comparison: for closed spreads, the model's chance-to-keep at the moment of close versus what happened at expiry. Report calibration in plain words ("When the model said 70%, about 68% expired worthless across N trades"). Until there are 30 or more trades per strategy, the line says "estimate" and no claim of accuracy is made. Alan owns the method.

## Non-goals

No change to any rule, threshold, stop, gate or action. Not a gate, not a score input, not a ranking input. No prediction claims. No probability for bought options (state "Not judged yet"). No new data source. No AI text.

## Acceptance criteria

1. `Chance to keep the whole credit` equals `calcPositionPopVsStrike` for BPS, BCS, CSP and IC (an iron condor uses the between-both-strikes probability the function already computes), and is shown as a whole percent.
2. The touch probability is computed by a tested pure function (Alan's formula) and is never smaller than the finishing probability.
3. The line is hidden, with a stated reason, when price, IV or DTE is missing or zero, and shows the earnings exception when earnings fall before expiry.
4. The roll detail (Part A) shows the six lines above with correct arithmetic for a same-width roll and for a wider roll, per share and per contract, fees included.
5. The odds line never appears on Take Profit, on an Acquire or Wheel put, or on a bought option.
6. When a stop or maximum-loss state is met, the odds line is below the label and never changes the label, the action or the suggested button.
7. Text limits: the note ≤ 72 characters; everything else in the fold-out; no red; jargon terms use DECIDE-0001's tap-to-explain buttons ("expected move", "probability of finishing beyond the strike").
8. Verification: `tsc` with `tsconfig.check.json`, affected tests, and a real `next build`; the full suite if shared logic (`positionMetrics.ts`) changes.

## Golden fixtures (Alan to verify in python3)

Put spread 570/565, stock 574, IV 30%, 19 days: finishing probability above 570 about 53% (`d2 = (ln(574/570) − 0.5·0.30²·19/365)/(0.30·√(19/365)) = 0.068`); stock 590, same inputs: about 92%; stock 570 (at the strike): about 49%; DTE 0 and missing IV hide the line; a call spread mirrors the put spread; an iron condor is the probability of finishing between both short strikes; the touch probability is about twice the finishing probability when the stock is out of the money on the near side. Alan adds the exact values.

## Who reviews what

| Who | What | Status |
|---|---|---|
| **Dean** | Approve the concept and where it shows; confirm that showing the touch probability next to the finishing probability is what he wants | Waiting |
| **Ian** | Whether the odds line could push a trader to hold past a stop (wording, placement, the states it appears on); the earnings exception; whether showing it on a stop state is wise | Not started |
| **Alan** | Finishing and touch formulas, the calibration method, fixtures, the IV input (which IV: the position's or the underlying's) | Not started |
| **Quinn** | Data availability for IV and DTE per position, the two existing functions' callers, tests, regression risk in `positionMetrics.ts` | Not started |
| **Paul** | Scope and sequencing after DECIDE-0001 S3-0; whether Part A ships alone first | Not started |
| **Diane** | The note wording, the fold-out layout, how the roll explanation reads; a rendered mock for Dean | Not started |
| **Dane (developer)** | Pre-development review; runs last | Not started |

## Open questions

1. Which implied volatility does `popVsStrike` use today (`p.iv`, per position) and is it the short leg's or the position's (Quinn, Alan)?
2. Should the odds line also appear on the Position Analysis Management view (the default) or stay in the recommendation cell only? Today the POP figures show only in the Risk view.
3. Should the same idea apply to a CSP set to Income (chance of assignment) in a follow-up?
4. Part A alone can ship before Part B, since it needs no probability model (Paul).
