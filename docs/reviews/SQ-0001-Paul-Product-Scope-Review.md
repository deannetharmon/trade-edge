# SQ-0001 — Paul Independent Product & Scope Review

**Reviewer role:** Product/specification ownership and scope discipline  
**Baseline:** SQ-0001 forensic audit on `main` at `b8fe19b1f6cbb2e2797dd362d9a8ac994464caca`  
**Disposition:** **Audit accepted. Product contract requires redesign before implementation.**

## 1. Independent Ruling

The Screener's current product promise and its technical evidence are out of alignment.

TradeEdge is intended to function as an intelligent decision engine, not merely a sortable options table. A user who sees a candidate labeled `Strong`, graded `A/A+`, or scored near 100 is entitled to believe that TradeEdge has strong evidence that the **trade setup itself** is strong. Today the number is an additive mixture of underlying-direction heuristics and option-contract economics. It does not establish that the underlying thesis is strong before rewarding the contract.

That is the core product defect.

I agree with the forensic audit that remediation should not begin as threshold tuning. We first need to specify what decision TradeEdge is making and what each displayed judgment means.

## 2. Product Contract That Exists Today

The UI effectively communicates a hierarchy:

- Strong
- Acceptable
- Marginal
- Avoid

and elsewhere exposes grades / `/100` style scoring.

The implementation, however, produces a composite rank in which IVR, expected-move clearance, liquidity, OTM buffer, delta quality and other dimensions can offset weak directional evidence. Trend `confidence` is also heuristic rather than empirical probability.

Therefore the user-facing semantics currently overstate what the system has proven.

## 3. Product Contract I Recommend

The Screener should answer four distinct questions in order:

### Stage 1 — Is there a tradeable underlying setup?

Classify the underlying state: bullish continuation, bullish reversal, bearish continuation, bearish reversal, range, chaotic/extended, or insufficient/conflicting evidence.

This stage must stand on underlying market evidence only. Option premium cannot make the underlying setup become valid.

### Stage 2 — Which strategies are eligible for that setup?

The setup authorizes strategy families. Examples:

- validated bullish setup -> BPS may be eligible;
- validated bearish setup -> BCS may be eligible;
- validated range setup -> IC may be eligible;
- conflicting/chaotic/insufficient setup -> no new recommendation.

Reversal should remain explicitly distinguishable from continuation because the product should not imply equivalent maturity or reliability unless validation proves it.

### Stage 3 — Which contract is best within the eligible strategy?

Only now should TradeEdge rank strikes/expirations using POP/delta, expected-move clearance, OTM buffer, liquidity, credit/ROC, IV environment, DTE and other contract economics.

### Stage 4 — What should the user understand and do?

The recommendation should expose the rationale separately:

- underlying thesis;
- thesis strength / evidence quality;
- contract quality;
- key risks / invalidation conditions;
- final action state.

A single opaque number should not be responsible for communicating all five.

## 4. Score Semantics

Until empirical calibration exists, I recommend that TradeEdge stop treating a 0–100 heuristic as though it were probability-like confidence.

If a numeric score remains, its label must describe what it is, e.g. `Setup Quality` or `Contract Quality`, with documented inputs. `Confidence` should be reserved for a calibrated quantity or explicitly named `Evidence Strength` if it remains heuristic.

`Strong` should mean the setup has satisfied a defined high-quality contract, not merely crossed an additive threshold.

Grades such as A+ should not survive unless the team can state exactly what an A+ guarantees relative to A/B candidates and validate that distinction historically.

## 5. Scope Boundaries for SQ-0001 Remediation

SQ-0001 should solve **decision quality and truthfulness**, not become an unlimited quant platform rewrite.

### In scope

- correct semantic calculation defects identified by the audit;
- separate underlying-thesis eligibility from contract ranking;
- define strategy eligibility states;
- make horizon/DTE semantics explicit;
- improve market-structure inputs where justified by the approved design;
- rename/restructure score semantics;
- create historical replay and validation capability sufficient to evaluate the model;
- preserve explainability so a user can understand why a recommendation exists;
- version decision/config contracts for later outcome review.

### Out of scope unless separately approved

- automated trade execution;
- portfolio sizing redesign;
- Wheel/PMCC/CC architecture changes unrelated to Screener decision quality;
- broad UI redesign outside the recommendation semantics needed for SQ-0001;
- machine-learning model deployment merely because historical data becomes available;
- adding dozens of indicators without evidence that they improve decisions.

## 6. Product Acceptance Questions

Before implementation is frozen, the team must be able to answer:

1. What exactly is the Screener recommending: an underlying thesis, a strategy, a contract, or all three as separate decisions?
2. What evidence is required before a directional thesis becomes eligible?
3. What does reversal mean operationally compared with continuation?
4. How is a candidate handled when the contract is excellent but the thesis is weak?
5. What does every displayed score/label mean in plain English?
6. Which labels are empirical and which are heuristic?
7. How does the user see conflicting evidence?
8. How does DTE affect the validity of the underlying thesis?
9. What historical result is sufficient for us to call a tier `Strong`?
10. What happens when evidence is insufficient? The product must be willing to say `No Trade` rather than manufacture a ranked answer.

## 7. Product Acceptance Criteria for the Architecture

I will consider the design product-ready for implementation when:

- the underlying thesis cannot be rescued by attractive option economics;
- every recommended directional strategy has an explicit authoritative thesis;
- continuation, reversal, range and no-trade states are first-class;
- contract ranking occurs only among eligible strategies;
- numeric labels have explicit semantics and do not imply unvalidated probability;
- the user can see why the setup qualified and what would invalidate it;
- score/config version is recoverable for outcome analysis;
- the design supports historical validation without changing the live decision contract;
- the system can return no recommendation when evidence is inadequate.

## 8. Paul Recommendation to the Team

Accept Dane's forensic audit as the current-state baseline. Accept Quinn's requirement for invariant-based and historical validation. Alan should now synthesize a replacement decision architecture around a staged model:

**Underlying evidence -> setup classification/eligibility -> strategy eligibility -> contract ranking -> recommendation explanation.**

Do not send Dane a collection of isolated fixes. Send one frozen implementation specification after architecture, quant, trader and safety/testability rulings are reconciled.

**Paul status:** Independent product/scope review complete. Ready for synthesis.