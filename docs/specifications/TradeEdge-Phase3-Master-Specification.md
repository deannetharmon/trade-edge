# Trade Edge Phase 3 Master Specification

**Branch:** `feature/autopilot-paper-mode`  
**Status:** Draft v1  
**Purpose:** Define the product direction and implementation blueprint for the next phase of Trade Edge after the platform/task infrastructure work.

## 1. Product Vision

Trade Edge is an intelligent capital management platform for non-professional options traders.

Its purpose is to keep available and deployed capital working as safely and efficiently as possible by continuously answering two equally important questions:

1. **What should I do with the positions I already own?**
2. **Where should my next dollar be invested?**

Trade Edge combines portfolio analysis, opportunity discovery, risk management, income planning, and execution guidance into a single decision system that helps the trader generate reliable recurring income while preserving capital.

The application is designed for a serious non-professional trader who is trying to build a portfolio and produce recurring income in a safe, reliable, and repeatable way.

## 2. Investment Philosophy

Trade Edge should optimize the long-term performance of the entire portfolio, not isolated trade metrics.

Core principles:

1. Keep capital working safely.
2. Prefer high-quality companies the trader is willing to own.
3. Prefer Wheel strategies when capital allows.
4. Use spreads selectively as a capital-efficiency tool, not as the primary long-term objective.
5. Progressively mature the portfolio from spread-heavy trading toward a Wheel-focused income portfolio.
6. Let rules, not emotion, drive recommendations.
7. Use AI later for explanation and reasoning support, not as the primary source of deterministic recommendations.
8. Do not build features unless they improve a capital decision.

## 3. Strategic Goal

Trade Edge should help the trader answer:

> What should I do today to maximize long-term recurring income while protecting my portfolio?

This includes:

- managing existing positions
- deploying available capital
- reducing unnecessary risk
- improving capital efficiency
- increasing income reliability
- progressing toward retirement income goals

## 4. Five Core Engines

These are product/logic concepts, not necessarily large technical abstractions. The UI should remain simple.

### 4.1 Opportunity Engine

**Question:** Where should my next dollar go?

Inputs may include:

- selected watchlists
- ranked scan results
- repeat trades
- hunter/screener candidates
- available capital
- IVR / IV / HV
- earnings risk
- liquidity
- probability of profit
- ROC
- sector concentration
- current portfolio exposure
- Wheel suitability
- trader preference for owning the company

Outputs:

- best opportunity today
- recommended ticker
- recommended strategy
- strike and expiration
- expected income
- capital required
- risk assessment
- reason this opportunity ranks above alternatives

Guiding behavior:

- Prefer Wheel candidates when capital allows.
- Avoid recommending companies the trader would not want to own.
- Do not optimize only for ROC.
- Rank opportunities by portfolio fit, risk-adjusted income, and capital efficiency.

### 4.2 Portfolio Engine

**Question:** What should I do with what I already own?

Inputs may include:

- position health score
- recommendation rules
- DTE
- profit/loss percentage
- strike buffer / OTM percentage
- earnings risk
- Greeks
- IV vs HV
- GTC status
- stop status
- lifecycle state
- Wheel phase
- assignment risk

Outputs:

- hold
- watch
- close winner
- close loser
- roll soon
- place GTC
- let expire
- accept assignment
- sell covered call
- reduce exposure

Current completed foundation:

- TE-0006A — Portfolio Health Scoring Framework
- TE-0006B — Portfolio Recommendation Rules Engine

### 4.3 Risk Engine

**Question:** What could hurt me?

Risk categories:

- assignment risk
- earnings clustering
- sector concentration
- ticker concentration
- strategy concentration
- correlation risk
- buying power risk
- cash drag
- liquidity risk
- spread loss risk
- overexposure to short premium
- overexposure to technology or any single sector

Outputs:

- portfolio risk summary
- highest-risk positions
- concentration warnings
- capital efficiency warnings
- recommended risk-reduction actions

### 4.4 Income Engine

**Question:** Am I producing enough recurring income?

Inputs may include:

- option premium collected
- realized income
- unrealized premium
- open position income potential
- Wheel income
- covered call income
- cash-secured put income
- deployed capital
- idle capital
- annualized income
- monthly income target
- retirement income target

Outputs:

- monthly income generated
- projected monthly income
- annualized income
- yield on deployed capital
- income consistency
- capital required to meet income goals
- comparison against passive investing assumptions
- Wheel progression metrics

Long-term questions:

- How much recurring income is my portfolio generating?
- Is my option income reliable enough for retirement planning?
- How much capital must be deployed to reach my target monthly income?
- How much income could I generate if more positions were moved into Wheel strategies?
- What happens if a major CSP gets assigned?

### 4.5 Execution Engine

**Question:** What do I actually need to do today?

The Execution Engine synthesizes the other engines into a prioritized daily workflow.

It does not make independent trade decisions. It organizes outputs from:

- Opportunity Engine
- Portfolio Engine
- Risk Engine
- Income Engine

Outputs:

- Today's Priorities
- actions requiring attention
- ranked list of next actions
- suggested trades
- suggested closes
- suggested rolls
- suggested GTCs
- suggested new deployments

## 5. Capital Lifecycle Model

Trade Edge should be designed around the lifecycle of capital:

