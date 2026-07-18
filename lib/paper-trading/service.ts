// lib/paper-trading/service.ts
//
// PT-0001: the single orchestration layer API routes call. Combines
// validation, pricing, capital, ledger mutation, idempotency, and audit
// under one lock acquisition per request (see persistence/locking.ts's
// withPaperTradingLock) so a duplicate/concurrent submission can never race
// the check for either the idempotency record or capital availability.
//
// PT-0001 corrective round (fix #2/#3): an ACCEPTED open/close/reset now
// commits its ledger mutation, its one accepted audit event, and its
// idempotency record as a single atomic transaction via
// persistence/commit.ts's commitPaperMutation() — not as three separate
// writes. That same call re-verifies, atomically together with the write,
// that this request still owns the mutation lock, so a request whose lease
// expired mid-flight (and was reacquired by someone else) cannot silently
// commit; it throws LockLostError instead, which is surfaced to the caller
// as a safe-to-retry 'LOCK_LOST' error. Holding the lock alone was never
// treated as sufficient for atomicity — see persistence/commit.ts's module
// doc comment for the full reasoning. REJECTED attempts (validation,
// pricing, capital) and REPLAYED duplicates are still logged via the
// simpler, standalone appendPaperAuditEvent() — they mutate no ledger
// state, so they have nothing that needs to be atomic with them.
//
// PT-0001 corrective round (fix #4): manual-fill confirmation identity is
// never accepted from the client. Callers pass a PaperManualFillOverrideInput
// (price, reason, a confirmation flag — no identity, no timestamp);
// resolveManualOverride() below stamps the caller's SERVER-resolved userId
// (already authenticated by the API route via resolveAutopilotUserId()
// before req.userId ever reaches this file) and a server-generated
// timestamp into the full PaperManualFillOverride before it reaches
// pricing.ts or the audit trail.
//
// PT-0001 corrective round (fix #6): PaperTradingPosition.auditRefs is now
// genuinely populated — the accepted audit event's id is generated up
// front (createPaperAuditEventId()) so it can be threaded into both the
// audit event written to the trail AND the position's own auditRefs, in
// the same atomic commit.
//
// PT-0001 PO Round 3 (accepted/rejected audit semantics): openPaperPosition()
// and closePaperPosition() previously wrapped BOTH commitPaperMutation() and
// a couple of standalone, post-commit "observational" audit appends (stale-
// quote / manual-override confirmation notices) in the same try/catch as the
// commit itself. If the atomic commit succeeded but one of those *separate*
// appends then failed, the catch block wrote an entry_rejected/close_rejected
// event and RE-THREW -- falsely telling the caller an already-committed
// position mutation had failed, and leaving contradictory accepted +
// rejected audit evidence for the same operation. Fixed two ways:
//   1. Stale-quote-confirmed and manual-override-confirmed evidence is now
//      recorded as additional rule IDs on the PRIMARY accepted audit event
//      (see fillEvidenceRuleIds() below) -- the same event already commits
//      pricingSource/quoteAgeSeconds atomically with the ledger mutation, so
//      no separate post-commit event is needed to carry this evidence. There
//      is now nothing left to run between "commit confirmed success" and
//      "return the result" in either function -- a confirmed commit cannot
//      be converted into a rejection by anything downstream, because nothing
//      is downstream.
//   2. The remaining genuinely-separate observational appends -- the
//      duplicate-replay notices (entry_duplicate_replayed/
//      close_duplicate_replayed), and the standalone entry_rejected/
//      close_rejected notices written for PRE-commit rejections (validation/
//      pricing/lookup failures, which never reach commitPaperMutation() at
//      all) -- go through appendObservationalAuditEvent() below, which
//      swallows and reports (never throws) a failure in the append itself,
//      so a logging failure can never mask a confirmed replay as a failure,
//      nor mask a genuine rejection's real error with an unrelated one.
//
// No function in this file (or anything it imports) calls, imports, or is
// imported by the broker order-submission module or its order builders. See
// __tests__/liveIsolation.test.ts for the enforced boundary test.

