// lib/ai-policy/__tests__/artifactStore.test.ts
import { describe, expect, it } from 'vitest';
import { artifactKey, getArtifact, listArtifactIds, markCurrent, saveArtifact, subjectHash } from '../artifactStore';
import { FakeRedis } from '../fixtures/fakeRedis';
import { NOW, OTHER_USER, TEST_ENV, USER } from '../fixtures/testRoute';
import type { AiArtifact } from '../types';

const artifact = (id: string, over: Partial<AiArtifact> = {}): AiArtifact => ({
  id, userId: USER, route: 'scan_summary', status: 'ready', reason: null, inputId: 'i', accountScope: 's', trust: 'client_attested', tier: 'economy',
  model: 'gpt-5.6-luna', templateId: 't', templateVersion: '1', createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1000).toISOString(),
  output: { summary: 'x', observations: [], tradeoffs: [], missingOrStaleData: [], questionsForTrader: [], limitations: [], citations: [] }, ...over,
});
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const subject = subjectHash('scan_summary', 'session-1');

describe('artifact store', () => {
  it('stores encrypted and round-trips; refuses to overwrite', async () => {
    const redis = new FakeRedis();
    expect(await saveArtifact(redis, artifact(A), subject, TEST_ENV)).toBe(true);
    expect(redis.store.get(artifactKey(USER, A))!.value).not.toContain('"summary"');
    expect(await saveArtifact(redis, artifact(A, { model: 'changed' }), subject, TEST_ENV)).toBe(false);
    expect((await getArtifact(redis, USER, A, TEST_ENV))?.model).toBe('gpt-5.6-luna');
  });

  it('a refresh marks the older artifact stale on read and never rewrites it', async () => {
    const redis = new FakeRedis();
    await saveArtifact(redis, artifact(A), subject, TEST_ENV);
    await markCurrent(redis, USER, 'scan_summary', subject, A);
    expect((await getArtifact(redis, USER, A, TEST_ENV))?.status).toBe('ready');
    const before = redis.store.get(artifactKey(USER, A))!.value;
    await saveArtifact(redis, artifact(B), subject, TEST_ENV);
    await markCurrent(redis, USER, 'scan_summary', subject, B);
    expect((await getArtifact(redis, USER, A, TEST_ENV))?.status).toBe('stale');
    expect((await getArtifact(redis, USER, B, TEST_ENV))?.status).toBe('ready');
    expect(redis.store.get(artifactKey(USER, A))!.value).toBe(before);
  });

  it('a different subject does not make an artifact stale', async () => {
    const redis = new FakeRedis();
    await saveArtifact(redis, artifact(A), subject, TEST_ENV);
    await markCurrent(redis, USER, 'scan_summary', subject, A);
    await markCurrent(redis, USER, 'scan_summary', subjectHash('scan_summary', 'session-2'), B);
    expect((await getArtifact(redis, USER, A, TEST_ENV))?.status).toBe('ready');
  });

  it('only the owner can read an artifact', async () => {
    const redis = new FakeRedis();
    await saveArtifact(redis, artifact(A), subject, TEST_ENV);
    expect(await getArtifact(redis, OTHER_USER, A, TEST_ENV)).toBeNull();
    expect(await getArtifact(redis, USER, 'not-a-uuid', TEST_ENV)).toBeNull();
  });

  it('non-ready artifacts keep their own status', async () => {
    const redis = new FakeRedis();
    await saveArtifact(redis, artifact(A, { status: 'rejected', reason: 'VALIDATION_REJECTED', output: null }), subject, TEST_ENV);
    await markCurrent(redis, USER, 'scan_summary', subject, B);
    expect((await getArtifact(redis, USER, A, TEST_ENV))?.status).toBe('rejected');
  });

  it('keeps a per-user index, newest first', async () => {
    const redis = new FakeRedis();
    await saveArtifact(redis, artifact(A, { createdAt: new Date(NOW).toISOString() }), subject, TEST_ENV);
    await saveArtifact(redis, artifact(B, { createdAt: new Date(NOW + 5000).toISOString() }), subject, TEST_ENV);
    expect(await listArtifactIds(redis, USER)).toEqual([B, A]);
    expect(await listArtifactIds(redis, OTHER_USER)).toEqual([]);
  });
});
