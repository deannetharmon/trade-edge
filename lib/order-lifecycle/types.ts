export type OrderLifecycleStatus = 'submitted' | 'working' | 'canceled' | 'rejected' | 'failed' | 'filled' | 'partially_filled' | 'unknown';
export type OrderLifecycleKind = 'entry' | 'exit' | 'contingency' | 'roll';

export interface OrderLifecycleEvent {
  id: string;
  version: 1;
  observedAt: string;
  status: OrderLifecycleStatus;
  kind: OrderLifecycleKind;
  brokerOrderId: string;
  brokerComplexOrderId?: string | null;
  accountNumber: string;
  symbol: string;
  strategy?: string | null;
  requestedPrice?: number | null;
  orderType?: string | null;
  quantity?: number | null;
  source: 'tradeedge-command' | 'broker-refresh';
  workflowId?: string | null;
  predecessorOrderId?: string | null;
  successorOrderId?: string | null;
  reason?: string | null;
}

export type OrderLifecycleStore = { version: 1; events: OrderLifecycleEvent[] };

export function emptyOrderLifecycleStore(): OrderLifecycleStore { return { version: 1, events: [] }; }

export function parseOrderLifecycleStore(raw: string | null): OrderLifecycleStore {
  try {
    const parsed = JSON.parse(raw ?? 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) return emptyOrderLifecycleStore();
    return { version: 1, events: parsed.events.filter((event: unknown): event is OrderLifecycleEvent => !!event && typeof event === 'object' && typeof (event as any).id === 'string' && typeof (event as any).brokerOrderId === 'string') };
  } catch { return emptyOrderLifecycleStore(); }
}

/** One broker order may progress through statuses; retain the latest event per status, not duplicate refreshes. */
export function upsertOrderLifecycleEvent(store: OrderLifecycleStore, event: OrderLifecycleEvent): OrderLifecycleStore {
  const index = store.events.findIndex(existing => existing.brokerOrderId === event.brokerOrderId && existing.status === event.status && existing.workflowId === event.workflowId);
  const events = [...store.events];
  if (index >= 0) events[index] = { ...events[index], ...event, id: events[index].id };
  else events.unshift(event);
  return { version: 1, events: events.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 1000) };
}
