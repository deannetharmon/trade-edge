// lib/portfolio/pendingOrderReplacementSubmission.ts
//
// ES-0002: the broker-boundary wrapper for pending-order replacement/restore,
// analogous in discipline to `closeOrderSubmission.ts`'s
// `submitCloseOrderIfSafe` (ES-0001). The literal `ttPost` call for a
// replacement or a restore must exist ONLY inside the `submitToBroker`
// callback passed to the corresponding function below -- never as a
// following statement after a guard check. That "guard, then separate
// broker call" shape was explicitly rejected during ES-0001 (it left the
// broker call reachable independent of the guard's result) and must not be
// reintroduced here.
//
// This module does not decide WHEN to cancel the existing order -- that
// remains `app/portfolio/page.tsx`'s `replacePendingOrder` orchestration,
// exactly as `closeOrderSubmission.ts` leaves order-body construction and
// GTC/OCO cancellation to `page.tsx`. What this module guarantees is narrower
// and absolute: `submitToBroker` runs if and only if the corresponding gate
// passed.

import {
  runPendingOrderReplacementSafetyGate,
  runPendingOrderRestoreSafetyGate,
  buildPendingOrderReplacementPlan,
  buildPendingOrderRestorePlan,
  type PendingOrderReplacementSafetyInput,
  type PendingOrderRestoreSafetyInput,
  type PendingOrderReplacementSafetyCheckResult,
  type PendingOrderEvidence,
  type ActualReplacementOrderEvidence,
} from './pendingOrderReplacementSafety';

export type SubmitPendingOrderReplacementResult<T> =
  | { submitted: true; result: T; safetyCheck: PendingOrderReplacementSafetyCheckResult }
  | { submitted: false; reason: string; safetyCheck: PendingOrderReplacementSafetyCheckResult };

/**
 * THE single boundary every live pending-order REPLACEMENT submission must
 * pass through. `submitToBroker` runs if and only if
 * `runPendingOrderReplacementSafetyGate` returns `ok: true`. Write the
 * literal `ttPost` call INSIDE this callback at the call site.
 */
export async function submitPendingOrderReplacementIfSafe<T>(
  gateInput: PendingOrderReplacementSafetyInput,
  submitToBroker: (safetyCheck: PendingOrderReplacementSafetyCheckResult) => Promise<T>
): Promise<SubmitPendingOrderReplacementResult<T>> {
  const safetyCheck = runPendingOrderReplacementSafetyGate(gateInput);
  if (!safetyCheck.ok) {
    return { submitted: false, reason: safetyCheck.issues.map(i => i.message).join(' '), safetyCheck };
  }
  const result = await submitToBroker(safetyCheck);
  return { submitted: true, result, safetyCheck };
}

/**
 * THE single boundary every live pending-order RESTORE submission must pass
 * through (the automatic recovery attempted when a replacement fails after
 * the original order was already cancelled). Reuses the identical
 * fail-closed shape as `submitPendingOrderReplacementIfSafe` -- restoration
 * is not a lesser-validated path.
 */
export async function submitPendingOrderRestoreIfSafe<T>(
  gateInput: PendingOrderRestoreSafetyInput,
  submitToBroker: (safetyCheck: PendingOrderReplacementSafetyCheckResult) => Promise<T>
): Promise<SubmitPendingOrderReplacementResult<T>> {
  const safetyCheck = runPendingOrderRestoreSafetyGate(gateInput);
  if (!safetyCheck.ok) {
    return { submitted: false, reason: safetyCheck.issues.map(i => i.message).join(' '), safetyCheck };
  }
  const result = await submitToBroker(safetyCheck);
  return { submitted: true, result, safetyCheck };
}

// ---------------------------------------------------------------------------
// Full cancel/replace/restore orchestration -- extracted from
// `app/portfolio/page.tsx`'s `replacePendingOrder` so its ordering
// guarantees (pre-cancel rejection, cancel-then-replace, restore-only-on-
// post-cancel-failure, no-restore-on-success) are independently unit
// testable with mocked cancel/post functions, not just verifiable by
// inspection. `page.tsx` itself becomes a thin adapter: real `ttDelete`/
// `ttPost`/`buildReplaceOrder` wired in as `deps`, and the returned
// discriminated result mapped onto `setError`/`fetchPositions`/UI state.
// -- Generic over `TOrderBody`/`TBrokerResult` so this module has no
// dependency on page.tsx's `OrderBody` type.
// ---------------------------------------------------------------------------

