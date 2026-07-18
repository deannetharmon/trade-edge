// lib/portfolio/closeOrderSubmission.ts
//
// ES-0001 (Product Owner corrective round 2), REQUIRED CORRECTION #2: round
// 1's corrective diff imported `guardAgainstAmbiguousStructure` and
// `guardWithSafetyGate` at each submission call site in
// `app/portfolio/page.tsx`, but the actual `ttPost`/`ttPostComplex` broker
// call still happened as a SEPARATE statement afterward -- the guard
// functions were exercised, but nothing structurally prevented a future edit
// (or a bug) from reaching the broker call without going through them first.
// `submitCloseOrderIfSafe` below is the fix: the broker call must be written
// AS the callback passed to this function. There is no way to obtain a
// broker response from this module without the guards having already
// returned `allowed: true`.
//
// This module is the minimum orchestration extracted from
// `app/portfolio/page.tsx` to make that property unit-testable with a broker
// mock standing in for `ttPost`/`ttPostComplex`. It does not replicate order-
// body construction, GTC/OCO cancellation, roll input validation, or any
// React/UI state -- all of that remains exactly where it was in page.tsx.

import {
  runLiveCloseOrderSafetyGate,
  type CanonicalCloseIdentity,
  type LiveCloseOrderSafetyInput,
  type SafetyCheckResult,
} from './closeOrderSafety';

/** The structure-ambiguity fields already carried on `Position` in
 *  app/portfolio/page.tsx -- passed here rather than importing the `Position`
 *  type itself, to keep this module free of any page.tsx/React dependency. */
export interface AmbiguityGuardInput {
  identity: CanonicalCloseIdentity | null;
  structureAmbiguous: boolean;
  structureBlockMessage: string | null;
}

export interface GuardBlocked {
  allowed: false;
  reason: string;
  safetyCheck: SafetyCheckResult | null;
}

export interface GuardAllowed {
  allowed: true;
  safetyCheck: SafetyCheckResult;
}

export type GuardResult = GuardBlocked | GuardAllowed;

/**
 * Step 1: the structure-level guard. Must pass before a
 * `LiveCloseOrderSafetyInput` can even be constructed -- an ambiguous or
 * null identity has no canonical quantity or economics to check against.
 * Returns `null` when the structure is fine to proceed past (i.e. NOT
 * blocked at this step).
 */
export function guardAgainstAmbiguousStructure(input: AmbiguityGuardInput): GuardBlocked | null {
  if (!input.identity || input.structureAmbiguous) {
    return {
      allowed: false,
      reason: `AMBIGUOUS_POSITION_STRUCTURE -- ${input.structureBlockMessage ?? 'position structure could not be resolved unambiguously.'}`,
      safetyCheck: null,
    };
  }
  return null;
}

/** Step 2: the full economic/quote/payload safety gate. */
export function guardWithSafetyGate(gateInput: LiveCloseOrderSafetyInput): GuardResult {
  const safetyCheck = runLiveCloseOrderSafetyGate(gateInput);
  if (!safetyCheck.ok) {
    const reason = safetyCheck.issues.map(i => i.message).join(' ');
    return { allowed: false, reason, safetyCheck };
  }
  return { allowed: true, safetyCheck };
}

export type SubmitCloseOrderResult<T> =
  | { submitted: true; result: T; safetyCheck: SafetyCheckResult }
  | { submitted: false; reason: string; safetyCheck: SafetyCheckResult | null };

/**
 * THE single boundary every live close/roll/stop-loss submission must pass
 * through. `submitToBroker` is invoked if and ONLY IF both guards pass.
 * Write the actual `ttPost`/`ttPostComplex` call INSIDE the `submitToBroker`
 * callback at the call site -- do not call the guards separately and then
 * make a broker call as a following statement; that leaves the broker call
 * reachable independent of the guards passing, which is exactly what round
 * 1's corrective diff did and the Product Owner rejected.
 */
export async function submitCloseOrderIfSafe<T>(
  structureGuardInput: AmbiguityGuardInput,
  gateInput: LiveCloseOrderSafetyInput,
  submitToBroker: (safetyCheck: SafetyCheckResult) => Promise<T>
): Promise<SubmitCloseOrderResult<T>> {
  const structureBlock = guardAgainstAmbiguousStructure(structureGuardInput);
  if (structureBlock) {
    return { submitted: false, reason: structureBlock.reason, safetyCheck: structureBlock.safetyCheck };
  }

  const gateResult = guardWithSafetyGate(gateInput);
  if (!gateResult.allowed) {
    return { submitted: false, reason: gateResult.reason, safetyCheck: gateResult.safetyCheck };
  }

  const result = await submitToBroker(gateResult.safetyCheck);
  return { submitted: true, result, safetyCheck: gateResult.safetyCheck };
}
