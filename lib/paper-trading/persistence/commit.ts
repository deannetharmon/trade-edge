// lib/paper-trading/persistence/commit.ts
//
// PT-0001 corrective round (second pass, Product Owner review #2): true
// all-or-nothing accepted-mutation commit.
//
// The first corrective-round pass used Redis WATCH/MULTI/EXEC. The Product
// Owner rejected that design: Redis does not roll back an individual queued
// command's runtime error while leaving OTHER commands in the same
// transaction applied -- "essentially never fails" is not a commit
// guarantee. This version replaces MULTI/EXEC entirely with a SINGLE Lua
// EVAL (COMMIT_SCRIPT below) that:
//
//   1. Checks lock ownership FIRST, before touching any other key. If the
//      caller's lease was lost, the script returns "LOCK_LOST" and writes
//      nothing.
//   2. Checks the TYPE of every key it is about to write BEFORE performing
//      any write (account key must be absent or a string; audit key must
//      be absent or a list; idempotency key, if any, must be absent or a
//      string). If any check fails, the script returns "TYPE_ERROR" and
//      writes nothing.
//   3. When an idempotency write is part of this operation, validates every
//      argument the final `SET ... EX <ttl>` command depends on BEFORE any
//      write: the idempotency value must be non-empty, and the TTL argument
//      must parse as a number, have no fractional part, and be strictly
//      positive. Any failure here returns "INVALID_ARG" and writes nothing
//      (PO Round 4: `SET KEYS[4] ARGV[5] "EX" tonumber(ARGV[6])` could
//      previously fail on an invalid TTL *after* the account and audit
//      writes had already happened -- this closes that gap by validating it
//      up front instead, alongside the equivalent TypeScript-side guard in
//      commitPaperMutation() below; the Lua check is the one that actually
//      matters, since nothing else stands between a caller and Redis at the
//      moment EVAL runs).
//   4. Only after every precondition has passed does it perform its
//      writes: SET the account, LPUSH + LTRIM the audit list, and
//      (if applicable) SET the idempotency record.
//
// A Redis Lua script executes as a single atomic unit from the server's
// perspective -- no other command from any client can interleave with it,
// and by construction here every write-capable branch is only reached
// after every precondition that could otherwise cause a write to fail has
// already been checked. This is the "carefully validated Lua operation
// that performs all precondition and key-type checks before its first
// write and cannot encounter an expected runtime error after writing"
// design the Product Owner asked for, not a MULTI/EXEC pipeline relying on
// individual commands being unlikely to fail.
//
// This still leaves exactly one real ambiguity, inherent to any networked
// system and not specific to Redis: the EVAL request can reach Redis, be
// executed and committed, and then the ACKNOWLEDGEMENT can be lost on the
// way back to the client (a dropped connection, a timeout, ...). From the
// client's point of view this looks identical to "the request never
// arrived." resolveAmbiguousOutcome() below handles exactly this case by
// re-reading authoritative state (the ledger, the audit trail, and the
// idempotency record) and reasoning about what it finds rather than
// guessing -- see its own doc comment.

