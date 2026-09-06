import { describe, expect, it } from 'vitest';
import { shouldAppendLifecycleEvent } from '../pmccHistory';

const alert = { id: 'earnings', severity: 'critical' as const, message: 'Earnings in cycle.' };
const last = { id: '1', kind: 'LIFECYCLE_ALERT' as const, positionKey: 'AAPL:long:short', symbol: 'AAPL', observedAt: '2026-09-05T10:00:00.000Z', status: 'ACTION_REQUIRED' as const, alerts: [alert], expiresAt: '2028-03-06T00:00:00.000Z' };

describe('PMCC lifecycle history de-duplication', () => {
  it('does not append identical refreshes on the same day', () => {
    expect(shouldAppendLifecycleEvent(last, { ...last, observedAt: '2026-09-05T12:00:00.000Z' })).toBe(false);
  });
  it('appends when reasons/status change or on a later day', () => {
    expect(shouldAppendLifecycleEvent(last, { ...last, status: 'MONITOR', observedAt: '2026-09-05T12:00:00.000Z' })).toBe(true);
    expect(shouldAppendLifecycleEvent(last, { ...last, observedAt: '2026-09-06T10:00:00.000Z' })).toBe(true);
  });
});
