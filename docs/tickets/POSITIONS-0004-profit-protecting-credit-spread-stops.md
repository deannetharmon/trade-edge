# POSITIONS-0004 — Profit-Protecting Credit-Spread Stop Adjustments

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Experience review:** Diane  
**Safety/release review:** Quinn  
**Status:** Ready for validation — initial-entry OTOCO protection is implemented separately; this ticket governs post-entry protection adjustments.

## Problem

Defined-risk credit-spread entries can now start with an OCO profit target and stop-loss pair, but a static entry stop does not protect realized opportunity as the spread becomes profitable. The trader needs a clear, reviewable way to tighten the stop as profit accumulates without creating an accidental widening of risk or silently replacing a live broker order.

## User value

The trader begins with a deterministic protective stop and can preserve gains as a credit spread moves favorably. Every proposed adjustment is understandable in dollars and percentages, and the trader remains in control of a live-order replacement.

## Product decisions

1. Initial defined-risk credit-spread stop default: **2× original entry credit**.
2. This ticket covers BPS, BCS, and IC positions with complete canonical credit-entry economics and a broker-identifiable working stop/OCO pair.
3. A stop may only tighten in the favorable direction: for a debit-to-close stop, the replacement trigger must be lower than the currently working trigger. The system must never automatically widen a protective stop.
4. TradeEdge may calculate and present a proposed protection adjustment, but it must not silently cancel or replace a working OCO pair. The trader explicitly reviews and confirms each replacement.
5. Ian-approved ratchet stages for this release are: at 50% profit captured, offer break-even; at 65%, offer a stop that locks 25% of original credit; at 75%, offer a stop that locks 50% of original credit. The profit target remains separately configurable.
6. PMCC, long-LEAPS, debit spreads, CSPs, covered calls, and other debit/thesis-driven positions are out of scope until their distinct exit policies are approved.

## Scope

### 1. Versioned protection policy

Create one typed, versioned policy for defined-risk credit spreads that records:

- initial stop multiple (2× original credit for this release);
- approved profit-capture stages and their proposed stop values: 50% captured → break-even; 65% captured → lock 25% of original credit; 75% captured → lock 50% of original credit;
- reference basis for every price and percentage;
- strategy applicability;
- stale/missing quote behavior;
- policy version and effective date.

The policy must not be embedded in JSX or copied into independent management paths.

#### Approved credit-spread formulas

Let `C` be the original entry credit per contract and `S` be the replacement buy-to-close stop trigger per contract. For a credit spread, realized P/L at stop is `C − S`.

| Profit capture observed | Proposed protection | Stop trigger `S` | Meaning at fill |
| --- | --- | --- | --- |
| Entry | Initial protection | `2.00 × C` | `−100%` of original credit |
| 50% | Break-even | `1.00 × C` | `0%` P/L |
| 65% | Lock 25% credit | `0.75 × C` | `+25%` of original credit |
| 75% | Lock 50% credit | `0.50 × C` | `+50%` of original credit |

The evaluator proposes a stage only when its calculated trigger is strictly lower than the current broker-recognized trigger. A more-protective existing stop stays unchanged.

### 2. Advisory adjustment evaluation

For an eligible position, compute an advisory state using the current broker-recognized OCO/stop and marketable close evidence:

- no change proposed;
- a tighter stop is available;
- current stop already protects the same or more profit;
- adjustment unavailable because identity, quote, or working-order evidence is incomplete.

The evaluator must use the same canonical close identity and broker-order evidence used by the existing stop management workflow. It must not infer a stop from a displayed card or stale local state.

### 3. Reviewed OCO replacement

When the trader elects to tighten protection:

1. show the existing profit target and stop alongside the proposed pair;
2. show dollar prices and their percentage meanings relative to original credit;
3. state whether the proposed stop locks a loss, breaks even, or locks a profit;
4. require explicit confirmation before cancelling the existing OCO;
5. submit the replacement OCO through the existing broker safety gate;
6. persist the individual stop-order id and complex-order id from the broker response;
7. on failure after cancellation, follow the existing restoration behavior and disclose the resulting protection state.

## Diane’s experience requirements

1. Use plain, paired labels at every decision point: `profit target $0.63 · 50% captured` and `stop trigger $2.50 · 200% of credit / −100% P/L` are the model. Never show a dollar price without its reference percentage.
2. Clearly distinguish **current working protection**, **proposed protection**, and **result after confirmation**. The user must not mistake an advisory suggestion for a broker-submitted change.
3. Make the favorable-direction rule visible: `This adjustment tightens protection; it does not widen your stop.` If a proposed value would widen risk, disable the action and explain why.
4. Keep the primary decision compact. Details such as order IDs, price source, quote time, policy version, and replacement/recovery state belong in expandable detail.
5. Preserve keyboard access, focus management, and readable narrow-width behavior for the review and confirmation states.

## Non-goals

- Automatically cancelling/replacing a live OCO pair.
- Expanding or changing the approved ratchet stages without an explicit policy update.
- Applying a credit-spread stop formula to debit, PMCC, LEAPS, or equity strategies.
- Changing the initial-entry OTOCO payload beyond the already-approved 2×-credit default.

## Acceptance criteria

1. A newly opened eligible credit spread defaults to a 2×-original-credit stop in its entry OTOCO bracket.
2. The management surface identifies whether a working stop can be tightened using the approved policy and current broker evidence.
3. Stage calculations use the formulas above against original entry credit, rounded to broker-valid price precision; their displayed dollar values and P/L percentages agree with the submitted payload.
4. No automatic path widens a stop; attempted widening is blocked and explained.
5. A replacement requires explicit trader confirmation and sends the target plus stop as one OCO pair.
6. The UI presents every current/proposed exit value in dollars and percentages, including the P/L meaning of the stop.
7. Missing/stale quote, ambiguous position, incomplete entry economics, or incomplete broker-order identity produces an unavailable state rather than a proposed replacement.
8. Broker response identities and the policy version are persisted so reload/classification recognizes the replacement as TradeEdge-managed.
9. Tests cover: initial 2× default; 50%-captured break-even proposal; 65%-captured 25%-credit lock proposal; 75%-captured 50%-credit lock proposal; favorable-only tightening; widening block; confirmation before replacement; broker-rejection restoration; and reload recognition of the replacement OCO.

## Validation and rollout

Quinn verifies the payload and broker identities against a dry-run and a read-only post-fill refresh. Diane validates desktop and narrow layouts. Release behind a credit-spread stop-adjustment flag; review the first live replacements with Ian before broader enablement.
