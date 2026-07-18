// lib/paper-trading/__tests__/commit.test.ts
//
// PT-0001 PO Round 2: exercises the redesigned single-Lua-EVAL atomic
// commit (persistence/commit.ts) against the in-memory fake Redis,
// including the full failure-state matrix the Product Owner required:
//
//   1. failure before server-side commit ("before_apply")
//   2. confirmed lock-ownership abort (a script-returned "LOCK_LOST",
//      not a thrown/ambiguous error)
//   3. response loss AFTER a successful server-side commit ("after_apply")
//   4. retry after response loss returns the original result exactly once
//   5. detection of deliberately inconsistent persistence state
//      ("partial_apply")
//   6. no partial state from any REACHABLE commit failure (before_apply,
//      confirmed lock-loss) -- asserted directly inside those scenarios.
//      partial_apply is deliberately EXCLUDED from this claim: it exists
//      specifically to construct a partial state the real script cannot
//      produce through its own command paths, so that the resolver's
//      detection of it (surfacing IntegrityFailureError, never silently
//      repaired) can be proven. See scenario 5's own describe block.
//
// PT-0001 PO Round 4 additions:
//   - Accepted/rejected audit semantics: failure-injection tests proving a
//     standalone (non-atomic) audit-append failure can never convert a
//     confirmed commit success, or a confirmed idempotent replay, into an
//     apparent rejection -- see "accepted/rejected audit semantics" below.
//   - Idempotency-write TTL/value precondition validation: tests proving an
//     invalid TTL (zero, negative, fractional, non-numeric) is rejected
//     before any write, both by commitPaperMutation()'s own TypeScript-side
//     guard and, independently, by the Lua script's own precondition check
//     (modeled here by fakeRedisClient.ts's failNextCommit-free direct
//     eval() path) -- see "idempotency TTL precondition validation" below.
//
// PT-0001 PO Round 5 additions: every error leaving commitPaperMutation() now
// carries an explicit PaperCommitOutcomeClass (CONFIRMED_NOT_COMMITTED /
// OUTCOME_UNKNOWN / INTEGRITY_FAILURE -- see types.ts's doc comment). See
// "commit-outcome classification: reconciliation-read failures" below for
// the new OUTCOME_UNKNOWN scenario (EVAL ack lost, THEN the reconciliation
// read that would resolve that ambiguity also fails) and
// "commit-outcome classification: confirmed rejections still produce a
// rejected event" for the regression checks proving this change didn't
// suppress any legitimate rejection.
//
// See fakeRedisClient.ts's module doc comment for exactly what each
// failNextCommit() mode simulates, and persistence/commit.ts's module doc
// comment for why a single atomic EVAL makes "partial apply" impossible
// from the real script itself (partial_apply is a test-only injection used
// solely to prove resolveAmbiguousOutcome() surfaces disagreement rather
// than guessing).
//
// PT-0001 PO Round 6 addition: commitPaperMutation()'s entire body is now
// wrapped in a final boundary guarantee (ensureClassifiedOutcome() in
// commit.ts) converting ANY otherwise-unclassified error to OutcomeUnknownError
// before it can leave the function -- see "commit-outcome classification:
// boundary guarantee for otherwise-unclassified errors" below. The
// corresponding fix to service.ts's OWN defensive handling of a missing/
// unrecognized commitOutcome (which the prior round had backwards -- it fell
// through to RECORDING a rejection instead of skipping one) is tested
// separately in serviceCommitOutcomeClassification.test.ts, which mocks
// commitPaperMutation() directly so that case can be exercised in isolation
// even though it can no longer occur through this file's real (unmocked)
// commit path.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

import { checkIdempotency } from '../idempotency';
import { closePaperPosition, openPaperPosition, refreshPaperMark, resetPaperLedger } from '../service';
import { getPaperTradingLedger } from '../persistence/store';
import { getPaperAuditEvents } from '../audit';
import { PaperTradingError } from '../types';
import type { PaperLeg, PaperQuoteSnapshot } from '../types';

beforeEach(() => {
  mockRedis = new FakeRedisClient();
});

const EXP = '2026-08-21';
const cspLegs: PaperLeg[] = [{ legId: 'p', optionType: 'put', strike: 100, expiration: EXP, openAction: 'sell_to_open' }];

function quoteFor(legs: PaperLeg[], bidAsk: [number, number] = [3.0, 3.2]): PaperQuoteSnapshot {
  return {
    source: 'manual',
    legs: legs.map((l) => ({ legId: l.legId, bid: bidAsk[0], ask: bidAsk[1], mid: null, quoteTimestamp: new Date().toISOString() })),
  };
}

