import type { CapacityShadowResult } from './shadowParity';

export const CC_CAPACITY_SHADOW_ENDPOINT = '/api/telemetry/cc-capacity-shadow';

export type ShadowTelemetryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function collectCoveredCallCapacityShadow(
  result: CapacityShadowResult,
  fetcher: ShadowTelemetryFetch = fetch,
): void {
  void Promise.resolve()
    .then(() => fetcher(CC_CAPACITY_SHADOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
      credentials: 'same-origin',
      keepalive: true,
    }))
    .catch(() => undefined);
}
