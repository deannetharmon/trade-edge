// lib/ai-policy/__tests__/builders/deterministicRegression.test.ts
//
// Acceptance 6: with all AI flags on or off, a fixture scan session's counts, dispositions, ranking order and readiness
// fields are byte-identical after freeze + summary + chat. The session is deep-frozen, so any attempt by the freeze,
// summary, or chat paths to mutate scan state would throw and show up as a failed step here.

import { describe, expect, it, vi } from 'vitest';
import { computeSessionAccounting } from '@/lib/screener/scanSession';
import { freezeScanSession } from '../../freezeScanSession';
import { runAiRoute } from '../../gateway';
import { FakeRedis } from '../../fixtures/fakeRedis';
import { TEST_ENV, USER, fakeFetch } from '../../fixtures/testRoute';
import { deepFreeze, makeSession, scanOutputJson } from '../../builders/testing/scanSessionFixture';

function fingerprint(session: ReturnType<typeof makeSession>): string {
  return JSON.stringify({
    whole: session,
    accounting: computeSessionAccounting(session),
    dispositions: session.symbolOutcomes.map((o) => [o.symbol, o.status, o.reasonCode ?? null, o.candidateCount]),
    rankingOrder: session.results.map((r) => [r.symbol, r.publishedRank ?? null, r.publishedOrder ?? null]),
    readiness: session.results.map((r) => [r.symbol, r.qualified, (r as { pmccDecision?: unknown }).pmccDecision ?? null]),
  });
}

async function runAll(env: Record<string, string | undefined>) {
  const session = deepFreeze(makeSession({ resultOver: (_s, i) => ({ publishedRank: i + 1 }) }));
  const before = fingerprint(session);
  const redis = new FakeRedis();
  const fetchImpl = vi.fn(fakeFetch(scanOutputJson()));
  const deps = { env, redis, fetchImpl: fetchImpl as unknown as typeof fetch };

  const frozen = await freezeScanSession({ userId: USER, session, idempotencyKey: 'regress-freeze-key-0001' }, deps);
  const inputId = frozen.status === 'frozen' ? frozen.analysisInputId : 'none';
  const summary = await runAiRoute({ route: 'scan_summary', userId: USER, inputId, idempotencyKey: 'regress-summary-key-001', userAction: 'click:x' }, deps);
  const chat = await runAiRoute({ route: 'grounded_chat', userId: USER, inputId, idempotencyKey: 'regress-chat-key-00001', question: 'Why was DDD excluded?', userAction: 'click:x' }, deps);
  return { before, after: fingerprint(session), frozen, summary, chat, providerCalls: fetchImpl.mock.calls.length };
}

describe('acceptance 6: freeze, summary and chat cannot reach deterministic scan state', () => {
  it('flags ON: every step succeeds and the session is byte-identical afterwards', async () => {
    const run = await runAll(TEST_ENV);
    expect(run.frozen.status).toBe('frozen');
    expect(run.summary.status).toBe('ready');
    expect(run.chat.status).toBe('ready');
    expect(run.providerCalls).toBe(2);
    expect(run.after).toBe(run.before);
  });

  it('flags OFF: every step is unavailable(FLAG_OFF), no provider call, and the session is byte-identical', async () => {
    const run = await runAll({ ...TEST_ENV, AI_POLICY_ENABLED: undefined });
    expect(run.frozen).toEqual({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(run.summary).toMatchObject({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(run.chat).toMatchObject({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(run.providerCalls).toBe(0);
    expect(run.after).toBe(run.before);
  });

  it('the on and off runs leave identical scan state', async () => {
    const on = await runAll(TEST_ENV);
    const off = await runAll({ ...TEST_ENV, AI_POLICY_ENABLED: undefined });
    // Session ids and timestamps differ per run; the deterministic parts (counts, dispositions, order) must not.
    const strip = (fp: string) => {
      const { accounting, dispositions, rankingOrder, readiness } = JSON.parse(fp);
      return { accounting, dispositions, rankingOrder, readiness };
    };
    expect(strip(on.after)).toEqual(strip(off.after));
  });
});