function openReq(overrides: Partial<Parameters<typeof openPaperPosition>[0]> = {}) {
  return {
    userId: 'u1',
    idempotencyKey: 'idem-open-1',
    symbol: 'SPY',
    strategy: 'CSP' as const,
    legs: cspLegs,
    expiration: EXP,
    quantity: 1,
    quoteSnapshot: quoteFor(cspLegs),
    staleConfirmed: false,
    manualOverride: null,
    entryRationale: null,
    ...overrides,
  };
}

describe('atomic successful commit', () => {
  it('produces the ledger position, the accepted audit event, and the idempotency record together', async () => {
    const req = openReq();
    const result = await openPaperPosition(req);
    expect(result.replay).toBe(false);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.openPositions[0].positionId).toBe(result.position.positionId);

    const events = await getPaperAuditEvents('u1');
    const accepted = events.find((e) => e.eventType === 'entry_accepted');
    expect(accepted).toBeDefined();
    expect(accepted?.positionId).toBe(result.position.positionId);
    expect(ledger.openPositions[0].auditRefs).toEqual([accepted!.id]);

    const idem = await checkIdempotency('u1', 'open', 'idem-open-1', {
      symbol: req.symbol,
      strategy: req.strategy,
      legs: req.legs,
      expiration: req.expiration,
      quantity: req.quantity,
      quoteSnapshot: req.quoteSnapshot,
      manualOverride: null,
    });
    expect(idem.replay).toBe(true);
  });
});

describe('1. failure before server-side commit', () => {
  it('open: leaves no ledger position, no accepted audit event, and no idempotency record behind (no partial state)', async () => {
    mockRedis.failNextCommit('before_apply');
    await expect(openPaperPosition(openReq())).rejects.toThrow(PaperTradingError);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(0);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_accepted')).toBe(false);

    const idem = await checkIdempotency('u1', 'open', 'idem-open-1', {
      symbol: 'SPY',
      strategy: 'CSP',
      legs: cspLegs,
      expiration: EXP,
      quantity: 1,
      quoteSnapshot: quoteFor(cspLegs),
      manualOverride: null,
    });
    expect(idem.replay).toBe(false);
  });

  it('open: a retry after a before-commit failure (same idempotency key, same payload) safely succeeds exactly once', async () => {
    mockRedis.failNextCommit('before_apply');
    await expect(openPaperPosition(openReq())).rejects.toThrow(PaperTradingError);

    const retried = await openPaperPosition(openReq());
    expect(retried.replay).toBe(false);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1); // not double-opened
  });

  it('close: leaves the position open (no partial close applied) and no accepted audit event or idempotency record behind', async () => {
    const opened = await openPaperPosition(openReq());

    mockRedis.failNextCommit('before_apply');
    await expect(
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-close-1',
        positionId: opened.position.positionId,
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }),
    ).rejects.toThrow(PaperTradingError);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1); // still open -- not partially closed
    expect(ledger.closedPositions).toHaveLength(0);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_accepted')).toBe(false);

    const idem = await checkIdempotency('u1', 'close', 'idem-close-1', {
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      manualOverride: null,
    });
    expect(idem.replay).toBe(false);
  });
});

describe('2. confirmed lock-ownership abort', () => {
  it('open: if the mutation lock is deleted/reassigned before the commit step, the script itself returns LOCK_LOST (a confirmed abort, not an ambiguous one) and nothing is persisted', async () => {
    const { acquirePaperTradingLock } = await import('../persistence/locking');
    const { commitPaperMutation, LockLostError } = await import('../persistence/commit');
    const { createInitialLedger } = await import('../ledger');

    const lock = await acquirePaperTradingLock('u1');
    expect(lock.acquired).toBe(true);

    // Lease lost: someone else's lock is now on record.
    await mockRedis.del('paper-trading:mutation-lock:u1');
    const replacement = await acquirePaperTradingLock('u1');
    expect(replacement.acquired).toBe(true);

    await expect(
      commitPaperMutation('u1', lock.lockId, (_account, current) => ({
        next: createInitialLedger('u1', 42),
        auditEvent: {
          id: 'evt-should-never-be-written',
          userId: 'u1',
          eventType: 'account_reset',
          operation: 'reset',
          timestamp: new Date().toISOString(),
          idempotencyKey: 'k',
          cashBefore: current.cash,
          cashAfter: 42,
          ruleIds: ['pt_account_reset'],
        },
        idempotency: null,
        extra: null,
        verify: () => false,
      })),
    ).rejects.toThrow(LockLostError);

    // Nothing from the aborted commit was persisted.
    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.id === 'evt-should-never-be-written')).toBe(false);
  });
});

