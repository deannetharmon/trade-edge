# DR-0001 — Strategy Unification and Wheel Opportunity Finder

**Status:** Draft v1  
**Branch:** `feature/autopilot-paper-mode`  
**Type:** Product / Algorithm Design  
**Related Documents:**

- `docs/philosophy/TradeEdge-Investment-Constitution.md`
- `docs/specifications/TradeEdge-Phase3-Master-Specification.md`

---

## 1. Purpose

Trade Edge currently treats spread strategies as the primary screener workflow while Wheel strategies are partially separated into the Wheel page.

This design document defines how Trade Edge should unify spread, Wheel, and PMCC opportunity discovery into one consistent strategy selection and opportunity-finding model.

The goal is to allow the trader to evaluate:

```text
BPS | BCS | IC | CSP | CC | PMCC
```

as first-class strategies while preserving the specific rules, capital requirements, and portfolio-awareness required by each strategy.

---

## 2. Product Goal

Trade Edge should answer:

> Given my selected universe, my current portfolio, and my available capital, what is the best opportunity today?

This includes both:

1. **New capital deployment**
   - BPS
   - BCS
   - IC
   - CSP
   - PMCC

2. **Income generation on existing holdings**
   - CC

The experience should feel consistent across strategies. CSP, CC, and PMCC should not feel like separate apps bolted onto the spread screener.

---

## 3. Guiding Principles

This design follows the Trade Edge Investment Constitution.

Key principles:

- Keep capital working safely.
- Prefer high-quality companies.
- Prefer Wheel strategies when capital allows.
- Use spreads selectively.
- Include PMCC/LEAPS when they provide capital-efficient exposure without materially increasing risk.
- Avoid margin by default.
- Optimize for the portfolio, not isolated trade ROC.
- Every recommendation must be explainable and actionable.
- Cash is a valid position when no opportunity meets standards.

---

## 4. Strategy Taxonomy

Trade Edge should support the following first-class strategy modes.

| Strategy | Meaning | Primary Use |
|---|---|---|
| BPS | Bull Put Spread | Defined-risk bullish income |
| BCS | Bear Call Spread | Defined-risk bearish/neutral income |
| IC | Iron Condor | Defined-risk neutral income |
| CSP | Cash-Secured Put | Wheel entry / stock acquisition income |
| CC | Covered Call | Wheel income on owned shares |
| PMCC | Poor Man's Covered Call using LEAPS | Capital-efficient synthetic covered call |

User-facing label should be **PMCC**, not just LEAPS, because PMCC describes the strategy being searched. LEAPS are the long-call component.

---

## 5. Unified Strategy Selector

The Screener / Engine strategy selector should expose:

```text
BPS | BCS | IC | CSP | CC | PMCC
```

Requirements:

- Each strategy should be selectable with the same visual treatment.
- Selecting a strategy should determine:
  - scan universe
  - required inputs
  - eligibility checks
  - result columns
  - scoring rules
  - capital checks
  - portfolio checks
- The user should not have to jump to a different page to evaluate Wheel-compatible opportunities.
- The Wheel page may remain, but CSP and CC discovery should be integrated into the broader opportunity workflow.

---

## 6. Unified Opportunity Result Model

All strategies should produce a common opportunity result shape where possible.

Suggested conceptual fields:

```ts
type StrategyKind = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC' | 'PMCC';

interface OpportunityResult {
  id: string;
  strategy: StrategyKind;
  symbol: string;
  underlyingPrice: number | null;
  expiration: string | null;
  dte: number | null;

  thesis: 'bullish' | 'bearish' | 'neutral' | 'income' | 'ownership' | 'synthetic-ownership';

  premium: number | null;
  maxProfit: number | null;
  maxRisk: number | null;
  capitalRequired: number | null;
  buyingPowerImpact: number | null;

  roc: number | null;
  annualizedRoc: number | null;
  pop: number | null;
  delta: number | null;
  otmPct: number | null;

  iv: number | null;
  hv: number | null;
  ivr: number | null;

  earningsDate: string | null;
  earningsRisk: boolean;

  liquidityScore: number | null;
  bidAskWarning: string | null;

  portfolioFitScore: number | null;
  riskScore: number | null;
  incomeScore: number | null;
  opportunityScore: number | null;

  recommendation: string;
  reason: string;
  warnings: string[];
}
```

