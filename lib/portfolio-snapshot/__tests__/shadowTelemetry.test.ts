import { describe, expect, it, vi } from 'vitest';
import { collectCoveredCallCapacityShadow, CC_CAPACITY_SHADOW_ENDPOINT } from '../shadowTelemetry';
import type { CapacityShadowResult } from '../shadowParity';

const result: CapacityShadowResult = {
  outcome: 'parity', differences: [], comparedAt: '2026-08-22T18:01:00.000Z',
  snapshotAsOf: '2026-08-22T18:00:00.000Z', snapshotFreshness: 'current',
};

describe('Covered Call capacity shadow telemetry client', () => {
  it('posts only the structured result to the authenticated same-origin endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    collectCoveredCallCapacityShadow(result, fetcher);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledWith(CC_CAPACITY_SHADOW_ENDPOINT, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', keepalive: true, body: JSON.stringify(result),
    }));
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/token|accountNumber|rawPositions|rawOrders|sessionId/);
  });

  it('swallows transport rejection without an unhandled failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('collector offline'));
    expect(() => collectCoveredCallCapacityShadow(result, fetcher)).not.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  });
});
