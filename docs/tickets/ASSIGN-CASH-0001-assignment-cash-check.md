# ASSIGN-CASH-0001 — Assignment cash check on the CSP ticket

Status: built, pending CI green and Vercel preview Ready on the pushed head. Frank closes the gate only after both.

## User story

As an options trader selling cash-secured puts, I want the ticket to show my total potential assignment obligation against my usable cash before I open or adjust a position, so I cannot unknowingly commit more capital than I can fund if multiple puts are assigned.

## Definitions

- Obligation per short put = strike x 100 x contracts. Not max risk. Premium is not netted (cash-balance already holds it). A long put is not netted against a short put on this ticket.
- Assignment cash after this trade = open short puts + working sell-to-open puts + the proposed order's puts - puts the order closes. Working closing orders are ignored until they fill, which is the conservative reading.
- Usable cash after reserve = `cash-balance` minus reserve (default 5% of cash, percent or fixed dollars, user-configurable). Same basis as CSP-COLLATERAL-0001.
- Funding surplus/shortfall = usable cash - assignment cash after this trade.
- Utilization = assignment cash after this trade / usable cash.

## Tiers

| Utilization | Behavior |
|---|---|
| under 70% | none |
| 70% to under 90% | strong warning banner |
| 90% to 100% inclusive | warning plus required acknowledgment checkbox |
| over 100% | Place blocked, exact shortfall shown. Override only with margin-backed assignment ON (off by default, own risk acknowledgment) plus a per-order borrowing confirmation |
| usable cash <= 0 | any new short put blocked |
| any source fails to load | "Cannot verify funding", Place blocked (fail closed) |

A trade that lowers the obligation is never blocked and needs no acknowledgment. The 90% acknowledgment start (instead of an exact 100% trigger) is Ian's ruling: an exact-100% trigger would almost never fire.

## Team decisions (Frank, 2026-11-05)

1. Usable cash is `cash-balance` minus reserve. No settled-cash field is read anywhere in the repo.
2. One pure module (`lib/scans/assignmentCash.ts`) is used by the panel and by the submit-time check in `refreshCapital`, which re-fetches cash, positions and working orders before every order, including each walk step.
3. Fail closed. A missing working-order quantity is never read as 1.
4. The ticket follows the sponsor's rule (full strike x 100 on every short put). The Portfolio "cash to deploy" tile still uses spread width plus credit; the two figures are labelled differently.
5. `guardCspOrder` (this order against min(option buying power, cash)) is unchanged and still runs first. The margin-backed override covers cumulative over-commitment; it does not lift that single-order cap (DR-0001).
6. Ian ratified: working orders count; no spread netting; acknowledgment from 90%; 5% default reserve.

## Files

- `lib/scans/assignmentCash.ts` (pure module), `assignmentCashLoader.ts` (fetch), `assignmentCashSettings.ts` (localStorage)
- `features/screener/components/AssignmentCashPanel.tsx`
- `app/screener/page.tsx`: CspTradeModal wiring only
- Tests: `lib/scans/__tests__/assignmentCash.test.ts` (34), `app/screener/__tests__/CspTradeModal.test.tsx` (+4)

## Known gaps and follow-ups (not blockers)

- Not yet wired: roll, close and partial-close tickets (Portfolio page, ExitWalkPanel, pending-order replacement, salvage), the spread TradeModal, Engine, Rinse-Repeat and Long Book order paths. The pure module already supports closes, rolls and `replacesOrderIds`; each ticket needs its own wiring slice.
- Settled vs unsettled cash: `cash-balance` may include unsettled proceeds. Needs a live payload check, then an exclusion if confirmed.
- Live field check outstanding (only Dean's authenticated session can do it): that `cash-balance` is returned as expected, and that sell-to-open put legs in `/orders/live` always carry leg quantity. Until confirmed, a missing quantity blocks the order.
- Paul to rule on unifying the Portfolio cash-to-deploy tile with this ticket's rule.