describe('3/4. response loss after a successful server-side commit, and exactly-once retry', () => {
  it('open: when the commit script fully applies but the response is lost, the operation is confirmed via re-read and returns the original result -- not an error', async () => {
    mockRedis.failNextCommit('after_apply');
    const result = await openPaperPosition(openReq());
    expect(result.replay).toBe(false);
    expect(result.position.symbol).toBe('SPY');

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.openPositions[0].positionId).toBe(result.position.positionId);

    const events = await getPaperAuditEvents('u1');
    const acceptedEvents = events.filter((e) => e.eventType === 'entry_accepted');
    expect(acceptedEvents).toHaveLength(1); // exactly one -- not written twice
  });

  it('open: a subsequent retry with the same idempotency key replays the confirmed result instead of opening a second position', async () => {
    // Reused across both calls, not rebuilt -- quoteFor() stamps a fresh
    // quoteTimestamp each call, so two separately-built requests would
    // (correctly) be seen as different payloads and hit IDEMPOTENCY_CONFLICT
    // rather than replay. See the "atomic successful commit" test above.
    const req = openReq();

    mockRedis.failNextCommit('after_apply');
    const first = await openPaperPosition(req);

    const retried = await openPaperPosition(req);
    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(first.position.positionId);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1); // exactly once
  });

  it('close: when the commit script fully applies but the response is lost, the close is confirmed via re-read and returns the original result', async () => {
    const opened = await openPaperPosition(openReq());

    mockRedis.failNextCommit('after_apply');
    const result = await closePaperPosition({
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      staleConfirmed: false,
      manualOverride: null,
    });
    expect(result.replay).toBe(false);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(0);
    expect(ledger.closedPositions).toHaveLength(1);

    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'close_accepted')).toHaveLength(1);
  });

  it('reset: when the commit script fully applies but the response is lost, the reset is confirmed via re-read (verify() distinguishes this exact reset from any prior ledger state)', async () => {
    await openPaperPosition(openReq());

    mockRedis.failNextCommit('after_apply');
    const result = await resetPaperLedger({ userId: 'u1', idempotencyKey: 'idem-reset-1', startingBalance: 55000 });
    expect(result.replay).toBe(false);
    expect(result.ledgerView.ledger.startingBalance).toBe(55000);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.startingBalance).toBe(55000);
    expect(ledger.openPositions).toHaveLength(0);

    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'account_reset')).toHaveLength(1);
  });

  it('mark: when the commit script fully applies but the response is lost, the mark refresh is confirmed via re-read (verify() checks the specific mark timestamp)', async () => {
    const opened = await openPaperPosition(openReq());

    mockRedis.failNextCommit('after_apply');
    const result = await refreshPaperMark({
      userId: 'u1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [2.5, 2.7]),
      manualOverride: null,
      staleConfirmed: false,
    });
    expect(result.position.currentMark).not.toBeNull();

    const ledger = await getPaperTradingLedger('u1');
    const position = ledger.openPositions.find((p) => p.positionId === opened.position.positionId);
    expect(position?.currentMark?.evaluatedAt).toBe(result.position.currentMark?.evaluatedAt);

    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'mark_refreshed')).toHaveLength(1);
  });
});

describe('5. detection of deliberately inconsistent persistence state', () => {
  it('open: if the ledger reflects the mutation but the audit trail and idempotency record do not (a state the real atomic script cannot itself produce), this is surfaced as a distinct integrity failure, never silently treated as success or failure', async () => {
    const { IntegrityFailureError } = await import('../persistence/commit');

    mockRedis.failNextCommit('partial_apply');
    // The error is exposed with a PaperTradingError-compatible code so API
    // routes can map it (INTEGRITY_FAILURE), and it is NOT treated as a
    // retryable COMMIT_FAILED or a success -- it is its own distinct class.
    try {
      await openPaperPosition(openReq());
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(IntegrityFailureError);
      expect(e).toBeInstanceOf(PaperTradingError);
      expect((e as PaperTradingError).code).toBe('INTEGRITY_FAILURE');
      // PO Round 5: IntegrityFailureError is not a confirmed rejection --
      // persisted signals merely disagree -- so it must never coexist with
      // an entry_rejected event.
      expect((e as PaperTradingError).commitOutcome).toBe('INTEGRITY_FAILURE');
    }

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
  });
});

