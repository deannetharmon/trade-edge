# LEAPS-LEDGER-0001 — Decision history for held LEAPS (what the card said, what you did)

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-LEDGER-0001-implementation-report.md)
**Follows:** LEAPS-MANDATE-0001 (rule changes already write to this ledger), LEAPS-ENTRY-0001

## Problem

The Positions card gives a verdict and you act on it, but nothing kept a record of either. There was no way to look back and see what the card said before you sold a call, what you actually did, or when you changed your rules.

## Scope

Uses the **existing append-only ledger** (`persistence/repository.ts`: immutable events, idempotent by request id, one list per user + broker account + LEAPS); nothing new is stored elsewhere. The list is capped at the newest 1,000 events.

1. **What the card said** (`decision-evaluated`, *reported by your browser*): when the state or its reason **changes** (Review income call, Monitor, Hold uncovered, Reassess thesis) — with the candidate (strike, expiry, credit, delta), the stock price, the red/amber reasons, and the rules in force. Recorded only once the inputs that decide the state have loaded, only when a live candidate or a rule gate exists, and by the server only if the state or reason differs from the last recorded one **and** at least 30 minutes have passed.
2. **What you did**
   - Orders the broker accepted (`user-decision`, *recorded by the server*): bought this LEAPS, opened a PMCC pair, sold a short call — written right after the entry record from LEAPS-ENTRY-0001, with the same failure isolation (best-effort, 2-second limit, cannot change the order). The event id is derived from the broker order id, so a repeat is a no-op.
   - Opening the PMCC review (*reported by your browser*): recorded once per five minutes at most.
3. **Rule changes** already in the ledger (`mandate-changed`) appear in the same list.
4. **Decision history view** on both Positions cards ("Show decision history", loaded on click): newest first, each line says what happened and who recorded it (the server, your browser, or your saved rules).
5. **API** `/api/leaps-ledger`: `GET` (your own ledger only; decisions, evaluations and rule changes); `POST` accepts **only** a card evaluation or "opened the review". Orders and rule changes can never be written through it — only the server writes those. Every browser event is validated field by field (allowed states, bounded text, at most six callouts, positive prices), stripped of unknown fields, and marked client-attested.

## Non-goals

- No outcome events: how a cycle ended is shown by the Income history (from the Trade Log), not duplicated here.
- Closes and rolls placed elsewhere in the app are not recorded here (their routes are separate and were not touched).
- A state change that happens inside the 30-minute window is not recorded on its own; the next state change after the window, or the next time the card loads, records the current state.
- The browser-reported lines are a personal log, not proof; that is stated on each line.

## Acceptance criteria

1. Validation (every accepted shape and every rejection, exact limits), the evaluation and opened-review throttles (including the boundary minute), the order-event builder (each kind, request id derivation), and the plain-English descriptions are unit-tested.
2. The route tests prove: session required; user-scoped reads and writes (a `userId` in the request is ignored); other event types and every order action are rejected without writing; throttled events return `skipped`; storage failures leak no detail.
3. The capture wrapper tests prove: an accepted order appends one server-attested decision with the right identity and request id; duplicates append nothing; a ledger failure never changes the outcome; the same timeout covers it.
4. Existing tests are unchanged.

## Rollout notes

No flag or environment variable (existing Redis). Rollback is a revert; existing events simply stop being read.
