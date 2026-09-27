# DECIDE-0001 — O12 rulings (Ian)

> **SUPERSEDED (2026-09-27).** This record came from a parallel session and conflicts with the ticket on `main` (revision 7). Revision 7 is the only source of truth. Do not build from this file. Anything it had that revision 7 lacked was carried into the ticket (Phase 0 entry-date finding, and open item O25).

**Ruled 2026-09-27.** This closes O12 in DECIDE-0001 revision 3 and unblocks slice S2 (the B1 shadow evaluator). All tests use integer math, per the ticket's conventions. Alan to confirm the fixtures below.

## 1. Support-break confidence

A close just under support on barely enough volume is the classic false breakdown, so either condition near its edge makes the signal LOW. Otherwise it is HIGH.

| Value | Fires (unchanged) | LOW when | Integer test for LOW |
|---|---|---|---|
| Distance below support | `c < 0.99·S` | the close is less than one more percent below the trigger (`c ≥ 0.9801·S`) | `c_c·10000 ≥ 9801·S_c` |
| Volume ratio | `v ≥ 1.5 ×` prior-20 average | ratio below 1.65 (the 10% band) | `400·v[n] < 33·Σ v[n−20..n−1]` |

Relative weakness can still lift LOW to MEDIUM, as the ticket already says.

## 2. Does a fired gap clear on recovery?

**Yes, with confirmation.** A fired failed gap clears when either of these happens:
- **two consecutive completed closes are at or above `R`** (the half-gap level), or
- **any completed close is at or above `C[g−1]`**, the close before the gap (the gap is fully filled).

A single close above `R` does **not** clear it; that is the same one-day noise the trend rule already guards against. The signal also drops out naturally once `g` leaves the 20-session window.

This replaces the interim rule in the ticket ("clears when `c[n] ≥ R`").

## 3. Does an unreachable stop need another protection?

**No.** The stop fires at a mark of `2·C`, which is a loss of `1·C`. The stop is unreachable when `2·C ≥ width`. In that case the most the spread can ever lose is `width − C ≤ C`, which is **no more than the loss the stop would have allowed**. Defined risk already caps the position at or below the stop.

- For an IC, check each wing separately, as the ticket already does: a wing is flagged when `2·C ≥` that wing's width, and that wing's max loss is `wing width − C ≤ C`.
- Keep the amber context line ("Stop cannot trigger; max loss is $X per contract"). The broken-stock, 21-DTE and delta rules still apply.
- A credit of half the width or more means a near-the-money entry. Whether the scanner should warn about that at entry is a separate scan-qualification question. It is not part of this ticket.

## Fixtures for Alan

**Support distance** (`S = $100.00`, trigger `$99.00`):

| Close | Result |
|---|---|
| $99.00 | no fire |
| $98.99 | fires, LOW |
| $98.01 | fires, LOW (boundary) |
| $98.00 | fires, HIGH |

**Volume ratio:**

| Ratio | Result |
|---|---|
| 1.49 | no fire |
| 1.50 | fires, LOW |
| 1.6499 | fires, LOW |
| 1.65 | fires, HIGH |

A support break is LOW if either the distance or the volume ratio is LOW.

**Gap clearing** (`C[g−1] = 100`, `O[g] = 90`, `R = 95`):

| Closes after firing | State |
|---|---|
| one close at 95.00, then 94.99 | still fired |
| 95.00, then 95.00 | clear |
| a single close at 100.00 | clear (gap filled) |
| 99.99 | still fired |

**Unreachable stop:**

| Position | Max loss | Stop loss | Protection needed |
|---|---|---|---|
| 5-wide, C = $2.50 | $250 | $250 | none (equal) |
| 5-wide, C = $2.55 | $245 | $255 | none (max loss is lower) |
| IC, put wing 5, call wing 10, C = $3.00 | put wing $200; call wing $700 | put wing flagged (6 ≥ 5); call wing reachable (6 < 10) | none: the put wing's $200 is below the $300 stop loss |
