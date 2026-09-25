# EARNINGS-MARGIN-0001 — One earnings buffer after expiry across Ranked, Targeted, CC, CSP and PMCC

## Status

**Decided 2026-09-25 (Ian and Paul lenses, accepted by Dean): CSP and covered call first (phase 1), then Ranked spreads and PMCC (phase 2). Buffer fixed at 10 days for now; a scan control (0 = off) is a later follow-up. **Phase 1 (CSP and covered call) and phase 2a (Ranked spreads) built 2026-09-25 and pushed to `main`. Phase 2b (PMCC): decided 2026-09-25 (Dean, option 1) to leave PMCC as designed. Ticket complete.** Split out of `SCAN-EARNINGS-TARGETED-0001` on 2026-09-25.

## Problem

`SCAN-EARNINGS-TARGETED-0001` made Targeted (strict) scans require earnings to fall at least 10 calendar days after a trade's expiration, because upstream earnings dates are estimates that can be wrong by a week or more (TastyTrade showed MSFT, META and GOOGL a week later than FMP; all 18 symbols carry `estimated: false`; Google shows AMD's Nov 3 as unconfirmed). Ranked, covered call, CSP and PMCC still treat earnings one day after expiry as safe (zero margin), so the same trade can pass in one scan and fail in another.

## Proposal (for ruling)

- Use one named rule, "Earnings buffer after expiry: 10 days", shared by Ranked, Targeted, CC, CSP and PMCC. The shared function `earningsOnOrBeforeExpiration(earnings, expiry, asOf, minDaysAfterExpiry)` already takes the margin (default 1, meaning on or before expiry); callers pass `EARNINGS_MIN_DAYS_AFTER_EXPIRY` to opt in.
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

## Phase 1 build notes (2026-09-25)

- `EARNINGS_MIN_DAYS_AFTER_EXPIRY = 10` (renamed from the Targeted-only name) in `lib/scans/earningsPrecheck.ts`; `evaluateEarningsPrecheck` takes an optional `minDaysAfterExpiry` (default 1).
- CSP: `earningsWithinCspExpiration` (`lib/scans/csp-finder.ts`) now returns true for earnings on or before expiry or within 10 days after it, so the same flag drives `DISQUALIFIED_EARNINGS`, the CSP score's event-risk component and the candidate check text.
- Covered call: `isEarningsSafeForExpiration` (`lib/scans/covered-call-finder.ts`) and the selected-contract check in `app/screener/page.tsx` use the buffer.
- Symbol-level advisory (both CSP and CC) uses the buffer, so "no eligible expiration" and "outside window" agree with the per-contract rule.
- Copy: CSP and CC registry entries, the candidate failure text (names the gap in days when earnings is after expiry), and the advisory text. Existing tests that encoded "day after expiry is clear" were updated to 10+ days; new tests pin the 1-9 day band.
- Still on the old rule (phase 2): Ranked spreads (checklist rank mode and `page.tsx:3888`), PMCC (`pmccScore`, `pmccReadiness`, `page.tsx:8217`, PMCC earnings removal). Portfolio position-management call sites are not scan qualification and are unchanged.

## Phase 2a build notes (2026-09-25): Ranked spreads

- `lib/scans/checklist.ts` per-trade re-check (rank mode) now treats earnings within 10 days after the trade's expiry like earnings inside it: status `warn` ("scored lower in rank mode"), which keeps the row from qualifying (the qualified flag needs earnings = pass), the same as inside-expiry today. Reason text names the gap: "Earnings 5d after this trade's 35d expiry, inside the 10-day buffer".
- Test `checklistEarningsBasis.test.ts` updated: 1 and 9 days after expiry warn; 10 days passes.
- Left unchanged on purpose: `page.tsx` `earningsWithinExpiry` (position-card advisory text about "this position's expiration window"), portfolio position-management call sites, and the `lib/screener.ts` duplicate (follow-up ticket).

## Phase 2b: PMCC (decided: leave as designed)

PMCC already has a designed earnings model (SCAN-ALIGN-0001D, Ian): earnings on or before the short call's expiry removes the call from results; earnings up to 5 NYSE business days after expiry is a **warning-only ambient tag that never affects qualification or ranking** (`lib/scans/earningsExpiryZone.ts`, `EARNINGS_AFTER_EXPIRY_WINDOW_BD = 5`, used by `pmccDecision.ts` and `pmccEarningsRemoval.ts`). A hard 10-day rule would reverse that ruling. Options:

1. Leave PMCC as designed (ambient tag, 5 business days).
2. Keep it ambient but widen the tag window to about 10 calendar days (7 business days), so the tag covers the observed date error.
3. Make the 10 days after expiry a removal like the on-or-before case, reversing the ambient-only ruling.

Other PMCC call sites still on the old one-day rule: `pmccScore.ts:83`, `pmccReadiness.ts:31`, `page.tsx` `pmccEarningsBlocksBestFit`.

**Decision (Dean, 2026-09-25): option 1.** PMCC keeps the SCAN-ALIGN-0001D model unchanged: earnings on or before the short call's expiry removes the call; earnings up to 5 NYSE business days after expiry is an ambient, warning-only tag that never affects qualification or ranking. Reason: a PMCC short call is covered by the long LEAP, so a gap through earnings costs less than on a CSP, and the existing tag already flags it. No PMCC code changes. Revisit only if the earnings-date accuracy problem shows up in PMCC results.

## CORRECTION (2026-09-25): phase 2a did not reach the main Ranked scan

Found while planning QUAL-STATES-0001. The main Ranked scan builds its rows in `exploreAllCandidatesForRank` (`lib/scans/rank-scoring.ts` ~396-560), which calls `runChecklist` in strict mode and then **recomputes earnings locally** with the old rule (`earnings <= dte` warns, otherwise passes; no 10-day buffer, old day-count basis). Phase 2a changed only the non-strict branch inside `checklist.ts`, which those rows do not use. A probe confirmed it: earnings 6 days after expiry shows "Outside this trade's 27d expiry" (pass) in the Ranked scan. So **Ranked spreads do not yet have the buffer.** Targeted (which uses `runChecklist` strict directly), CSP and covered call do. Fix is tracked in QUAL-STATES-0001 (phase 0).

