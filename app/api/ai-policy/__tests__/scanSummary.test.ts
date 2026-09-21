// app/api/ai-policy/__tests__/scanSummary.test.ts
//
// POST /api/ai-policy/scan-summary: auth, IDOR, idempotency, fallback states, neutral bodies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '@/lib/ai-policy/fixtures/fakeRedis';
import { makeSession, scanOutputJson } from '@/lib/ai-policy/builders/testing/scanSessionFixture';
import { KEY_A, applyEnv, expectNeutralBody, post, stubProvider } from './support';

const h = vi.hoisted(() => ({ redis: null as unknown, userId: 'user-a' as string | null }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

let restoreEnv: () => void;
let redis: FakeRedis;
let n = 0;
const key = (): string => `summary-key-${String((n += 1)).padStart(10, '0')}`;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  h.userId = 'user-a';
  restoreEnv = applyEnv();
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

async function freeze(): Promise<string> {
  const { POST } = await import('../snapshots/route');
  const res = await POST(post('/api/ai-policy/snapshots', { kind: 'scan_session', session: makeSession(), idempotencyKey: key() }));
  return ((await res.json()) as { analysisInputId: string }).analysisInputId;
}
const summarize = async (analysisInputId: string, idempotencyKey = key()) => {
  const { POST } = await import('../scan-summary/route');
  const res = await POST(post('/api/ai-policy/scan-summary', { analysisInputId, idempotencyKey }));
  return { res, body: (await res.json()) as Record<string, any> };
};
const RANDOM_ID = '11111111-1111-4111-8111-111111111111';

describe('route configuration', () => {
  it('runs on Node, is dynamic, and has a 60 s limit', async () => {
    const mod = await import('../scan-summary/route');
    expect([mod.runtime, mod.dynamic, mod.maxDuration]).toEqual(['nodejs', 'force-dynamic', 60]);
  });
});

describe('authentication and strict bodies', () => {
  it('401 before reading the body or calling the provider', async () => {
    const id = await freeze();
    h.userId = null;
    const provider = stubProvider(scanOutputJson());
    const { res, body } = await summarize(id);
    expect([res.status, body]).toEqual([401, { status: 'unauthorized' }]);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown key', { analysisInputId: RANDOM_ID, idempotencyKey: KEY_A, model: 'gpt-6-astra' }],
    ['a client user id', { analysisInputId: RANDOM_ID, idempotencyKey: KEY_A, userId: 'user-b' }],
    ['a missing key', { analysisInputId: RANDOM_ID }],
    ['a non-string id', { analysisInputId: 5, idempotencyKey: KEY_A }],
  ])('422 for %s, with no provider call', async (_n, body) => {
    const provider = stubProvider(scanOutputJson());
    const { POST } = await import('../scan-summary/route');
    const res = await POST(post('/api/ai-policy/scan-summary', body));
    expect(res.status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('acceptance 2: no cross-user access to an analysis input', () => {
  it("user B asking for user A's input gets the identical NOT_FOUND as a random id", async () => {
    const id = await freeze();
    const provider = stubProvider(scanOutputJson());
    h.userId = 'user-b';
    const foreign = await summarize(id);
    const random = await summarize(RANDOM_ID);
    expect(foreign.res.status).toBe(404);
    expect(foreign.body).toEqual({ status: 'unavailable', reason: 'NOT_FOUND', artifactId: null });
    expect(random.body).toEqual(foreign.body);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('summary', () => {
  it('returns a ready artifact with rendered values and none of the internals', async () => {
    const id = await freeze();
    stubProvider(scanOutputJson());
    const { res, body } = await summarize(id);
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.artifact.output.summary).toBe('The scan evaluated 3 symbols and found 2 candidates.');
    expect(Object.keys(body.artifact).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'inputId', 'model', 'output', 'route', 'status']);
    expect(JSON.stringify(body)).not.toMatch(/accountScope|trust|pointer|templateId|payloadHash|valueHash/);
  });

  it('acceptance 8: the same key returns the same artifact with one provider call', async () => {
    const id = await freeze();
    const provider = stubProvider(scanOutputJson());
    const k = key();
    const first = await summarize(id, k);
    const again = await summarize(id, k);
    expect(again.body).toEqual(first.body);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('a rejected output is a normal 200 with the neutral rejected body (nothing the model wrote)', async () => {
    const id = await freeze();
    stubProvider(scanOutputJson((o) => { o.summary = 'You should buy {{c:1}}.'; }));
    const { res, body } = await summarize(id);
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('should buy');
  });
});

describe('acceptance 7: failures share one neutral body and the status for their reason', () => {
  it('a provider error: 503 PROVIDER_ERROR with no provider text', async () => {
    const id = await freeze();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"secret provider detail sk-live-123"}}', { status: 500 })));
    const { res, body } = await summarize(id);
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'unavailable', reason: 'PROVIDER_ERROR', artifactId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('secret provider detail');
    expectNeutralBody(body);
  });

  it('a network failure inside the provider call is also neutral', async () => {
    const id = await freeze();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNRESET 10.0.0.1'); }));
    const { res, body } = await summarize(id);
    expect(res.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain('ECONNRESET');
  });

  it.each([
    ['flags off', { AI_POLICY_ENABLED: undefined }, 503, 'FLAG_OFF'],
    ['route flag off', { AI_POLICY_SCAN_SUMMARY_ENABLED: undefined }, 503, 'FLAG_OFF'],
    ['no governance attestation', { AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED: undefined }, 503, 'GOVERNANCE'],
    ['unset budgets', { AI_POLICY_GLOBAL_DAILY_BUDGET_USD: undefined }, 429, 'BUDGET'],
  ])('%s', async (_n, env, status, reason) => {
    const id = await freeze();
    const provider = stubProvider(scanOutputJson());
    restoreEnv();
    restoreEnv = applyEnv(env);
    const { res, body } = await summarize(id);
    expect([res.status, body]).toEqual([status, { status: 'unavailable', reason, artifactId: null }]);
    expect(provider).not.toHaveBeenCalled();
  });

  it('a kill switch: 503 KILL_SWITCH', async () => {
    const id = await freeze();
    await redis.set('ai-policy:kill:route:scan_summary', '1');
    const provider = stubProvider(scanOutputJson());
    const { res, body } = await summarize(id);
    expect([res.status, body.reason]).toEqual([503, 'KILL_SWITCH']);
    expect(provider).not.toHaveBeenCalled();
  });

  it('the hourly limit: 429 RATE_LIMIT', async () => {
    const id = await freeze();
    stubProvider(scanOutputJson());
    restoreEnv();
    restoreEnv = applyEnv({ AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: '1' });
    expect((await summarize(id)).res.status).toBe(200);
    const second = await summarize(id);
    expect([second.res.status, second.body.reason]).toEqual([429, 'RATE_LIMIT']);
  });

  it('Redis down: a neutral 503', async () => {
    const id = await freeze();
    redis.failAll = true;
    const { res, body } = await summarize(id);
    expect(res.status).toBe(503);
    expectNeutralBody(body);
  });

  it('every body of every failure has the same key set', async () => {
    const id = await freeze();
    const shapes = new Set<string>();
    for (const env of [{ AI_POLICY_ENABLED: undefined }, { AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED: undefined }, {}]) {
      restoreEnv();
      restoreEnv = applyEnv(env);
      stubProvider('not json');
      shapes.add(Object.keys((await summarize(id)).body).sort().join(','));
    }
    expect(Array.from(shapes)).toEqual(['artifactId,reason,status']);
  });
});