Implementation may use existing types, but future work should move toward a shared opportunity model.

---

## 7. Strategy-Specific Requirements

---

## 7.1 Bull Put Spread (BPS)

Existing spread behavior should be preserved.

BPS remains a defined-risk bullish income strategy.

Key metrics:

- short put strike
- long put strike
- credit
- width
- max risk
- ROC
- annualized ROC
- POP
- delta
- OTM %
- DTE
- IV / HV / IVR
- earnings risk
- liquidity

Do not change current BPS formulas unless explicitly scoped.

---

## 7.2 Bear Call Spread (BCS)

Existing spread behavior should be preserved.

BCS remains a defined-risk bearish or neutral income strategy.

Key metrics:

- short call strike
- long call strike
- credit
- width
- max risk
- ROC
- annualized ROC
- POP
- delta
- OTM %
- DTE
- IV / HV / IVR
- earnings risk
- liquidity

Do not change current BCS formulas unless explicitly scoped.

---

## 7.3 Iron Condor (IC)

Existing IC behavior should be preserved.

IC remains a defined-risk neutral income strategy.

Key metrics:

- short put strike
- long put strike
- short call strike
- long call strike
- total credit
- max risk
- ROC
- annualized ROC
- POP
- put-side OTM %
- call-side OTM %
- DTE
- IV / HV / IVR
- earnings risk
- liquidity

Do not change current IC formulas unless explicitly scoped.

---

## 7.4 Cash-Secured Put (CSP)

CSP should be a first-class strategy and should integrate with Wheel logic.

### Purpose

CSP is the preferred Wheel entry strategy when the trader is willing to own the underlying and has sufficient capital.

### Eligibility Requirements

A CSP candidate must check:

- underlying is in approved/selectable universe
- option chain is available
- put strike is available
- sufficient cash or buying power exists
- no margin required unless explicitly overridden
- earnings risk is known
- liquidity is acceptable
- assignment would be acceptable or explicitly flagged

### Capital Requirement

CSP required cash:

```text
required cash = strike × 100 × contracts
```

Default behavior:

- Do not recommend CSPs that exceed available cash / allowed buying power.
- Do not use margin by default.
- If insufficient funds exist, show the candidate as unavailable or blocked.
- Future override may allow margin, but should require explicit user action and clear warnings.

### CSP Result Metrics

CSP results should show:

- symbol
- current stock price
- put strike
- expiration
- DTE
- premium
- required cash
- ROC
- annualized ROC
- delta
- OTM %
- breakeven
- assignment price
- IV / HV / IVR
- earnings risk
- liquidity
- ownership desirability
- recommendation / warning

### CSP Recommendation Logic

Prefer CSPs when:

- trader is willing to own the stock
- capital is available
- strike is below current price by acceptable buffer
- premium is meaningful
- earnings risk is acceptable
- liquidity is acceptable
- assignment would not create excessive concentration

Avoid or penalize CSPs when:

- capital is insufficient
- assignment would create excessive concentration
- company quality is weak
- earnings are imminent
- bid/ask is too wide
- premium is high only because risk is high
- the trade would use too much available capital

---

## 7.5 Covered Call (CC)

CC should be a first-class strategy, but it must be portfolio-aware.

### Purpose

CC generates income on shares already owned.

### Eligibility Requirements

A CC candidate requires:

- existing stock position
- at least 100 uncovered shares
- no conflicting existing short call beyond available lots
- option chain is available
- acceptable call strike exists
- liquidity is acceptable
- assignment outcome is understood

### Covered Contract Capacity

Available covered-call contracts:

```text
available contracts = floor(owned shares / 100) - existing short call contracts
```

Default behavior:

- Never recommend naked calls.
- Never recommend more CC contracts than covered shares allow.
- If existing short calls already cover shares, show no available CC capacity unless rolling is explicitly scoped.

### CC Result Metrics

CC results should show:

