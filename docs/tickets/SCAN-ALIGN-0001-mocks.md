# SCAN-ALIGN-0001 mocks (Diane, 2026-09-24)

Draft mocks, not approved. Nothing here goes to code without approval from Ian, Paul and Dean. All three use the real scan theme: `ScanModalShell` with the amber accent, the Active rules receipt as an amber-bordered panel (`border-amber-500/30 bg-amber-500/5`) with a small uppercase heading, and amber warning tags.

Diane read `features/screener/components/PmccScanModal.tsx`, `lib/screener/scanConfig/ccRegistry.ts`, `lib/scans/pmccConfig.ts` and `features/screener/components/ActiveCcRules.tsx`. Tile names in Mock 3 are a proposal and were not checked against the results component.

## Where the real code differs from the ticket

1. **A PMCC short-delta control already exists.** `PmccScanModal` has `shortDeltaMin` and `shortDeltaMax`, labelled "Min Δ" and "Max Δ", validated 0.10–0.40, default 0.20–0.35. F1 is not a new control. It is preset chips (matching CC), hint text, a receipt row, and removal of the note "Delta guides rank; it does not hide an otherwise tradable short call." (false once F2 lands). The ticket's "missing control" framing should read "control exists but is not labelled as a rule and has no preset chips."
2. **CC labels.** Criterion "Delta range" (`DELTA_MIN`/`DELTA_MAX`, inputs "Min Δ"/"Max Δ"); presets `Δ .10–.20`, `Δ .20–.35`, `Δ .30–.40`; card "Search range". Bid/ask criterion "Max bid/ask width", key `BID_ASK_MAX`, unit "$ per share", presets $0.10/$0.20/$0.30, default 0.20.
3. **PMCC bid/ask is already a percent field.** Label "Max spread %", field `maxSpreadPct`, mapped to `qualifyingSpreadPctMax` (10). `acceptableSpreadPctMax` (5) is fixed and not exposed. The PMCC modal is a flat 3-column grid with no cards; the CC modal uses cards (Search range / Open interest / Always applied). The layouts are not identical yet; card grouping is a separate question.
4. **PMCC OI label** is "Short OI min" (`shortOiMin`); CC's is "OI min".
5. **Receipt.** CC's is `ActiveCcRules.tsx`, headed "Active CC rules". No PMCC equivalent was found, so the PMCC receipt rows assume the PMCC registry migration or a stopgap receipt.
6. The ticket's row 3 says "5 acceptable, 10 qualifying"; the user-facing PMCC field controls only the 10.

## Mock 1: PMCC short-delta control (F1) plus receipt row

**Tier:** delta range is decision; hint and receipt row are risk-context; bounds text is ambient.

```
PMCC SCAN                                             [x]
2 of 3 held LEAPS positions selected · configure short-call search
[AAPL] [UBER] [~~MSFT~~]

SHORT CALL SEARCH RANGE
 Min DTE [ 21 ]   Max DTE [ 45 ]
 Delta range (absolute)
   Min Δ [ 0.20 ]   Max Δ [ 0.35 ]
   [Δ .10–.20] [Δ .20–.35*] [Δ .30–.40]          * = active preset
 A hard limit: a short call outside this range is never a candidate.
 Allowed 0.10–0.40.

OPEN INTEREST
 Short OI min [ 100 ]   (see Mock 2 for the spread fields)

                              [Cancel]  [RUN PMCC SCAN →]
```

**Copy**
- Group label `Delta range`, unit line `absolute delta` (matches CC).
- Hint once F2 is built: `A hard limit for PMCC: a short call outside the range is never a candidate.`
- Hint while only F1 is built: `Guides rank. A short call outside the range is kept, with a warning.` The hint must match the engine; do not ship "hard limit" before F2.
- Invalid state, inline: `Delta must be between 0.10 and 0.40, and Min must not exceed Max.` Run is disabled, as today.
- Remove `Delta guides rank; it does not hide an otherwise tradable short call.` when F2 ships.

**Receipt row** ("Active PMCC rules", same panel as CC):
```
ACTIVE PMCC RULES
 Search    21–45 DTE · Δ 0.20–0.35 (hard)
```
`(hard)` appears only after F2; before F2 use `(preference)`. That makes the difference visible in the receipt, which the registry needs.

**Open questions**
1. Keep the flat grid on PMCC or move to CC's cards? Recommendation: cards, for identical layout.
2. Same three presets as CC? PMCC's default 0.20–0.35 equals CC's middle preset. Recommendation: yes.

