// lib/ai-policy/artifactStore.ts
//
// Encrypted artifact store: per-user index, a `current` pointer per subject, stale marking on read, 90-day TTL.
// A refresh creates a new artifact and moves the pointer; older artifacts for the subject read back as `stale`.
// Artifacts are never rewritten in place.

import { ARTIFACT_TTL_SECONDS } from './config';
import { sha256Hex } from './canonical';
import { openJson, sealJson } from './artifactCrypto';
import { UUID_RE, isSafeUserId } from './types';
import type { AiArtifact, AiRouteId, Env, RedisLike } from './types';

export const artifactKey = (userId: string, id: string): string => `ai-policy:artifact:${userId}:${id}`;
export const indexKey = (userId: string): string => `ai-policy:index:${userId}`;
export const subjectHash = (route: AiRouteId, subjectKey: string): string => sha256Hex(`${route}\u0000${subjectKey}`).slice(0, 32);
export const currentKey = (userId: string, route: AiRouteId, hash: string): string => `ai-policy:current:${userId}:${route}:${hash}`;
const aadFor = (userId: string, id: string): string => `artifact|${userId}|${id}`;

/** The subject pointer travels with the artifact so stale-on-read needs no other lookup. */
interface StoredArtifact {
  artifact: AiArtifact;
  subjectHash: string;
}

export async function saveArtifact(redis: RedisLike, artifact: AiArtifact, subject: string, env: Env = process.env): Promise<boolean> {
  if (!isSafeUserId(artifact.userId) || !UUID_RE.test(artifact.id)) return false;
  const stored: StoredArtifact = { artifact, subjectHash: subject };
  const ok = await redis.set(artifactKey(artifact.userId, artifact.id), sealJson(stored, env, aadFor(artifact.userId, artifact.id)), 'EX', ARTIFACT_TTL_SECONDS, 'NX');
  if (ok !== 'OK') return false;
  await redis.zadd(indexKey(artifact.userId), Date.parse(artifact.createdAt), artifact.id);
  await redis.expire(indexKey(artifact.userId), ARTIFACT_TTL_SECONDS);
  return true;
}

/** Makes `artifact` the current one for its subject; every older 'ready' artifact for the subject then reads as stale. */
export async function markCurrent(redis: RedisLike, userId: string, route: AiRouteId, subject: string, artifactId: string): Promise<void> {
  await redis.set(currentKey(userId, route, subject), artifactId, 'EX', ARTIFACT_TTL_SECONDS);
}

export async function getArtifact(redis: RedisLike, userId: string, id: string, env: Env = process.env): Promise<AiArtifact | null> {
  if (!isSafeUserId(userId) || typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const raw = await redis.get(artifactKey(userId, id));
  if (raw == null) return null;
  try {
    const stored = openJson<StoredArtifact>(raw, env, aadFor(userId, id));
    const artifact = stored.artifact;
    if (artifact.userId !== userId || artifact.id !== id) return null;
    if (artifact.status !== 'ready') return artifact;
    const currentId = await redis.get(currentKey(userId, artifact.route, stored.subjectHash));
    return currentId != null && currentId !== artifact.id ? { ...artifact, status: 'stale' } : artifact;
  } catch {
    return null;
  }
}

export async function listArtifactIds(redis: RedisLike, userId: string, limit = 25): Promise<string[]> {
  if (!isSafeUserId(userId)) return [];
  return redis.zrevrange(indexKey(userId), 0, Math.max(0, Math.min(limit, 100) - 1));
}
