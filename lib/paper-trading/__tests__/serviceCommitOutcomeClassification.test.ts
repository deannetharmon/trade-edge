// lib/paper-trading/__tests__/serviceCommitOutcomeClassification.test.ts
//
// PT-0001 PO Round 6: the sixth review found that service.ts's post-commit
// catch blocks had the unclassified/unexpected-commitOutcome case backwards.
// The prior (Round 5) check was:
//
//   if (outcome === 'OUTCOME_UNKNOWN' || outcome === 'INTEGRITY_FAILURE') {
//     throw e; // skip the rejected-event append
//   }
//   // falls through to appending entry_rejected/close_rejected otherwise --
//   // including when `outcome` is undefined (missing) or any value this
//   // codebase doesn't recognize.
//
// That fell through to RECORDING a rejection for a missing/unrecognized
// commitOutcome, which treats an unclassified error as if it were proof the
// mutation did not commit -- exactly the class of bug this sprint keeps
// finding. The fix (service.ts's new shouldRecordCommitRejection()) inverts
// this: a rejected event is recorded ONLY for the one classification that
// actually proves non-commit, CONFIRMED_NOT_COMMITTED. Everything else --
// OUTCOME_UNKNOWN, INTEGRITY_FAILURE, undefined, or a bogus/future value --
// defaults to "do not record", with the missing/unrecognized case reported
// via console.error (the same non-throwing "log an anomaly" convention used
// elsewhere in this file) rather than silently swallowed.
//
// persistence/commit.ts's own boundary-classification fix (this same round)
// means an unclassified error can no longer actually reach service.ts
// through the REAL commitPaperMutation() call path -- see that module's
// ensureClassifiedOutcome() doc comment. This file tests service.ts's
// defensive handling of that case directly and in isolation, independent of
// whether commit.ts's own guarantee holds, by mocking commitPaperMutation()
// itself so its rejection value is fully controlled by each test -- this is
// deliberately a different testing style from service.test.ts (a genuine,
// unmocked integration test of the real commit path), because what's being
// proven here is specifically service.ts's OWN fallback behavior as a
// second, independent layer of defense.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

const commitPaperMutationMock = vi.fn();

vi.mock('../persistence/commit', () => ({
  commitPaperMutation: (...args: unknown[]) => commitPaperMutationMock(...args),
  // service.ts only uses this for an `instanceof` check inside
  // rejectionRuleId(); none of these tests throw a real lock-loss error, so
  // a standalone stand-in (never actually thrown here) is sufficient.
  LockLostError: class LockLostError extends Error {},
}));