- symbol
- shares owned
- available covered contracts
- current stock price
- cost basis if available
- call strike
- expiration
- DTE
- premium
- annualized yield on shares
- strike vs current price
- strike vs cost basis
- assignment outcome
- max upside if called away
- IV / HV / IVR
- earnings risk
- liquidity
- recommendation / warning

### CC Recommendation Logic

Prefer CCs when:

- shares are owned
- strike is above acceptable sale price
- premium is meaningful
- assignment would be acceptable
- earnings risk is acceptable
- the call improves income without undermining long-term thesis

Avoid or penalize CCs when:

- strike is below cost basis unless explicitly approved
- assignment would be undesirable
- earnings are imminent and trader wants upside
- bid/ask is too wide
- the call caps upside too aggressively
- existing calls already cover the shares

---

## 7.6 PMCC / LEAPS

PMCC should be a first-class strategy because it has different timing, risk, and construction rules than CSP, CC, or vertical spreads.

### User-Facing Name

Use **PMCC** as the strategy label.

LEAPS are the long-call component of the PMCC.

### Purpose

PMCC provides capital-efficient bullish exposure with recurring short-call income, acting as a synthetic covered call when owning 100 shares is too expensive or capital-inefficient.

### Eligibility Requirements

A PMCC candidate requires:

- high-quality underlying
- liquid long-dated call options
- liquid short-dated call options
- long call with sufficient DTE
- long call with high delta
- short call with appropriate DTE and delta
- acceptable net debit
- acceptable breakeven
- defined risk understood
- no earnings or event risk that breaks the setup unless explicitly accepted

### Long Call / LEAPS Leg Requirements

Preferred long call characteristics:

- long-dated expiration, usually 180+ DTE, often 9–24 months
- high delta, commonly 0.70–0.85+
- acceptable bid/ask spread
- sufficient open interest
- breakeven not excessively above current stock price
- enough extrinsic value profile to make the PMCC viable

The exact thresholds should be configurable later.

### Short Call Requirements

Preferred short call characteristics:

- shorter expiration, usually 21–45 DTE
- strike above long-call breakeven when possible
- delta commonly around 0.20–0.35
- meaningful premium
- acceptable liquidity
- assignment/roll risk understood

### PMCC Result Metrics

PMCC results should show:

- symbol
- stock price
- long call expiration
- long call strike
- long call delta
- long call debit
- short call expiration
- short call strike
- short call delta
- short call credit
- net debit
- capital required
- estimated max risk
- short-call income yield
- annualized short-call yield
- breakeven
- upside cap for current cycle
- earnings risk
- liquidity on both legs
- recommendation / warning

### PMCC Recommendation Logic

Prefer PMCCs when:

- stock ownership is desirable but expensive
- capital is insufficient or inefficient for CSP/share ownership
- long call is liquid and high delta
- short call provides meaningful recurring income
- breakeven is reasonable
- portfolio exposure remains acceptable
- risk is lower than or preferable to owning shares outright

Avoid or penalize PMCCs when:

- long call bid/ask is wide
- short call bid/ask is wide
- long call delta is too low
- long call expiration is too short
- net debit is too high relative to account size
- breakeven is unattractive
- short call creates too much assignment/roll pressure
- earnings risk is unacceptable
- the trader would be better served by CSP or shares

---

## 8. Portfolio Awareness Requirements

Different strategies require different levels of portfolio awareness.

| Strategy | Needs Available Capital | Needs Existing Positions | Needs Stock Shares | Needs Existing Options |
|---|---:|---:|---:|---:|
| BPS | Yes | Helpful | No | Helpful |
| BCS | Yes | Helpful | No | Helpful |
| IC | Yes | Helpful | No | Helpful |
| CSP | Yes | Yes | No | Helpful |
| CC | Yes | Yes | Yes | Yes |
| PMCC | Yes | Yes | No | Helpful |

Portfolio awareness should eventually include:

- current stock holdings
- current option holdings
- existing short calls
- existing short puts
- buying power
- available cash
- margin status / margin override
- sector exposure
- ticker concentration
- strategy concentration
- current Wheel phase

---