export interface PendingOrderReplacementWorkflowDeps<TOrderBody, TBrokerResult> {
  /** Cancels the existing pending complex order. Cancellation-only -- no
   *  economic validation happens here or is expected of it. */
  cancelExistingOrder: () => Promise<void>;
  /** Builds the exact broker order body for a given limit price (points).
   *  Called once per submission attempt; the SAME returned object is what
   *  gets cross-checked and posted -- never rebuilt in between. */
  buildOrderBody: (limitPricePoints: number) => TOrderBody;
  /** Reads the actual-payload cross-check evidence back out of the order
   *  body `buildOrderBody` just returned. */
  toActualOrder: (orderBody: TOrderBody) => ActualReplacementOrderEvidence;
  /** Submits the order body to the broker. Must be the literal `ttPost`
   *  call at the real call site -- this function itself only ever invokes
   *  it via `submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe`'s
   *  guarded callback. */
  postOrder: (orderBody: TOrderBody) => Promise<TBrokerResult>;
  /** Optional delay between cancel and post (the real call site waits 500ms
   *  for TastyTrade's cancellation to settle). Omitted in tests. */
  waitBetweenCancelAndPost?: () => Promise<void>;
}

export type PendingOrderReplacementWorkflowResult<TBrokerResult> =
  | { kind: 'REJECTED_BEFORE_CANCEL'; reason: string }
  | { kind: 'CANCEL_FAILED'; reason: string }
  | { kind: 'REPLACED'; result: TBrokerResult }
  | { kind: 'RESTORED'; result: TBrokerResult; replaceError: string }
  | { kind: 'RESTORE_BLOCKED'; replaceError: string; restoreReason: string }
  | { kind: 'RESTORE_FAILED'; replaceError: string; restoreError: string };

/**
 * The full pending-order replace workflow: deterministic pre-cancel
 * validation, cancel, guarded replacement submission, and -- only if the
 * replacement fails after a successful cancel -- a guarded restore
 * submission at the ORIGINAL order's own price. Every broker-reaching call
 * (`deps.cancelExistingOrder`, and every `deps.postOrder` invocation) is
 * either gated by the pre-cancel plan or wrapped in
 * `submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe` --
 * there is no path from this function to `deps.postOrder` that skips a gate.
 */
export async function runPendingOrderReplacementWorkflow<TOrderBody, TBrokerResult>(
  evidence: PendingOrderEvidence,
  requestedLimitPricePoints: number,
  deps: PendingOrderReplacementWorkflowDeps<TOrderBody, TBrokerResult>
): Promise<PendingOrderReplacementWorkflowResult<TBrokerResult>> {
  // Deterministic, no-network-I/O pre-cancel guard. A known-invalid request
  // (bad price, or an order whose own identity/legs/price-effect are
  // unusable) never reaches `cancelExistingOrder`.
  const preCancelPlan = buildPendingOrderReplacementPlan(evidence, requestedLimitPricePoints);
  if (!preCancelPlan.ok) {
    return { kind: 'REJECTED_BEFORE_CANCEL', reason: preCancelPlan.message };
  }

  try {
    await deps.cancelExistingOrder();
  } catch (e: any) {
    return { kind: 'CANCEL_FAILED', reason: e?.message ?? 'unknown error' };
  }

  if (deps.waitBetweenCancelAndPost) {
    await deps.waitBetweenCancelAndPost();
  }

  try {
    const orderBody = deps.buildOrderBody(requestedLimitPricePoints);
    const actualOrder = deps.toActualOrder(orderBody);
    const submission = await submitPendingOrderReplacementIfSafe(
      { evidence, requestedLimitPricePoints, actualOrder },
      async () => deps.postOrder(orderBody)
    );
    if (!submission.submitted) {
      throw new Error(submission.reason);
    }
    return { kind: 'REPLACED', result: submission.result };
  } catch (replaceErr: any) {
    const replaceError = replaceErr?.message ?? 'unknown error';

    // The existing order is already cancelled -- attempt the one automatic
    // recovery, at the order's own original price, through the identical
    // guarded boundary. Never substitutes `requestedLimitPricePoints` (the
    // failed replacement's price) for the missing/invalid original.
    const restorePlan = buildPendingOrderRestorePlan(evidence);
    if (!restorePlan.ok) {
      return { kind: 'RESTORE_BLOCKED', replaceError, restoreReason: restorePlan.message };
    }

    try {
      const restoreOrderBody = deps.buildOrderBody(restorePlan.plan.limitPricePoints);
      const restoreActual = deps.toActualOrder(restoreOrderBody);
      const restoreSubmission = await submitPendingOrderRestoreIfSafe(
        { evidence, actualOrder: restoreActual },
        async () => deps.postOrder(restoreOrderBody)
      );
      if (!restoreSubmission.submitted) {
        throw new Error(restoreSubmission.reason);
      }
      return { kind: 'RESTORED', result: restoreSubmission.result, replaceError };
    } catch (restoreErr: any) {
      return { kind: 'RESTORE_FAILED', replaceError, restoreError: restoreErr?.message ?? 'unknown error' };
    }
  }
}
