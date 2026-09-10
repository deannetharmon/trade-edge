import type { OrderLifecycleEvent } from './types';

export async function recordOrderLifecycleEvent(event: Omit<OrderLifecycleEvent, 'id' | 'version' | 'observedAt' | 'source'> & Partial<Pick<OrderLifecycleEvent, 'id' | 'version' | 'observedAt' | 'source'>>) {
  const response = await fetch('/api/order-lifecycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not record order lifecycle event');
  return response.json();
}
