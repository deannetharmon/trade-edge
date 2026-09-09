# POSITIONS-0005 — Standalone LEAPS Reviewed Stop

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Experience review:** Diane  
**Safety/release review:** Quinn  
**Status:** Ready for validation

## Problem

The Positions table currently shows a long LEAPS as `GTC None / Stop Unsupported` followed by a technical explanation. A trader holding a **standalone** long LEAPS cannot set a reviewed loss stop through TradeEdge, while a PMCC long LEAPS must not be stopped independently because it supports a short call.

## User value

For a standalone long LEAPS, the trader can choose a maximum loss in plain percentage terms, see the corresponding stop price and dollar consequence, and explicitly review a broker order. A PMCC remains safe from an accidental long-leg-only close.

## Product decisions

1. This ticket applies only to a standalone long LEAPS with a complete canonical close identity and complete original debit economics.
2. The trader must explicitly choose one maximum-loss threshold: **25%, 35%, or 50%** of original entry debit. There is **no preselected default**.
3. For entry debit `D` per contract and selected loss `L`, the stop trigger is `D × (1 − L)`.
4. The stop is optional. No selection and no confirmation means no broker order is created.
5. The stop must be reviewed and confirmed before broker submission. It must use the existing canonical close identity, fresh quote evidence, and live close-order safety gate.
6. A LEAPS paired with a short call (or with ambiguous/missing pairing evidence) is **PMCC-managed** and remains observation-only in this release. No standalone long-leg stop, cancel, replacement, or submission action is available.
7. Profit-protection ratchets and credit-spread formulas do not apply to LEAPS.

## Scope

### 1. Position classification and eligibility

Create one typed predicate/evaluator used by the Positions surface. It must distinguish:

- `ELIGIBLE_STANDALONE_LEAPS`: long LEAPS, complete canonical identity and original-debit economics, no paired short call;
- `PMCC_MANAGED`: known paired short call, or pairing/structure state is not sufficiently reliable to safely act on the long leg alone;
- `UNAVAILABLE`: incomplete identity, missing original debit, missing required quote evidence, or unsupported structure.

Do not infer standalone eligibility from display labels or a single option leg.

### 2. Reviewed stop proposal

For an eligible standalone LEAPS:

- Replace the current technical unsupported copy with: **`No stop set — choose your maximum loss.`**
- Present three unselected choices: `25%`, `35%`, `50%`.
- After selection, show the calculated order in the same compact view:
  - `Stop $13.00 · −35% from $20.00 entry debit`
  - Include whole-position dollars when quantity is known: `about −$700 if filled near the trigger`.
- The value shown must be derived from original entry debit, rounded to broker-valid price precision, and exactly match the submitted trigger.
- Selection only prepares the review; it must not submit an order.

### 3. Confirmation and order safety

The confirmation modal must show:

- original debit and selected maximum-loss percentage;
- current reliable marketable price and quote state;
- proposed stop trigger in dollars, percent, and expected dollar result;
- the intended close legs and quantity;
- explicit `Confirm & Submit` action.

Submission must use the existing `submitCloseOrderIfSafe` boundary and required current quote evidence. Missing, one-sided, crossed, stale, or degraded quote evidence blocks review/submission with a concise explanation. Persist the individual broker stop order id and stop-policy provenance after successful submission.

### 4. PMCC presentation

For `PMCC_MANAGED`, replace the generic unsupported explanation with:

> This LEAPS supports a short call, so it is managed with the paired position—not stopped on its own.

Show no standalone stop control. Existing paired-position actions remain unchanged. A future PMCC policy will decide how to close, roll, or protect both legs together.

## Diane’s experience requirements

1. Keep the table state compact. Do not place long explanatory or broker-response text over neighboring columns.
2. Put detailed order, quote, and broker information in the review modal; table confirmation is a compact in-cell status only.
3. Dollar and percentage meanings are always paired. Do not show a stop price alone.
4. Preserve keyboard navigation and clear focus in the threshold chooser and review modal.
5. The PMCC explanation must be direct and non-alarming; it is a deliberate safeguard, not an error.

## Non-goals

- A default loss threshold for LEAPS.
- Automatic stop creation, cancellation, or replacement.
- Stop policies for PMCC long legs, covered calls, debit spreads, or other debit strategies.
- Credit-spread profit-protection ratchets.
- Changing existing PMCC management actions.

## Acceptance criteria

1. An eligible standalone LEAPS displays `No stop set — choose your maximum loss` and offers 25%, 35%, and 50% with no preselected choice.
2. For an entry debit of $20.00, choices calculate exactly: 25% → $15.00, 35% → $13.00, 50% → $10.00.
3. The displayed percentage and dollar loss meaning match the order payload at review and submission.
4. No broker request occurs before explicit confirmation; every broker-bound request passes the existing identity and fresh-quote safety gate.
5. Quote or identity uncertainty blocks action without fabricating a price or stop recommendation.
6. PMCC-managed or pairing-ambiguous LEAPS show the paired-position explanation and never expose a standalone stop action.
7. Successful submission persists the individual broker order id and provenance; post-submit table feedback is compact and does not overlap columns.

## Implementation notes

- Reuse the existing debit-stop policy model only after the trader chooses the percentage; do not add a silent default.
- Reuse the current stop-order broker orchestration and `submitCloseOrderIfSafe`; do not add a broker call outside that boundary.
- Add pure unit tests for eligibility, formula calculation, no-default state, PMCC exclusion, and quote/identity blocking. Add wiring tests proving the broker submission remains guarded.

## Validation steps

1. Run focused eligibility/formula/policy tests and the existing close-order safety tests.
2. Run TypeScript validation.
3. In paper/dry-run mode, verify each threshold produces the expected stop trigger and no order is sent until confirmation.
4. Verify a paired PMCC and an ambiguous pairing cannot open the standalone LEAPS stop workflow.
5. Verify successful and failed submissions use compact in-cell feedback and do not overlap table columns.

## Rollout notes

- Start in dry-run/paper mode.
- Quinn must verify one successful broker-response persistence path and one safety-gate rejection before live enablement.
