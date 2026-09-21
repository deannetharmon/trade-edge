// lib/ai-policy/__tests__/inputStore.test.ts
import { describe, expect, it } from 'vitest';
import { buildAnalysisInput, getInput, inputKey, saveInput } from '../inputStore';
import { FakeRedis } from '../fixtures/fakeRedis';
import { FRESH_AS_OF, OTHER_USER, TEST_ENV, TEST_KEY_PREVIOUS_HEX, TEST_REGISTRY, USER, makeInput } from '../fixtures/testRoute';

describe('input store', () => {
  it('stores encrypted (no plaintext payload in Redis) and round-trips', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    expect(await saveInput(redis, input, TEST_ENV)).toEqual({ ok: true });
    const raw = redis.store.get(inputKey(USER, input.id))!.value;
    expect(raw).not.toContain('AAA');
    expect(raw).not.toContain('scan-session-1');
    expect(await getInput(redis, USER, input.id, TEST_ENV)).toEqual({ ok: true, input });
  });

  it('NX immutability: a second write to the same id fails and the first is unchanged', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    await saveInput(redis, input, TEST_ENV);
    const tampered = { ...input, deterministicStates: ['Ready'] };
    expect(await saveInput(redis, tampered, TEST_ENV)).toEqual({ ok: false, reason: 'EXISTS' });
    const read = await getInput(redis, USER, input.id, TEST_ENV);
    expect(read.ok && read.input.deterministicStates).toEqual(['Not ready']);
  });

  it('a foreign user gets exactly the same NOT_FOUND as a missing id', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    await saveInput(redis, input, TEST_ENV);
    const foreign = await getInput(redis, OTHER_USER, input.id, TEST_ENV);
    const missing = await getInput(redis, USER, '11111111-1111-4111-8111-111111111111', TEST_ENV);
    expect(foreign).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(missing).toEqual(foreign);
  });

  it('rejects ids and user ids that could alter a Redis key', async () => {
    const redis = new FakeRedis();
    expect(await getInput(redis, USER, '../../etc', TEST_ENV)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await getInput(redis, 'a:b', 'x', TEST_ENV)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await getInput(redis, '', 'x', TEST_ENV)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('a record copied under another user\'s key cannot be read (AAD binding)', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    await saveInput(redis, input, TEST_ENV);
    redis.store.set(inputKey(OTHER_USER, input.id), redis.store.get(inputKey(USER, input.id))!);
    expect(await getInput(redis, OTHER_USER, input.id, TEST_ENV)).toEqual({ ok: false, reason: 'INPUT_INVALID' });
  });

  it('the wrong key fails; _PREVIOUS decrypts data written before rotation', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    await saveInput(redis, input, TEST_ENV);
    const wrong = { ...TEST_ENV, AI_POLICY_ARTIFACT_KEY: TEST_KEY_PREVIOUS_HEX };
    expect(await getInput(redis, USER, input.id, wrong)).toEqual({ ok: false, reason: 'INPUT_INVALID' });
    const rotated = { ...TEST_ENV, AI_POLICY_ARTIFACT_KEY: TEST_KEY_PREVIOUS_HEX, AI_POLICY_ARTIFACT_KEY_PREVIOUS: TEST_ENV.AI_POLICY_ARTIFACT_KEY };
    expect((await getInput(redis, USER, input.id, rotated)).ok).toBe(true);
  });

  it('refuses to save an input whose hash does not match its payload', async () => {
    const input = makeInput();
    expect(await saveInput(new FakeRedis(), { ...input, payloadHash: 'f'.repeat(64) }, TEST_ENV)).toEqual({ ok: false, reason: 'INPUT_INVALID' });
  });

  it('detects a stored payload that no longer matches its hash', async () => {
    const redis = new FakeRedis();
    const input = makeInput();
    const forged = { ...input, payload: { scan: { count: 99 } } };
    // Write a forged record directly, bypassing saveInput's own check.
    const { sealJson } = await import('../artifactCrypto');
    await redis.set(inputKey(USER, input.id), sealJson(forged, TEST_ENV, `input|${USER}|${input.id}`));
    expect(await getInput(redis, USER, input.id, TEST_ENV)).toEqual({ ok: false, reason: 'INPUT_INVALID' });
  });

  it('the payload may contain only registry fields', () => {
    const base = { userId: USER, accountScope: 's', route: 'scan_summary' as const, trust: 'client_attested' as const, schemaVersion: 'v', subjectKey: 'k', sourceAsOf: FRESH_AS_OF, registry: TEST_REGISTRY };
    expect(buildAnalysisInput({ ...base, payload: { scan: { count: 1 } } }).ok).toBe(true);
    const extra = buildAnalysisInput({ ...base, payload: { scan: { count: 1, accountNumber: '5WX12345' } } });
    expect(extra).toMatchObject({ ok: false, reason: 'INPUT_INVALID' });
    expect(buildAnalysisInput({ ...base, payload: { scan: { count: NaN } } })).toMatchObject({ ok: false });
    expect(buildAnalysisInput({ ...base, userId: 'a:b', payload: {} })).toMatchObject({ ok: false });
  });

  it('input ids are opaque UUIDs and the record carries hash, trust class, and expiry', () => {
    const input = makeInput();
    expect(input.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(input.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(input.expiresAt) - Date.parse(input.createdAt)).toBe(90 * 24 * 3600 * 1000);
  });
});