## Mock 2: Hybrid bid/ask rule, identical on CC and PMCC

**Tier:** the two limit fields are decision; the "Wide spread 8.7%" tag and migration note are risk-context; formula hint and receipt row are ambient.

**Rule (Ian)**
- Reject if width > max($0.05, 10% of mid).
- Warn if width > max($0.05, 5% of mid).
- New absolute reject ceiling: width > ceiling per share. Default $0.60; Ian's range is $0.50–$0.75. **Ian to confirm the default.**
- No one-tick floor when mid < $0.10; below that, percent only.
- Compare in integer cents (Alan): `0.33 − 0.28` is `0.05000000000000004` in floating point.

**Layout** (same block in both modals, under Delta range):
```
BID/ASK SPREAD
 Max spread (% of mid) [ 10 ]     Max spread ($ per share) [ 0.60 ]
                                   [$0.50] [$0.60*] [$0.75]
 Rejects a call when its bid/ask width is over 10% of the mid, but never
 for less than $0.05 (one tick), and always over $0.60 per share.
 Calls with a mid under $0.10 have no one-tick allowance.
 Warns from 5%.
```

**Copy**
- Field 1: `Max spread (% of mid)`, title `Widest bid/ask spread, as a percent of the mid price`, unit `%`.
- Field 2: `Max spread ($ per share)`, title `Absolute ceiling on bid/ask width, in dollars per share`, unit `$ per share`.
- Hint (dynamic): `Rejects a call when its bid/ask width is over {pct}% of the mid, but never for less than $0.05 (one tick), and always over ${ceiling} per share. Calls with a mid under $0.10 have no one-tick allowance. Warns from 5%.`
- The label states the percent and the floor appears in the hint directly under it. If Dean wants the floor in the label: `Max spread (% of mid, $0.05 min)`.
- Validation: `Percent must be 1–100. Ceiling must be $0.05 or more.` Run disabled if invalid.

**Migration note.** One-time, dismissible, CC only, shown only when a saved `BID_ASK_MAX` exists.
```
+--------------------------------------------------------------+
| i  Bid/ask limit changed. Your saved $0.20 limit is no       |
|    longer used. Spread is now a percent of the mid, with a   |
|    $0.60 per-share ceiling. Review both.              [Got it]|
+--------------------------------------------------------------+
```
Neutral (`border-neutral-700`, not amber). Dismissal in localStorage, no auto-dismiss. PMCC gets no note: its percent carries over from `maxSpreadPct`, only the ceiling is new.

**Warning tag** (both scans): amber `Wide spread 8.7%`. Example: bid 2.20, ask 2.40, mid 2.30, width 0.20 = 8.7% of mid: over the 5% warn limit (0.115), under the 10% reject limit (0.23) and the ceiling, so the call is kept with the tag. Tooltip: `Bid/ask width $0.20 on a $2.30 mid. Warns above 5%, rejects above 10%.` No tag below 5% (no green pass).

**Receipt row**
```
 Spread    ≤ 10% of mid (min $0.05) · ceiling $0.60/share · warn from 5%
```

**Fixtures for Alan**

| Bid / ask | Mid | Width | % of mid | Result |
|---|---|---|---|---|
| 0.28 / 0.33 | 0.305 | 0.05 | 16.4% | Pass on the one-tick floor |
| 2.20 / 2.40 | 2.30 | 0.20 | 8.7% | Pass with `Wide spread 8.7%` |
| 5.75 / 6.25 | 6.00 | 0.50 | 8.3% | Warn; passes at a $0.50 ceiling (test is `>`) |
| 0.07 / 0.08 | 0.075 | 0.01 | 13.3% | Reject (mid under $0.10, percent only) |
| 8.00 / 9.00 | 8.50 | 1.00 | 11.8% | Reject, over 10% and over the ceiling |

**Open questions**
1. Default ceiling ($0.60, $0.50 or $0.75). Ian.
2. Is the 5% warn threshold user-editable? Recommendation: fixed, stated in the hint.
3. Under a $0.10 mid, percent-only rejects almost every real quote (one tick is at least 10%). Probably intended (no premium to sell); confirm.
4. PMCC uses the short-leg spread only; the long leg's spread is separate and unchanged.

## Mock 3: Held-LEAP zero-shorts empty state, plus flagged OTM LEAPs