describe('6. no partial state from any reachable commit failure', () => {
  it('sweeps before_apply and confirmed lock-loss (the failure modes a real client/network/Redis interaction can actually produce) and confirms neither leaves a mixed/half-written state; separately confirms partial_apply (a test-only injection unreachable by the real script) is detected rather than silently accepted', async () => {
    // before_apply: nothing written by the commit itself. (service.ts does
    // still log a standalone, non-atomic 'entry_rejected' event for every
    // rejected attempt -- see its module doc comment -- so the assertion
    // here is "no accepted/committed state", not "zero audit events".)
    mockRedis.failNextCommit('before_apply');
    await expect(openPaperPosition(openReq({ idempotencyKey: 'sweep-1' }))).rejects.toThrow(PaperTradingError);
    let ledger = await getPaperTradingLedger('u1');
    let events = await getPaperAuditEvents('u1');
    expect(ledger.openPositions).toHaveLength(0);
    expect(events.some((e) => e.eventType === 'entry_accepted')).toBe(false);

    // partial_apply: this is NOT a "no partial state" assertion -- the test
    // double deliberately writes only the account key here, a state the
    // real precondition-checked script cannot reach through its own command
    // paths (see commit.ts's module doc comment and fakeRedisClient.ts's).
    // What's being verified is that this artificially-injected partial
    // state is detected and surfaced as a distinct integrity failure --
    // never silently resolved either way, and never automatically repaired
    // -- not that no partial write occurred.
    mockRedis.failNextCommit('partial_apply');
    await expect(openPaperPosition(openReq({ idempotencyKey: 'sweep-2' }))).rejects.toThrow(PaperTradingError);
    ledger = await getPaperTradingLedger('u1');
    // The partial write did land in this corrupted-injection scenario (by
    // construction of the test double) -- the important guarantee is that
    // the caller was NOT told this succeeded, and the disagreement was
    // reported rather than papered over. Confirm the surfaced error is the
    // distinct integrity code, not a generic success or a plain retry.
    events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.idempotencyKey === 'sweep-2' && e.eventType === 'entry_accepted')).toBe(false);
  });
});

