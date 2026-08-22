import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CC_CAPACITY_SHADOW_MAX_BYTES,
  parseCapacityShadowTelemetry,
} from '@/lib/portfolio-snapshot/shadowTelemetrySchema';

const { getServerSession, ingestCoveredCallCapacityShadow, readCoveredCallCapacityShadowRecent } = vi.hoisted(() => ({
  getServerSession: vi.fn(), ingestCoveredCallCapacityShadow: vi.fn(),
  readCoveredCallCapacityShadowRecent: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/portfolio-snapshot/shadowTelemetryStore', () => ({
  ingestCoveredCallCapacityShadow, readCoveredCallCapacityShadowRecent,
}));

import { GET, POST } from '../route';

const valid = {
  outcome: 'difference', comparedAt: '2026-08-22T18:01:00.000Z',
  snapshotAsOf: '2026-08-22T18:00:00.000Z', snapshotFreshness: 'current',
  differences: [{ kind: 'field', symbol: 'AAPL', field: 'sharesOwned', legacy: 100, snapshot: 200 }],
};
const originalOperators = process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS;
const noStore = 'private, no-store, max-age=0';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telemetry/cc-capacity-shadow', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function fieldPayload(field: string, legacy: unknown, snapshot: unknown) {
  return { ...valid, differences: [{ kind: 'field', symbol: 'AAPL', field, legacy, snapshot }] };
}