**Rule.** A verified empty result opens the results modal with an in-modal banner. Cost basis unavailable is a technical failure and blocks before the modal with an error.

**Tier:** banner and action are decision; LEAP tiles and flag tag are risk-context; funnel line and collapsed detail are ambient.

```
PMCC RESULTS · UBER 2027-01 $60 Call (held)                    [x]
+----------------------------------------------------------------+
| ! No short calls qualified. Short delta removed the last 14.   |
|   [Adjust short delta]      [Show full breakdown v]            |
+----------------------------------------------------------------+
 LEAP     Strike   Delta   DTE   Avg open   Mark    Since open   Extrinsic
 tiles    $60      0.82    132   $18.40     $19.85  ▲ +$1.45     $0.90
 (stay)
 Hidden while there is no short: Net debit, Combined breakeven,
 Short credit, Max profit.
 [Show full breakdown v]  (collapsed)
   Considered 96 short calls in 21–45 DTE
   96 -> 88  spread    (8 over 10% of mid / $0.60)
   88 -> 71  open interest (17 under 100)
   71 -> 14  breakeven (57 at or below LEAP strike + your cost)
   14 ->  0  delta     (14 outside 0.20–0.35)   <- binding
   Earnings: not a factor
```

**Banner copy** (`amber-500/10` fill and border, as in the PMCC modal's existing exclusion banner)
- Body: `No short calls qualified against this LEAP. {Filter} removed the last {n}.`
- Primary action `Adjust short delta`: closes results, reopens the scan modal, focuses `Min Δ` (same reopen path as Active rules "Edit / Run Again").
- Secondary `Show full breakdown`: collapse toggle, collapsed by default.

| Binding filter | Banner message | Action |
|---|---|---|
| Delta | `Short delta removed the last {n}. No call fell inside Δ {min}–{max}.` | `Adjust short delta` |
| Open interest | `Open interest removed the last {n}. All were under {oi}.` | `Adjust short OI min` |
| Spread | `Bid/ask spread removed the last {n}. All were wider than {pct}% of mid or ${ceiling}.` | `Adjust max spread` |
| Breakeven | `Breakeven removed the last {n}. Each strike sits at or below your LEAP cost of ${be}.` | Info only (fixed rule) |
| Earnings | `Earnings on {date} removed the last {n}. Only calls expiring before it qualify.` | `Adjust DTE range` |
| Cost basis unavailable | Not a banner. Blocks before the modal: `Cost basis for {symbol} could not be read from your broker. Refresh Portfolio and try again.` | `Refresh Portfolio` |

"Binding" is the filter that removed the last surviving candidates in funnel order. If two remove the last ones in the same step, name the first in funnel order.

**LEAP tiles that stay:** Strike, Delta, DTE, Avg open price, Mark, Since open (▲/▼), Extrinsic remaining. **Hidden:** Net debit, Combined breakeven, Short credit, Max profit (all depend on a short). Proposal only; check against the real results component before build.

**Flagged OTM or lost-extrinsic LEAP** (Ian; `LONG_NOT_ITM` and `INVALID_EXTRINSIC`, `pmccPairing.ts:167,183`). A held LEAP must not silently drop. It shows as its own flagged card with no short search:
```
 UBER 2027-01 $60 Call (held)          [ LEAP now OTM ]  [ No extrinsic value ]
 LEAP     Strike   Delta   DTE   Avg open   Mark    Since open   Extrinsic
 tiles    $60      0.38    132   $18.40     $6.10   ▼ -$12.30    $6.10
 Not eligible for a PMCC scan: the LEAP is out of the money.
 No short calls were searched.                       [Why?]
```
- Tags: `LEAP now OTM` (`LONG_NOT_ITM`), `Extrinsic invalid` or `No extrinsic value` (`INVALID_EXTRINSIC`). Amber, risk-context weight: a state to see, not a decision.
- The card also appears in the position selection chips, with the tag. No `line-through` (that means "you deselected it").
- "Trust the qualified realm" still applies: the flag only stops a silent drop.

**Open questions**
1. Should a flagged LEAP be selectable for a scan? Recommendation: no; shown, not checked by default.
2. The funnel counts need a per-filter drop list from the engine. Pairing retains only qualified and near-miss pairs. Alan or Dane must check before committing to the breakdown copy.
3. Show `LEAP now OTM` always or only at DTE thresholds? Recommendation: always.
4. The breakeven funnel row assumes `PMCC-HELD-BREAKEVEN-0001` has landed.
