# EARNINGS-MARGIN-0001 — One earnings buffer after expiry across Ranked, Targeted, CC, CSP and PMCC

## Status

**Decided 2026-09-25 (Ian and Paul lenses, accepted by Dean): CSP and covered call first (phase 1), then Ranked spreads and PMCC (phase 2). Buffer fixed at 10 days for now; a scan control (0 = off) is a later follow-up. Not built.** Split out of `SCAN-EARNINGS-TARGETED-0001` on 2026-09-25.

## Problem

`SCAN-EARNINGS-TARGETED-0001` made Targeted (strict) scans require earnings to fall at least 10 calendar days after a trade's expiration, because upstream earnings dates are estimates that can be wrong by a week or more (TastyTrade showed MSFT, META and GOOGL a week later than FMP; all 18 symbols carry `estimated: false`; Google shows AMD's Nov 3 as unconfirmed). Ranked, covered call, CSP and PMCC still treat earnings one day after expiry as safe (zero margin), so the same trade can pass in one scan and fail in another.

## Proposal (for ruling)

- Use one named rule, "Earnings buffer after expiry: 10 days", shared by Ranked, Targeted, CC, CSP and PMCC. The shared function `earningsOnOrBeforeExpiration(earnings, expiry, asOf, minDaysAfterExpiry)` already takes the margin (default 1, meaning on or before expiry); callers pass `STRICT_EARNINGS_MIN_DAYS_AFTER_EXPIRY` to opt in.
- Roll out CSP first (undefined risk), then covered call, then PMCC and Ranked (Ian).
- Show the rule in each Active Rules panel and make it adjustable later (0 = off) so traders tune it in scan controls (Ian, "trust the qualified realm").

## Effect

Tightens those scans versus today: about 10 days of each roughly 90-day earnings cycle stop qualifying for a given symbol. Ranked currently only warns on earnings inside expiry, so the margin zone should get the same treatment as inside-expiry (warn in Rank mode, fail in strict).

## Decisions

- Rollout order: CSP, then covered call (phase 1); Ranked spreads and PMCC (phase 2).
- The buffer is fixed at 10 days for now, shown in each Active Rules panel as "Earnings buffer after expiry: 10 days". An adjustable control is a separate later ticket.
- Ranked currently only warns on earnings inside expiry; the buffer zone gets the same treatment as inside-expiry (warn in Rank mode, fail in strict).
- Rules-panel copy is small display text; Diane's lens applies inline, no separate mock.

## Not in this ticket

The 21-DTE management-date cutoff, the FMP plan gap, and the stale past-date handling (MRVL, ORCL); see the follow-ups in `SCAN-EARNINGS-TARGETED-0001`.