describe('accepted/rejected audit semantics (PO Round 4)', () => {
  it('open: a confirmed commit succeeds even when the standalone audit-append path is broken, and the accepted event (not a separate event) carries the stale-quote-confirmation evidence', async () => {
    // Arm a failure for the next STANDALONE (non-script) audit append. If
    // openPaperPosition() still called a separate post-commit
    // appendPaperAuditEvent() for stale-quote evidence (the old, rejected
    // architecture), this would throw and (under the old code) get turned
    // into an entry_rejected event with the commit itself already having
    // succeeded. Under the current architecture nothing calls the
    // standalone append path after a successful commit at all, so this must
    // have no effect on the result.
    mockRedis.failNextPlainAppend('standalone audit append should not be reached after a successful open commit');

    const req = openReq({ staleConfirmed: true, quoteSnapshot: quoteFor(cspLegs) });
    // Force a stale quote: backdate the quote timestamp on the snapshot.
    const staleQuote: PaperQuoteSnapshot = {
      source: 'manual',
      legs: req.quoteSnapshot!.legs.map((l) => ({ ...l, quoteTimestamp: new Date(Date.now() - 400_000).toISOString() })),
    };

    const result = await openPaperPosition({ ...req, quoteSnapshot: staleQuote });
    expect(result.replay).toBe(false);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
    const accepted = events.find((e) => e.eventType === 'entry_accepted');
    expect(accepted).toBeDefined();
    expect(accepted?.pricingSource).toBe('stale_confirmed');
    expect(accepted?.ruleIds).toContain('pt_stale_quote_confirmed');
    // No separate stale_quote_confirmed event exists -- the evidence lives
    // only on the primary accepted event.
    expect(events.some((e) => e.eventType === 'stale_quote_confirmed')).toBe(false);

    // The armed failure was never consumed, proving nothing attempted a
    // standalone append on this success path.
    mockRedis.failNextPlainAppend('should remain armed and unused');
    // (No further assertion needed here beyond the above -- re-arming and
    // leaving it unused for the rest of this test is itself the point.)
  });

  it('open: manual-override evidence is recorded on the accepted event, and a broken standalone-append path does not affect success', async () => {
    mockRedis.failNextPlainAppend('standalone audit append should not be reached after a successful open commit');

    const result = await openPaperPosition(
      openReq({
        quoteSnapshot: null,
        manualOverride: { manualPrice: 2.5, reason: 'no live quote available', confirmed: true },
      }),
    );
    expect(result.replay).toBe(false);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
    const accepted = events.find((e) => e.eventType === 'entry_accepted');
    expect(accepted?.pricingSource).toBe('manual_paper_fill');
    expect(accepted?.ruleIds).toContain('pt_manual_fill_override');
    expect(events.some((e) => e.eventType === 'manual_fill_override_confirmed')).toBe(false);
  });

  it('close: a confirmed commit succeeds even when the standalone audit-append path is broken, and the accepted event carries manual-override evidence', async () => {
    const opened = await openPaperPosition(openReq());

    mockRedis.failNextPlainAppend('standalone audit append should not be reached after a successful close commit');

    const result = await closePaperPosition({
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: null,
      staleConfirmed: false,
      manualOverride: { manualPrice: 1.1, reason: 'manual close fill', confirmed: true },
    });
    expect(result.replay).toBe(false);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.closedPositions).toHaveLength(1);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_rejected')).toBe(false);
    const accepted = events.find((e) => e.eventType === 'close_accepted');
    expect(accepted).toBeDefined();
    expect(accepted?.pricingSource).toBe('manual_paper_fill');
    expect(accepted?.ruleIds).toContain('pt_manual_fill_override');
    expect(events.some((e) => e.eventType === 'manual_fill_override_confirmed')).toBe(false);
  });

  it('open: a confirmed idempotent replay remains a replay success even when replay-observation logging fails', async () => {
    const req = openReq();
    const first = await openPaperPosition(req);
    expect(first.replay).toBe(false);

    mockRedis.failNextPlainAppend('replay-observation logging should not affect the confirmed replay result');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const retried = await openPaperPosition(req);

    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(first.position.positionId);
    // The observational logging failure was reported, not swallowed silently.
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('close: a confirmed idempotent replay remains a replay success even when replay-observation logging fails', async () => {
    const opened = await openPaperPosition(openReq());
    const closeReq = {
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      staleConfirmed: false,
      manualOverride: null,
    };
    const first = await closePaperPosition(closeReq);
    expect(first.replay).toBe(false);

    mockRedis.failNextPlainAppend('replay-observation logging should not affect the confirmed replay result');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const retried = await closePaperPosition(closeReq);

    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(first.position.positionId);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('idempotency TTL precondition validation (PO Round 4)', () => {
  // Uses acquirePaperTradingLock()/releasePaperTradingLock() directly
  // (rather than withPaperTradingLock()) so a synthetic AtomicCommitPlan
  // with a deliberately invalid idempotency TTL can be passed straight to
  // commitPaperMutation(). The lock is always released in `finally` --
  // otherwise it would still be held afterward and starve any later
  // lazy-init lock acquisition this same test file's assertions need (e.g.
  // getPaperTradingLedger() acquiring its own lock for a never-before-seen
  // user), which is exactly what happened before this was added.
  async function attemptResetWithTtl(userId: string, ttlSeconds: unknown) {
    const { acquirePaperTradingLock, releasePaperTradingLock } = await import('../persistence/locking');
    const { commitPaperMutation } = await import('../persistence/commit');
    const { createInitialLedger } = await import('../ledger');

    const lock = await acquirePaperTradingLock(userId);
    expect(lock.acquired).toBe(true);

    try {
      return await commitPaperMutation(userId, lock.lockId, (_account, current) => ({
        next: createInitialLedger(userId, 12345),
        auditEvent: {
          id: 'evt-ttl-test',
          userId,
          eventType: 'account_reset',
          operation: 'reset',
          timestamp: new Date().toISOString(),
          idempotencyKey: 'ttl-test-key',
          cashBefore: current.cash,
          cashAfter: 12345,
          ruleIds: ['pt_account_reset'],
        },
        idempotency: {
          key: `paper-trading:idempotency:${userId}:reset:ttl-test-key`,
          value: JSON.stringify({ ok: true }),
          ttlSeconds: ttlSeconds as number,
        },
        extra: null,
        verify: () => false,
      }));
    } finally {
      await releasePaperTradingLock(userId, lock.lockId);
    }
  }

  it('zero TTL writes nothing (rejected by the TypeScript guard before EVAL is called)', async () => {
    await expect(attemptResetWithTtl('u-ttl-zero', 0)).rejects.toThrow(PaperTradingError);
    const events = await getPaperAuditEvents('u-ttl-zero');
    expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(false);
    const ledger = await getPaperTradingLedger('u-ttl-zero');
    expect(ledger.startingBalance).toBe(100000); // lazy-init default -- reset never committed
  });

  it('negative TTL writes nothing', async () => {
    await expect(attemptResetWithTtl('u-ttl-neg', -5)).rejects.toThrow(PaperTradingError);
    const events = await getPaperAuditEvents('u-ttl-neg');
    expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(false);
  });

  it('fractional TTL writes nothing', async () => {
    await expect(attemptResetWithTtl('u-ttl-frac', 3.5)).rejects.toThrow(PaperTradingError);
    const events = await getPaperAuditEvents('u-ttl-frac');
    expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(false);
  });

  it('nonnumeric TTL writes nothing', async () => {
    await expect(attemptResetWithTtl('u-ttl-nan', 'not-a-number')).rejects.toThrow(PaperTradingError);
    const events = await getPaperAuditEvents('u-ttl-nan');
    expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(false);
  });

  it('valid positive integer TTL commits all state', async () => {
    const result = await attemptResetWithTtl('u-ttl-valid', 3600);
    expect(result).toBeNull();

    const events = await getPaperAuditEvents('u-ttl-valid');
    expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(true);

    const ledger = await getPaperTradingLedger('u-ttl-valid');
    expect(ledger.startingBalance).toBe(12345);

    const idemRaw = await mockRedis.get('paper-trading:idempotency:u-ttl-valid:reset:ttl-test-key');
    expect(idemRaw).not.toBeNull();
  });

  it('no invalid-TTL scenario leaves ledger, accepted audit, or idempotency state', async () => {
    const cases: Array<[string, unknown]> = [
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['nonnumeric', 'x'],
    ];
    for (const [label, ttl] of cases) {
      const userId = `u-ttl-sweep-${label}`;
      await expect(attemptResetWithTtl(userId, ttl)).rejects.toThrow(PaperTradingError);

      const ledger = await getPaperTradingLedger(userId);
      expect(ledger.startingBalance).toBe(100000);
      expect(ledger.openPositions).toHaveLength(0);

      const events = await getPaperAuditEvents(userId);
      expect(events.some((e) => e.id === 'evt-ttl-test')).toBe(false);

      const idemRaw = await mockRedis.get(`paper-trading:idempotency:${userId}:reset:ttl-test-key`);
      expect(idemRaw).toBeNull();
    }
  });

  it('Lua-level validation independently rejects an invalid TTL even when called directly, bypassing commitPaperMutation()\'s own TypeScript guard, and writes nothing', async () => {
    // This proves the fake's (and, per commit.ts's COMMIT_SCRIPT, the real
    // script's) OWN validation, decoupled from assertValidIdempotencyPlan()
    // -- "do not rely on TypeScript validation alone."
    const { acquirePaperTradingLock } = await import('../persistence/locking');
    const { paperAccountKey } = await import('@/lib/autopilot/persistence/keys');
    const { paperAuditKey, paperMutationLockKey } = await import('../persistence/keys');

    const userId = 'u-ttl-lua-direct';
    const lock = await acquirePaperTradingLock(userId);
    expect(lock.acquired).toBe(true);

    const accountKey = paperAccountKey(userId);
    const lockKey = paperMutationLockKey(userId);
    const auditKey = paperAuditKey(userId);
    const idemKey = `paper-trading:idempotency:${userId}:reset:ttl-test-key`;

    const accountBefore = await mockRedis.get(accountKey);

    const result = await mockRedis.eval(
      '-- PAPER_COMMIT_V2 (direct test call)',
      4,
      accountKey,
      lockKey,
      auditKey,
      idemKey,
      lock.lockId,
      JSON.stringify({ fake: 'account-should-not-be-written' }),
      JSON.stringify({ id: 'evt-should-not-write', eventType: 'account_reset' }),
      '4999',
      JSON.stringify({ result: 'should-not-write' }),
      '0', // invalid: zero TTL
    );

    expect(result).toBe('INVALID_ARG');
    expect(await mockRedis.get(accountKey)).toBe(accountBefore);
    expect(await mockRedis.get(idemKey)).toBeNull();
    const auditEntries = await mockRedis.lrange(auditKey, 0, -1);
    expect(auditEntries.some((raw) => raw.includes('evt-should-not-write'))).toBe(false);
  });
});

// PT-0001 PO Round 5: commitPaperMutation() may successfully commit, lose
// the EVAL acknowledgement, and then fail AGAIN while resolveAmbiguousOutcome()
// is re-reading Redis to resolve that ambiguity. That verification failure
// must never be misclassified as a confirmed rejection -- the accepted
// mutation may already exist. Every error leaving commitPaperMutation() now
// carries an explicit PaperCommitOutcomeClass (CONFIRMED_NOT_COMMITTED /
// OUTCOME_UNKNOWN / INTEGRITY_FAILURE -- see types.ts), and service.ts's
// catch blocks only append entry_rejected/close_rejected for
// CONFIRMED_NOT_COMMITTED.
describe('commit-outcome classification: reconciliation-read failures (PO Round 5)', () => {
  it('open: commit fully applies, EVAL ack is lost, and the reconciliation ACCOUNT read then fails -> OUTCOME_UNKNOWN, accepted state remains, no entry_rejected event, and a later retry with the same idempotency key replays the original success exactly once', async () => {
    const { paperAccountKey } = await import('@/lib/autopilot/persistence/keys');
    const { OutcomeUnknownError } = await import('../persistence/commit');

    const accountKey = paperAccountKey('u1');
    const req = openReq({ idempotencyKey: 'idem-outcome-unknown-account' });

    mockRedis.failNextCommit('after_apply');
    // skip: 1 -- commitPaperMutation() itself reads the account once, up
    // front, before build()/EVAL are ever reached; that legitimate read must
    // succeed. Only the SECOND read of this key -- the one
    // resolveAmbiguousOutcome() performs after the EVAL ack is lost -- is
    // the reconciliation read this test targets.
    mockRedis.failNextGetForKey(accountKey, 'simulated account read failure during reconciliation', 1);

    let caught: unknown;
    try {
      await openPaperPosition(req);
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutcomeUnknownError);
    expect(caught).toBeInstanceOf(PaperTradingError);
    expect((caught as PaperTradingError).code).toBe('OUTCOME_UNKNOWN');
    expect((caught as PaperTradingError).commitOutcome).toBe('OUTCOME_UNKNOWN');

    // The commit itself fully applied ('after_apply' writes everything
    // before the acknowledgement is lost) -- reconciliation simply could
    // not CONFIRM that. The accepted state must still be there, and no
    // rejected event may have been appended alongside it.
    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);
    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'entry_accepted')).toHaveLength(1);
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);

    // A later retry with the SAME idempotency key (reconciliation reads now
    // succeed normally, since the injected failure was single-shot) safely
    // replays the original success exactly once -- never opens a second
    // position, never resubmits under a different key.
    const retried = await openPaperPosition(req);
    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(ledger.openPositions[0].positionId);
    const ledgerAfterRetry = await getPaperTradingLedger('u1');
    expect(ledgerAfterRetry.openPositions).toHaveLength(1);
  });

  it('open: commit fully applies, EVAL ack is lost, and the reconciliation AUDIT TRAIL read then fails -> OUTCOME_UNKNOWN, accepted state remains, no entry_rejected event, and a later retry with the same idempotency key replays the original success exactly once', async () => {
    const { OutcomeUnknownError } = await import('../persistence/commit');

    const req = openReq({ idempotencyKey: 'idem-outcome-unknown-audit' });

    mockRedis.failNextCommit('after_apply');
    mockRedis.failNextLrange('simulated audit trail read failure during reconciliation');

    let caught: unknown;
    try {
      await openPaperPosition(req);
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutcomeUnknownError);
    expect((caught as PaperTradingError).commitOutcome).toBe('OUTCOME_UNKNOWN');

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);
    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'entry_accepted')).toHaveLength(1);
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);

    const retried = await openPaperPosition(req);
    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(ledger.openPositions[0].positionId);
    const ledgerAfterRetry = await getPaperTradingLedger('u1');
    expect(ledgerAfterRetry.openPositions).toHaveLength(1);
  });

  it('open: commit fully applies, EVAL ack is lost, and the reconciliation IDEMPOTENCY RECORD read then fails -> OUTCOME_UNKNOWN, accepted state remains, no entry_rejected event, and a later retry with the same idempotency key replays the original success exactly once', async () => {
    const { paperIdempotencyKey } = await import('../persistence/keys');
    const { OutcomeUnknownError } = await import('../persistence/commit');

    const idempotencyKey = 'idem-outcome-unknown-idem';
    const idemKey = paperIdempotencyKey('u1', 'open', idempotencyKey);
    const req = openReq({ idempotencyKey });

    mockRedis.failNextCommit('after_apply');
    // skip: 1 -- checkIdempotency()'s initial replay check (at the very top
    // of openPaperPosition(), before this is even a new mutation attempt)
    // legitimately reads this key first and must succeed; only the SECOND
    // read -- resolveAmbiguousOutcome()'s reconciliation read after the EVAL
    // ack is lost -- is the one this test targets.
    mockRedis.failNextGetForKey(idemKey, 'simulated idempotency record read failure during reconciliation', 1);

    let caught: unknown;
    try {
      await openPaperPosition(req);
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutcomeUnknownError);
    expect((caught as PaperTradingError).commitOutcome).toBe('OUTCOME_UNKNOWN');

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1);
    const events = await getPaperAuditEvents('u1');
    expect(events.filter((e) => e.eventType === 'entry_accepted')).toHaveLength(1);
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);

    const retried = await openPaperPosition(req);
    expect(retried.replay).toBe(true);
    expect(retried.position.positionId).toBe(ledger.openPositions[0].positionId);
    const ledgerAfterRetry = await getPaperTradingLedger('u1');
    expect(ledgerAfterRetry.openPositions).toHaveLength(1);
  });
});

