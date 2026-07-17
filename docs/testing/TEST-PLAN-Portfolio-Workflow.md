# TEST-PLAN --- Portfolio Workflow

**Purpose:** Validate the end-to-end portfolio workflow after the recent
Portfolio Intelligence, Portfolio Review, and Daily Briefing
enhancements.

**Recommended Repository Location**

``` text
docs/testing/TEST-PLAN-Portfolio-Workflow.md
```

------------------------------------------------------------------------

## Testing Goal

Ask yourself:

> **Would I confidently use TradeEdge to manage my portfolio every
> trading morning?**

------------------------------------------------------------------------

## 1. Daily Briefing

-   [ ] Appears first on Portfolio page
-   [ ] Readable in under 30 seconds
-   [ ] Executive Summary matches portfolio
-   [ ] Today's Priorities are correct
-   [ ] Portfolio Snapshot is accurate
-   [ ] Upcoming Events are correct
-   [ ] Opportunity Summary makes sense
-   [ ] Risk Summary matches reality
-   [ ] No duplicated information
-   [ ] Empty states render cleanly

**Question**

> If I only read this section, would I know what deserves my attention
> today?

------------------------------------------------------------------------

## 2. Portfolio Review

-   [ ] Portfolio Health score is correct
-   [ ] Health contributors make sense
-   [ ] Top Risks prioritized correctly
-   [ ] Portfolio Composition accurate
-   [ ] Strategy counts correct
-   [ ] Largest concentration correct
-   [ ] Buying Power flags accurate
-   [ ] Income recommendations appropriate

**Question**

> Does this summarize my portfolio better than the position list?

------------------------------------------------------------------------

## 3. Mission Control

-   [ ] Priorities still correct
-   [ ] Recommendations still accurate
-   [ ] Nothing disappeared
-   [ ] No duplicated recommendations

**Question**

> Is Mission Control still valuable now that Daily Briefing exists?

------------------------------------------------------------------------

## 4. Position Intelligence

Review multiple positions.

-   [ ] Suggested Action
-   [ ] Position Health
-   [ ] Priority
-   [ ] Profit Bar
-   [ ] Decision Review
-   [ ] AI Explanation
-   [ ] Roll Recommendation
-   [ ] Close Recommendation
-   [ ] Harvest Recommendation

------------------------------------------------------------------------

## 5. Portfolio Health

-   [ ] Health score reasonable
-   [ ] Positive contributors correct
-   [ ] Negative contributors correct
-   [ ] Score changes appropriately

------------------------------------------------------------------------

## 6. Hunter

-   [ ] Rankings
-   [ ] Filters
-   [ ] OTM Guardrails
-   [ ] POP
-   [ ] ROC
-   [ ] Earnings awareness
-   [ ] IV
-   [ ] Suggested trade

------------------------------------------------------------------------

## 7. Pending Orders

-   [ ] Contract count displayed
-   [ ] Status correct
-   [ ] Cards render cleanly

------------------------------------------------------------------------

## 8. CSP Risk Card

-   [ ] 2σ Scenario Loss shown
-   [ ] Tooltip understandable
-   [ ] Numbers reasonable

------------------------------------------------------------------------

## 9. Mobile

-   [ ] Portfolio page
-   [ ] Daily Briefing
-   [ ] Portfolio Review
-   [ ] Position cards
-   [ ] No horizontal scrolling
-   [ ] No overflow

------------------------------------------------------------------------

## 10. End-to-End Workflow

Pretend it is tomorrow morning.

Answer:

1.  What did I look at first?
2.  What confused me?
3.  What information was missing?
4.  What took too many clicks?
5.  What surprised me?
6.  What saved me time?
7.  Would I trust this every trading day?

------------------------------------------------------------------------

# Recently Implemented Features

## Daily Briefing

-   Executive Summary
-   Today's Priorities
-   Portfolio Snapshot
-   Upcoming Events
-   Opportunity Summary
-   Risk Summary

## Portfolio Review

-   Portfolio Health
-   Top Risks
-   Portfolio Composition
-   Capital & Income
-   Strategy Mix
-   Concentration Summary

## Portfolio Intelligence

-   Suggested Action
-   Position Health
-   Priority Scoring
-   Enhanced AI Explanation
-   Expanded Card Layout

## Risk Management

-   Minimum OTM Guardrails
-   2σ Scenario Loss
-   Improved Recommendation Explainability

## Hunter

-   Improved Rankings
-   POP Improvements
-   OTM Improvements
-   Earnings Awareness
-   Strategy Refinements

## Portfolio Workflow

-   Pending Order Contract Count
-   Mission Control Enhancements
-   Better Portfolio Integration

------------------------------------------------------------------------

# Final Evaluation

After testing, answer:

-   Would I use TradeEdge every trading morning?
-   Three most valuable features?
-   Three biggest pain points?
-   Highest-priority improvement before the next sprint?