```text
Available Capital
        |
        v
Find Best Opportunity
        |
        v
Evaluate Risk / Return
        |
        v
Deploy Capital
        |
        v
Monitor Position Health
        |
        v
Hold / Roll / Close / Assignment
        |
        v
Capital Released
        |
        v
Find Next Best Opportunity
```

Every major feature should support one of these lifecycle steps.

## 6. Morning Workflow

The ideal morning experience should answer:

> What should I work on today?

The Portfolio/Dashboard experience should eventually show:

1. **Today's Priorities**
   - top actions requiring attention
   - ranked by urgency, risk, confidence, and income impact

2. **Capital Deployment**
   - available buying power
   - idle capital
   - best current opportunity
   - whether to deploy or wait

3. **Portfolio Health**
   - overall health
   - weak positions
   - expiring positions
   - assignment/earnings risks

4. **Income Progress**
   - month-to-date income
   - projected monthly income
   - progress toward retirement income target

5. **Risk Warnings**
   - concentration
   - earnings cluster
   - overexposure
   - capital inefficiency

## 7. Wheel-Focused Strategy Direction

Trade Edge should explicitly support a progression toward a Wheel-focused income portfolio.

### Why

The trader wants to reduce spread losses, own higher-quality companies, and use capital more efficiently over the long term.

### Strategy Preference

When multiple strategies are viable:

1. Prefer CSPs when the trader is willing to own the stock and capital is available.
2. Prefer covered calls when shares are owned.
3. Use spreads when:
   - capital is insufficient for CSPs
   - diversification requires smaller exposure
   - defined risk is required
   - the opportunity is attractive but ownership is not desired
4. Avoid recommending spreads merely because ROC is higher.
5. Evaluate whether a spread should be replaced by a Wheel position as the portfolio matures.

### Strategy Maturity Stages

#### Stage 1 — Capital Building
- More use of credit spreads
- Strict risk limits
- Smaller position sizes
- Focus on avoiding large drawdowns

#### Stage 2 — Hybrid
- More CSPs
- Selective spreads
- Increasing use of covered calls
- Capital deployment becomes more deliberate

#### Stage 3 — Income Portfolio
- Mostly Wheel positions
- Covered calls on owned stock
- Occasional spreads for tactical opportunities
- Focus on reliable monthly income

Trade Edge should eventually understand the current stage and recommend accordingly.

## 8. Phase 3 Implementation Sequence

### Completed

- TE-0006A — Portfolio Health Scoring Framework
- TE-0006B — Portfolio Recommendation Rules Engine

### Next

#### TE-0006C — Daily Priority List

Create a deterministic list of the top actions the trader should consider today.

Inputs:

- recommendation urgency
- recommendation confidence
- health score
- DTE
- assignment risk
- earnings risk
- profit target status
- loss severity

Output:

- ranked top 5 daily actions

#### TE-0006D — Position Advisor Cards

Upgrade position display from passive data cards to advisor-oriented cards.

Each card should show:

- recommendation
- health score
- urgency
- primary reason
- suggested action
- key supporting metrics

#### TE-0006E — Recommendation Explanation Panel

Provide deeper explanation of why a recommendation exists.

Should include:

- triggering rules
- supporting factors
- risk tradeoffs
- what would change the recommendation

#### TE-0007 — Opportunity Engine Foundation

Rank new trade opportunities from screener/watchlist/repeat trade sources.

This starts answering:

> Where should my next dollar go?

#### TE-0008 — Capital Allocation / Wheel Preference Engine

Add capital allocation logic with explicit preference for Wheel strategies when capital allows.

#### TE-0009 — Income Engine Foundation

Track recurring option income and project income against monthly and retirement targets.

#### TE-0010 — Autopilot Paper Mode

Use recommendations and opportunity rankings to simulate suggested trades without live execution.

## 9. Non-Goals for Phase 3

Do not build yet:

- live trade automation
- persistent background workers
- server-side trade queue
- tax optimization
- complex Monte Carlo retirement simulations
- full AI trading agent
- live execution without approval
- portfolio margin modeling beyond available data

## 10. Design Principles

1. Keep the system explainable.
2. Prefer deterministic rules before AI.
3. Keep code modular but avoid unnecessary abstraction.
4. Every recommendation must include a reason.
5. Every major screen should answer a user decision.
6. Avoid optimizing for isolated trade metrics.
7. Favor long-term portfolio quality over short-term ROC.
8. Make Wheel progression a first-class product objective.
9. Use Vercel as authoritative build validation.
10. Keep tickets small enough for one implementation pass.

## 11. Success Criteria

Phase 3 is successful when the user can open the app and immediately understand:

- which existing positions need action
- which positions should be left alone
- where idle capital should go next
- whether the portfolio is becoming safer or riskier
- how much recurring income is being produced
- whether the portfolio is progressing toward retirement income goals

The product should feel like an intelligent trading partner that helps manage capital, not just a dashboard that displays positions.

## 12. Documentation and Implementation Workflow

For each feature:

1. Create or update a TE ticket.
2. Implement one ticket at a time.
3. Commit implementation to `feature/autopilot-paper-mode`.
4. Validate through Vercel.
5. Create an implementation report in `docs/reviews/`.
6. Review before moving to the next ticket.

Vercel is the authoritative build validation. Local `npm` is not required.
