import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CC_CAPACITY_SHADOW_MAX_BYTES } from '@/lib/portfolio-snapshot/shadowTelemetrySchema';

const { getServerSession, recordCoveredCallCapacityShadow } = vi.hoisted(() => ({
  getServerSession: vi.fn(), recordCoveredCallCapacityShadow: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/portfolio-snapshot/shadowTelemetryStore', () => ({ recordCoveredCallCapacityShadow }));

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
    getServerSession.mockReset().mockResolvedValue({ user: { id: 'server-only-user' } });
    recordCoveredCallCapacityShadow.mockReset().mockResolvedValue(undefined);
  });

  it('requires authentication', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(request(valid))).status).toBe(401);
    expect(recordCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('accepts, records, and centrally logs only an allowlisted event', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    expect(recordCoveredCallCapacityShadow).toHaveBeenCalledWith(valid);
    expect(info).toHaveBeenCalledWith('lcc0001a.covered_call_capacity_shadow', valid);
    expect(JSON.stringify(recordCoveredCallCapacityShadow.mock.calls)).not.toMatch(/server-only-user|token|accountNumber|rawPositions|sessionId/);
    info.mockRestore();
  });

  it.each([
    ['malformed JSON', '{bad-json'],
    ['unexpected field', { ...valid, accountNumber: 'forbidden' }],
    ['raw payload', { ...valid, rawPositions: [] }],
    ['invalid difference field', { ...valid, differences: [{ kind: 'field', symbol: 'AAPL', field: 'token', legacy: 1, snapshot: 2 }] }],
  ])('rejects %s', async (_label, body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(recordCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before parsing or storage', async () => {
    const response = await POST(request(valid, { 'content-length': String(CC_CAPACITY_SHADOW_MAX_BYTES + 1) }));
    expect(response.status).toBe(413);
    expect(recordCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types', async () => {
    const response = await POST(new Request('http://localhost/api/telemetry/cc-capacity-shadow', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(valid),
    }));
    expect(response.status).toBe(415);
    expect(recordCoveredCallCapacityShadow).not.toHaveBeenCalled();
  });

  it('returns a non-authoritative unavailable response when the sink fails', async () => {
    recordCoveredCallCapacityShadow.mockRejectedValue(new Error('redis unavailable'));
    expect((await POST(request(valid))).status).toBe(503);
  });
});
