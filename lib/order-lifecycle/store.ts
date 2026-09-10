import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { parseOrderLifecycleStore, upsertOrderLifecycleEvent, type OrderLifecycleEvent, type OrderLifecycleStore } from './types';

const key = (userId: string) => `order-lifecycle:${userId}`;

export async function listOrderLifecycleEvents(userId: string): Promise<OrderLifecycleStore> {
  return withAutopilotRedis(async redis => parseOrderLifecycleStore(await redis.get(key(userId))));
}

export async function saveOrderLifecycleEvent(userId: string, event: OrderLifecycleEvent): Promise<OrderLifecycleStore> {
  return withAutopilotRedis(async redis => {
    const next = upsertOrderLifecycleEvent(parseOrderLifecycleStore(await redis.get(key(userId))), event);
    await redis.set(key(userId), JSON.stringify(next));
    return next;
  });
}
