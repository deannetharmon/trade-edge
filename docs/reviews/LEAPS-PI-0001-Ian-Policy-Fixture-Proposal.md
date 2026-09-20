# LEAPS-PI-0001 — Initial Policy Fixture and Golden-Case Proposal

**Status:** Proposal for product approval; not enabled as an automatic rule.  
**Policy owner:** Ian  
**Purpose:** Supply one versioned, explainable starting configuration for the
canonical evaluator. Each value is visible and editable through the mandate
where the product permits it.

## Existing-policy values retained

These values already exist in TradeEdge's PMCC policy and should be consumed,
not duplicated:

| Rule | Existing value |
|---|---:|
| New LEAPS entry DTE range | 270–720 |
| Long-call delta range | 0.70–0.85 |
| Short-call DTE range | 21–45 |
| Short-call delta range | 0.20–0.35 |
| Long and short minimum OI | 100 |
| Preferred quote spread | 5% maximum |
| Qualifying quote spread | 10% maximum |
| Quote age | No more than 120 seconds old |

## Proposed `LEAPS-PI-1.1` additions

| Policy | Proposed value | Reason / effect |
|---|---:|---|
| Broker position/order snapshot age | 5 minutes | A Review state requires a current attributable broker snapshot. |
| Event-data age | 15 minutes | A stale/unknown event result is Monitor, never clear. |
| Existing-position review threshold | 180 DTE | Below it requires thesis review, not an automatic close or a reclassification of the original entry. |
| Minimum long DTE remaining after short expiry | 120 DTE | Active-cycle/revalidation floor after a short call is open; it is not a redundant new-cycle gate because long-call health and short-DTE rules already govern new-cycle entry. |
| Conservative credit basis | Short-call bid | Never present midpoint as executable credit. |
| Quote rule | Two-sided, non-crossed | Missing/crossed quotes block review. |

The 120-DTE buffer and the profile percentages below are proposed,
user-visible v1 defaults pending product approval. They are never silent
universal thresholds, forecasts, or recommendations.

## Mandate profiles — configurable starting choices

These are starting profiles, not forecasts or promises. The trader confirms
or edits them before an income-call Review state becomes possible.

| Profile | Minimum upside participation to thesis target | Income-cap strike | Known earnings cycle | Intended tradeoff |
|---|---:|---|---|---|
| Upside-first | 70% | User required | Not permitted | Preserve most target upside; fewer cycles. |
| Balanced | 55% | User required | Not permitted | Permit income only when meaningful upside remains. |
| Income-first | 40% | User required | User must explicitly opt in | More income opportunity; materially tighter upside cap. |

All profiles inherit 21–45 DTE, 0.20–0.35 delta, OI ≥100, two-sided quotes,
10% maximum qualifying spread, and 120-second quote freshness. The trader
may narrow—not silently relax—these boundaries unless a future policy change
is approved and versioned.

## Deterministic state examples

| Facts | Required state |
|---|---|
| Exact foundation, fresh data, no active short, all gates pass, 64% participation against Balanced 55% minimum | Review income call |
| Same facts, but 39% participation against Balanced 55% minimum | Hold uncovered |
| Valid candidate but short strike below saved income-cap strike | Monitor: preference-not-met |
| Valid candidate but target/high is missing or at/below current underlying | Monitor: preference-not-met |
| Known earnings inside cycle and mandate disallows it | Monitor: event-window |
| Earnings/event data unknown or stale | Monitor: event-data-unavailable |
| Existing short call or working order consumes the only long contract | Monitor: capacity-reserved |
| Existing long DTE below 180 | Reassess thesis |
| Active-cycle revalidation finds fewer than 120 DTE after short expiry | Management review; do not extend/replace automatically |
| Quote older than 120 seconds, one-sided, or crossed | Not ready |
| Market closed while broker identity/data are otherwise current | Market closed |

## Golden-case matrix

The evaluator and PMCC handoff must have exact fixture tests for:

1. All four mandate profiles plus no-mandate health-only mode.
2. Target-participation equality at the threshold and one cent/one basis point
   on either side.
3. Income-cap equality and short-strike failure.
4. New-entry DTE boundaries at 270/720, existing-position review at 180, and pairing-buffer boundary at 120.
5. Broker snapshot, order, quote, and event freshness at the exact threshold,
   just inside, and just outside.
6. Missing, one-sided, crossed, stale, and delayed quotes.
7. Missing entry debit and unavailable capital-percentage calculation.
8. Known allowed/disallowed earnings, unknown earnings, ex-dividend, and
   corporate-action/assignment warning states.
9. Exact OCC/account/capacity mismatch and revalidation change of candidate,
   strike, credit, delta, DTE, quantity, or quote timestamp.
10. Append-only mandate, decision, outcome, idempotency, authorization, and
    feature-flag rollback behavior.

## Approval requested

Approve or revise the two new policy additions before Dane begins build:

1. **120 DTE minimum remaining long horizon after a short-call expiry.**
2. **55% / 70% / 40% initial upside-participation profile defaults.**

All other values are current TradeEdge PMCC configuration or direct
fail-closed data-safety rules.
