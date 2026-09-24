# PMCC-EARNINGS-PAST-0001 — PMCC earnings warning fires on past earnings dates

## Status

**Logged; approved by Dean 2026-09-24. Not built.** Bug, **P2** (Ian). Found during the `SCAN-ALIGN-0001` review (slice B). **Must land before, or together with,** the `SCAN-ALIGN-0001` change that makes PMCC earnings a hard exclusion (slice D). Otherwise past dates will wrongly remove real candidates.

## Problem

`lib/scans/pmccDecision.ts:197` raises `EARNINGS_BEFORE_SHORT_EXPIRY` when `input.earningsDate <= pair.shortLeg.expiration`. That is a plain string comparison with two gaps:

1. **No lower bound.** An already-reported date is still `<=` expiry, so the warning fires (`"2026-08-01" <= "2026-10-16"`). TastyTrade's `expected-report-date` can stay stale after a report.
2. **No format check.** The string compare only works for zero-padded `YYYY-MM-DD`. A timestamp such as `"2026-10-16T20:00"` sorts after `"2026-10-16"`, so a report on expiry day is missed.

## User value

A false earnings warning on a PMCC teaches the trader to ignore it. Once earnings becomes a hard exclusion, the same bug would hide real candidates.

## Scope

- Condition: **`today <= earningsDate <= shortExpiration`**, comparing validated ISO dates, not day counts.
- `today` is the market's own date (US Eastern), taken from the same `asOf` the scan uses.
- Earnings dated today count as still upcoming (a same-day after-close report is a risk). This matches CC's existing rule (`isEarningsSafeForDte`, excluded when 0 ≤ d ≤ dte).
- Reuse the guard pattern already in `lib/scans/pmccLifecycle.ts:30` (`isDate` + `onOrBefore` + `>= today`).
- An invalid or unparseable earnings date is treated as no date on file.

## Non-goals

- Making PMCC earnings a hard exclusion (`SCAN-ALIGN-0001` slice D). Ian (2026-09-24): slice D is removal from results, like CC, not a DISQUALIFIED gate.
- The "no earnings date on file lets it through" gap in CC and CSP (a separate ticket, if Ian wants it).
- Don't reuse CC's `daysUntil`-based check with PMCC's `pmccDte`. The first uses local time and the second UTC, which is off by one after 8pm ET (Alan).

## Acceptance criteria

- A past earnings date produces no earnings gate.
- An earnings date on expiry day, or on today, produces the gate.
- A timestamp-form date is normalized or rejected, never silently compared as a string.

## Golden fixtures (Alan)

- **F5a:** asOf 2026-09-24, short expiry 2026-10-16. Earnings 2026-08-01 → no gate. Earnings 2026-10-16 → gate.
- **F5b:** asOf 2026-09-24T23:30 EDT (already 09-25 UTC), earnings = expiry → gate still fires.

## Validation

Tests on `pmccDecision` for the fixtures above, the existing PMCC decision tests, then a Vercel preview build.

## Rollout

Engine and gate only; no UI change. Before `SCAN-ALIGN-0001` slice D.
