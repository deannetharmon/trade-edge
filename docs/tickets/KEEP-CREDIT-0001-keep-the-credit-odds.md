# KEEP-CREDIT-0001 — Keep-the-credit odds and a first-time-roll explanation

**Status:** DRAFT 2 (2026-09-26). **Not approved to build.** Draft 1 was reviewed by Ian, Alan, Quinn, Paul and Diane on 2026-09-26; every required change is folded in below. Left: Dean's decisions (listed next), a rendered mock for Dean to approve, and Dane's (the developer's) pre-development review.
**Sponsor:** Dean. **Related:** DECIDE-0001 (`docs/tickets/DECIDE-0001-decisive-position-recommendations.md`). This ticket changes no rule, threshold, stop or action.
**Rendered mock:** see the link in the roadmap entry (item 13) once published.

## Decisions Dean owes (shortest list)

1. **Approve Part A (the first-time-roll explanation) and its mock.** It ships first and alone.
2. **Show the odds only on "Hold with a loss"** (a spread or an Income put, down at least 25% of the credit, above the stop, more than 21 days left), and **never** on a stop, "Loss limit reached", maximum-loss, "Stock has weakened", time-limit-winner, Acquire-or-Wheel-put or expires-soon state (Ian and Paul; Paul would also have allowed "Stock has weakened", Ian's trader ruling wins). The time-limit-with-no-roll state gets it in the fold-out only.
3. **No touch percentage in version 1.** The fold-out carries one plain sentence instead: "If the stock reaches your strike, it is about a coin flip whether it finishes back out of the money."
4. **Should a position be rolled at most once?** (Ian) Each roll resets the stop to twice the *cumulative* credit, so repeated rolls quietly widen your stop.
5. **Make the hindsight review of your own closed spreads (KEEP-CREDIT-0002) a real ticket** after DECIDE-0001's data work (Paul).

## Problem (Dean, in his own words, 2026-09-26)

1. *"When a roll is recommended, is the information there enough to act? I have never rolled a position so I am hesitant, because to me it is the same thing as closing a position for a loss and opening a new position and just getting the premium offset."*
2. *"I have been bitten by closing positions, particularly spreads, that would have closed OTM and I would have been able to keep my premium. I am looking for help to stop panicking about that and actually winning. That is my biggest issue."*

Evidence: Trade Log (65 closed trades, Apr 29 to Sep 21 2026): 21 of 28 losses were closed before the position reached twice the credit, so the panic happens while Dean's own rule says "not yet"; CSPs net +$2,957 over 13 trades, spreads net −$530 over 52. The Trade Log cannot say how many of those closes would have expired worthless (no stock price at expiry; DECIDE-0001D owns that capture).

## What a roll is (the plain answer)

A roll is two things done together: close the current position, then open a new one with a later expiry, usually for a net credit. **Dean is about 90% right: the loss on the old position is real and final. The credit does not "offset" it; it pays you to take more time, and hoping to win the loss back on the new position is a new bet.** In the example below the roll lowers the worst case by only $14. Dean's rules roll only losers at the 21-day time limit and only when the roll pays at least $0.10 a share after fees; winners are closed, not rolled.

## Outcome

1. **Part A:** each roll suggestion and roll candidate lays out both halves, the fees, the net, what changes and what does not, before Dean clicks Roll.
2. **Part B:** on the one situation where Dean tends to panic-close a spread (a loss that has not reached his stop), the cell says the estimated chance the short strike finishes out of the money, and how far he is from his own stop. It is information, never a gate, and never appears on a state that says close.

## Part A — first-time roll explanation (ships first, alone)

**Where (Quinn corrected the earlier draft).** There is no separate roll dialog: the roll flow is the "Close + Roll" mode of the batch dialog (`app/portfolio/page.tsx` `initialRollMode` `:3026`, `:3044`; toggle `:4255-4257`; candidate cards `:~4275-4360`). Part A adds the lines below to **each roll candidate card** and to **the roll suggestion detail** (state "Consider rolling"). Today the cards show the mid credit, an 85% limit price, open interest, bid-ask, and "Net Roll P&L" with no fees. The existing candidate rules (delta pick; gross credit at least one third of the width) are **unchanged**, so a card can be shown that does not meet Dean's $0.10-after-fees rule; **Part A states the truth on such a card** ("Net credit after fees: $0.06 a share. Your rule asks for $0.10.") and does not hide it.

**When it shows:** only when the old position is at a loss (a winner is closed, not rolled).

**The lines** (dollars for the position's contract count lead; per share follows; every price is labeled as the closing mid or the 85% limit):

| Line | Example (put spread, credit $1.65, 570/565, one contract, roll to 568/563, later expiry) |
|---|---|
| Close the old spread | "Pay $210 ($2.10 a share, the closing mid) to close. You lose $45 on this trade, and that loss is now final." |
| Open the new spread | "Sell the 568/563 put spread expiring Nov 20 and collect $228 ($2.28 a share, the limit price)." |
| Fees and net | "Fees $4 ($0.04 a share). Net credit $14 ($0.14 a share) after fees." (The lines must add up: 2.28 − 2.10 − 0.04 = 0.14.) |
| What changes | "Most you can lose: $321 (was $335). Breakeven $566.21 (was $568.35). Buying power needed: about the same." |
| Your rules after the roll | "Your stop moves to a $3.58 mark, a total loss of about $179 (was $165). Next 21-day check: Oct 16." |
| If you close instead | "Close now and you take the $45 loss and are done. Roll and you carry $321 of risk for 41 more days and collect $14." |
| The honest line | "A roll does not undo the $45 loss. It is a new trade that gives you more time, and it can lose too." |

**Warnings (amber):** *Wider spread:* "The new spread is wider: the most you can lose rises to $821 (was $335), even though you collect a credit." *Net debit* (a manual roll): "You pay $30 more than you collect ($0.30 a share). New most you can lose: $365 (was $335). You are risking more to stay in this trade." with the button "Roll for a $30 debit". A credit roll's button reads "Roll for a $14 credit".

**Formulas** are DECIDE-0001's "Qualifying roll and roll cost": `rollNet = floor_to_cent(new mid − old mid) − fees/(100·qty)`; new credit `C' = C + r`; new maximum loss `(W' − C')·100` (an iron condor: the wider wing minus the total credit); change in maximum loss `((W' − W) − r)·100`; new breakeven `K_s' − C'` (put spread) or `K_s' + C'` (call spread); new stop `2·C'`. **Alan's cross-check:** loss at close $45 + remaining risk (5 − 2.24)·100 = $321, so "$321" is the total worst case including the $45 already lost. Fee treatment: use the fee-inclusive number and say so. The layout is Diane's (a small close/open/net table, the net in bright type, the honest line on a left border, warnings above it).

## Part B — the odds line (ships after Part A)

**What it says.**

- **The note (one line, 72 characters at most):** "About 50% chance you keep the whole $165 (estimate). −$55 of your −$165 stop." (odds, then the distance to Dean's own stop; Ian: the stop distance is the number that matters most for Dean's problem). If a warning note already fills the cell, a short form: "45% to keep $140 (estimate)". Notes are ranked: amber warnings, then odds, then ambient; odds that do not fit move to the fold-out.
- **The fold-out block "The odds"** ("estimate, not a forecast" at its right): chance to keep the whole credit (about X%); "Closing now locks in about −$55 at the midpoint (before fees; a real fill is usually worse). Your rules limit the loss to about −$165. A gap can make it more, up to $335."; "If it expires worthless you keep +$165 (before fees). The most you can lose is $335."; "The stock is $1 above your $100 strike, about 0.1 expected moves"; the coin-flip sentence (decision 3); a footer "Estimate from implied volatility 45% and 31 days left. It cannot see sudden gaps or news. Not a forecast. The market price already reflects these odds, so the reason to close is your rule, not the odds. Your stop is unchanged."
- **A thin distance strip** (Diane) in the fold-out only: an SVG 236×46 showing the expected-move range as a neutral band, the stock as a dot and the strike as a dashed line; no probability bar; `aria-hidden` (the text rows carry the same facts) or `role="img"` with a full label. No color meaning.
- **The strike distance is shown in expected moves as a fraction** ("about 0.1 expected moves"), not only dollars.

**Rounding and honesty rules (Ian, Alan, Paul):** rounded to the nearest 5% ("over 95%", "under 5%" at the ends); the word "estimate" always; never bold or colored; never the words safe, likely to recover, should hold or unlikely; **unfavorable numbers show as readily as favorable ones** (it must appear at 35% as well as 65%, or it becomes cherry-picked reassurance); the volatility used is named.

**Where it shows.** **Only on "Hold with a loss":** a spread or an Income put, a loss of at least 25% of the credit (Ian confirms the threshold), above the stop, more than 21 days left. **In the fold-out only** on the time-limit state with no roll (G1). **Never** on: stop reached, Income put at the stop, "Loss limit reached", at maximum loss, "Stock has weakened", the time-limit winner, "Consider rolling" (Part A carries it), an Acquire or Wheel put, a bought option, take profit, or any expires-soon state. A state that says close cannot carry a reason to hold. **First surfaces (Paul):** the close order window (the batch dialog's Close Only mode) and the Positions row detail, the moment of the click, neither of which DECIDE-0001 S3-B rebuilds; the recommendation cell mounts the same component in S3-B. The close window also shows DECIDE-0001's line "Your stop is $3.30; it is at $2.20. Not reached." from existing stop data (Quinn confirms the data is available there). Until S3-B, B2 uses the live recommendation labels; Quinn provides the mapping table from the live labels to DECIDE-0001's state letters.

**Hidden states (exact text, fold-out only; the cell shows nothing):** "Odds unavailable: volatility missing." / "…: price missing." / "…: expires today." / "…: earnings Oct 22 fall before expiry, so the estimate is unreliable." It never shows "unknown, so 50%". Also hidden for: a bought option, a net-debit or unsupported-economics position (today `popVsStrike` is nulled when `entryEconomicsComplete` is false or it is a net debit, `acquisition.ts:2115-2122`), an ex-dividend date inside the window with a short call near the money.

**Where the number comes from (already in the app) and what it really is (Alan).** `calcPositionPopVsStrike` (`lib/portfolio/positionMetrics.ts:419`) is the **risk-neutral lognormal probability that the stock finishes beyond the short strike at expiry** (zero carry, log drift −σ²/2, `d2 = (ln(S/K) − 0.5σ²t)/(σ√t)`, σ = IV/100, t = DTE/365). It is not "will price ever touch my strike": the comment saying so is wrong in **four places** (`positionMetrics.ts:412-418`, `PositionsWorkspace.tsx:726`, `acquisition.ts:2116-2121`, `types.ts:156-158`) and is corrected (comment only, zero risk); the Risk view's "Strike" row is relabeled "Finishes beyond strike". An iron condor is the probability of finishing between both short strikes, `P(above put) + P(below call) − 1`, which is exact (not an independence assumption; a product would be wrong): 560/590 at stock 574, IV 30%, 19 days: 29.65%.

**Facts the build must respect.**

1. **Volatility (Quinn, Alan, Ian).** Today the value is the **underlying's 30-day implied volatility, rounded to a whole percent** (`ivMap[symbol]`, `acquisition.ts:1441-1442`, `:2122`), not the short leg's and not matched to the expiry. **One IV feeds both the odds and the expected move**, so the screen never shows two volatilities: prefer the expiry-matched IVx if present, then the short leg's IV (for put spreads the plain model overstates the chance of expiring worthless because out-of-the-money puts trade at higher volatility), then the underlying's 30-day IV, labeled "30-day IV". Alan checks the fraction-or-percent guard at `acquisition.ts:1442`.
2. **Days to expiry (Quinn).** DTE is `Math.round` of a UTC-midnight difference (`acquisition.ts:1823`), so it reads 0 from about noon New York time the day before expiry. On DTE 0 the line says "expires today" rather than disappearing; the shared DTE is not changed (Alan and Ian decide whether this line alone uses a New York DTE).
3. **A model, not a forecast.** It ignores gaps (a 10% earnings drop takes a $574 stock to $516.6, below a $570 strike), fat tails and skew, and it is effectively risk-neutral: it cannot show an edge, because the market price already reflects these odds. Dean's real edge is the volatility premium and his discipline.
4. **The stop is a risk limit, not a forecast.** When a stop or maximum-loss state is met the state says so and no odds line appears at all.

**Not built (and why).** *No touch percentage in version 1* (Paul, Ian, Quinn; Alan's numbers: at stock 574, strike 570, IV 30%, 19 days, finish-beyond 47.3% and touch 92.2%, which reads as panic; "about double" holds only well out of the money; it is capped at 100%; iron condors need their own formula). *No break-even or expected-value comparison* (Ian, Alan: "you need 58% to hold" is pro-close by construction and flips on a one-point input change, and it uses −$335, which is not Dean's rule). *No two-step or paused close, no Close cooldown, no journal prompt* (Paul: friction and a gate on the order path; Dean asked for calm). Ian's separate idea of a "you are closing before your plan" note in the close dialog overlaps the DECIDE-0001D log and is not in this ticket.

## Slices (each ships alone, each needs approval; Paul)

| Slice | What Dean sees | Order |
|---|---|---|
| **A1** Roll explanation on the roll candidate cards and the roll suggestion detail | The lines above before clicking Roll, only when the old position is at a loss | After DECIDE-0001 S3-0c, sequenced one at a time on `page.tsx` (working-file rule); before S0 |
| **A2** The same text in the recommendation cell's fold-out for the roll state | The same six lines in the calm cell | With DECIDE-0001 S3-B |
| **B1** Pure functions and tests, comment fixes | Nothing on screen | Any time after S3-0a (no shared files) |
| **B2** Odds line in the close order window and the Positions row detail | The note and fold-out on "Hold with a loss" | After B1 and S3-0c |
| **B3** Mount in the calm cell | The same component in the cell | With DECIDE-0001 S3-B |

## Files (Quinn)

New: `lib/portfolio/rollExplanation.ts` and its test; `lib/portfolio/keepCreditOdds.ts` (wraps `calcPositionPopVsStrike`, rounding, the show and hide rules, the wording) and its test; no new probability math in `positionMetrics.ts`, whose existing `calcPositionPop` and `calcPositionPopVsStrike` tests stay unchanged (add an iron-condor test for `calcPositionPopVsStrike` if none exists). Comment-only edits in the four places above. `page.tsx` gets wiring only. **Sibling paths to check:** the single-suggestion path `fetchRollSuggestion` (`page.tsx:1359`) versus `findRollCandidates` (`:~582`, BPS and BCS only); the manual-entry roll form and its "1/3 rule" text (`:~4370`); CC and CSP roll suggestions from the engine; the iron-condor roll (4 legs); the Risk view POP column (left as is); Today's Priorities and the briefing (they read the same recommendation); `pop` in snapshots and `page.tsx:9492`. Tests that must not break: `PositionsWorkspace.test.tsx:105-112` (Close and Roll button names: a new toggle must not be named "Roll Position" or "Close Position"), `:87`, `:195`, `model.test.ts:~144` (do not add a column).

## Follow-ups

- **KEEP-CREDIT-0002 (Paul; after DECIDE-0001 S0 and 0001D):** a read-only hindsight review of Dean's own closed spreads: for each close, the price at close, the price at expiry, whether it would have expired worthless, and what the model said at the moment of close. Reports calibration in plain words ("When the model said 60 to 80%, about 71% actually expired worthless: 34 trades, plus or minus 15 points"), compared with the short delta's own estimate. **The odds line makes no accuracy claim until this review has at least 100 trades in total and at least 30 per bucket** (Alan: 30 trades gives a margin of about ±16 points; only 52 spreads exist today and not all will have an expiry price; overlapping trades reduce the effective sample). Alan owns the method. The touch probability is reconsidered here.
- **KEEP-CREDIT-0003 (parked):** a "nothing has changed since you entered" comparison; needs entry snapshots (started 2026-09-25) and the entry stock price.

## Non-goals

No change to any rule, threshold, stop, gate, action or candidate list. Not a gate, score input or ranking input. No prediction claims. No probability for bought options. No new data source. No AI text. No touch percentage, no break-even or expected-value figure, no two-step close, no Close cooldown, no journal prompt.

## Acceptance criteria

1. The chance to keep the whole credit equals `calcPositionPopVsStrike` (an iron condor between both strikes), then rounded to the nearest 5% for display, with "over 95%" and "under 5%" at the ends, always labeled "estimate", and it names the volatility used. Unfavorable values display as readily as favorable ones.
2. The odds line is hidden, with one of the four exact strings, when volatility, price or DTE is missing or zero, on expiry day, or when earnings fall before expiry; never "unknown, so 50%".
3. It appears **only** on "Hold with a loss" (fold-out only on the no-roll time-limit state) and never on the states listed under "Where it shows".
4. Part A: every line **foots** (close cost, open credit, fees, net), for a same-width roll and a wider roll, per share and per contract, fees included, each price labeled (closing mid, 85% limit); it shows only when the old position is at a loss; it states the truth on a candidate below the $0.10-after-fees rule without changing which candidates appear.
5. The note is ≤ 72 characters; everything else is in the fold-out; no red; the note is never bold or colored; DECIDE-0001's tap-to-explain terms include "estimate", "expected move", "implied volatility" and "finishing" (24px minimum hit area, announced through the page status region).
6. The distance strip has an `aria-hidden` or `aria-label` equivalent and no color meaning.
7. The four wrong "touch" comments are corrected; the Risk view row is relabeled "Finishes beyond strike".
8. Verification: `tsc` with `tsconfig.check.json`, the new tests plus the existing roll and PositionsWorkspace tests, the full suite (the roll and order path), and a real `next build`; never claim the build ran until Vercel reports it.

## Golden fixtures (Alan; verified in python3, finishing probability out of the money = "keep the credit")

| Case | Inputs | Finish OTM % |
|---|---|---|
| Put base | stock 574, short strike 570, 19 days, IV 30% | 52.709 (about 55% displayed) |
| Put far | stock 590, same | **68.069** (the earlier "92%" was wrong; 92% needs a stock price near $629) |
| Put at strike | stock 570 | 48.635 |
| Put already in the money | stock 560 | 38.483 (line hidden or reworded) |
| Put low and high IV | stock 574, IV 20% / 50% | 55.189 / 50.170 |
| Put, 60 days | stock 574, IV 30% | 49.867 |
| Call mirror | stock 574, short call 590 | 66.854 |
| Iron condor | stock 574, 560/590, IV 30%, 19 days | 29.653 |
| Expected move | 574 × 0.30 × √(19/365) | 39.29 |
| Hidden | DTE 0; IV missing or 0; price missing; earnings before expiry; a bought option or net debit | hidden with the stated reason |
| Roll | close $2.10, open $2.28, fees $0.04: net $0.14; max loss $321 (was $335); breakeven $566.21 (was $568.35); wider roll (10-wide): max loss $821; net below $0.10: stated plainly | per DECIDE-0001 formulas |

The touch fixtures (Alan's T1 to T8) are recorded for KEEP-CREDIT-0002 and not built in version 1.

## Who reviews what

| Who | What | Status |
|---|---|---|
| **Dean** | The five decisions at the top; approve the mock | Waiting |
| **Ian** | Reviewed draft 1: state list, wording, stop distance; confirms the 25% threshold and the rounding | Done; threshold to confirm |
| **Alan** | Reviewed draft 1: formulas, fixtures, IV, calibration; verifies the mock's rounded numbers (the NVDA case has no inputs) | Done; verification of the mock's numbers remains |
| **Quinn** | Reviewed draft 1: roll flow, data, files, risks; confirms the stop data in the close window and the live-label mapping | Done; two confirmations remain |
| **Paul** | Reviewed draft 1: scope and slices adopted above | Done |
| **Diane** | Reviewed draft 1: note, fold-out, strip, Part A layout; the rendered mock follows her spec | Done |
| **Dane (developer)** | Pre-development review of draft 2; runs last | Started after this draft |
