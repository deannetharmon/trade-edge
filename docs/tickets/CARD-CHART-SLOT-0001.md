# CARD-CHART-SLOT-0001 -- the chart link is in the same place on every position card

Dean: the chart link was in three places (next to the price on option cards, in the bottom row on stock cards, and wrapped onto its
own line on LEAP/long-option cards once the strike, breakeven and chance chips went in). Chose option 1 (Diane/Ian recommendation).

## Rule
The first line of every card is `SYMBOL  BADGE  PRICE  chart`, on one line that never wraps.

## Built
- Option cards: ticker line is `flex-nowrap`. Cause of the wrap: the centre grid column (`auto`) grew with the three chips and squeezed
  the left column.
- Bought options (strike / breakeven / chance chips): the chip group now sits under the ticker line in the left column, so the centre
  column is only the note. A plain option card keeps its single distance chip in the centre as before.
- Stock cards: the chart link moved from the action row to the ticker line, beside the STOCK badge.
- Unchanged: the chart popup (fixed, anchored to the card, bottom aligned to the card bottom).

## Tests
LongOptionPath.test.tsx (LEAP and plain option card), StockCardRsi.test.tsx (stock card).