import { closePaperPosition, openPaperPosition } from '../service';
import { getPaperAuditEvents } from '../audit';
import { PaperTradingError } from '../types';
import type { PaperCommitOutcomeClass, PaperLeg, PaperQuoteSnapshot } from '../types';
import { createInitialLedger, openPosition } from '../ledger';
import { buildFillEvidence } from '../pricing';
import { createInitialPaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import { paperAccountKey } from '@/lib/autopilot/persistence/keys';

beforeEach(() => {
  mockRedis = new FakeRedisClient();
  commitPaperMutationMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
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

/**
 * Seeds an already-open position directly into the fake Redis account
 * record -- built with the same pure domain functions (createInitialLedger,
 * buildFillEvidence, openPosition) commitPaperMutation()'s own build()
 * callback uses -- so closePaperPosition() can find it via
 * getPaperTradingLedger() without needing a real (unmocked)
 * commitPaperMutation() call, since that function is entirely mocked in
 * this file.
 */
async function seedOpenPosition(userId: string, positionId: string): Promise<void> {
  const now = new Date();
  const ledger = createInitialLedger(userId, 100000);
  const entryFill = buildFillEvidence({
    legs: cspLegs,
    quantity: 1,
    contractMultiplier: 100,
    quoteSnapshot: quoteFor(cspLegs),
    side: 'open',
    staleConfirmed: false,
    manualOverride: null,
    now,
  });
  const { next } = openPosition(ledger, {
    positionId,
    idempotencyKey: 'seed-idem',
    userId,
    symbol: 'SPY',
    strategy: 'CSP',
    legs: cspLegs,
    expiration: EXP,
    quantity: 1,
    contractMultiplier: 100,
    entryFill,
    entryRationale: null,
    auditRefs: ['seed-evt'],
    now,
  });
  const account = { ...createInitialPaperAccount(userId), paperTrading: next };
  await mockRedis.set(paperAccountKey(userId), JSON.stringify(account));
}

function unclassifiedError(): PaperTradingError {
  // Deliberately constructed with NO commitOutcome set -- simulating what
  // would happen if some future code path threw out of commitPaperMutation()
  // without classifying the error (the exact scenario persistence/commit.ts's
  // own boundary fix, in this same round, now prevents on the real path).
  return new PaperTradingError('COMMIT_FAILED', 'simulated unclassified commit-boundary error');
}

function errorWithOutcome(outcome: PaperCommitOutcomeClass | 'SOME_FUTURE_OUTCOME_VALUE' | undefined): PaperTradingError {
  const e = new PaperTradingError('COMMIT_FAILED', `simulated commit error (commitOutcome=${String(outcome)})`);
  // Cast through unknown -- deliberately testing a value outside the current
  // PaperCommitOutcomeClass union for the "unrecognized" case.
  (e as unknown as { commitOutcome: unknown }).commitOutcome = outcome;
  return e;
}

describe('service.ts commit-rejection classification (PO Round 6)', () => {
  it('open: an unclassified error (commitOutcome undefined) produces NO entry_rejected event, is reported via console.error, and is rethrown unchanged', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = unclassifiedError();
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(openPaperPosition(openReq())).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/unclassified|unrecognized/i);
  });

  it('close: an unclassified error (commitOutcome undefined) produces NO close_rejected event, is reported via console.error, and is rethrown unchanged', async () => {
    await seedOpenPosition('u1', 'pos-unclassified-close');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = unclassifiedError();
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-close-unclassified',
        positionId: 'pos-unclassified-close',
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }),
    ).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_rejected')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/unclassified|unrecognized/i);
  });

  it('open: an unexpected/unrecognized commitOutcome value produces NO entry_rejected event and is reported via console.error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = errorWithOutcome('SOME_FUTURE_OUTCOME_VALUE');
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(openPaperPosition(openReq())).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('close: an unexpected/unrecognized commitOutcome value produces NO close_rejected event and is reported via console.error', async () => {
    await seedOpenPosition('u1', 'pos-unexpected-close');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = errorWithOutcome('SOME_FUTURE_OUTCOME_VALUE');
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-close-unexpected',
        positionId: 'pos-unexpected-close',
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }),
    ).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_rejected')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('open: OUTCOME_UNKNOWN and INTEGRITY_FAILURE still produce no entry_rejected event and no anomaly log (they are known, expected classifications, not unclassified ones)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    commitPaperMutationMock.mockRejectedValueOnce(errorWithOutcome('OUTCOME_UNKNOWN'));
    await expect(openPaperPosition(openReq({ idempotencyKey: 'idem-outcome-unknown' }))).rejects.toBeInstanceOf(PaperTradingError);

    commitPaperMutationMock.mockRejectedValueOnce(errorWithOutcome('INTEGRITY_FAILURE'));
    await expect(openPaperPosition(openReq({ idempotencyKey: 'idem-integrity-failure' }))).rejects.toBeInstanceOf(PaperTradingError);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(false);
    // Known classifications aren't anomalies -- nothing to report.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('open: a CONFIRMED_NOT_COMMITTED outcome still appends an entry_rejected event (regression -- this pass must not suppress a legitimate rejection)', async () => {
    const thrown = errorWithOutcome('CONFIRMED_NOT_COMMITTED');
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(openPaperPosition(openReq())).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'entry_rejected')).toBe(true);
  });

  it('close: a CONFIRMED_NOT_COMMITTED outcome still appends a close_rejected event (regression -- this pass must not suppress a legitimate rejection)', async () => {
    await seedOpenPosition('u1', 'pos-confirmed-close');
    const thrown = errorWithOutcome('CONFIRMED_NOT_COMMITTED');
    commitPaperMutationMock.mockRejectedValueOnce(thrown);

    await expect(
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-close-confirmed',
        positionId: 'pos-confirmed-close',
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }),
    ).rejects.toBe(thrown);

    const events = await getPaperAuditEvents('u1');
    expect(events.some((e) => e.eventType === 'close_rejected')).toBe(true);
  });
});
