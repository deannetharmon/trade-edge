# LEV-0001 Gate 3 — Leveraged & Inverse UX Specification

**Status:** Gate 3 review
**Owner:** Diane — UX
**Issue:** #52
**Date:** 2026-10-01

## UX principle

Leveraged/inverse products remain inside the normal TradeEdge workflow. The UI must make leverage, economic underlying, effective exposure, incomplete normalization, and layered leverage obvious **without** creating a separate leveraged-products workspace.

Risk information is progressive:
1. primary results expose enough context to prevent category mistakes;
2. detail views explain exposure/stress;
3. portfolio views roll related instruments to their economic underlying;
4. Opportunity → Expression Comparison makes alternative implementations comparable.

No UI may turn capital efficiency into a quality endorsement.

---

## A. Scanner

### Row anatomy

```
NVDU   [2× LONG]   NVDA   Bullish   Score 84
Capital $8,000  |  Initial effective exposure ~$16,000
Stress -10% underlying: est. -$1,600  |  Normalization: Complete
```

Ordinary instrument:
```
NVDA   [STOCK]   NVDA   Bullish   Score 82
Capital $16,000  |  Initial effective exposure $16,000
```

Incomplete:
```
XYZ   [TYPE UNKNOWN]   Normalization incomplete
Comparable rank unavailable — product economics require validated metadata
```

### Required primary-row signals
- compact badge: STOCK, ETF when authoritative, 2× LONG, 1× INVERSE, 2× INVERSE, 3× LONG, etc.;
- economic underlying when different from traded ticker;
- capital required/deployed;
- initial effective exposure when authoritative;
- normalization incomplete state when not authoritative;
- hard risk-gate failure shown as status, never hidden in a lower score.

### Ranking behavior presentation
If a candidate fails a hard risk gate:
```
FAIL — Portfolio Risk Limit
Underlying gross exposure would exceed policy
```
Do not show a cosmetically reduced score as the explanation for rejection.

If normalization is incomplete:
```
NOT COMPARABLY RANKED — Normalization Incomplete
```

### Layered leverage
Options on a leveraged/inverse product show:
`[LAYERED LEVERAGE]`
adjacent to the strategy/instrument context.

---

## B. Trade Detail — Leveraged Exposure

Contextual section appears only when relevant or when economic-underlying roll-up adds useful context.

```
Leveraged Exposure
Instrument             NVDU
Economic underlying    NVDA
Structure              2× Long — Daily Reset
Capital required       $8,000
Initial effective exp. ~$16,000
Portfolio capital       8.0%
Effective exposure     16.0%

Stress — underlying move
 -20%   est. -$3,200
 -15%   est. -$2,400
 -10%   est. -$1,600
  -5%   est.   -$800
  +5%   est.   +$800
 +10%   est. +$1,600
 +15%   est. +$2,400
 +20%   est. +$3,200

[Approximation] Daily-reset/path effects are not captured by simple multiplier stress.
Normalization: Complete
Risk model: lev-risk-v1
```

### Terminology
Use **Initial effective exposure** in user-facing UI; tooltip/technical detail may say “initial underlying-equivalent exposure (UEE).”

Never label multiplier stress as:
- expected loss;
- VaR;
- likely loss;
- maximum loss.

For long shares/ETFs, show maximum capital loss separately where useful.

### Incomplete state
Do not render numeric effective exposure/stress as authoritative:
```
Risk normalization incomplete
TradeEdge cannot yet validate this product's underlying, leverage target, or reset policy.
Comparable normalized ranking is unavailable.
```

---

## C. Positions — Economic Underlying Roll-up

Default position rows stay compact. Add an expandable underlying group when related instruments exist.

```
NVDA Exposure Group
Gross bullish exposure   $100,000
Gross bearish exposure    $80,000
Net directional exposure  +$20,000
Capital deployed          $130,000
[Expand 3 positions]
```

Expanded:
```
NVDA   Stock       +$40,000 effective
NVDU   2× LONG     +$60,000 effective
NVDD   1× INVERSE  -$80,000 effective
```

Rules:
- gross is never visually replaced by net;
- net is signed and clearly labeled directional;
- incomplete positions remain visible in the group with an incomplete marker;
- if an incomplete member prevents authoritative group stress, state that explicitly rather than omitting it.

Mission Control / Today's Priorities receives **only actionable exceptions**, e.g.:
- NVDA gross exposure exceeds policy;
- leveraged holding/path risk materially increased;
- normalization incomplete on a held product;
- related-underlying concentration exceeds policy.

No new leverage dashboard.

---

## D. Opportunity → Expression Comparison

This is the primary new component.

```
NVDA — Bullish Opportunity
Underlying Opportunity Score: 86

Expression          Score   Capital   POP    -10% Stress   Risk Status
Bull Put Spread       88     $2,500    74%      $___        Within policy
NVDU 2× Long          84     $8,000     —      $1,600       Within policy
CSP                    81    $17,000    78%      $___        Within policy
LEAPS                  79     $6,200     —      $___        Within policy
```

### Rules
- one underlying opportunity, multiple trade expressions;
- underlying score is visually distinct from expression score;
- a leveraged expression may rank first or last;
- no leverage badge color/wording implies good/bad by itself;
- hard-gate failures appear outside eligible ranking:
  `FAIL — Portfolio Risk Limit`;
- incomplete normalization appears:
  `NOT COMPARABLY RANKED`;
- POP may be N/A for expressions where the metric is not meaningful/comparable;
- capital, stress and risk status remain visible enough to prevent score-only selection.

### Selection
Selecting an expression opens the existing trade-detail workflow with its full risk evidence. No new parallel order/recommendation workflow.

---

## E. Analyze With AI

No new chat UI. Structured context passed to AI should include:
- instrument classification;
- economic underlying;
- signed leverage multiplier/reset;
- normalization confidence;
- capital required/deployed;
- initial effective exposure;
- stress matrix;
- same-underlying gross/net portfolio exposure;
- hard-gate results;
- layered-leverage marker;
- risk-model version.

AI explanations must preserve canonical labels and may not convert approximate stress into predicted/expected loss.

---

## F. Accessibility & error-state requirements

- Do not rely on color alone for LONG/INVERSE, PASS/FAIL, or confidence.
- Every badge has text.
- Approximation/incomplete states have textual explanation.
- Tables remain understandable in narrow layouts via label/value stacking.
- Missing data displays “Unavailable” or the explicit incomplete state, never zero.
- Tooltips supplement rather than contain required risk information exclusively.

---

## Acceptance checks

Diane:
- leverage context obvious in scanner without dominating ordinary rows;
- detail explains capital vs effective exposure;
- economic-underlying roll-up preserves gross and net;
- expression comparison is understandable without requiring derivatives jargon.

Ian:
- no risk understatement or misleading statistical labels;
- daily-reset/path limitation visible;
- hard-gate failure cannot look like merely a weaker score.

Alan:
- every displayed field maps to canonical Gate 1/2 domain evidence or later canonical scoring contract;
- UI does not recompute exposure/risk.

Quinn:
- explicit incomplete, unavailable, hard-fail, layered-leverage and narrow-layout states are testable.