## 9. Capital and Margin Requirements

### Default Rule

Trade Edge should not recommend strategies that require margin unless the trader explicitly enables an override.

### CSP

Must compare required cash against available cash/buying power.

### CC

Must ensure calls are covered by shares.

### PMCC

Must clearly show net debit and max capital at risk.

### Spreads

Continue using existing defined-risk buying power / max risk calculations.

### Future Override

A future setting may allow:

```text
Allow margin recommendations: OFF / WARN / ON
```

Default must be `OFF`.

---

## 10. UI / UX Requirements

### Strategy Selector

Add first-class strategy buttons:

```text
BPS | BCS | IC | CSP | CC | PMCC
```

### Result Layout

Opportunity results should preserve the same look and feel across strategies.

Common columns/cards should include:

- Symbol
- Strategy
- Expiration / DTE
- Strike / Legs
- Premium / Credit
- ROC / Annualized ROC
- POP or probability metric when applicable
- Delta
- OTM / Buffer
- IV / HV / IVR
- Earnings
- Capital Required / Max Risk
- Recommendation / Warning
- Trade / Analyze action

Strategy-specific metrics may appear in expanded view or secondary details.

### Wheel Opportunity Finder

The Wheel opportunity finder should not feel separate from the spread screener.

CSP search should be seamless with Wheel.

Covered Call search should use existing portfolio positions.

PMCC search should be presented as a capital-efficient income alternative, not as a generic long-option scan.

---

## 11. Implementation Approach

Do not implement all of this in one ticket.

Recommended sequence:

### TE-0007A — Strategy Taxonomy and Unified Selector

- Define strategy type model.
- Add CSP, CC, PMCC to selector.
- Do not implement full scanning yet.
- Ensure UI does not break existing BPS/BCS/IC.

### TE-0007B — CSP First-Class Screener Strategy

- Integrate CSP scan logic.
- Reuse Wheel logic where possible.
- Add capital checks.
- No margin by default.
- Match result layout to spread opportunities.

### TE-0007C — Covered Call First-Class Strategy

- Detect share positions.
- Calculate available covered contracts.
- Scan call chains.
- Avoid naked call recommendations.
- Add CC results to unified opportunity format.

### TE-0007D — PMCC First-Class Strategy

- Search long-dated high-delta calls.
- Search short-dated calls.
- Build PMCC candidate model.
- Score PMCC against CSP/share alternatives.

### TE-0007E — Unified Opportunity Result UI

- Align result tables/cards across BPS, BCS, IC, CSP, CC, PMCC.
- Move strategy-specific details into expanded view where needed.
- Reduce duplication between Screener, Engine, and Wheel pages.

### TE-0007F — Portfolio-Aware Opportunity Ranking

- Begin ranking opportunities using portfolio context.
- Connect to future Opportunity Engine.

---

## 12. Non-Goals

Do not include in the first implementation pass:

- live trade automation
- automatic order placement
- margin-enabled recommendations
- full tax modeling
- complete retirement modeling
- AI-generated trade recommendations
- full Opportunity Engine scoring
- complete portfolio optimization

---

## 13. Open Questions

Before implementation, confirm:

1. Should the user-facing label be `PMCC` or `LEAPS/PMCC`?
2. What is the default minimum cash reserve after CSP recommendations?
3. What is the maximum capital allocation per ticker?
4. What is the maximum capital allocation per sector?
5. Should CC strikes default above cost basis when cost basis is known?
6. What is the preferred PMCC long-call DTE range?
7. What is the preferred PMCC long-call delta range?
8. Should PMCC be allowed only on selected high-quality tickers?
9. Should CSP/CC/PMCC share the same watchlist universe as spreads?
10. Should the Wheel page remain as a specialized view, or eventually become a filtered strategy view of the unified Opportunity Finder?

---

## 14. Acceptance Standard for Future Tickets

Future implementation tickets derived from this design should:

- preserve existing spread behavior
- avoid rewriting unrelated pages
- keep UI consistent
- use Vercel as authoritative validation
- create implementation reports
- avoid temporary scripts in commits
- keep each implementation ticket narrow enough for one build cycle

