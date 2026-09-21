// lib/ai-policy/inputStore.ts
//
// Immutable analysis-input store: `SET ... NX`, encrypted (AAD-bound to user + id), 90-day TTL, user-scoped keys,
// opaque UUID ids. A foreign user's read is indistinguishable from a missing id (NOT_FOUND).

import { randomUUID } from 'crypto';
import { ARTIFACT_TTL_SECONDS } from './config';
import { canonicalHash } from './canonical';
import { openJson, sealJson } from './artifactCrypto';
import { firstUnregisteredLeaf } from './pointer';
import { UUID_RE, isSafeUserId } from './types';
import type { AiRouteId, AnalysisInput, CitableFieldRegistry, Env, RedisLike, SourceKind, TrustClass } from './types';

export const inputKey = (userId: string, id: string): string => `ai-policy:input:${userId}:${id}`;
const aadFor = (userId: string, id: string): string => `input|${userId}|${id}`;

export interface BuildInputParams {
  userId: string;
  accountScope: string;
  route: AiRouteId;
  trust: TrustClass;
  schemaVersion: string;
  subjectKey: string;
  deterministicStates?: string[];
  payload: unknown;
  sourceAsOf: Record<SourceKind, string | null>;
  registry: CitableFieldRegistry;
  nowMs?: number;
}

export type BuildInputResult = { ok: true; input: AnalysisInput } | { ok: false; reason: 'INPUT_INVALID'; detail: string };

/** Freezes a payload into an AnalysisInput: allowlist-checks it against the route registry and hashes it canonically. */
export function buildAnalysisInput(params: BuildInputParams): BuildInputResult {
  if (!isSafeUserId(params.userId)) return { ok: false, reason: 'INPUT_INVALID', detail: 'userId' };
  if (!params.subjectKey || params.subjectKey.length > 200) return { ok: false, reason: 'INPUT_INVALID', detail: 'subjectKey' };
  const states = params.deterministicStates ?? [];
  if (states.length > 50 || states.some((s) => typeof s !== 'string' || s.length === 0 || s.length > 64)) {
    return { ok: false, reason: 'INPUT_INVALID', detail: 'deterministicStates' };
  }
  const offending = firstUnregisteredLeaf(params.payload, params.registry);
  if (offending) return { ok: false, reason: 'INPUT_INVALID', detail: `unregistered field ${offending}` };
  let payloadHash: string;
  try {
    payloadHash = canonicalHash(params.payload);
  } catch (error) {
    return { ok: false, reason: 'INPUT_INVALID', detail: error instanceof Error ? error.message : 'canonical' };
  }
  const now = params.nowMs ?? Date.now();
  return {
    ok: true,
    input: {
      id: randomUUID(),
      userId: params.userId,
      accountScope: params.accountScope,
      route: params.route,
      trust: params.trust,
      schemaVersion: params.schemaVersion,
      subjectKey: params.subjectKey,
      deterministicStates: states,
      payload: params.payload,
      payloadHash,
      sourceAsOf: params.sourceAsOf,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ARTIFACT_TTL_SECONDS * 1000).toISOString(),
    },
  };
}

export type SaveInputResult = { ok: true } | { ok: false; reason: 'EXISTS' | 'INPUT_INVALID' };

export async function saveInput(redis: RedisLike, input: AnalysisInput, env: Env = process.env): Promise<SaveInputResult> {
  if (!isSafeUserId(input.userId) || !UUID_RE.test(input.id)) return { ok: false, reason: 'INPUT_INVALID' };
  let recomputed: string;
  try {
    recomputed = canonicalHash(input.payload);
  } catch {
    return { ok: false, reason: 'INPUT_INVALID' };
  }
  if (recomputed !== input.payloadHash) return { ok: false, reason: 'INPUT_INVALID' };
  const sealed = sealJson(input, env, aadFor(input.userId, input.id));
  const result = await redis.set(inputKey(input.userId, input.id), sealed, 'EX', ARTIFACT_TTL_SECONDS, 'NX');
  return result === 'OK' ? { ok: true } : { ok: false, reason: 'EXISTS' };
}

export type GetInputResult = { ok: true; input: AnalysisInput } | { ok: false; reason: 'NOT_FOUND' | 'INPUT_INVALID' };

export async function getInput(redis: RedisLike, userId: string, id: string, env: Env = process.env): Promise<GetInputResult> {
  if (!isSafeUserId(userId) || typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, reason: 'NOT_FOUND' };
  const raw = await redis.get(inputKey(userId, id));
  if (raw == null) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const input = openJson<AnalysisInput>(raw, env, aadFor(userId, id));
    if (input.userId !== userId || input.id !== id) return { ok: false, reason: 'NOT_FOUND' };
    if (canonicalHash(input.payload) !== input.payloadHash) return { ok: false, reason: 'INPUT_INVALID' };
    return { ok: true, input };
  } catch {
    return { ok: false, reason: 'INPUT_INVALID' };
  }
}
