// lib/ai-policy/types.ts
//
// AI-POLICY-0001A: shared types for the AI policy gateway. Pure types and constants; no runtime dependencies.
// The gateway is server-side only and read-only: nothing in this library may import deterministic scan,
// portfolio, or order code (enforced by __tests__/importBoundary.test.ts).

export const AI_ROUTE_IDS = [
  'scan_summary',
  'grounded_chat',
  'leaps_deep_analysis',
  'pmcc_deep_analysis',
  'retrospective_batch',
] as const;
export type AiRouteId = (typeof AI_ROUTE_IDS)[number];

export type AiTier = 'economy' | 'reasoning' | 'batch';

/** ADR-0005 trust classes. */
export type TrustClass = 'server_verified' | 'client_attested';

export const SOURCE_KINDS = ['quoteGreeks', 'brokerPositionCapacity', 'earningsCalendar', 'scanCalculation'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABELS: Record<SourceKind, string> = {
  quoteGreeks: 'Quotes and Greeks',
  brokerPositionCapacity: 'Broker positions and capacity',
  earningsCalendar: 'Earnings calendar',
  scanCalculation: 'Scan calculation',
};

export type CitableFormat = 'usd' | 'pct' | 'number' | 'integer' | 'date' | 'text' | 'boolean';

/** One citable field. `pattern` is an RFC 6901 JSON Pointer where a `*` segment matches exactly one segment. */
export interface CitableField {
  pattern: string;
  /** Human label shown to users (Diane owns the wording). */
  label: string;
  source: SourceKind;
  format: CitableFormat;
}
export type CitableFieldRegistry = readonly CitableField[];

export type ReasonCode =
  | 'FLAG_OFF'
  | 'KILL_SWITCH'
  | 'GOVERNANCE'
  | 'BUDGET'
  | 'RATE_LIMIT'
  | 'CIRCUIT_OPEN'
  | 'INPUT_MISSING'
  | 'INPUT_STALE'
  | 'INPUT_INVALID'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'VALIDATION_REJECTED'
  | 'NOT_FOUND';

export type ArtifactStatus = 'ready' | 'unavailable' | 'rejected' | 'stale';

/** Immutable once stored. `payload` may contain only registry fields plus structural containers. */
export interface AnalysisInput {
  /** Opaque UUID. */
  id: string;
  userId: string;
  /** Truncated HMAC of (userId, accountNumber); account numbers never appear anywhere else. */
  accountScope: string;
  route: AiRouteId;
  trust: TrustClass;
  schemaVersion: string;
  /**
   * Route-defined stable identifier of what is analysed (scan session id, OCC symbol, ...). Used only to maintain
   * the per-subject `current` pointer; stored hashed. (Added to the ticket's contract summary.)
   */
  subjectKey: string;
  /** Deterministic states/reason codes the deterministic layer attached to the subject (audit only). */
  deterministicStates: string[];
  payload: unknown;
  payloadHash: string;
  sourceAsOf: Record<SourceKind, string | null>;
  createdAt: string;
  expiresAt: string;
}

export interface Claim {
  text: string;
  citationIds: number[];
}
export interface TextItem {
  text: string;
}
export interface ModelCitation {
  id: number;
  pointer: string;
}

/** Exactly what the model must return. Values appear in text only as `{{c:N}}` placeholders. */
export interface ModelOutput {
  summary: string;
  observations: Claim[];
  tradeoffs: Claim[];
  missingOrStaleData: Claim[];
  questionsForTrader: TextItem[];
  limitations: TextItem[];
  citations: ModelCitation[];
}

/** What the client may see for one citation. Raw pointers and hashes stay in provenance. */
export interface ClientCitation {
  id: number;
  label: string;
  displayValue: string;
  sourceLabel: string;
  asOf: string;
}

export interface RenderedOutput {
  summary: string;
  observations: Claim[];
  tradeoffs: Claim[];
  missingOrStaleData: Claim[];
  questionsForTrader: TextItem[];
  limitations: TextItem[];
  citations: ClientCitation[];
}

export interface AiArtifact {
  id: string;
  userId: string;
  route: AiRouteId;
  status: ArtifactStatus;
  reason: ReasonCode | null;
  inputId: string;
  accountScope: string;
  trust: TrustClass;
  tier: AiTier;
  model: string;
  templateId: string;
  templateVersion: string;
  createdAt: string;
  expiresAt: string;
  /** Present only when status is 'ready' (or 'stale', which was ready when created). */
  output: RenderedOutput | null;
}

export type AiRouteResult =
  | { status: 'ready' | 'stale'; artifact: AiArtifact }
  | { status: 'rejected'; reason: ReasonCode; artifactId: string }
  | { status: 'unavailable'; reason: ReasonCode; artifactId: string | null };

/** Minimal Redis surface used by the library (ioredis satisfies it; tests use an in-memory fake). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, by: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number | string>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export type Env = Record<string, string | undefined>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** userId is server-resolved; still refuse anything that could alter a Redis key. */
export function isSafeUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.length > 0 && userId.length <= 256 && !/[\s\u0000-\u001f:*?[\]\\]/.test(userId);
}
