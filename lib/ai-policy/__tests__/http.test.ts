// lib/ai-policy/__tests__/http.test.ts
import { describe, expect, it } from 'vitest';
import { REASON_HTTP_STATUS, artifactReadResponse, clientArtifact, freezeResultResponse, pickStrict, readBoundedJson, routeResultResponse } from '../http';
import { NOW } from '../fixtures/testRoute';
import type { AiArtifact, ReasonCode } from '../types';

const ALL_REASONS: ReasonCode[] = [
  'FLAG_OFF', 'KILL_SWITCH', 'GOVERNANCE', 'BUDGET', 'RATE_LIMIT', 'CIRCUIT_OPEN', 'INPUT_MISSING', 'INPUT_STALE', 'INPUT_INVALID', 'TIMEOUT',
  'PROVIDER_ERROR', 'VALIDATION_REJECTED', 'NOT_FOUND',
];
const artifact: AiArtifact = {
  id: 'a', userId: 'u', route: 'scan_summary', status: 'ready', reason: null, inputId: 'i', accountScope: 'scope-secret', trust: 'client_attested', tier: 'economy',
  model: 'm', templateId: 't', templateVersion: 'v', createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW).toISOString(), output: null,
};

describe('HTTP status per reason code', () => {
  it('covers every reason code exactly once', () => {
    expect(Object.keys(REASON_HTTP_STATUS).sort()).toEqual([...ALL_REASONS].sort());
  });

  it.each([
    [503, ['FLAG_OFF', 'KILL_SWITCH', 'GOVERNANCE', 'CIRCUIT_OPEN', 'TIMEOUT', 'PROVIDER_ERROR']], [429, ['BUDGET', 'RATE_LIMIT']],
    [422, ['INPUT_INVALID', 'INPUT_MISSING']], [409, ['INPUT_STALE']], [404, ['NOT_FOUND']], [200, ['VALIDATION_REJECTED']],
  ] as const)('%s', (status, reasons) => {
    for (const reason of reasons) expect(REASON_HTTP_STATUS[reason]).toBe(status);
  });

  it('every unavailable result becomes the same three-key neutral body at its status', async () => {
    for (const reason of ALL_REASONS.filter((r) => r !== 'VALIDATION_REJECTED')) {
      const res = routeResultResponse({ status: 'unavailable', reason, artifactId: null });
      expect(res.status).toBe(REASON_HTTP_STATUS[reason]);
      expect(await res.json()).toEqual({ status: 'unavailable', reason, artifactId: null });
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(freezeResultResponse({ status: 'unavailable', reason: 'FLAG_OFF' }).status).toBe(503);
    expect(artifactReadResponse({ status: 'unavailable', reason: 'NOT_FOUND' }).status).toBe(404);
  });

  it('a rejected result is a 200 that carries only the artifact id', async () => {
    const res = routeResultResponse({ status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId: 'x' });
    expect([res.status, await res.json()]).toEqual([200, { status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId: 'x' }]);
  });
});

describe('clientArtifact', () => {
  it('hides the account scope, trust class, and template identity', () => {
    const shown = clientArtifact(artifact);
    expect(Object.keys(shown).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'inputId', 'model', 'output', 'route', 'status']);
    expect(JSON.stringify(shown)).not.toContain('scope-secret');
  });
});

describe('readBoundedJson and pickStrict', () => {
  const req = (body: string, headers: Record<string, string> = {}) => new Request('http://x', { method: 'POST', body, headers });
  it('parses within the bound and refuses beyond it, even if Content-Length lies', async () => {
    expect(await readBoundedJson(req('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readBoundedJson(req('x'.repeat(200)), 100)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(await readBoundedJson(req('{}', { 'content-length': '999999' }), 100)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(await readBoundedJson(req('nope'), 100)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('accepts exactly the allowed keys', () => {
    expect(pickStrict({ a: 1, b: 2 }, ['a'], ['b'])).toEqual({ a: 1, b: 2 });
    expect(pickStrict({ a: 1 }, ['a'], ['b'])).toEqual({ a: 1 });
    for (const bad of [{ b: 2 }, { a: 1, c: 3 }, null, [], 'x', 5]) expect(pickStrict(bad, ['a'], ['b'])).toBeNull();
  });
});
