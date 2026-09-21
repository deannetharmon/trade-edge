// lib/ai-policy/__tests__/gateway.test.ts
//
// Gateway: stage-failure matrix (one test per stage) proving the provider is called only after stages 1-7 pass, no stage
// throws, and a failed or rejected run leaves the stored input unchanged; plus the happy path and provenance content.

import { describe, expect, it, vi } from 'vitest';
import { getArtifact, listArtifactIds } from '../artifactStore';
import { InMemoryBudgetStore, budgetKeys } from '../budget';
import type { BudgetStore } from '../budget';
import { FAILURE_THRESHOLD } from '../circuitBreaker';
import { runAiRoute } from '../gateway';
import type { GatewayDeps, RunAiRouteRequest } from '../gateway';
import { fingerprint, idempotencyKey } from '../idempotency';
import { getInput, inputKey, saveInput } from '../inputStore';
import { KILL_GLOBAL_KEY, killRouteKey } from '../killSwitch';
import { actualCostMicros } from '../pricing';
import { auditKey, getProvenance } from '../provenance';
import { ROUTE_SPECS } from '../routeSpecs';
import { AI_ROUTE_IDS } from '../types';
import type { AiRouteId } from '../types';
import { FakeRedis } from '../fixtures/fakeRedis';
import { NOW, OTHER_USER, TEST_ENV, USER, fakeFetch, makeInput, testSpecs, validOutputJson } from '../fixtures/testRoute';

const IDEM = 'idem-key-0123456789';

async function setup(opts: { env?: Record<string, string | undefined>; route?: AiRouteId; fetchText?: string; inputOver?: Parameters<typeof makeInput>[0] } = {}) {
  const redis = new FakeRedis();
  redis.clock = () => NOW;
  const env = { ...TEST_ENV, ...opts.env };
  const route = opts.route ?? 'scan_summary';
  const input = makeInput({ route, ...opts.inputOver });
  await saveInput(redis, input, env);
  const fetchImpl = vi.fn(fakeFetch(opts.fetchText ?? validOutputJson()));
  const budget = new InMemoryBudgetStore();
  const deps: GatewayDeps = { env, redis, budgetStore: budget, now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch, specs: testSpecs(), providerTimeoutMs: 50 };
  const request = (over: Partial<RunAiRouteRequest> = {}): RunAiRouteRequest => ({ route, userId: USER, inputId: input.id, idempotencyKey: IDEM, userAction: 'click:explain_scan', ...over });
  return { redis, env, input, fetchImpl, budget, deps, request, run: (over: Partial<RunAiRouteRequest> = {}, d: Partial<GatewayDeps> = {}) => runAiRoute(request(over), { ...deps, ...d }) };
}

