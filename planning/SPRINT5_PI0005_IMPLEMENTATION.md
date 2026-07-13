# PI-0005 — Position Intelligence — Implementation Specification

Branch: `feature/portfolio-intelligence`

## Executive Summary

Every position on the Portfolio page gets an expandable "Position Intelligence" panel that explains its canonical recommendation in plain language: why it exists, what evidence and concerns support it, what would change it, what's expected next, and what the reasonable management alternatives are. Everything shown is already computed today — `pos.recommendation` and `pos.portfolioObjective`, attached to every position since PI-0002 but never rendered. This ticket renders them; it does not compute anything new.

## Objectives

Make each position answer, in one expandable panel: why this recommendation, what facts support it, what concerns exist, what would change it, what's the next expected lifecycle event, and what are the reasonable alternatives — without adding a single new evaluation rule.

## User Experience

A new "Position Intelligence" toggle button sits next to the existing "Analyze with AI" button in each position card's action row. Clicking it expands a panel below the card (same slot pattern as the existing AI analysis panel) with five sections in order: Current Recommendation, Why, Current Concerns, What Would Change This Recommendation, Next Expected Lifecycle Event, Available Management Choices.

## Component Design

- `features/portfolio/intelligence/managementChoices.ts` — `deriveManagementChoices(kind: PortfolioRecommendationKind)`: a static lookup from the canonical recommendation kind to `{ preferred: string; alternatives: string[] }` using the fixed vocabulary (Hold, Harvest, Roll, Close, Accept Assignment, Monitor). Presentation-only relabeling of an already-decided value — no thresholds, no evaluation.
- `features/portfolio/intelligence/nextLifecycleEvent.ts` — `deriveNextLifecycleEvent(lifecycleType, kind)`: a static lookup combining the existing `classifyPositionLifecycle().type` with the recommendation `kind` into one of the sprint's own example phrases ("Continue monitoring.", "Earnings review approaching.", "Prepare for assignment.", "Harvest likely next.", "Covered call candidate after assignment."). Also presentation-only.
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — the view. Props: `{ recommendation: PortfolioRecommendation; objective: PortfolioObjective | null; lifecycleType: PositionLifecycleType; th }`. Renders Why/Concerns/Review-Triggers straight from `objective` when present; when `objective` is null (the existing "hold" case, which never gets a canonical objective), falls back to `recommendation`'s own `primaryReason`/`supportingReasons` for Why, and to the same "next portfolio evaluation" phrasing `synthesizeWaitObjective` already uses portfolio-wide for the review-trigger fallback — not new copy, the existing convention applied at the position level.
- `app/portfolio/page.tsx` (`PositionCard`) — one new `showIntelligence` boolean, one new toggle button, one new render block calling `classifyPositionLifecycle(pos).type` (already imported) and passing `pos.recommendation`/`pos.portfolioObjective` straight through.

## Reuse Strategy

`pos.recommendation` (`PortfolioRecommendation`, PI-0002) and `pos.portfolioObjective` (`PortfolioObjective | null`, PI-0002) are already computed for every position in `attachSnapshotHistory()`/`scorePortfolioPositionObjective()` — wired through since PI-0002 specifically so a future slice could consume them without new data plumbing. This is that slice. `classifyPositionLifecycle` (already used for section sorting) supplies lifecycle type. Nothing in `lib/portfolio-intelligence` or `lib/decision-engine` changes.

## Data Sources

`pos.recommendation`, `pos.portfolioObjective`, `classifyPositionLifecycle(pos)` — all already in scope inside `PositionCard`. No new fetch, no new API route.

## Testing Strategy

Pure-logic tests for `deriveManagementChoices` (every `PortfolioRecommendationKind`) and `deriveNextLifecycleEvent` (lifecycle × kind combinations, including the `ASSIGNED_STOCK` special case). Component tests for `PositionIntelligencePanel` covering the objective-present path (Why/Concerns/Review Triggers from the objective) and the null-objective ("hold") fallback path, plus a purity check that it imports no Portfolio Intelligence evaluation function.

## Acceptance Criteria

Matches the sprint brief verbatim: every position explains its recommendation using only reused evidence/concerns/review-triggers; Next Expected Lifecycle Event and Available Management Choices are displayed; no duplicate Portfolio Intelligence or Decision Engine logic; existing recommendation behavior is unchanged; tests, TypeScript, and build all pass.

## Non-Goals

Daily Briefing, Today's Priorities, Decision History, Paper Trading, Autopilot, AI-generated commentary, Portfolio redesign, new recommendation rules.