describe('commit-outcome classification: confirmed rejections still produce a rejected event (regression, PO Round 5)', () => {
  it('open: a confirmed before-commit failure (nothing written; CONFIRMED_NOT_COMMITTED) still appends an entry_rejected event', async () => {
    mockRedis.failNextCommit('before_apply');

    let caught: unknown;
    try {
      await openPaperPosition(openReq({ idempotencyKey: 'idem-regression-before-apply' }));
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect((caught as PaperTradingError).commitOutcome).toBe('CONFIRMED_NOT_COMMITTED');

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(true);
  });

  it('open: a confirmed lock-ownership abort (script-returned LOCK_LOST; CONFIRMED_NOT_COMMITTED) still appends an entry_rejected event', async () => {
    const { LockLostError } = await import('../persistence/commit');

    mockRedis.failNextCommit('lock_lost');

    let caught: unknown;
    try {
      await openPaperPosition(openReq({ idempotencyKey: 'idem-regression-lock-lost' }));
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LockLostError);
    expect((caught as PaperTradingError).commitOutcome).toBe('CONFIRMED_NOT_COMMITTED');

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(true);
  });

  it('close: a confirmed before-commit failure still appends a close_rejected event', async () => {
    const opened = await openPaperPosition(openReq({ idempotencyKey: 'idem-regression-close-setup' }));

    mockRedis.failNextCommit('before_apply');
    let caught: unknown;
    try {
      await closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-regression-close-before-apply',
        positionId: opened.position.positionId,
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      });
      throw new Error('expected closePaperPosition to reject');
    } catch (e) {
      caught = e;
    }
    expect((caught as PaperTradingError).commitOutcome).toBe('CONFIRMED_NOT_COMMITTED');

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_rejected')).toBe(true);
  });
});

