# CLOSE-OVERRIDE-INTENT-0001 -- editing a profit target disabled Submit

Dean (2026-11-09): in "Review 1 order" for a TQQQ covered-call Set Profit Target, any edit to the % or the limit price grayed out Submit until he cancelled and reopened.

Cause: the order is built with intent PROFIT_TARGET (a resting GTC limit, exempt from the marketable-price drift rule). The edit path re-ran the safety gate with intent hard-coded to CUSTOM, so the $0.76 target was compared with the $1.43 marketable ask, tripped MATERIAL_PNL_DEVIATION, and disabled Submit. The red reason was not visible because the card showed the original, pre-edit check.

Fix (app/portfolio/page.tsx): the edit re-check derives intent from the item's action, same as at submit time; the card shows the re-checked issues.
Test: closeOrderSafety.test.ts (PROFIT_TARGET passes, CUSTOM trips the drift check).
Not changed: the gate itself.
