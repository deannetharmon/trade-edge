# DECIDE-0001 — O10 mock approval record

> **SUPERSEDED (2026-09-27).** This record came from a parallel session and conflicts with the ticket on `main` (revision 7). Revision 7 is the only source of truth. Do not build from this file. Anything it had that revision 7 lacked was carried into the ticket (Phase 0 entry-date finding, and open item O25).

**Approved by Dean, 2026-09-27.** This closes open items O1 and O10 in DECIDE-0001 revision 3.

- **Mock:** `docs/tickets/mockups/decide-0001-recommendation-cards.html` (version 3)
- **Published at:** https://claude.ai/artifact/CAGCyoLor48eLM3ptX1k8Z
- **Spec:** Diane's G5 presentation spec in the ticket. The mock renders all ten states in the Position Analysis table.

## Ian's review, applied before approval

1. **Default-Acquire CSP.** The detail states that choosing Income when the mark is already past the stop immediately shows "Stop level reached".
2. **Covered call.** The value shows the call and the shares together with a net. The call's own P/L is neutral, not a warning color.
3. **Unreachable stop.** It is shown as an amber context line ("Stop cannot trigger; max loss is $X per contract") when 2× the credit is at or above the width.
4. **Roll.** The detail shows the net credit to date, the new breakeven and the new maximum loss next to the old values.
5. **Gated broken-stock close.** The detail says it fired because the position is at a loss, and that a winner would show Hold with the signal as a note.

## For the ticket owner

- Mark O1 and O10 **Done** in the ticket's open items.
- Add Ian's items 1 to 5 to the Presentation section as copy requirements. Item 2 changes the value column for covered calls, which is outside the recommendation cell.

**Still before S1:** Ian's O12, then Dane's pre-development review (G6).