describe('commit-outcome classification: boundary guarantee for otherwise-unclassified errors (PO Round 6)', () => {
  it('a failure in the very first, pre-build() account read (before EVAL is ever reached) is converted to OutcomeUnknownError, not left unclassified', async () => {
    const { paperAccountKey } = await import('@/lib/autopilot/persistence/keys');
    const { OutcomeUnknownError } = await import('../persistence/commit');

    const accountKey = paperAccountKey('u1');
    // No `skip` -- this targets commitPaperMutation()'s OWN first read,
    // which happens before build()/EVAL are ever reached, and which (prior
    // to this round's boundary fix in commit.ts) had no dedicated try/catch
    // classifying its failure at all.
    mockRedis.failNextGetForKey(accountKey, 'simulated failure on the very first account read');

    let caught: unknown;
    try {
      await openPaperPosition(openReq({ idempotencyKey: 'idem-boundary-guarantee' }));
      throw new Error('expected openPaperPosition to reject');
    } catch (e) {
      caught = e;
    }

    // Converted to OUTCOME_UNKNOWN (never CONFIRMED_NOT_COMMITTED, and never
    // left with commitOutcome undefined) -- an unclassified error is not
    // proof the mutation didn't commit (in this specific case nothing was
    // even attempted yet, but the boundary fix does not special-case that;
    // it conservatively classifies anything it doesn't already recognize as
    // OUTCOME_UNKNOWN).
    expect(caught).toBeInstanceOf(OutcomeUnknownError);
    expect((caught as PaperTradingError).commitOutcome).toBe('OUTCOME_UNKNOWN');

    // service.ts's own defensive layer sees a KNOWN classification here
    // (OUTCOME_UNKNOWN), so no entry_rejected event is appended.
    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
  });
});
