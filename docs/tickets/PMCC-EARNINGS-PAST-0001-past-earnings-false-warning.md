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
- An invalid or unparseable earnings date is treated as no date on file (no gate).
- **Malformed `asOf` skips the lower bound only** (Dean, 2026-09-24; Ian's reading below): with `T` unknown the gate keeps today's behavior and fires when `E <= X`. **Malformed earnings is no date.** A missing or malformed short expiry `X` is out of scope: there is no upper bound to compare, so no gate.
- **Timestamp values** (Dean, 2026-09-24): for a well-formed ISO value take the leading calendar date, with no timezone conversion (`"2026-10-16T00:00:00Z"` gives 10-16). "Well-formed" means a full ISO-8601 datetime or a date-only string, and the date part must be a real calendar date. Anything else is malformed. **Two grammars (Alan, 2026-09-24):** for an earnings date, `YYYY-MM-DD` or `YYYY-MM-DDThh:mm[:ss[.f+]][Z|±hh:mm]`; for `asOf`, the same, except a datetime **requires** the zone. A space separator, a lowercase `t`, `24:00` and out-of-range hh/mm/ss are malformed in both. A zoneless timestamp such as `"2026-10-16T20:00"` is well-formed **as an earnings date**, because only its leading calendar date is used with no timezone conversion (B9); the same shape is unparseable **as `asOf`** (B25), because there the instant matters. Whitespace is not trimmed: `" 2026-10-16 "` is malformed (B10f).
- The gate's observed value carries the normalized date.
- **Requirement: strict date validator.** The build must validate ISO dates with a strict validator that rejects impossible calendar dates such as `2026-02-30` (regex alone is not enough; do not reuse `isDate` at `pmccLifecycle.ts:14` as-is, and do not rely on `new Date()` alone, which can roll an invalid date over). It applies to earnings dates, the timestamp prefix, `asOf` and the short expiry.

## Non-goals

- Making PMCC earnings a hard exclusion (`SCAN-ALIGN-0001` slice D). Ian (2026-09-24): slice D is removal from results, like CC, not a DISQUALIFIED gate.
- The "no earnings date on file lets it through" gap in CC and CSP (a separate ticket, if Ian wants it).
- Don't reuse CC's `daysUntil`-based check with PMCC's `pmccDte`. The first uses local time and the second UTC, which is off by one after 8pm ET (Alan).

## Acceptance criteria

- A past earnings date produces no earnings gate.
- An earnings date on expiry day, or on today, produces the gate.
- A well-formed timestamp-form date is normalized to its leading date; a malformed one is treated as no date. Neither is silently compared as a string.
- A missing or unparseable `asOf` skips the lower bound only.
- A missing or malformed short expiry `X` produces no gate (B27).
- `"2026-02-30"` and other impossible dates are rejected as malformed: as an earnings date, no date on file (no gate); as `asOf`, unparseable (lower bound skipped).

## Golden fixtures (Alan)

- **F5a:** asOf 2026-09-24, short expiry 2026-10-16. Earnings 2026-08-01 → no gate. Earnings 2026-10-16 → gate.
- **F5b:** asOf 2026-09-24T23:30:00-04:00 (23:30 EDT, already 09-25 UTC), earnings = expiry → gate still fires. (Use `-04:00` or a Z form; bare "EDT" is not ISO.)

### Case table (Alan, drafted 2026-09-24)

`T` = New York date from `asOf` via `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` (never local getters or `toISOString().slice`). Gate fires when `T <= E <= X`, all as `YYYY-MM-DD` strings. `X` = 2026-10-16 unless noted. Slice D's after-expiry warning is not part of B.

| # | asOf | Earnings | Expected |
|---|---|---|---|
| B1 | 2026-09-24T14:00Z (T 09-24) | 2026-08-01 | no gate (F5a) |
| B2 | same | 2026-09-23 (T−1) | no gate |
| B3 | same | 2026-09-24 (E = T) | gate |
| B4 | same | 2026-09-25 | gate |
| B5 | same | 2026-10-16 (E = X) | gate (F5a) |
| B6 | same | 2026-10-17 (X+1) | no gate |
| B7 | same | `null`, `undefined`, `""` | no gate |
| B8 | same | `"2026-9-24"`, `"10/16/2026"`, `"garbage"`, `"2026-02-30"` | no gate (malformed = no date) |
| B9 | same | `"2026-10-16T20:00"` | gate (normalized to 10-16; the old string compare missed it); the gate's observed value carries the normalized date |
| B10 | same | `"2026-09-23T20:00"` | no gate (normalized to 09-23) |
| B11 | 2026-09-25T03:30Z (09-24 23:30 EDT) | 2026-10-16 | gate (F5b) |
| B12 | same | 2026-09-24 | gate (T is 09-24; a UTC date of 09-25 would wrongly suppress it) |
| B13 | 2026-10-02T01:00Z (10-01 21:00 EDT) | 2026-10-01 | gate (still today in NY) |
| B14 | same | 2026-09-30 | no gate |
| B15 | 2026-11-02T04:30Z (11-01 23:30 EST), X 2026-11-20 | 2026-11-01 | gate |
| B16 | 2026-11-01T03:59Z (10-31 23:59 EDT), X 2026-11-20 | 2026-10-31 | gate (T 10-31) |
| B17 | 2026-11-01T04:00Z (11-01 00:00 EDT), X 2026-11-20 | 2026-10-31 | no gate (T 11-01) |
| B18 | 2026-11-01T05:30Z (01:30 EDT) and 2026-11-01T06:30Z (01:30 EST), X 2026-11-20 | 2026-11-01 | gate at both (T 11-01) |
| B19 | 2026-10-01T21:00:00-04:00 (same instant as B13) | 2026-10-01 | gate |
| B9b | same as B1 | `"2026-10-16T00:00:00Z"` | gate (prefix 10-16, no TZ shift) |
| B9c | same | `"2026-10-16T20:00:00-04:00"`, `"2026-10-16T23:30:00-05:00"` | gate (prefix 10-16 in both, no conversion) |
| B9d | same | `"2026-10-17T00:00:00Z"` | no gate (prefix 10-17 = X+1). Known limit of the prefix rule: in UTC terms this may be a 10-16 evening report |
| B10b | same | `"2026-09-23T23:59:59Z"` | no gate |
| B10c | same | `"2026-09-24T00:00:00Z"` | gate (E = T by prefix) |
| B10d | same | `"2026-02-30T20:00"` | no gate (malformed date part; validate the calendar, not just a regex) |
| B10e | same | `"2026-10-16Tgarbage"` | no gate (malformed time part; a loose prefix regex would wrongly gate) |
| B10f | same | `" 2026-10-16 "` | no gate (malformed: no trimming, Ian 2026-09-24; differs from the cost-basis parser in ticket A, which trims) |
| B10g | same | a number, a `Date` object | no gate |
| B20a | `null`, `undefined`, `""` | 2026-08-01, X 10-16 | gate (lower bound skipped, `E <= X` only) |
| B20b | unparseable (`"garbage"`) | 2026-08-01, X 10-16 | gate |
| B20c | missing or unparseable | 2026-10-17 (X+1) | no gate (upper bound still applies) |
| B20d | missing or unparseable | `null` or malformed | no gate (earnings rules win) |
| B21 | date-only `"2026-09-24"` | 2026-09-23 → no gate; 2026-09-24 → gate | T = 09-24, already a NY calendar date, no conversion. A `Date` parse would read UTC midnight as 09-23 in NY, which is wrong |
| B22 | `"2026-09-24T23:30:00-04:00"` | 2026-09-24 | gate (T 09-24). B22 is the offset-form twin of B11; B19 is the offset-form twin of B13 |
| B23 | non-ISO (`"Sept 24 2026"`, `"09/24/2026"`, `"2026-09-24T23:30 EDT"`) | 2026-08-01 | gate (unparseable `asOf`; bare "EDT" is not ISO) |
| B24 | n/a | | Input type pinned to `string` (open item 4), so no `Date` variant is tested |
| B27 | any valid | X = `null`, `""` or `"2026-02-30"`, earnings 2026-10-01 | no gate (no valid upper bound) |
| B28 | validator boundaries | `2028-02-29` valid → gate when `T <= E <= X`; `2026-02-29`, `2026-04-31`, `2026-13-01`, `2026-00-10` rejected as malformed | no gate (as an earnings date) |
| B25 | `"2026-09-24T14:00"` (no zone) | 2026-08-01 | gate (unparseable: T is unknowable across host zones; pinned, Ian 2026-09-24) |
| B26 | `"2026-02-30T14:00Z"` | 2026-08-01 | gate (unparseable; `new Date()` may roll it over, so validate the calendar, not just `isNaN`) |

Run the whole suite under both `TZ=UTC` and `TZ=America/Los_Angeles` with identical results. B13, B15 and B16 discriminate a UTC or local-date implementation.

### Findings and open items (Alan)

1. **Not a one-line change.** `asOf` is not an input to `evaluatePmccDecision` (`{pair, criteria, marketSession, trendAgainst?, earningsDate?}`). The caller `resultForPair` (`pmccProduction.ts:152`) has `session.asOf` (a string from `snapshot.asOf`), so B adds a new input field threaded from that call.
2. **Invalid or missing `asOf` (B20a-d): decided (Dean, 2026-09-24).** The warning keeps firing (lower bound skipped, `E <= X` only).
3. **Timestamp handling: decided (Dean, 2026-09-24).** Leading calendar date for well-formed ISO strings, no timezone conversion; malformed is unparseable.
   - **Ian's reading of "malformed fires" (2026-09-24), accepted by Dean 2026-09-24:** Dean's wording "anything malformed is treated as unparseable and the warning still fires" applies to `asOf` only. A malformed **earnings** date stays "no date on file" (B7, B8, B10d, B10e, B10g: no gate). Firing on a junk earnings field would warn on every candidate with a bad value and, once slice D makes earnings a removal, would delete good candidates. `EARNINGS-NO-DATE-0001` owns that gap.
4. **Input type: pinned.** The new input is a `string` (`session.asOf` is a string). `derivePmccMarketSession` takes a `Date`; the build must not accept both.
5. **Calendar validity:** `"2026-02-30"` needs a real validity check, not just a regex. **`isDate` at `pmccLifecycle.ts:14` is regex-only (`/^\d{4}-\d{2}-\d{2}$/`) and accepts `"2026-02-30"`, so it must not be reused as-is.** Build a strict validator (or tighten it, checking the lifecycle callers).

6. **Build condition (Ian, final review 2026-09-24):** before build, confirm the real shape of the earnings value that reaches `resultForPair` (from a real payload or existing fixtures) and add one golden fixture using that exact string, expecting the gate to fire when `T <= E <= X`. TastyTrade's `expected-report-date` is believed to be date-only `YYYY-MM-DD` (not verified). A space-separated stamp, a lowercase `t` or `z`, or padded whitespace would be dropped as malformed and suppress a real warning: if any such shape turns up, widen the grammar or normalize it upstream. Do not suppress the gate, and do not add a junk-value warning here (`EARNINGS-NO-DATE-0001` owns that gap).

### Ian's review (2026-09-24): approve with changes, changes applied

The `T <= E <= X` rule, E = T counting as upcoming (a same-day after-close report is a real short-call risk; matches CC), the NY-date derivation and the DST rows are sound. The prefix rule errs toward the warning near boundaries; do not add timezone conversion, which would reintroduce host dependence.

## Validation

Tests on `pmccDecision` for the fixtures above, the existing PMCC decision tests, then a Vercel preview build.

## Rollout

Engine and gate only; no UI change. Before `SCAN-ALIGN-0001` slice D.
