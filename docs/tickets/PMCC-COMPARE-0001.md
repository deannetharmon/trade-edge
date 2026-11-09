# PMCC-COMPARE-0001 -- Hold the LEAP, or sell a short call against it (S1: the compare card)

Dean (2026-11-09): UBER Sep 2027 $67.50 call, paid $21.30, now about $11.35. Compare keeping the LEAP alone with selling a short call.
Team ruling in project doc `claude/PMCC-COMPARE-0001.md`; S2 (Campaign ledger) and S3 (alerts) are separate slices.

## Built (S1)
- `lib/scans/pmccCompare.ts`: pure model. Profit and loss are against what you PAID (never today's value). Odds are model odds,
  1 - |short delta| (the same delta the card already shows as chance of assignment). Scenarios use Black-Scholes on the LEAP's own
  IV backed out of its current value (4% rate). Scenario rows: unchanged, up 5%, up 10%, and 10% past the highest strike offered.
- Choices: No call (never the default) plus up to three calls by delta: bullish (lowest delta / farthest strike), neutral, cautious.
  Default: bullish when the LEAP is below what you paid, neutral at or above.
- Minimum credit: 3% of the LEAP's value per 30 days; a call below it is flagged.
- `features/screener/components/HeldCompareCard.tsx`: one card per held LEAP above its short-call candidates (outside the candidate
  buttons). Shown only when the cost basis is usable. Required sentence: "Above this strike, additional stock gains are substantially
  offset until you close or roll the short call."
- `app/screener/page.tsx`: two insertions (qualified group, near-miss group). Display only: no gate, rank or order reads the compare.

## Corrected during the build
The approved mock's "Up 10% $84.70" row was the $77 strike plus 10%, not the stock plus 10% ($75.55). The model and card show both.

## Not in S1
Adjusted basis from realized credits (S2), after-execution tracking and alerts (S3), RSI/trend pre-selection (the card shows the
LEAP-vs-cost rule only; the RSI chip stays where it is).

## Tests
`lib/scans/__tests__/pmccCompare.test.ts` (UBER fixture, quantity, no-candidate, IV not solvable, other cycle, uncovered strike,
missing inputs) and `features/screener/components/__tests__/HeldCompareCard.test.tsx`.

## S1b -- one verdict, details behind a toggle (Dean, 2026-11-09)
Dean ran S1 on UBER: the scenario table was confusing (three near-identical rows, one extreme row) and the default call paid $1
against a $12 minimum. Changes:
- The default is never a call that fails the minimum credit. If none pays enough the verdict is "Don't sell a call right now."
  (best credit vs minimum, per contract). Otherwise: under water -> the farthest paying strike; at or above cost -> the middle one.
- The card leads with one verdict sentence and its reason; paid/worth, the choices, odds and the chart are behind "Show details".
- The scenario table is replaced by a payoff chart: profit or loss vs what you paid across stock prices at expiration, no call vs the
  selected call, with today's price and the strike marked.
