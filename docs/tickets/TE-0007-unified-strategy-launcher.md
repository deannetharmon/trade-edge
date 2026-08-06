# TE-0007 — Unified Screener Launcher: One Opportunity Universe, Strategy-Specific Scan Actions

## Problem

Before this ticket, the Screener sidebar had three independent ticker inputs: the general/primary watchlist (used by BPS/BCS/IC spread scans), a free-form CSP ticker box, and a free-form PMCC ticker box. Each held its own state and its own `localStorage` key. A ticker typed into one box had no relationship to the others, and there was no single answer to "which companies am I willing to evaluate."

## Goal

Replace the separate CSP and PMCC ticker boxes with one canonical **Opportunity Universe** ticker list. The universe answers "which companies am I willing to evaluate"; the strategy launcher buttons answer "which strategy should TradeEdge evaluate for those companies."

```
OPPORTUNITY UNIVERSE
[NVDA, MU, NKE, AAPL...]
[Find Spreads] [Find CSPs] [Find Covered Calls] [Find PMCCs] [Find LEAPS — Coming Soon]
```

CSP is never labeled "Bull Puts" (confusable with bull put spreads) — the button reads "Find CSPs" / "Cash-Secured Puts".

## Objectives

- One canonical ticker-list state; one canonical persisted ticker universe.
- Separate strategy scan actions — no shared "scan everything" button.
- No duplicated PMCC/CSP ticker storage.
- No change to underlying financial calculations, qualification thresholds, or scoring.
- No live order execution changes.
- Covered Calls remain impossible without verified share coverage.
- Standalone LEAPS remains explicitly unavailable until its own strategy specification exists.

## Canonical universe

Conceptually `opportunityUniverse: string[]`: symbols normalized to uppercase, trimmed, deduplicated, invalid/empty entries rejected, deterministic input order preserved. Persisted to one new `localStorage` key. All new-capital strategy buttons read this same normalized array.

## Migration

`opportunityUniverse` = ordered unique union of (1) existing primary Screener tickers, (2) existing CSP tickers, (3) existing PMCC tickers. Runs once — only when the canonical key doesn't already exist. Never silently discards a saved ticker. Legacy keys remain readable during a compatibility period but are never written to again once the canonical key exists.

## Strategy behavior

- **Find Spreads** — uses the canonical universe; preserves existing BPS/BCS/IC scan behavior and the existing config-modal workflow.
- **Find CSPs** — uses the canonical universe; preserves cash-availability checks and no-margin-by-default behavior; no separate CSP ticker state remains; empty universe disables the action.
- **Find Covered Calls** — the portfolio-aware exception. The universe may narrow eligible holdings but can never create eligibility: `scan universe = universe non-empty ? (verified CC-eligible holdings ∩ universe) : all verified CC-eligible holdings`. An explicit "Scan all eligible holdings" control bypasses only the universe narrowing, never capacity verification.
- **Find PMCCs** — uses the canonical universe; preserves existing PMCC scan behavior; no separate PMCC ticker state remains; empty universe disables the action.
- **Find LEAPS** — rendered disabled, "Coming Soon." Never calls the PMCC scanner or fabricates a placeholder result.

## Non-goals

Does not redesign the full Screener page or shared result cards. Does not change spread/CSP/PMCC/CC financial formulas, qualification, or scoring. Does not add PMCC to Autopilot. Does not implement standalone LEAPS. Does not add live execution for any strategy.
