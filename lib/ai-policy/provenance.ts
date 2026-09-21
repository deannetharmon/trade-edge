// lib/ai-policy/provenance.ts
//
// Audit records: metadata and hashes ONLY (no prompt text, no output text, no account number). 548-day TTL (D4).
// Reads are keyed by the acting user, so only the owning user can read a record.

import { AUDIT_TTL_SECONDS } from './config';
import { sha256Hex } from './canonical';
import { UUID_RE, isSafeUserId } from './types';
import type { AiRouteId, ArtifactStatus, CitableFormat, ReasonCode, RedisLike, SourceKind, TrustClass } from './types';

export const auditKey = (userId: string, artifactId: string): string => `ai-policy:audit:${userId}:${artifactId}`;
export const userScopeId = (userId: string): string => sha256Hex(`user\u0000${userId}`).slice(0, 32);

export interface CitationProvenance {
  id: number;
  pointer: string;
  valueHash: string;
  format: CitableFormat;
  source: SourceKind;
  asOf: string | null;
}

export interface ClaimMapEntry {
  section: 'summary' | 'observations' | 'tradeoffs' | 'missingOrStaleData' | 'questionsForTrader' | 'limitations';
  index: number;
  citationIds: number[];
}

export interface ProvenanceRecord {
  artifactId: string;
  artifactType: AiRouteId;
  status: ArtifactStatus;
  provider: 'openai';
  model: string;
  providerModelId: string | null;
  templateId: string;
  templateVersion: string;
  policyVersion: string;
  providerPolicyVersion: string;
  lexiconVersion: string;
  validatorVersion: string;
  input: { id: string; payloadHash: string; schemaVersion: string; trustClass: TrustClass };
  authorizationScope: { accountScope: string; userScope: string };
  sourceAsOf: Record<SourceKind, string | null>;
  deterministicStates: string[];
  citations: CitationProvenance[];
  claimMap: ClaimMapEntry[];
  validation: { result: 'accepted' | 'rejected' | 'not_run'; rule: string | null; outputHash: string | null };
  promptHash: string;
  latencyMs: number | null;
  cost: { estimatedMicros: number; actualMicros: number | null; inputTokens: number | null; outputTokens: number | null };
  featureFlag: { global: string; route: string };
  userAction: string;
  failureReason: ReasonCode | null;
  createdAt: string;
}

export async function saveProvenance(redis: RedisLike, userId: string, record: ProvenanceRecord): Promise<boolean> {
  if (!isSafeUserId(userId) || !UUID_RE.test(record.artifactId)) return false;
  const result = await redis.set(auditKey(userId, record.artifactId), JSON.stringify(record), 'EX', AUDIT_TTL_SECONDS, 'NX');
  return result === 'OK';
}

/** Audit read: only the owning user (the key is user-scoped) can read a record. */
export async function getProvenance(redis: RedisLike, actingUserId: string, artifactId: string): Promise<ProvenanceRecord | null> {
  if (!isSafeUserId(actingUserId) || typeof artifactId !== 'string' || !UUID_RE.test(artifactId)) return null;
  const raw = await redis.get(auditKey(actingUserId, artifactId));
  if (raw == null) return null;
  try {
    const record = JSON.parse(raw) as ProvenanceRecord;
    return record.authorizationScope?.userScope === userScopeId(actingUserId) ? record : null;
  } catch {
    return null;
  }
}
