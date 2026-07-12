# TradeEdge Decision Intelligence v2

## The Philosophy and Architecture of the Portfolio Decision Engine

## Executive Summary

TradeEdge is not a trading platform.

TradeEdge is not an options screener.

TradeEdge is not a portfolio tracker.

TradeEdge is a **Portfolio Decision Engine**.

Its purpose is not to present data.

Its purpose is not to produce alerts.

Its purpose is to help the trader consistently make better portfolio
decisions while minimizing unnecessary cognitive load.

Every recommendation produced by TradeEdge must satisfy one fundamental
principle:

> **Only surface information that materially improves a portfolio
> decision.**

Anything that does not improve a decision should remain in the
background.

------------------------------------------------------------------------

# Core Philosophy

## Principle 1 --- Recommendations Drive Decisions

Recommendations exist to drive decisions, not observations.

**Poor recommendation**

> Earnings occur before expiration.

**Good recommendation**

> Review this position five trading days before earnings.

------------------------------------------------------------------------

## Principle 2 --- Facts Are Not Recommendations

The engine discovers facts.

The engine interprets facts.

Only then should it recommend action.

    Market Facts
            ↓
    Portfolio Facts
            ↓
    Position Context
            ↓
    Decision
            ↓
    Recommendation

------------------------------------------------------------------------

## Principle 3 --- Truth Is Insufficient

Many things can be true.

Very few require attention today.

The Decision Engine optimizes for **relevance**, not completeness.

------------------------------------------------------------------------

## Principle 4 --- Reduce Cognitive Load

The trader should spend mental energy making decisions---not filtering
alerts.

TradeEdge exists to eliminate noise.

------------------------------------------------------------------------

# Decision Intelligence Architecture

Every position is evaluated using this pipeline:

    Market Data
            ↓
    Position Facts
            ↓
    Position Context
            ↓
    Strategy Context
            ↓
    Lifecycle Context
            ↓
    Risk Context
            ↓
    Actionability
            ↓
    Portfolio Objectives
            ↓
    Portfolio Priorities
            ↓
    User Experience

Business logic belongs in the intelligence layers.

The UI consumes intelligence.

The UI never recreates intelligence.

------------------------------------------------------------------------

# Position Context

The option strategy describes the instrument.

The Position Strategy describes how that instrument should be managed.

These are different concepts.

------------------------------------------------------------------------

# Position Strategy

Every managed position belongs to one primary strategy.

Initial canonical strategies:

-   Wheel
-   Income
-   Long-Term Hold
-   Growth
-   Hedge
-   Swing
-   Speculation
-   Acquisition

Future strategies may be added without changing existing recommendation
behavior.

------------------------------------------------------------------------

# Assignment Preference

Assignment preference is independent of Position Strategy.

Canonical values:

-   Avoid
-   Accept
-   Prefer

Examples:

  Position Strategy       Assignment Preference
  ----------------------- -----------------------
  Income CSP              Avoid
  Wheel CSP               Prefer
  Long-Term Acquisition   Accept

Recommendations must never ignore assignment preference.

------------------------------------------------------------------------

# Lifecycle Context

Recommendations evaluate the lifecycle---not isolated positions.

Example Wheel lifecycle:

    Cash
     ↓
    Cash-Secured Put
     ↓
    Assigned Shares
     ↓
    Covered Call
     ↓
    Called Away
     ↓
    Cash

The engine should reason across the lifecycle rather than only the
current instrument.

------------------------------------------------------------------------

# Strategy Alignment

Before surfacing a recommendation the engine must determine:

> Does this recommendation support or conflict with the declared
> strategy?

If a recommendation conflicts with the strategy, the engine must explain
why.

Strategy influences recommendations.

Strategy does **not** suppress genuine portfolio risk.

------------------------------------------------------------------------

# Actionability

Actionability determines whether a recommendation deserves attention
today.

Canonical states:

-   Ignore
-   Monitor
-   Review Soon
-   Action Needed
-   Critical

Only the following may appear in **Today's Priorities**:

-   Review Soon
-   Action Needed
-   Critical

Everything else remains background intelligence.

------------------------------------------------------------------------

# Time Awareness

Recommendations evolve over time.

Example:

  Condition             Actionability
  --------------------- ---------------
  Earnings far away     Monitor
  Review window opens   Review Soon
  Decision imminent     Action Needed
  Immediate risk        Critical

Thresholds belong in centralized policy---not the UI.

------------------------------------------------------------------------

# Portfolio Context

Recommendations optimize the portfolio---not individual positions.

Portfolio Intelligence considers:

-   Diversification
-   Buying Power
-   Concentration
-   Income
-   Capital Deployment
-   Drawdown
-   Liquidity
-   Correlation

------------------------------------------------------------------------

# Recommendation Philosophy

Every recommendation answers three questions:

## 1. What should I do?

One clear recommendation.

Not a list of equally weighted possibilities.

## 2. Why?

Objective evidence supporting the recommendation.

## 3. When should I think about this again?

Based on:

-   Date
-   Event
-   Threshold
-   Lifecycle transition

Never implementation details such as:

> Re-check on next portfolio refresh.

------------------------------------------------------------------------

# Recommendation Content Rules

Every visible section must improve decision quality.

Display only information that:

-   Explains the recommendation
-   Builds confidence
-   Changes behavior

Avoid:

-   Generic warnings
-   Repeated information
-   Meaningless severity labels
-   Abstract scoring without interpretation
-   Implementation details

When a section adds no value, omit it.

------------------------------------------------------------------------

# Attention Model

Today's Priorities are **not** a list of everything the engine knows.

They are a list of recommendations requiring current attention.

The engine should aggressively suppress low-value alerts.

------------------------------------------------------------------------

# Noise Reduction

TradeEdge favors silence over unnecessary interruption.

False urgency is more harmful than delayed awareness.

The user should learn to trust:

> If TradeEdge surfaced it, it matters.

------------------------------------------------------------------------

# Explainability

Every recommendation must explain:

-   Why it appeared
-   Why it has this priority
-   Why it appeared now
-   Why alternative actions were not recommended

------------------------------------------------------------------------

# Trust

The purpose of Decision Intelligence is not automation.

The purpose is trust.

Trust comes from recommendations that are:

-   Correct
-   Context-aware
-   Strategy-aware
-   Actionable
-   Timely
-   Consistent

------------------------------------------------------------------------

# Long-Term Vision

Decision Intelligence becomes the foundation for:

-   Portfolio Dashboard
-   Today's Priorities
-   Daily Briefing
-   Decision History
-   Notifications
-   Paper Trading
-   Autopilot
-   AI Portfolio Coach

Every future feature consumes Decision Intelligence.

No future feature duplicates its reasoning.

------------------------------------------------------------------------

# Guiding Principles

1.  The UI renders. Decision Intelligence thinks.
2.  Facts are inputs, not recommendations.
3.  Every recommendation must earn the trader's attention.
4.  Context is as important as calculation.
5.  Strategy influences recommendations.
6.  Actionability determines visibility.
7.  Recommendations should reduce cognitive load.
8.  Trust is the ultimate product feature.

------------------------------------------------------------------------

# Mission Statement

> **TradeEdge should strive to think like the user's most disciplined
> portfolio manager---not their loudest trading platform.**

That philosophy will guide every recommendation, every notification,
every briefing, every automation, and every future capability built on
the Portfolio Decision Engine.
