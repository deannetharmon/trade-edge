// lib/paper-trading/__tests__/service.test.ts
//
// PT-0001 sections 9.1/9.2 (idempotency & atomicity), 14 "Idempotency and
// concurrency". Exercises the real service.ts + persistence/store.ts +
// ledger.ts + idempotency.ts + audit.ts stack against a single in-memory
// fake Redis (the same one lib/autopilot/persistence/paperAccountStore.ts
// and lib/paper-trading's own locking/idempotency/audit all read/write
// through), so this is a genuine integration test of the atomic
// read-modify-write path, not a mocked-out shell.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from './testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

import { closePaperPosition, openPaperPosition, resetPaperLedger } from '../service';
import { getPaperTradingLedger } from '../persistence/store';
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

describe('openPaperPosition / closePaperPosition full lifecycle', () => {
  it('opens then closes a position, updating cash/reserved/realized correctly', async () => {
    const opened = await openPaperPosition(openReq());
    expect(opened.replay).toBe(false);
    expect(opened.ledgerView.ledger.openPositions).toHaveLength(1);

    const closed = await closePaperPosition({
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      staleConfirmed: false,
      manualOverride: null,
    });
    expect(closed.replay).toBe(false);
    expect(closed.ledgerView.ledger.openPositions).toHaveLength(0);
    expect(closed.ledgerView.ledger.closedPositions).toHaveLength(1);
  });
});

describe('idempotent replay (section 9.1)', () => {
  it('replays the original result for a duplicate open with the same key and payload', async () => {
    // Reuse the SAME request object for both calls -- quoteFor() stamps a
    // fresh quoteTimestamp on every call, and a genuinely different quote
    // observation is correctly treated as a materially different payload
    // (corrective round fix #1: nested quote fields are no longer silently
    // dropped from the idempotency comparison). A real duplicate submission
    // resends the identical captured quote snapshot, not a freshly-sampled
    // one, so this mirrors the actual retry behavior being tested.
    const req = openReq();
    const first = await openPaperPosition(req);
    const second = await openPaperPosition(req);

    expect(second.replay).toBe(true);
    expect(second.position.positionId).toBe(first.position.positionId);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(1); // not duplicated
  });

  it('rejects the same idempotency key reused with a materially different payload', async () => {
    await openPaperPosition(openReq());
    await expect(openPaperPosition(openReq({ quantity: 2 }))).rejects.toThrow(PaperTradingError);
  });

  it('replays the original result for a duplicate close', async () => {
    const opened = await openPaperPosition(openReq());
    const closeArgs = {
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      staleConfirmed: false,
      manualOverride: null,
    };
    const first = await closePaperPosition(closeArgs);
    const second = await closePaperPosition(closeArgs);
    expect(second.replay).toBe(true);
    expect(second.position.positionId).toBe(first.position.positionId);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.closedPositions).toHaveLength(1); // not double-closed
  });

  it('rejects closing an already-closed position under a NEW idempotency key', async () => {
    const opened = await openPaperPosition(openReq());
    await closePaperPosition({
      userId: 'u1',
      idempotencyKey: 'idem-close-1',
      positionId: opened.position.positionId,
      quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
      staleConfirmed: false,
      manualOverride: null,
    });

    await expect(
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: 'idem-close-2', // different key -- not a replay, a genuine second attempt
        positionId: opened.position.positionId,
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }),
    ).rejects.toThrow(/already been closed/);
  });
});

describe('concurrency / atomicity (section 9.2)', () => {
  it('two concurrent opens for the same user cannot together overspend available capital', async () => {
    // Starting balance defaults to 100,000; a $100-strike CSP reserves
    // $10,000 -- ten of them would exactly exhaust it, so eleven concurrent
    // attempts must not all succeed.
    const attempts = Array.from({ length: 11 }, (_, i) =>
      openPaperPosition(
        openReq({ idempotencyKey: `idem-concurrent-${i}`, legs: [{ ...cspLegs[0] }] }),
      ).then(
        () => ({ ok: true as const }),
        (e) => ({ ok: false as const, error: e }),
      ),
    );
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    expect(succeeded.length).toBe(10);
    expect(failed.length).toBe(1);
    for (const f of failed) {
      if (!f.ok) expect(f.error).toBeInstanceOf(PaperTradingError);
    }

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.openPositions).toHaveLength(10);
    expect(ledger.reservedCapital).toBeLessThanOrEqual(100000);
  });

  it('two concurrent closes of the same position cannot both release capital (second sees already-closed)', async () => {
    const opened = await openPaperPosition(openReq());
    const closeOnce = (key: string) =>
      closePaperPosition({
        userId: 'u1',
        idempotencyKey: key,
        positionId: opened.position.positionId,
        quoteSnapshot: quoteFor(cspLegs, [1.0, 1.2]),
        staleConfirmed: false,
        manualOverride: null,
      }).then(
        () => ({ ok: true as const }),
        (e) => ({ ok: false as const, error: e }),
      );

    const [a, b] = await Promise.all([closeOnce('close-a'), closeOnce('close-b')]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);

    const ledger = await getPaperTradingLedger('u1');
    expect(ledger.closedPositions).toHaveLength(1);
    expect(ledger.reservedCapital).toBe(0);
  });
});

describe('reset is user-scoped', () => {
  it('resetting one user does not affect another user\'s ledger', async () => {
    await openPaperPosition(openReq({ userId: 'u1', idempotencyKey: 'k-u1' }));
    await openPaperPosition(openReq({ userId: 'u2', idempotencyKey: 'k-u2' }));

    await resetPaperLedger({ userId: 'u1', idempotencyKey: 'reset-1', startingBalance: 5000 });

    const u1 = await getPaperTradingLedger('u1');
    const u2 = await getPaperTradingLedger('u2');
    expect(u1.openPositions).toHaveLength(0);
    expect(u1.startingBalance).toBe(5000);
    expect(u2.openPositions).toHaveLength(1); // untouched
  });
});