import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { paperAccountKey } from '@/lib/autopilot/persistence/keys';
import { createInitialPaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import type { PaperAccount } from '@/lib/autopilot/types';
import { getPaperAuditEvents } from '../audit';
import { paperAuditKey, paperMutationLockKey } from './keys';
import { createInitialLedger } from '../ledger';
import { PaperTradingError } from '../types';
import type { PaperAuditEvent, PaperTradingLedger } from '../types';

const PAPER_AUDIT_MAX_ENTRIES = 4999;
const DEFAULT_PAPER_TRADING_STARTING_BALANCE = 100000;

export class LockLostError extends PaperTradingError {
  constructor(userId: string) {
    super(
      'LOCK_LOST',
      'The paper-trading mutation lock was lost (its lease expired and another request acquired it) before this change could commit. The commit script confirmed this and wrote nothing — safe to retry.',
      { userId },
    );
    this.name = 'LockLostError';
    this.commitOutcome = 'CONFIRMED_NOT_COMMITTED';
  }
}

export class IntegrityFailureError extends PaperTradingError {
  constructor(userId: string, details: Record<string, unknown>) {
    super(
      'INTEGRITY_FAILURE',
      'Paper-trading persistence state is inconsistent for this operation: the ledger, audit trail, and/or idempotency record disagree about whether it committed. This cannot happen from this module\'s own atomic commit alone and indicates persistence state was modified outside this commit path. Refusing to guess — this requires investigation before the affected account is trusted or retried.',
      { userId, ...details },
    );
    this.name = 'IntegrityFailureError';
    this.commitOutcome = 'INTEGRITY_FAILURE';
  }
}

/**
 * PO Round 5: the EVAL acknowledgement was lost AND the follow-up attempt to
 * re-read authoritative state (to resolve that ambiguity -- see
 * resolveAmbiguousOutcome()) itself failed, OR the commit script returned a
 * result this codebase's version doesn't recognize. Whether the mutation
 * committed is genuinely UNKNOWN -- never treated as a confirmed rejection,
 * never safe to retry under a different idempotency key. `details` carries
 * both the original EVAL error and the reconciliation-read error (message
 * text only -- no account/audit/idempotency payload contents, so no
 * user-entered data or secrets can leak through this diagnostic path).
 */
export class OutcomeUnknownError extends PaperTradingError {
  constructor(userId: string, details: Record<string, unknown>) {
    super(
      'OUTCOME_UNKNOWN',
      'This operation\'s outcome could not be determined: the commit request\'s acknowledgement was lost, and the follow-up attempt to read authoritative state (the ledger, audit trail, or idempotency record) itself failed. The accepted mutation may or may not already exist. Do NOT resubmit this request under a different idempotency key. Retry (or wait and re-check) using the SAME idempotency key -- this will safely replay the original result if it turns out to have committed, and will retry cleanly if it did not.',
      { userId, ...details },
    );
    this.name = 'OutcomeUnknownError';
    this.commitOutcome = 'OUTCOME_UNKNOWN';
  }
}

/**
 * Sets `commitOutcome` on any thrown value that leaves commitPaperMutation()
 * and doesn't already carry one (e.g. a pure build()/domain PaperTradingError
 * -- INSUFFICIENT_CAPITAL, POSITION_ALREADY_CLOSED, ... -- thrown before EVAL
 * was ever reached). Every one of those is, definitionally, a case where
 * nothing was written, so they are tagged CONFIRMED_NOT_COMMITTED here rather
 * than left unclassified. Mutates and returns the same error (never wraps or
 * replaces it), so callers checking `.code`/`instanceof` for the specific
 * domain error keep working unchanged.
 */
function tagAsConfirmedNotCommitted<E>(error: E): E {
  if (error instanceof PaperTradingError && error.commitOutcome === undefined) {
    error.commitOutcome = 'CONFIRMED_NOT_COMMITTED';
  }
  return error;
}

/**
 * PO Round 6: a final boundary guarantee, wrapping commitPaperMutation()'s
 * entire body -- every error that reaches this point should already carry an
 * explicit commitOutcome (via tagAsConfirmedNotCommitted(), the LockLostError/
 * IntegrityFailureError/OutcomeUnknownError constructors, or
 * resolveAmbiguousOutcome()'s own classification), but this is the last line
 * of defense against anything that slips through unclassified -- e.g. the
 * initial readAccount() call at the very top of commitPaperMutation(), before
 * build() is even invoked, has no dedicated try/catch of its own, or a future
 * change to this function accidentally introduces a new unclassified throw
 * path. An unclassified error is NOT proof the mutation didn't commit, so the
 * safe, conservative classification for anything that reaches this point
 * without one is OUTCOME_UNKNOWN -- never CONFIRMED_NOT_COMMITTED (that would
 * risk exactly the false-rejection bug this and the prior round were fixing)
 * and never INTEGRITY_FAILURE (that specifically means signals were
 * successfully read but disagree, which does not apply here). Already-
 * classified errors (any PaperTradingError whose commitOutcome is already
 * one of the three known values) pass through unchanged.
 */
function ensureClassifiedOutcome(error: unknown, userId: string): unknown {
  if (error instanceof PaperTradingError && error.commitOutcome !== undefined) {
    return error;
  }
  return new OutcomeUnknownError(userId, {
    stage: 'unclassified error leaving commitPaperMutation()',
    originalError: error instanceof Error ? error.message : String(error),
  });
}

/**
 * TypeScript-side mirror of the Lua script's own idempotency-argument
 * validation (see COMMIT_SCRIPT's doc comment). This is a fail-fast guard,
 * not a substitute for the Lua-side check -- it runs in this process, on
 * this build()-produced plan, before EVAL is even called; the Lua check is
 * what actually stands between the argument and Redis at the moment the
 * script runs, and remains authoritative regardless of what this validates.
 */
function assertValidIdempotencyPlan(idempotency: AtomicCommitPlan<unknown>['idempotency']): void {
  if (!idempotency) return;
  if (!idempotency.key) {
    throw tagAsConfirmedNotCommitted(
      new PaperTradingError('COMMIT_FAILED', 'Invalid commit plan: idempotency key must be a non-empty string.'),
    );
  }
  if (!idempotency.value) {
    throw tagAsConfirmedNotCommitted(
      new PaperTradingError('COMMIT_FAILED', 'Invalid commit plan: idempotency value must be a non-empty string.'),
    );
  }
  if (!Number.isInteger(idempotency.ttlSeconds) || idempotency.ttlSeconds <= 0) {
    throw tagAsConfirmedNotCommitted(
      new PaperTradingError(
        'COMMIT_FAILED',
        `Invalid commit plan: idempotency TTL must be a strictly positive integer (received ${idempotency.ttlSeconds}).`,
      ),
    );
  }
}

export interface AtomicCommitPlan<T> {
  next: PaperTradingLedger;
  /** Full event, including id — generate the id up front (see audit.ts's createPaperAuditEventId()) so it can also be threaded into position.auditRefs. */
  auditEvent: PaperAuditEvent;
  idempotency: { key: string; value: string; ttlSeconds: number } | null;
  extra: T;
  /**
   * Given a freshly re-read account, returns true if its `paperTrading`
   * ledger already reflects THIS specific attempted mutation (not just "a"
   * mutation — this exact one). Used only when the commit's outcome is
   * ambiguous (see resolveAmbiguousOutcome()), to help distinguish "this
   * attempt committed and I just didn't hear back" from "this attempt
   * never reached persistence."
   */
  verify: (account: PaperAccount) => boolean;
}

// Identifying comment (PAPER_COMMIT_V2) lets the test double
// (fakeRedisClient.ts) recognize this specific script deterministically,
// the same way it already recognizes locking.ts's release script.
const COMMIT_SCRIPT = `
-- PAPER_COMMIT_V2
-- KEYS[1] accountKey, KEYS[2] lockKey, KEYS[3] auditKey, KEYS[4] idempotencyKey ("" if none)
-- ARGV[1] expected lockId, ARGV[2] next account JSON, ARGV[3] audit event JSON,
-- ARGV[4] audit max index (LTRIM upper bound), ARGV[5] idempotency value JSON ("" if none),
-- ARGV[6] idempotency TTL seconds ("0" if none)

if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return "LOCK_LOST"
end

local accountType = redis.call("TYPE", KEYS[1])["ok"]
if accountType ~= "none" and accountType ~= "string" then
  return "TYPE_ERROR"
end

local auditType = redis.call("TYPE", KEYS[3])["ok"]
if auditType ~= "none" and auditType ~= "list" then
  return "TYPE_ERROR"
end

if KEYS[4] ~= "" then
  local idemType = redis.call("TYPE", KEYS[4])["ok"]
  if idemType ~= "none" and idemType ~= "string" then
    return "TYPE_ERROR"
  end

  -- Validate every argument the final idempotency SET/EX depends on before
  -- any write happens, so an invalid value/TTL can never be discovered only
  -- after the account and audit writes already landed.
  if ARGV[5] == "" then
    return "INVALID_ARG"
  end
  local ttl = tonumber(ARGV[6])
  if ttl == nil then
    return "INVALID_ARG"
  end
  if ttl ~= math.floor(ttl) then
    return "INVALID_ARG"
  end
  if ttl <= 0 then
    return "INVALID_ARG"
  end
end

redis.call("SET", KEYS[1], ARGV[2])
redis.call("LPUSH", KEYS[3], ARGV[3])
redis.call("LTRIM", KEYS[3], 0, tonumber(ARGV[4]))

if KEYS[4] ~= "" then
  redis.call("SET", KEYS[4], ARGV[5], "EX", tonumber(ARGV[6]))
end

return "OK"
`;

async function readAccount(userId: string): Promise<PaperAccount> {
  const accountKey = paperAccountKey(userId);
  return withAutopilotRedis(async (redis) => {
    const raw = await redis.get(accountKey);
    return raw ? (JSON.parse(raw) as PaperAccount) : createInitialPaperAccount(userId);
  });
}

async function runCommitScript(
  userId: string,
  lockId: string,
  auditEvent: PaperAuditEvent,
  nextAccountJson: string,
  idempotency: { key: string; value: string; ttlSeconds: number } | null,
): Promise<string> {
  const accountKey = paperAccountKey(userId);
  const lockKey = paperMutationLockKey(userId);
  const auditKey = paperAuditKey(userId);

  return withAutopilotRedis(async (redis) => {
    const result = await redis.eval(
      COMMIT_SCRIPT,
      4,
      accountKey,
      lockKey,
      auditKey,
      idempotency?.key ?? '',
      lockId,
      nextAccountJson,
      JSON.stringify(auditEvent),
      String(PAPER_AUDIT_MAX_ENTRIES),
      idempotency?.value ?? '',
      String(idempotency?.ttlSeconds ?? 0),
    );
    return result as string;
  });
}

/**
 * Resolves an AMBIGUOUS commit outcome — the EVAL call itself failed
 * (a network/connection/protocol-level error), which proves nothing about
 * whether Redis actually executed the script. Because Redis executes a Lua
 * script as a single atomic unit, there is no possibility of a "partially
 * run" script: either the whole script ran (and therefore wrote the
 * ledger, the audit event, and the idempotency record together) or none of
 * it did. The only real question is whether the request/response made it
 * across the network — this function answers that by re-reading
 * authoritative state rather than guessing:
 *
 *   - If the ledger, the audit trail, and (when applicable) the
 *     idempotency record ALL agree the operation committed -> it did.
 *     Return the already-computed result (`plan.extra`) — it is exactly
 *     what the script would have produced, since both are derived from the
 *     same deterministic inputs.
 *   - If they ALL agree it did NOT commit -> it didn't. Throw a
 *     conservative, explicitly retryable failure.
 *   - If they DISAGREE -> this module's own commit path cannot produce
 *     that outcome (the script writes all three together, or none of
 *     them), so a disagreement means persistence state was altered outside
 *     this path. Never guess which signal to trust — surface a distinct
 *     IntegrityFailureError instead of silently picking one.
 */
async function resolveAmbiguousOutcome<T>(userId: string, plan: AtomicCommitPlan<T>, cause: unknown): Promise<T> {
  let ledgerReflects: boolean;
  try {
    const account = await readAccount(userId);
    ledgerReflects = plan.verify(account);
  } catch (readError) {
    throw buildOutcomeUnknownError(userId, cause, readError, 'ledger (account) read');
  }

  let auditFound: boolean;
  try {
    const events = await getPaperAuditEvents(userId, 500);
    auditFound = events.some((e) => e.id === plan.auditEvent.id);
  } catch (readError) {
    throw buildOutcomeUnknownError(userId, cause, readError, 'audit trail read');
  }

  let idempotencyReflects: boolean | null = null;
  if (plan.idempotency) {
    const idemKey = plan.idempotency.key;
    const idemValue = plan.idempotency.value;
    try {
      const raw = await withAutopilotRedis((redis) => redis.get(idemKey));
      idempotencyReflects = raw === idemValue;
    } catch (readError) {
      throw buildOutcomeUnknownError(userId, cause, readError, 'idempotency record read');
    }
  }

  const signals = [ledgerReflects, auditFound, ...(idempotencyReflects === null ? [] : [idempotencyReflects])];
  const allCommitted = signals.every(Boolean);
  const noneCommitted = signals.every((s) => !s);

  if (allCommitted) return plan.extra;

  if (noneCommitted) {
    throw tagAsConfirmedNotCommitted(
      new PaperTradingError(
        'COMMIT_FAILED',
        'Could not confirm this operation reached persistence after a connection interruption while committing; re-reading authoritative state confirmed it was NOT applied. Safe to retry.',
        { userId, cause: cause instanceof Error ? cause.message : String(cause) },
      ),
    );
  }

  throw new IntegrityFailureError(userId, {
    ledgerReflects,
    auditFound,
    idempotencyReflects,
    eventId: plan.auditEvent.id,
  });
}

/**
 * PO Round 5: builds an OutcomeUnknownError for the case where the original
 * EVAL acknowledgement was lost AND the reconciliation read attempting to
 * resolve that ambiguity (readAccount() / getPaperAuditEvents() / the
 * idempotency redis.get()) itself failed. Both errors' message text are
 * preserved as diagnostic metadata -- never their full payloads -- so this
 * cannot leak account/audit/idempotency contents (user-entered data,
 * secrets) through the error path.
 */
function buildOutcomeUnknownError(userId: string, evalError: unknown, reconciliationError: unknown, stage: string): OutcomeUnknownError {
  return new OutcomeUnknownError(userId, {
    stage,
    originalCommitError: evalError instanceof Error ? evalError.message : String(evalError),
    reconciliationError: reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError),
  });
}

