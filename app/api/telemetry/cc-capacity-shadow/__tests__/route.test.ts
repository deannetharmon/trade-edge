import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CC_CAPACITY_SHADOW_MAX_BYTES } from '@/lib/portfolio-snapshot/shadowTelemetrySchema';

const { getServerSession, ingestCoveredCallCapacityShadow } = vi.hoisted(() => ({
  getServerSession: vi.fn(), ingestCoveredCallCapacityShadow: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/portfolio-snapshot/shadowTelemetryStore', () => ({ ingestCoveredCallCapacityShadow }));

import { POST } from '../route';

const valid = {
  outcome: 'difference', comparedAt: '2026-08-22T18:01:00.000Z',
  snapshotAsOf: '2026-08-22T18:00:00.000Z', snapshotFreshness: 'current',
  differences: [{ kind: 'field', symbol: 'AAPL', field: 'sharesOwned', legacy: 100, snapshot: 200 }],
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telemetry/cc-capacity-shadow', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/telemetry/cc-capacity-shadow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T18:05:00.000Z'));
    process.env.NEXTAUTH_SECRET = 'test-only-shadow-secret';
    getServerSession.mockReset().mockResolvedValue({ user: { id: 'server-only-user' } });
    ingestCoveredCallCapacityShadow.mockReset().mockResolvedValue('accepted');
  });

  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(request(valid))).status).toBe(401);
    expect(ingestCoveredCallCapacityShadow).not.toHaveBeenCalled();
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
    expect((await POST(request(body))).status).toBe(202);
    const stored = JSON.stringify(ingestCoveredCallCapacityShadow.mock.calls);
    const logged = JSON.stringify(info.mock.calls);
    expect(stored).not.toContain(secret);
    expect(logged).not.toContain(secret);
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
