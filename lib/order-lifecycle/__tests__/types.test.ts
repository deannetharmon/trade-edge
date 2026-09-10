import { describe, expect, it } from 'vitest';
import { emptyOrderLifecycleStore, upsertOrderLifecycleEvent, type OrderLifecycleEvent } from '../types';

const event = (overrides: Partial<OrderLifecycleEvent> = {}): OrderLifecycleEvent => ({
  id: 'event-1', version: 1, observedAt: '2026-09-09T10:00:00.000Z', status: 'canceled', kind: 'entry',
  brokerOrderId: 'broker-1', accountNumber: 'acct-1', symbol: 'SOXL', source: 'tradeedge-command', ...overrides,
});

describe('order lifecycle store', () => {
  it('does not duplicate a broker order status on refresh', () => {
    const first = upsertOrderLifecycleEvent(emptyOrderLifecycleStore(), event());
    const next = upsertOrderLifecycleEvent(first, event({ id: 'event-2', observedAt: '2026-09-09T10:01:00.000Z' }));
    expect(next.events).toHaveLength(1);
    expect(next.events[0].observedAt).toBe('2026-09-09T10:01:00.000Z');
  });

  it('keeps cancellation history separate from later filled status', () => {
    const canceled = upsertOrderLifecycleEvent(emptyOrderLifecycleStore(), event());
    const filled = upsertOrderLifecycleEvent(canceled, event({ id: 'event-3', status: 'filled' }));
    expect(filled.events.map(item => item.status).sort()).toEqual(['canceled', 'filled']);
  });
});
