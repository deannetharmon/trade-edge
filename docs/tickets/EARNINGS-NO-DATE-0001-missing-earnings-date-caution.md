# EARNINGS-NO-DATE-0001 — Missing earnings date should show a caution, not pass silently

## Status

**Draft, from the `SCAN-ALIGN-0001` second review (Ian, 2026-09-24). Not approved, not built.** Needs Paul scope.

## Problem

With no earnings date on file, covered calls, CSP and PMCC all let the candidate through with no indication. Malformed dates (after `PMCC-EARNINGS-PAST-0001` normalization) are treated the same way.

## Scope (proposed)

- Do not exclude. Show a "no earnings date on file" caution tag (risk-context tier) on covered call, CSP and PMCC candidates.

## Non-goals

- Making a missing date a hard exclusion ("trust the qualified realm").

## Open questions

- Tag placement and copy. Diane.