/**
 * Reads the current account, lets `build` compute the mutation (pure,
 * given that snapshot) plus the exact audit event, idempotency write, and
 * verification predicate it wants committed alongside it, then commits the
 * ledger + one audit event + an optional idempotency record as a single
 * Lua script execution (COMMIT_SCRIPT) that also re-verifies this caller's
 * lock ownership as its very first check. Returns `build`'s `extra` value
 * only when the commit is confirmed to have happened — either because the
 * script itself returned "OK", or (for the rarer ambiguous-outcome case)
 * because a re-read of authoritative state confirms it. A caller can never
 * receive a "success" for a mutation that provably was not persisted.
 */
export async function commitPaperMutation<T>(
  userId: string,
  lockId: string,
  build: (account: PaperAccount, current: PaperTradingLedger) => AtomicCommitPlan<T>,
): Promise<T> {
  // PO Round 6: the entire body is wrapped so that ANY error leaving this
  // function -- including one from a path that isn't individually tagged,
  // such as the initial readAccount() read below, before build() is even
  // invoked -- is guaranteed to carry an explicit commitOutcome by the time
  // it reaches the caller. See ensureClassifiedOutcome()'s doc comment.
  try {
    const account = await readAccount(userId);
    const current = account.paperTrading ?? createInitialLedger(userId, DEFAULT_PAPER_TRADING_STARTING_BALANCE);

    // build() may throw (insufficient capital, a rejected fill, a position
    // already closed, ...). Nothing has been sent to Redis yet at this
    // point, so the error propagates directly — no cleanup needed. It is,
    // definitionally, a CONFIRMED_NOT_COMMITTED outcome (PO Round 5).
    let plan: AtomicCommitPlan<T>;
    try {
      plan = build(account, current);
    } catch (buildError) {
      throw tagAsConfirmedNotCommitted(buildError);
    }

    // Fail-fast TypeScript-side guard -- see assertValidIdempotencyPlan()'s
    // doc comment. Also runs before anything is sent to Redis.
    assertValidIdempotencyPlan(plan.idempotency);

    const nextAccount: PaperAccount = {
      ...account,
      paperTrading: plan.next,
      peakBalance: Math.max(account.peakBalance, account.currentBalance),
      updatedAt: new Date().toISOString(),
    };

    let scriptResult: string;
    try {
      scriptResult = await runCommitScript(userId, lockId, plan.auditEvent, JSON.stringify(nextAccount), plan.idempotency);
    } catch (networkError) {
      return await resolveAmbiguousOutcome(userId, plan, networkError);
    }

    if (scriptResult === 'OK') return plan.extra;
    if (scriptResult === 'LOCK_LOST') throw new LockLostError(userId);
    if (scriptResult === 'TYPE_ERROR') {
      throw tagAsConfirmedNotCommitted(
        new PaperTradingError(
          'COMMIT_FAILED',
          'A persistence type-safety precondition failed before any write was attempted for this operation; nothing was written.',
          { userId },
        ),
      );
    }
    if (scriptResult === 'INVALID_ARG') {
      throw tagAsConfirmedNotCommitted(
        new PaperTradingError(
          'COMMIT_FAILED',
          'An idempotency-write argument (value or TTL) failed the commit script\'s precondition validation before any write was attempted for this operation; nothing was written.',
          { userId },
        ),
      );
    }

    // PO Round 5: an unrecognized script return value means this code
    // genuinely does not know what happened server-side -- it is NOT proof
    // that nothing was written, so this must NOT be treated as a confirmed
    // rejection. Classify as OUTCOME_UNKNOWN, not a generic COMMIT_FAILED.
    throw new OutcomeUnknownError(userId, { stage: 'unrecognized commit script result', scriptResult: String(scriptResult) });
  } catch (e) {
    throw ensureClassifiedOutcome(e, userId);
  }
}
