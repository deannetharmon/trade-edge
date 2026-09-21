// lib/ai-policy/killSwitch.ts
//
// Redis kill switches (D5): `ai-policy:kill:global` and `ai-policy:kill:route:<route>`. Redis wins over env: a set key
// stops the route without a redeploy. A missing key means "not killed" (env flags still govern). Only explicit
// 0/false/off lifts a kill key; any other present value kills. A Redis error is treated as OFF (unavailable).

import type { AiRouteId, RedisLike } from './types';

export const KILL_GLOBAL_KEY = 'ai-policy:kill:global';
export const killRouteKey = (route: AiRouteId): string => `ai-policy:kill:route:${route}`;

export interface KillSwitchResult {
  killed: boolean;
  cause: 'GLOBAL' | 'ROUTE' | 'ERROR' | null;
}

function isLifted(value: string | null): boolean {
  if (value == null) return true;
  return /^(?:0|false|off)$/i.test(value.trim());
}

export async function checkKillSwitch(redis: RedisLike, route: AiRouteId): Promise<KillSwitchResult> {
  try {
    const [globalValue, routeValue] = await Promise.all([redis.get(KILL_GLOBAL_KEY), redis.get(killRouteKey(route))]);
    if (!isLifted(globalValue)) return { killed: true, cause: 'GLOBAL' };
    if (!isLifted(routeValue)) return { killed: true, cause: 'ROUTE' };
    return { killed: false, cause: null };
  } catch {
    return { killed: true, cause: 'ERROR' };
  }
}
