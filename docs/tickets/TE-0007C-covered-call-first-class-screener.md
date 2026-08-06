# TE-0007C — Covered Call as a First-Class Screener Strategy

**Branch:** `feature/te-0007c-covered-call-screener`
**Status:** Implemented (pure logic verified locally; screener wiring not yet
verified against a live TastyTrade account or `next build` — see
Implementation Report §"Validation gap").

## Objective

Add Covered Calls (CC) as a first-class Screener strategy, following the
established CSP pattern (TE-0007A), with one structural difference: CC's
scan universe comes from verified account holdings, not a free-form ticker
list, because CC eligibility depends on shares already owned.

See `docs/reviews/TE-0007C-Implementation-Report.md` for full details.
