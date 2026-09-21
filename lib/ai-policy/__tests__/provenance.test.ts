// lib/ai-policy/__tests__/provenance.test.ts
import { describe, expect, it } from 'vitest';
import { AUDIT_TTL_SECONDS } from '../config';
import { auditKey, getProvenance, saveProvenance, userScopeId } from '../provenance';
import type { ProvenanceRecord } from '../provenance';
import { FakeRedis } from '../fixtures/fakeRedis';
import { FRESH_AS_OF, NOW, OTHER_USER, USER } from '../fixtures/testRoute';

const ID = '00000000-0000-4000-8000-00000000000c';
const record = (): ProvenanceRecord => ({
  artifactId: ID, artifactType: 'scan_summary', status: 'ready', provider: 'openai', model: 'gpt-5.6-luna', providerModelId: 'x',
  templateId: 't', templateVersion: '1', policyVersion: 'ai-policy-v1', providerPolicyVersion: 'p1', lexiconVersion: 'lex', validatorVersion: 'val',
  input: { id: 'i', payloadHash: 'h', schemaVersion: 's', trustClass: 'client_attested' },
  authorizationScope: { accountScope: 'scope', userScope: userScopeId(USER) }, sourceAsOf: FRESH_AS_OF, deterministicStates: ['Not ready'],
  citations: [{ id: 1, pointer: '/scan/count', valueHash: 'v', format: 'integer', source: 'scanCalculation', asOf: FRESH_AS_OF.scanCalculation }],
  claimMap: [{ section: 'summary', index: 0, citationIds: [1] }], validation: { result: 'accepted', rule: null, outputHash: 'o' }, promptHash: 'p',
  latencyMs: 12, cost: { estimatedMicros: 100, actualMicros: 60, inputTokens: 10, outputTokens: 5 },
  featureFlag: { global: 'AI_POLICY_ENABLED', route: 'AI_POLICY_SCAN_SUMMARY_ENABLED' }, userAction: 'click:explain', failureReason: null,
  createdAt: new Date(NOW).toISOString(),
});

describe('provenance', () => {
  it('persists with a 548-day TTL and reads back for the owner only', async () => {
    const redis = new FakeRedis();
    redis.clock = () => NOW;
    expect(await saveProvenance(redis, USER, record())).toBe(true);
    const ttl = redis.store.get(auditKey(USER, ID))!.expiresAt! - NOW;
    expect(ttl).toBe(AUDIT_TTL_SECONDS * 1000);
    expect((await getProvenance(redis, USER, ID))?.artifactId).toBe(ID);
    expect(await getProvenance(redis, OTHER_USER, ID)).toBeNull();
  });

  it('a record copied under another user\'s key is still refused (scope check)', async () => {
    const redis = new FakeRedis();
    await saveProvenance(redis, USER, record());
    redis.store.set(auditKey(OTHER_USER, ID), redis.store.get(auditKey(USER, ID))!);
    expect(await getProvenance(redis, OTHER_USER, ID)).toBeNull();
  });

  it('is immutable (NX)', async () => {
    const redis = new FakeRedis();
    expect(await saveProvenance(redis, USER, record())).toBe(true);
    expect(await saveProvenance(redis, USER, { ...record(), userAction: 'changed' })).toBe(false);
  });
});