describe('acceptance 1: with no env set every route is unavailable(FLAG_OFF) and nothing is called', () => {
  it.each(AI_ROUTE_IDS.map((r) => [r]))('%s', async (route) => {
    const redis = new FakeRedis();
    redis.failAll = true; // any Redis use would surface as KILL_SWITCH, not FLAG_OFF
    const fetchImpl = vi.fn();
    const result = await runAiRoute(
      { route, userId: USER, inputId: 'x', idempotencyKey: IDEM, userAction: 'click:x' },
      { env: {}, redis, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ status: 'unavailable', reason: 'FLAG_OFF', artifactId: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a fully configured environment still cannot run a route that has no template or registry yet (the deep routes)', async () => {
    const s = await setup({ route: 'leaps_deep_analysis' });
    const result = await s.run({}, { specs: ROUTE_SPECS });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('retrospective_batch is never dispatched by this gateway', async () => {
    const s = await setup();
    expect(await s.run({ route: 'retrospective_batch' })).toMatchObject({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('returns a ready artifact with rendered values, persists provenance, and reconciles the budget to actual usage', async () => {
    const s = await setup();
    const result = await s.run();
    if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
    expect(result.artifact.output?.summary).toBe('The scan finished with 3 candidates.');
    expect(result.artifact).toMatchObject({ route: 'scan_summary', tier: 'economy', model: 'gpt-5.6-luna', trust: 'client_attested', status: 'ready' });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse((s.fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    for (const key of ['tools', 'functions', 'tool_choice', 'function_call', 'web_search', 'plugins', 'mcp']) expect(body).not.toHaveProperty(key);
    expect(body.response_format.json_schema.strict).toBe(true);

    const keys = budgetKeys(USER, 'scan_summary', NOW);
    expect(s.budget.get(keys.monthKey)).toBe(actualCostMicros('gpt-5.6-luna', 400, 200));
    expect(s.budget.get(keys.hourKey)).toBe(1);
  });

  it('stores an encrypted artifact readable only by its owner', async () => {
    const s = await setup();
    const result = await s.run();
    if (result.status !== 'ready') throw new Error('expected ready');
    expect((await getArtifact(s.redis, USER, result.artifact.id, s.env))?.status).toBe('ready');
    expect(await getArtifact(s.redis, OTHER_USER, result.artifact.id, s.env)).toBeNull();
  });
});

describe('acceptance 11: provenance record', () => {
  it('has every required field, hashes only, no prompt/output text, no account number; audit read needs the owner', async () => {
    const s = await setup();
    const result = await s.run();
    if (result.status !== 'ready') throw new Error('expected ready');
    const record = (await getProvenance(s.redis, USER, result.artifact.id))!;
    expect(record).toMatchObject({
      artifactId: result.artifact.id, artifactType: 'scan_summary', status: 'ready', provider: 'openai', model: 'gpt-5.6-luna', providerModelId: 'test-model-2026',
      templateId: 'test-template', templateVersion: 't1', policyVersion: 'ai-policy-v1', providerPolicyVersion: 'test-policy-1', lexiconVersion: 'lex-v1-draft', validatorVersion: 'val-v1',
      input: { id: s.input.id, payloadHash: s.input.payloadHash, schemaVersion: 'scan_summary.v1', trustClass: 'client_attested' },
      deterministicStates: ['Not ready'], sourceAsOf: s.input.sourceAsOf, userAction: 'click:explain_scan', failureReason: null,
      featureFlag: { global: 'AI_POLICY_ENABLED', route: 'AI_POLICY_SCAN_SUMMARY_ENABLED' }, validation: { result: 'accepted', rule: null },
      cost: { inputTokens: 400, outputTokens: 200 },
    });
    expect(record.authorizationScope.accountScope).toBe('scope-synthetic-0001');
    expect(record.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.validation.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.citations[1]).toMatchObject({ pointer: '/candidates/0/delta', source: 'quoteGreeks', format: 'number' });
    expect(record.citations[1].valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.claimMap.length).toBeGreaterThan(0);

    const text = JSON.stringify(record);
    for (const forbidden of ['The scan finished', 'Explain the frozen facts', 'AAA', '5WX', 'delta is', 'Delta is']) expect(text).not.toContain(forbidden);
    expect(await getProvenance(s.redis, OTHER_USER, result.artifact.id)).toBeNull();
  });
});

describe('acceptance 10: stage-failure matrix (provider called only after stages 1-7 pass; nothing throws)', () => {
  const noProvider = (s: { fetchImpl: unknown }): void => { expect(s.fetchImpl).not.toHaveBeenCalled(); };

  describe('stage 1: flags and kill switches', () => {
    it('global flag off', async () => { const s = await setup({ env: { AI_POLICY_ENABLED: undefined } }); expect(await s.run()).toMatchObject({ reason: 'FLAG_OFF' }); noProvider(s); });
    it('route flag off', async () => { const s = await setup({ env: { AI_POLICY_SCAN_SUMMARY_ENABLED: 'false' } }); expect(await s.run()).toMatchObject({ reason: 'FLAG_OFF' }); noProvider(s); });
    it('global kill switch (Redis wins over an enabled env flag)', async () => { const s = await setup(); await s.redis.set(KILL_GLOBAL_KEY, '1'); expect(await s.run()).toMatchObject({ reason: 'KILL_SWITCH' }); noProvider(s); });
    it('route kill switch', async () => { const s = await setup(); await s.redis.set(killRouteKey('scan_summary'), '1'); expect(await s.run()).toMatchObject({ reason: 'KILL_SWITCH' }); noProvider(s); });
    it('another route\'s kill switch does not stop this route', async () => { const s = await setup(); await s.redis.set(killRouteKey('grounded_chat'), '1'); expect((await s.run()).status).toBe('ready'); });
    it('Redis unreachable', async () => { const s = await setup(); s.redis.failAll = true; expect(await s.run()).toMatchObject({ reason: 'KILL_SWITCH' }); noProvider(s); });
  });

  describe('stage 2: governance and configured budgets', () => {
    it.each([
      ['attestation missing', { AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED: undefined }, 'GOVERNANCE'],
      ['policy version missing', { AI_POLICY_PROVIDER_POLICY_VERSION: undefined }, 'GOVERNANCE'],
      ['model not named', { AI_POLICY_ECONOMY_MODEL: undefined }, 'GOVERNANCE'],
      ['model not allowlisted', { AI_POLICY_ALLOWED_MODELS: 'gpt-5.6-sol' }, 'GOVERNANCE'],
      ['model not priced', { AI_POLICY_ECONOMY_MODEL: 'gpt-4o-mini', AI_POLICY_ALLOWED_MODELS: 'gpt-4o-mini' }, 'GOVERNANCE'],
      ['artifact key missing', { AI_POLICY_ARTIFACT_KEY: undefined }, 'GOVERNANCE'],
      ['monthly budget unset', { AI_POLICY_USER_MONTHLY_BUDGET_USD: undefined }, 'BUDGET'],
      ['global budget unset', { AI_POLICY_GLOBAL_DAILY_BUDGET_USD: undefined }, 'BUDGET'],
      ['route hourly limit unset', { AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: undefined }, 'BUDGET'],
    ])('%s', async (_n, env, reason) => {
      const s = await setup();
      expect(await s.run({}, { env: { ...TEST_ENV, ...env } })).toMatchObject({ status: 'unavailable', reason });
      noProvider(s);
    });
  });

  describe('stage 3: input load, scoped to the acting user', () => {
    it('missing id', async () => { const s = await setup(); expect(await s.run({ inputId: '11111111-1111-4111-8111-111111111111' })).toEqual({ status: 'unavailable', reason: 'NOT_FOUND', artifactId: null }); noProvider(s); });
    it('a foreign user gets the identical result as a missing id', async () => {
      const s = await setup();
      const foreign = await s.run({ userId: OTHER_USER });
      const missing = await s.run({ inputId: '11111111-1111-4111-8111-111111111111' });
      expect(foreign).toEqual(missing);
      noProvider(s);
    });
    it('malformed id', async () => { const s = await setup(); expect(await s.run({ inputId: '../x' })).toMatchObject({ reason: 'NOT_FOUND' }); noProvider(s); });
    it('input made for another route', async () => {
      const s = await setup();
      const other = makeInput({ route: 'grounded_chat' });
      await saveInput(s.redis, other, s.env);
      expect(await s.run({ inputId: other.id })).toMatchObject({ reason: 'INPUT_INVALID' });
      noProvider(s);
    });
    it('a trust class the route does not allow', async () => {
      const s = await setup();
      const wrong = makeInput({ trust: 'server_verified' });
      await saveInput(s.redis, wrong, s.env);
      expect(await s.run({ inputId: wrong.id })).toMatchObject({ reason: 'INPUT_INVALID' });
      noProvider(s);
    });
    it('an expired input', async () => { const s = await setup(); expect(await s.run({}, { now: () => NOW + 91 * 24 * 3600 * 1000 })).toMatchObject({ reason: 'INPUT_INVALID' }); noProvider(s); });
    it('a bad user action or an unsafe user id', async () => {
      const s = await setup();
      expect(await s.run({ userAction: 'Click Me!' })).toMatchObject({ reason: 'INPUT_INVALID' });
      expect(await s.run({ userId: 'a:b' })).toMatchObject({ reason: 'INPUT_INVALID' });
      noProvider(s);
    });
    it('grounded_chat needs a question that survives redaction', async () => {
      const s = await setup({ route: 'grounded_chat' });
      expect(await s.run({ question: '   ' })).toMatchObject({ reason: 'INPUT_INVALID' });
      noProvider(s);
    });
  });

  describe('stage 4: source-specific freshness', () => {
    it('a deep route with any stale required source is unavailable(INPUT_STALE)', async () => {
      const s = await setup({ route: 'leaps_deep_analysis', inputOver: { sourceAsOf: { quoteGreeks: new Date(NOW - 301_000).toISOString() } } });
      expect(await s.run({ userAction: 'click:deep' })).toMatchObject({ status: 'unavailable', reason: 'INPUT_STALE' });
      noProvider(s);
    });
    it('a deep route with a missing required source is unavailable', async () => {
      const s = await setup({ route: 'leaps_deep_analysis', inputOver: { sourceAsOf: { earningsCalendar: null } } });
      expect(await s.run()).toMatchObject({ reason: 'INPUT_STALE' });
      noProvider(s);
    });
    it('a deep route with everything fresh proceeds', async () => {
      const s = await setup({ route: 'leaps_deep_analysis' });
      expect((await s.run()).status).toBe('ready');
      expect(JSON.parse((s.fetchImpl.mock.calls[0][1] as RequestInit).body as string).model).toBe('gpt-5.6-sol');
    });
    it('summary/chat proceeds and the SERVER appends a disclosure for each omitted or stale source, whatever the model said', async () => {
      const specs = testSpecs();
      specs.scan_summary = { ...specs.scan_summary, requiredSources: ['scanCalculation', 'earningsCalendar', 'brokerPositionCapacity'] };
      const s = await setup({ inputOver: { sourceAsOf: { earningsCalendar: null, brokerPositionCapacity: new Date(NOW - 99_999_000).toISOString() } } });
      const result = await s.run({}, { specs });
      if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
      const disclosures = result.artifact.output!.missingOrStaleData.map((c) => c.text);
      expect(disclosures).toHaveLength(2);
      expect(disclosures.join(' ')).toContain('Earnings calendar');
      expect(disclosures.join(' ')).toContain('Broker positions and capacity');
    });
  });

  describe('stage 5: idempotency', () => {
    it('an in-flight claim returns the neutral RATE_LIMIT state', async () => {
      const s = await setup();
      await s.redis.set(idempotencyKey(USER, fingerprint('scan_summary', s.input.id, IDEM)), 'pending', 'EX', 90);
      expect(await s.run()).toMatchObject({ status: 'unavailable', reason: 'RATE_LIMIT' });
      noProvider(s);
    });
    it('an invalid key is refused', async () => { const s = await setup(); expect(await s.run({ idempotencyKey: 'short' })).toMatchObject({ reason: 'INPUT_INVALID' }); noProvider(s); });
    it('a repeat returns the stored artifact and spends nothing', async () => {
      const s = await setup();
      const first = await s.run();
      const spent = s.budget.get(budgetKeys(USER, 'scan_summary', NOW).monthKey);
      const again = await s.run();
      expect(again).toEqual(first);
      expect(s.fetchImpl).toHaveBeenCalledTimes(1);
      expect(s.budget.get(budgetKeys(USER, 'scan_summary', NOW).monthKey)).toBe(spent);
      expect(s.budget.get(budgetKeys(USER, 'scan_summary', NOW).hourKey)).toBe(1);
    });
    it('10 concurrent requests with the same key make exactly one provider call and one artifact', async () => {
      const s = await setup();
      const results = await Promise.all(Array.from({ length: 10 }, () => s.run()));
      expect(s.fetchImpl).toHaveBeenCalledTimes(1);
      expect(results.filter((r) => r.status === 'ready')).toHaveLength(1);
      expect(await listArtifactIds(s.redis, USER)).toHaveLength(1);
    });
  });

  describe('stage 6: circuit breaker', () => {
    it('opens after repeated provider failures, then rejects without calling the provider, and frees the claim', async () => {
      const failing = vi.fn((async () => new Response('{}', { status: 500 })) as unknown as typeof fetch);
      const s = await setup({ env: { AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: '20' } });
      for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
        expect(await s.run({ idempotencyKey: `idem-fail-key-000000${i}` }, { fetchImpl: failing as unknown as typeof fetch })).toMatchObject({ reason: 'PROVIDER_ERROR' });
      }
      expect(failing).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
      expect(await s.run({ idempotencyKey: 'idem-after-open-000001' }, { fetchImpl: failing as unknown as typeof fetch })).toMatchObject({ status: 'unavailable', reason: 'CIRCUIT_OPEN' });
      expect(failing).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
      // The claim was freed: after the open period the same key can run (half-open probe).
      const later = await s.run({ idempotencyKey: 'idem-after-open-000001' }, { now: () => NOW + 121_000 });
      expect(later.status).toBe('ready');
    });
  });

  describe('stage 7: atomic budget reservation', () => {
    it('route hourly limit', async () => {
      const s = await setup({ env: { AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: '2' } });
      const results = [];
      for (let i = 0; i < 4; i += 1) results.push(await s.run({ idempotencyKey: `idem-hourly-key-00000${i}` }));
      expect(results.map((r) => r.status)).toEqual(['ready', 'ready', 'unavailable', 'unavailable']);
      expect(results[2]).toMatchObject({ reason: 'RATE_LIMIT' });
      expect(s.fetchImpl).toHaveBeenCalledTimes(2);
    });
    it('user monthly USD allowance', async () => {
      const s = await setup({ env: { AI_POLICY_USER_MONTHLY_BUDGET_USD: '0.0005' } });
      expect(await s.run()).toMatchObject({ status: 'unavailable', reason: 'BUDGET' });
      noProvider(s);
    });
    it('global daily USD allowance', async () => {
      const s = await setup({ env: { AI_POLICY_GLOBAL_DAILY_BUDGET_USD: '0.0005' } });
      expect(await s.run()).toMatchObject({ status: 'unavailable', reason: 'BUDGET' });
      noProvider(s);
    });
    it('25 concurrent requests with distinct keys never exceed the hourly limit of 5', async () => {
      const s = await setup();
      const results = await Promise.all(Array.from({ length: 25 }, (_, i) => s.run({ idempotencyKey: `idem-concurrent-${String(i).padStart(4, '0')}` })));
      // Same subject: concurrent results supersede each other, so an accepted run may already read back as 'stale'.
      expect(results.filter((r) => r.status === 'ready' || r.status === 'stale')).toHaveLength(5);
      expect(results.filter((r) => r.status === 'unavailable' && r.reason === 'RATE_LIMIT')).toHaveLength(20);
      expect(s.fetchImpl).toHaveBeenCalledTimes(5);
    });
    it('a failed gate frees the idempotency claim so the same key can retry', async () => {
      const s = await setup({ env: { AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: '1' } });
      await s.run({ idempotencyKey: 'idem-first-key-0000001' });
      expect(await s.run()).toMatchObject({ reason: 'RATE_LIMIT' });
      expect(await s.redis.get(idempotencyKey(USER, fingerprint('scan_summary', s.input.id, IDEM)))).toBeNull();
    });
  });

  describe('stage 8-10: provider outcomes, validation, and the input stays unchanged', () => {
    it('a timeout is unavailable(TIMEOUT), keeps the reservation (spend unknown), audits it, and frees the claim', async () => {
      const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))) as unknown as typeof fetch;
      const s = await setup();
      const before = s.redis.store.get(inputKey(USER, s.input.id))!.value;
      const result = await s.run({}, { fetchImpl: hang });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'TIMEOUT' });
      const id = (result as { artifactId: string }).artifactId;
      expect((await getArtifact(s.redis, USER, id, s.env))?.status).toBe('unavailable');
      expect((await getProvenance(s.redis, USER, id))?.failureReason).toBe('TIMEOUT');
      expect(s.budget.get(budgetKeys(USER, 'scan_summary', NOW).monthKey)).toBeGreaterThan(0);
      expect(await s.redis.get(idempotencyKey(USER, fingerprint('scan_summary', s.input.id, IDEM)))).toBeNull();
      expect(s.redis.store.get(inputKey(USER, s.input.id))!.value).toBe(before);
    });

    it('a provider error releases the whole reservation', async () => {
      const s = await setup();
      const result = await s.run({}, { fetchImpl: (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch });
      expect(result).toMatchObject({ reason: 'PROVIDER_ERROR' });
      expect(s.budget.get(budgetKeys(USER, 'scan_summary', NOW).monthKey)).toBe(0);
    });

    it.each([
      ['malformed JSON', 'not json', 'malformed_json'],
      ['invented digit', validOutputJson((o) => { o.observations[0].text = 'Delta is 0.81 {{c:2}} {{c:3}}'; }), 'digit'],
      ['recommendation', validOutputJson((o) => { o.observations[0].text = 'You should buy {{c:2}} {{c:3}}'; }), 'lexicon:recommendation'],
      ['pointer outside the registry', validOutputJson((o) => { o.citations[1].pointer = '/candidates/0/accountNumber'; }), 'pointer_unregistered'],
    ])('a rejected output (%s) is stored as rejected with provenance, shows the neutral state, keeps the input unchanged, and is cached', async (_n, text, rule) => {
      const s = await setup({ fetchText: text });
      const before = s.redis.store.get(inputKey(USER, s.input.id))!.value;
      const result = await s.run();
      expect(result).toMatchObject({ status: 'rejected', reason: 'VALIDATION_REJECTED' });
      const id = (result as { artifactId: string }).artifactId;
      const artifact = await getArtifact(s.redis, USER, id, s.env);
      expect(artifact).toMatchObject({ status: 'rejected', output: null });
      expect((await getProvenance(s.redis, USER, id))?.validation).toMatchObject({ result: 'rejected', rule });
      expect(s.redis.store.get(inputKey(USER, s.input.id))!.value).toBe(before);
      expect((await getInput(s.redis, USER, s.input.id, s.env)).ok).toBe(true);
      expect(await s.run()).toEqual(result);
      expect(s.fetchImpl).toHaveBeenCalledTimes(1);
      // Provider health is unaffected by rejected content.
      expect(s.redis.store.has('ai-policy:cb:economy:fail')).toBe(false);
    });

    it('never throws to the route: a Redis failure mid-flow becomes a neutral unavailable and frees the claim', async () => {
      const s = await setup();
      const exploding: BudgetStore = { reserve: async () => { throw new Error('redis exploded'); }, reconcile: async () => undefined };
      const result = await s.run({}, { budgetStore: exploding });
      expect(result).toMatchObject({ status: 'unavailable' });
      expect(s.fetchImpl).not.toHaveBeenCalled();
      expect(await s.redis.get(idempotencyKey(USER, fingerprint('scan_summary', s.input.id, IDEM)))).toBeNull();
    });

    it('never throws when persistence fails after a successful provider call', async () => {
      const s = await setup();
      const originalSet = s.redis.set.bind(s.redis);
      s.redis.set = async (key: string, value: string, ...args: Array<string | number>) => {
        if (key.startsWith('ai-policy:audit:')) throw new Error('audit write failed');
        return originalSet(key, value, ...args);
      };
      expect(await s.run()).toMatchObject({ status: 'unavailable', reason: 'PROVIDER_ERROR' });
      expect(await listArtifactIds(s.redis, USER)).toEqual([]);
    });
  });
});

describe('refresh and grounded chat', () => {
  it('a refresh with a new idempotency key creates a new artifact and marks the old one stale', async () => {
    const s = await setup();
    const first = await s.run();
    const second = await s.run({ idempotencyKey: 'idem-refresh-key-0001' });
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('expected ready');
    expect(second.artifact.id).not.toBe(first.artifact.id);
    expect((await getArtifact(s.redis, USER, first.artifact.id, s.env))?.status).toBe('stale');
    expect((await getArtifact(s.redis, USER, second.artifact.id, s.env))?.status).toBe('ready');
    expect(await s.redis.get(auditKey(USER, first.artifact.id))).not.toBeNull();
  });

  it('redacts and bounds the question before dispatch', async () => {
    const s = await setup({ route: 'grounded_chat' });
    const result = await s.run({ question: `Why is AAA weak? email me at trader@example.com about acct 123456789012. ${'x'.repeat(800)}` });
    expect(result.status).toBe('ready');
    const sent = JSON.parse((s.fetchImpl.mock.calls[0][1] as RequestInit).body as string).messages[1].content as string;
    expect(sent).not.toContain('trader@example.com');
    expect(sent).not.toContain('123456789012');
    expect(sent).toContain('[redacted]');
    expect(sent.length).toBeLessThan(2000);
  });

  it('different questions on the same key are different requests', async () => {
    const s = await setup({ route: 'grounded_chat' });
    await s.run({ question: 'Why is AAA weak?' });
    await s.run({ question: 'What about BBB?' });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });
});