describe('POST /api/telemetry/cc-capacity-shadow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T18:05:00.000Z'));
    process.env.NEXTAUTH_SECRET = 'test-only-shadow-secret';
    delete process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS;
    getServerSession.mockReset().mockResolvedValue({ user: { id: 'server-only-user' } });
    ingestCoveredCallCapacityShadow.mockReset().mockResolvedValue('accepted');
    readCoveredCallCapacityShadowRecent.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOperators === undefined) delete process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS;
    else process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS = originalOperators;
  });

  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(request(valid))).status).toBe(401);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('requires authentication for operational recent-evidence reads', async () => {
    getServerSession.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/telemetry/cc-capacity-shadow'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe(noStore);
    expect(readCoveredCallCapacityShadowRecent).not.toHaveBeenCalled();
  });

  it.each([
    ['missing email', { user: { id: 'ordinary-user' } }, 'ops@example.com'],
    ['missing policy', { user: { email: 'ops@example.com' } }, undefined],
    ['empty policy', { user: { email: 'ops@example.com' } }, '  , , '],
    ['ordinary user', { user: { email: 'ordinary@example.com' } }, 'ops@example.com'],
    ['substring match', { user: { email: 'notops@example.com' } }, 'ops@example.com'],
    ['wildcard policy', { user: { email: 'user@example.com' } }, '*@example.com'],
  ])('forbids GET for %s', async (_label, session, operators) => {
    getServerSession.mockResolvedValue(session);
    if (operators === undefined) delete process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS;
    else process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS = operators;
    const response = await GET(new Request('http://localhost/api/telemetry/cc-capacity-shadow'));
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe(noStore);
    expect(readCoveredCallCapacityShadowRecent).not.toHaveBeenCalled();
  });

  it.each([
    ['exact match', 'ops@example.com', 'ops@example.com'],
    ['case-insensitive match', 'OPS@EXAMPLE.COM', 'ops@example.com'],
    ['normalized entries', 'dean@example.com', ' , ops@example.com , , DEAN@example.com '],
  ])('allows an operator GET by %s', async (_label, email, operators) => {
    getServerSession.mockResolvedValue({ user: { email } });
    process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS = operators;
    const event = { ...valid, receivedAt: '2026-08-22T18:05:00.000Z' };
    readCoveredCallCapacityShadowRecent.mockResolvedValue([event]);
    const response = await GET(new Request('http://localhost/api/telemetry/cc-capacity-shadow?limit=500'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(noStore);
    expect(await response.json()).toEqual({ events: [event] });
    expect(readCoveredCallCapacityShadowRecent).toHaveBeenCalledWith(
      new Date('2026-08-22T18:05:00.000Z'), 500,
    );
  });

  it('keeps operational read failures non-authoritative', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'ops@example.com' } });
    process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS = 'ops@example.com';
    readCoveredCallCapacityShadowRecent.mockRejectedValue(new Error('redis unavailable'));
    const response = await GET(new Request('http://localhost/api/telemetry/cc-capacity-shadow'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe(noStore);
  });

  it('keeps POST available to an authenticated non-operator', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'ordinary-user', email: 'ordinary@example.com' } });
    process.env.LCC_0001A_CC_CAPACITY_SHADOW_OPERATORS = 'ops@example.com';
    expect((await POST(request(valid))).status).toBe(202);
    expect(ingestCoveredCallCapacityShadow).toHaveBeenCalledOnce();
  });

  it('accepts, records, and centrally logs only an allowlisted event', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    expect(ingestCoveredCallCapacityShadow).toHaveBeenCalledWith(
      valid,
      expect.objectContaining({ receivedAt: '2026-08-22T18:05:00.000Z' }),
    );
    expect(info).toHaveBeenCalledWith(
      'lcc0001a.covered_call_capacity_shadow',
      { ...valid, receivedAt: '2026-08-22T18:05:00.000Z' },
    );
    expect(JSON.stringify(ingestCoveredCallCapacityShadow.mock.calls)).not.toMatch(/server-only-user|token|accountNumber|rawPositions|sessionId/);
    info.mockRestore();
  });

  it.each([
    ['malformed JSON', '{bad-json'],
    ['unexpected field', { ...valid, accountNumber: 'forbidden' }],
    ['raw payload', { ...valid, rawPositions: [] }],
    ['invalid difference field', { ...valid, differences: [{ kind: 'field', symbol: 'AAPL', field: 'token', legacy: 1, snapshot: 2 }] }],
    ['non-canonical timestamp', { ...valid, comparedAt: '2026-08-22 18:01:00Z' }],
  ])('rejects %s', async (_label, body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before parsing or storage', async () => {
    const response = await POST(request(valid, { 'content-length': String(CC_CAPACITY_SHADOW_MAX_BYTES + 1) }));
    expect(response.status).toBe(413);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types', async () => {
    const response = await POST(new Request('http://localhost/api/telemetry/cc-capacity-shadow', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(valid),
    }));
    expect(response.status).toBe(415);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('returns a non-authoritative unavailable response when the sink fails', async () => {
    ingestCoveredCallCapacityShadow.mockRejectedValue(new Error('redis unavailable'));
    expect((await POST(request(valid))).status).toBe(503);
  });

  it('rejects excessive client clock skew before storage', async () => {
    expect((await POST(request({ ...valid, comparedAt: '2025-01-01T00:00:00.000Z' }))).status).toBe(400);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it.each([
    ['boolean shares', { field: 'sharesOwned', legacy: true, snapshot: 100 }],
    ['numeric oversubscribed', { field: 'oversubscribed', legacy: 1, snapshot: false }],
    ['negative contracts', { field: 'availableCoveredContracts', legacy: -1, snapshot: 0 }],
  ])('rejects field-incompatible %s without writing', async (_label, fieldDifference) => {
    const body = { ...valid, differences: [{ kind: 'field', symbol: 'AAPL', ...fieldDifference }] };
    expect((await POST(request(body))).status).toBe(400);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it.each([
    ['sharesOwned', 0, 250.5],
    ['costBasis', null, 123.45],
    ['costBasisComplete', false, true],
    ['grossCoveredContracts', 0, 2],
    ['existingShortCallContracts', 0, 2],
    ['workingShortCallContracts', 0, 2],
    ['availableCoveredContracts', 0, 2],
    ['oversubscribed', false, true],
    ['hasUnclassifiedExposure', false, true],
  ])('accepts the complete %s field contract', async (field, legacy, snapshot) => {
    expect((await POST(request(fieldPayload(field, legacy, snapshot)))).status).toBe(202);
    expect(ingestCoveredCallCapacityShadow).toHaveBeenCalledOnce();
  });

  it.each(([
    ['sharesOwned negative', 'sharesOwned', -0.5],
    ['sharesOwned boolean', 'sharesOwned', true],
    ['sharesOwned string', 'sharesOwned', '1.5'],
    ['sharesOwned null', 'sharesOwned', null],
    ['sharesOwned missing', 'sharesOwned', undefined],
    ['costBasis negative', 'costBasis', -0.01],
    ['costBasis boolean', 'costBasis', false],
    ['costBasis string', 'costBasis', '12.5'],
    ['costBasisComplete number', 'costBasisComplete', 1],
    ['costBasisComplete string', 'costBasisComplete', 'true'],
    ['costBasisComplete null', 'costBasisComplete', null],
    ['oversubscribed number', 'oversubscribed', 1],
    ['oversubscribed string', 'oversubscribed', 'false'],
    ['oversubscribed null', 'oversubscribed', null],
    ['hasUnclassifiedExposure number', 'hasUnclassifiedExposure', 0],
    ['hasUnclassifiedExposure string', 'hasUnclassifiedExposure', 'true'],
    ['hasUnclassifiedExposure null', 'hasUnclassifiedExposure', null],
    ...['grossCoveredContracts', 'existingShortCallContracts', 'workingShortCallContracts', 'availableCoveredContracts']
      .flatMap(field => [
        [`${field} negative`, field, -1],
        [`${field} fractional`, field, 1.5],
        [`${field} boolean`, field, true],
        [`${field} string`, field, '2'],
        [`${field} null`, field, null],
        [`${field} unsafe`, field, Number.MAX_SAFE_INTEGER + 1],
      ]),
  ]) as Array<[string, string, unknown]>)('rejects %s and performs no ingestion', async (_label, field, invalid) => {
    expect((await POST(request(fieldPayload(field, invalid, 0)))).status).toBe(400);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('rejects non-finite numeric values at the runtime parser boundary', () => {
    const now = new Date('2026-08-22T18:05:00.000Z');
    for (const field of [
      'sharesOwned', 'costBasis', 'grossCoveredContracts', 'existingShortCallContracts',
      'workingShortCallContracts', 'availableCoveredContracts',
    ]) {
      expect(parseCapacityShadowTelemetry(fieldPayload(field, Number.NaN, 1), now)).toBeNull();
      expect(parseCapacityShadowTelemetry(fieldPayload(field, Infinity, 1), now)).toBeNull();
      expect(parseCapacityShadowTelemetry(fieldPayload(field, -Infinity, 1), now)).toBeNull();
    }
  });

  it('fingerprints free-form diagnostics before storage and server logging', async () => {
    const secret = 'acct-123 token-secret dean@example.com order-987 raw-broker-fragment';
    const body = {
      ...valid,
      differences: [
        { kind: 'warnings', legacy: [secret], snapshot: [] },
        { kind: 'unavailableReason', legacy: secret, snapshot: null },
      ],
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    const stored = JSON.stringify(ingestCoveredCallCapacityShadow.mock.calls);
    const logged = JSON.stringify(info.mock.calls);
    expect(stored).not.toContain(secret);
    expect(logged).not.toContain(secret);
    expect(await response.text()).not.toContain(secret);
    expect(stored).toMatch(/warning:sha256:[a-f0-9]{24}/);
    expect(stored).toMatch(/reason:sha256:[a-f0-9]{24}/);
    info.mockRestore();
  });

  it('returns duplicate acceptance and rate limiting without server logging', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    ingestCoveredCallCapacityShadow.mockResolvedValueOnce('duplicate');
    const duplicate = await POST(request(valid));
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toEqual({ accepted: true, duplicate: true });
    ingestCoveredCallCapacityShadow.mockResolvedValueOnce('rate-limited');
    expect((await POST(request(valid))).status).toBe(429);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