import { appendPaperAuditEvent, createPaperAuditEventId } from './audit';
import { computeCapitalRequirement } from './capital';
import { buildIdempotencyWrite, checkIdempotency } from './idempotency';
import { closePosition, deriveLedgerView, markPosition, openPosition, resetLedger } from './ledger';
import { getPaperTradingLedger } from './persistence/store';
import { commitPaperMutation, LockLostError } from './persistence/commit';
import { withPaperTradingLock } from './persistence/locking';
import { buildFillEvidence, resolveClosingAction } from './pricing';
import {
  PaperTradingError,
  type PaperAuditEvent,
  type PaperCommitOutcomeClass,
  type PaperFillEvidence,
  type PaperLeg,
  type PaperManualFillOverride,
  type PaperManualFillOverrideInput,
  type PaperQuoteSnapshot,
  type PaperStrategy,
  type PaperTradingLedgerView,
  type PaperTradingPosition,
} from './types';
import { validateTicket } from './validation';

const CONTRACT_MULTIPLIER = 100;

function createPositionId(): string {
  return `paper_pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolves a client-supplied manual-fill CONSENT (price, reason, confirmed
 * flag) into the full, server-authoritative PaperManualFillOverride.
 * confirmedByUser and confirmedAt are NEVER taken from the client — see
 * this module's doc comment (fix #4).
 */
function resolveManualOverride(userId: string, input: PaperManualFillOverrideInput | null, now: Date): PaperManualFillOverride | null {
  if (!input) return null;
  if (!input.confirmed) {
    throw new PaperTradingError('MANUAL_OVERRIDE_CONFIRMATION_REQUIRED', 'Manual paper fill requires explicit confirmation.');
  }
  if (!input.reason || !input.reason.trim()) {
    throw new PaperTradingError('VALIDATION_ERROR', 'Manual paper fill requires a reason.');
  }
  return {
    manualPrice: input.manualPrice,
    reason: input.reason,
    confirmedAt: now.toISOString(),
    confirmedByUser: userId,
  };
}

function rejectionRuleId(e: unknown, fallback: string): string {
  return e instanceof LockLostError ? 'pt_lock_lost_commit_aborted' : fallback;
}

/**
 * PO Round 6: the ONLY commitOutcome that may ever produce a rejected audit
 * event (entry_rejected/close_rejected) is CONFIRMED_NOT_COMMITTED --
 * OUTCOME_UNKNOWN and INTEGRITY_FAILURE are NOT confirmed rejections, and a
 * MISSING or UNRECOGNIZED commitOutcome is not proof of anything either way,
 * so it must default to "skip", never to "record". The prior round's
 * `outcome === 'OUTCOME_UNKNOWN' || outcome === 'INTEGRITY_FAILURE'` check
 * had this backwards for the unclassified/unexpected case: anything that
 * wasn't explicitly one of those two known non-rejection classes fell
 * through to recording a rejection, which incorrectly treated an
 * unclassified error as if it were proof of non-commit. Exported so this
 * decision can be unit-tested directly, independent of whatever error shape
 * commitPaperMutation() happens to produce through its real call path (see
 * persistence/commit.ts's own boundary-classification guarantee, which
 * means an unclassified error can no longer reach here through THAT path --
 * this function's handling of the absent/unrecognized case is still an
 * independent, defense-in-depth layer, tested directly in isolation).
 */
export function shouldRecordCommitRejection(commitOutcome: PaperCommitOutcomeClass | undefined): boolean {
  return commitOutcome === 'CONFIRMED_NOT_COMMITTED';
}

/**
 * Additional rule IDs recording HOW an already-accepted fill was priced,
 * folded directly into the primary accepted audit event's ruleIds rather
 * than emitted as a separate post-commit event -- see this module's doc
 * comment. pricingSource is already a single value (never both stale and
 * manual at once), so at most one extra rule ID is added.
 */
function fillEvidenceRuleIds(fill: PaperFillEvidence): string[] {
  if (fill.pricingSource === 'stale_confirmed') return ['pt_stale_quote_confirmed'];
  if (fill.pricingSource === 'manual_paper_fill') return ['pt_manual_fill_override'];
  return [];
}

/**
 * Appends a purely OBSERVATIONAL audit event -- one that records something
 * for visibility but is never itself the authoritative evidence of a
 * mutation's outcome (duplicate-replay notices; the standalone rejection
 * notice for a PRE-commit rejection that never reached commitPaperMutation()
 * at all). If the append itself fails, that failure is reported (not
 * silently dropped) but never thrown -- a broken observational log must
 * never convert a confirmed result (a replay, or a distinct earlier error)
 * into a different, unrelated failure. See this module's doc comment.
 */
async function appendObservationalAuditEvent(userId: string, event: Omit<PaperAuditEvent, 'id'>, context: string): Promise<void> {
  try {
    await appendPaperAuditEvent(userId, event);
  } catch (auditError) {
    // No shared logger/telemetry sink exists in this codebase yet (checked);
    // console.error is the closest existing convention for a "log, don't
    // throw" background failure (see lib/scans/ranked-scan-runner.ts's
    // console.warn use for the same class of problem).
    console.error(`[paper-trading] observational audit event failed (${context}) for user ${userId}:`, auditError);
  }
}

export interface OpenPaperPositionRequest {
  userId: string;
  idempotencyKey: string;
  symbol: string;
  strategy: PaperStrategy;
  legs: PaperLeg[];
  expiration: string;
  quantity: number;
  quoteSnapshot: PaperQuoteSnapshot | null;
  staleConfirmed: boolean;
  manualOverride: PaperManualFillOverrideInput | null;
  entryRationale: string | null;
}

export interface PaperMutationResult {
  position: PaperTradingPosition;
  ledgerView: PaperTradingLedgerView;
  replay: boolean;
}

export async function openPaperPosition(req: OpenPaperPositionRequest): Promise<PaperMutationResult> {
  validateTicket({
    symbol: req.symbol,
    strategy: req.strategy,
    expiration: req.expiration,
    quantity: req.quantity,
    legs: req.legs,
  });

  // The idempotency payload is built from the CLIENT INPUT shape only
  // (manualOverride here is PaperManualFillOverrideInput, never the
  // server-resolved PaperManualFillOverride) so a server-generated,
  // per-attempt confirmedAt timestamp is never part of what a retry is
  // compared against -- including a nondeterministic server value in the
  // hash would make a legitimate retry of the same logical request fail to
  // replay cleanly. See idempotency.ts's canonicalize() doc comment.
  const idempotencyPayload = {
    symbol: req.symbol,
    strategy: req.strategy,
    legs: req.legs,
    expiration: req.expiration,
    quantity: req.quantity,
    quoteSnapshot: req.quoteSnapshot,
    manualOverride: req.manualOverride,
  };

  return withPaperTradingLock(req.userId, async (lockId) => {
    const idem = await checkIdempotency<PaperMutationResult>(req.userId, 'open', req.idempotencyKey, idempotencyPayload);
    if (idem.replay && idem.result) {
      // Observational only -- checkIdempotency() has already confirmed this
      // is a genuine replay of a previously-committed result. A failure to
      // log that observation must never turn a confirmed replay into an
      // apparent failure (see this module's doc comment).
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'entry_duplicate_replayed',
          operation: 'open',
          positionId: idem.result.position.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_idempotent_replay'],
        },
        'entry_duplicate_replayed',
      );
      return { ...idem.result, replay: true };
    }

    const now = new Date();
    const manualOverride = resolveManualOverride(req.userId, req.manualOverride, now);

    let entryFill: PaperFillEvidence;
    try {
      entryFill = buildFillEvidence({
        legs: req.legs,
        quantity: req.quantity,
        contractMultiplier: CONTRACT_MULTIPLIER,
        quoteSnapshot: req.quoteSnapshot,
        side: 'open',
        staleConfirmed: req.staleConfirmed,
        manualOverride,
        now,
      });
    } catch (e) {
      // Pre-commit rejection -- commitPaperMutation() is never reached, so
      // there is no committed state this could contradict. The append is
      // still non-throwing so a secondary logging failure here can never
      // mask the real (already-caught) rejection reason `e`.
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'entry_rejected',
          operation: 'open',
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_fill_evidence_rejected'],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        },
        'entry_rejected (pre-commit fill-evidence rejection)',
      );
      throw e;
    }

    const positionId = createPositionId();
    const eventId = createPaperAuditEventId();

    try {
      const result = await commitPaperMutation<PaperMutationResult>(req.userId, lockId, (_account, current) => {
        const view = deriveLedgerView(current);
        const openResult = openPosition(current, {
          positionId,
          idempotencyKey: req.idempotencyKey,
          userId: req.userId,
          symbol: req.symbol,
          strategy: req.strategy,
          legs: req.legs,
          expiration: req.expiration,
          quantity: req.quantity,
          contractMultiplier: CONTRACT_MULTIPLIER,
          entryFill,
          entryRationale: req.entryRationale,
          auditRefs: [eventId],
          now,
        });
        const nextView = deriveLedgerView(openResult.next);
        const result: PaperMutationResult = { position: openResult.position, ledgerView: nextView, replay: false };

        const auditEvent: PaperAuditEvent = {
          id: eventId,
          userId: req.userId,
          eventType: 'entry_accepted',
          operation: 'open',
          positionId: openResult.position.positionId,
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          pricingSource: entryFill.pricingSource,
          quoteAgeSeconds: entryFill.quoteAgeSeconds,
          capitalBefore: view.availableCapital,
          capitalAfter: nextView.availableCapital,
          cashBefore: current.cash,
          cashAfter: openResult.next.cash,
          // Stale-quote-confirmation and manual-override evidence is
          // recorded here, on the primary accepted event committed
          // atomically with the ledger mutation -- not as a separate
          // post-commit event. See this module's doc comment.
          ruleIds: ['pt_entry_accepted', ...fillEvidenceRuleIds(entryFill)],
        };

        return {
          next: openResult.next,
          auditEvent,
          idempotency: buildIdempotencyWrite(req.userId, 'open', req.idempotencyKey, idempotencyPayload, result),
          extra: result,
          verify: (account) => (account.paperTrading?.openPositions ?? []).some((p) => p.positionId === positionId),
        };
      });

      // Nothing runs between a confirmed commit success and returning it --
      // a confirmed commit can never be converted into a rejection by
      // anything downstream, because there is nothing downstream.
      return result;
    } catch (e) {
      // PO Round 6: ONLY a proven CONFIRMED_NOT_COMMITTED outcome may ever
      // produce an entry_rejected event -- see shouldRecordCommitRejection()'s
      // doc comment. OUTCOME_UNKNOWN and INTEGRITY_FAILURE are NOT confirmed
      // rejections (the accepted mutation may already exist), and a MISSING
      // or UNRECOGNIZED commitOutcome is not proof the mutation didn't
      // commit either -- an unclassified error must never be treated as
      // evidence of rejection. The defensive fallback below never records a
      // rejection for that case; it only reports the anomaly (the same
      // console.error convention appendObservationalAuditEvent() uses for
      // its own non-throwing failures) and rethrows the original error
      // unchanged.
      const outcome: PaperCommitOutcomeClass | undefined = e instanceof PaperTradingError ? e.commitOutcome : undefined;

      if (!shouldRecordCommitRejection(outcome)) {
        if (outcome !== 'OUTCOME_UNKNOWN' && outcome !== 'INTEGRITY_FAILURE') {
          console.error(
            `[paper-trading] commitPaperMutation() threw with a missing/unrecognized commitOutcome (${String(outcome)}) for user ${req.userId}; NOT recording entry_rejected -- an unclassified error is not proof the mutation did not commit.`,
            e,
          );
        }
        throw e;
      }

      // The rejection notice itself is observational and non-throwing, so a
      // secondary logging failure here can't mask the real error `e`.
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'entry_rejected',
          operation: 'open',
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: [rejectionRuleId(e, 'pt_capital_or_ledger_rejected')],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        },
        'entry_rejected (commit did not succeed)',
      );
      throw e;
    }
  });
}

export interface ClosePaperPositionRequest {
  userId: string;
  idempotencyKey: string;
  positionId: string;
  quoteSnapshot: PaperQuoteSnapshot | null;
  staleConfirmed: boolean;
  manualOverride: PaperManualFillOverrideInput | null;
}

export async function closePaperPosition(req: ClosePaperPositionRequest): Promise<PaperMutationResult> {
  const idempotencyPayload = {
    positionId: req.positionId,
    quoteSnapshot: req.quoteSnapshot,
    manualOverride: req.manualOverride,
  };

  return withPaperTradingLock(req.userId, async (lockId) => {
    const idem = await checkIdempotency<PaperMutationResult>(req.userId, 'close', req.idempotencyKey, idempotencyPayload);
    if (idem.replay && idem.result) {
      // Observational only -- see openPaperPosition()'s equivalent branch.
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'close_duplicate_replayed',
          operation: 'close',
          positionId: req.positionId,
          timestamp: new Date().toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_idempotent_replay'],
        },
        'close_duplicate_replayed',
      );
      return { ...idem.result, replay: true };
    }

    const now = new Date();
    const current = await getPaperTradingLedger(req.userId);
    const openPos = current.openPositions.find((p) => p.positionId === req.positionId);
    if (!openPos) {
      const alreadyClosed = current.closedPositions.some((p) => p.positionId === req.positionId);
      const code = alreadyClosed ? 'POSITION_ALREADY_CLOSED' : 'POSITION_NOT_FOUND';
      const message = alreadyClosed ? 'This position has already been closed.' : 'Paper position not found.';
      // Pre-commit rejection -- see openPaperPosition()'s equivalent catch.
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'close_rejected',
          operation: 'close',
          positionId: req.positionId,
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_close_target_invalid'],
          failureReason: code,
        },
        'close_rejected (pre-commit target invalid)',
      );
      throw new PaperTradingError(code, message, { positionId: req.positionId });
    }

    const manualOverride = resolveManualOverride(req.userId, req.manualOverride, now);

    let closeFill: PaperFillEvidence;
    try {
      closeFill = buildFillEvidence({
        legs: openPos.legs,
        quantity: openPos.quantity,
        contractMultiplier: openPos.contractMultiplier,
        quoteSnapshot: req.quoteSnapshot,
        side: 'close',
        staleConfirmed: req.staleConfirmed,
        manualOverride,
        now,
      });
    } catch (e) {
      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'close_rejected',
          operation: 'close',
          positionId: req.positionId,
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: ['pt_fill_evidence_rejected'],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        },
        'close_rejected (pre-commit fill-evidence rejection)',
      );
      throw e;
    }

    const eventId = createPaperAuditEventId();

    try {
      const result = await commitPaperMutation<PaperMutationResult>(req.userId, lockId, (_account, freshCurrent) => {
        const view = deriveLedgerView(freshCurrent);
        const closeResult = closePosition(freshCurrent, { positionId: req.positionId, closeFill, auditRefs: [eventId], now });
        const nextView = deriveLedgerView(closeResult.next);
        const result: PaperMutationResult = { position: closeResult.position, ledgerView: nextView, replay: false };

        const auditEvent: PaperAuditEvent = {
          id: eventId,
          userId: req.userId,
          eventType: 'close_accepted',
          operation: 'close',
          positionId: req.positionId,
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          pricingSource: closeFill.pricingSource,
          quoteAgeSeconds: closeFill.quoteAgeSeconds,
          capitalBefore: view.availableCapital,
          capitalAfter: nextView.availableCapital,
          cashBefore: freshCurrent.cash,
          cashAfter: closeResult.next.cash,
          // Stale-quote-confirmation and manual-override evidence lives on
          // the primary accepted event, committed atomically -- see
          // openPaperPosition()'s equivalent and this module's doc comment.
          ruleIds: ['pt_close_accepted', ...fillEvidenceRuleIds(closeFill)],
        };

        return {
          next: closeResult.next,
          auditEvent,
          idempotency: buildIdempotencyWrite(req.userId, 'close', req.idempotencyKey, idempotencyPayload, result),
          extra: result,
          verify: (account) => (account.paperTrading?.closedPositions ?? []).some((p) => p.positionId === req.positionId),
        };
      });

      // Nothing runs between a confirmed commit success and returning it.
      return result;
    } catch (e) {
      // PO Round 6: see openPaperPosition()'s equivalent catch block for the
      // full explanation. Only a proven CONFIRMED_NOT_COMMITTED outcome may
      // produce a close_rejected event; OUTCOME_UNKNOWN and INTEGRITY_FAILURE
      // propagate with no audit append, and so does a missing/unrecognized
      // commitOutcome -- the defensive fallback reports that anomaly instead
      // of recording a rejection for it.
      const outcome: PaperCommitOutcomeClass | undefined = e instanceof PaperTradingError ? e.commitOutcome : undefined;

      if (!shouldRecordCommitRejection(outcome)) {
        if (outcome !== 'OUTCOME_UNKNOWN' && outcome !== 'INTEGRITY_FAILURE') {
          console.error(
            `[paper-trading] commitPaperMutation() threw with a missing/unrecognized commitOutcome (${String(outcome)}) for user ${req.userId}; NOT recording close_rejected -- an unclassified error is not proof the mutation did not commit.`,
            e,
          );
        }
        throw e;
      }

      await appendObservationalAuditEvent(
        req.userId,
        {
          userId: req.userId,
          eventType: 'close_rejected',
          operation: 'close',
          positionId: req.positionId,
          timestamp: now.toISOString(),
          idempotencyKey: req.idempotencyKey,
          ruleIds: [rejectionRuleId(e, 'pt_capital_or_ledger_rejected')],
          failureReason: e instanceof Error ? e.message : 'Unknown error',
        },
        'close_rejected (commit did not succeed)',
      );
      throw e;
    }
  });
}

export interface ResetPaperLedgerRequest {
  userId: string;
  idempotencyKey: string;
  startingBalance: number;
}

export async function resetPaperLedger(req: ResetPaperLedgerRequest): Promise<{ ledgerView: PaperTradingLedgerView; replay: boolean }> {
  if (!Number.isFinite(req.startingBalance) || req.startingBalance <= 0) {
    throw new PaperTradingError('VALIDATION_ERROR', 'Starting balance must be a positive number.', {
      startingBalance: req.startingBalance,
    });
  }

  const idempotencyPayload = { startingBalance: req.startingBalance };

  return withPaperTradingLock(req.userId, async (lockId) => {
    const idem = await checkIdempotency<{ ledgerView: PaperTradingLedgerView; replay: boolean }>(
      req.userId,
      'reset',
      req.idempotencyKey,
      idempotencyPayload,
    );
    if (idem.replay && idem.result) {
      return { ...idem.result, replay: true };
    }

    const now = new Date();
    const eventId = createPaperAuditEventId();

    return commitPaperMutation(req.userId, lockId, (_account, current) => {
      const next = resetLedger(req.userId, req.startingBalance, now);
      const result = { ledgerView: deriveLedgerView(next), replay: false };

      const auditEvent: PaperAuditEvent = {
        id: eventId,
        userId: req.userId,
        eventType: 'account_reset',
        operation: 'reset',
        timestamp: now.toISOString(),
        idempotencyKey: req.idempotencyKey,
        cashBefore: current.cash,
        cashAfter: next.cash,
        ruleIds: ['pt_account_reset'],
      };

      return {
        next,
        auditEvent,
        idempotency: buildIdempotencyWrite(req.userId, 'reset', req.idempotencyKey, idempotencyPayload, result),
        extra: result,
        verify: (account) => account.paperTrading?.createdAt === next.createdAt,
      };
    });
  });
}

export interface RefreshMarkRequest {
  userId: string;
  positionId: string;
  quoteSnapshot: PaperQuoteSnapshot | null;
  manualOverride: PaperManualFillOverrideInput | null;
  staleConfirmed: boolean;
}

/**
 * Mark refresh is NOT idempotency-guarded (section 9.1 lists open/close/
 * reset only) — it is a read-mostly, non-cumulative operation: refreshing
 * twice with the same quote just recomputes the same mark. It still runs
 * under the same mutation lock and the same atomic, lease-fenced commit as
 * open/close/reset (persistence/commit.ts), because it performs a real
 * ledger write and a lost lease must not let that write commit any more
 * than for the other three operations.
 */
export async function refreshPaperMark(req: RefreshMarkRequest): Promise<PaperMutationResult> {
  return withPaperTradingLock(req.userId, async (lockId) => {
    const now = new Date();
    const current = await getPaperTradingLedger(req.userId);
    const position = current.openPositions.find((p) => p.positionId === req.positionId);
    if (!position) throw new PaperTradingError('POSITION_NOT_FOUND', 'Paper position not found.', { positionId: req.positionId });

    const manualOverride = resolveManualOverride(req.userId, req.manualOverride, now);

    const markFill = buildFillEvidence({
      legs: position.legs,
      quantity: position.quantity,
      contractMultiplier: position.contractMultiplier,
      quoteSnapshot: req.quoteSnapshot,
      side: 'close',
      staleConfirmed: req.staleConfirmed,
      manualOverride,
      now,
    });

    const eventId = createPaperAuditEventId();

    return commitPaperMutation<PaperMutationResult>(req.userId, lockId, (_account, freshCurrent) => {
      const { next, position: updated } = markPosition(freshCurrent, req.positionId, markFill, now);
      const ledgerView = deriveLedgerView(next);
      const result: PaperMutationResult = { position: updated, ledgerView, replay: false };

      const auditEvent: PaperAuditEvent = {
        id: eventId,
        userId: req.userId,
        eventType: 'mark_refreshed',
        operation: 'mark',
        positionId: req.positionId,
        timestamp: now.toISOString(),
        pricingSource: markFill.pricingSource,
        quoteAgeSeconds: markFill.quoteAgeSeconds,
        ruleIds: ['pt_mark_refreshed'],
      };

      return {
        next,
        auditEvent,
        idempotency: null,
        extra: result,
        verify: (account) =>
          (account.paperTrading?.openPositions ?? []).some(
            (p) => p.positionId === req.positionId && p.currentMark?.evaluatedAt === markFill.evaluatedAt,
          ),
      };
    });
  });
}

export { resolveClosingAction, computeCapitalRequirement };
