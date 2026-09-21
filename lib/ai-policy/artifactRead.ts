// lib/ai-policy/artifactRead.ts
//
// Read one stored artifact for its owner. A missing id and another user's id are indistinguishable (NOT_FOUND).
// Dark by default: unavailable unless the AI policy is enabled for at least one route. Never throws.

import { getArtifact } from './artifactStore';
import { hasArtifactKey } from './artifactCrypto';
import { AI_ROUTE_IDS } from './types';
import { isGloballyEnabled, isRouteEnabled } from './config';
import type { AiArtifact, Env, ReasonCode, RedisLike } from './types';
import { getRedis } from '@/lib/jobs/redis';

export type ArtifactReadResult = { status: 'found'; artifact: AiArtifact } | { status: 'unavailable'; reason: ReasonCode };

export async function readArtifactForUser(userId: string, artifactId: string, deps: { env?: Env; redis?: RedisLike } = {}): Promise<ArtifactReadResult> {
  const env = deps.env ?? process.env;
  try {
    if (!isGloballyEnabled(env) || !AI_ROUTE_IDS.some((route) => isRouteEnabled(route, env))) return { status: 'unavailable', reason: 'FLAG_OFF' };
    if (!hasArtifactKey(env)) return { status: 'unavailable', reason: 'GOVERNANCE' };
    const redis = deps.redis ?? (getRedis() as unknown as RedisLike);
    const artifact = await getArtifact(redis, userId, artifactId, env);
    return artifact ? { status: 'found', artifact } : { status: 'unavailable', reason: 'NOT_FOUND' };
  } catch {
    return { status: 'unavailable', reason: 'PROVIDER_ERROR' };
  }
}
