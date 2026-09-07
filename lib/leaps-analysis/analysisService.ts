import crypto from 'crypto';
import Redis from 'ioredis';
import type { ServerLeapsReview } from './serverTradeReview';

export const LEAPS_ANALYSIS_SNAPSHOT_VERSION = 'leaps-analysis-snapshot-v1';
export const LEAPS_ANALYSIS_TTL_SECONDS = 90 * 24 * 60 * 60;
export type LeapsIntent = 'standalone' | 'stock_replacement' | 'future_pmcc' | 'not_specified';
export type LeapsAnalysisStatus = 'MECHANICS_REVIEWED' | 'MORE_INFORMATION_NEEDED' | 'REVIEW_RISK_FACTORS' | 'ANALYSIS_UNAVAILABLE';
export type AiPosture = 'SUPPORTS_FURTHER_REVIEW' | 'WAIT_MONITOR' | 'INSUFFICIENT_EVIDENCE';
export type AnalysisOutput = { posture: AiPosture; evidence: Array<{ field: string; fact: string }>; inferences: Array<{ statement: string; uncertainty: string }>; mechanics: string; tradeoffs: string; cautions: string[]; missing: string[] };
export type Snapshot = {
  id: string; hash: string; version: string; createdAt: string; expiresAt: string;
  intent: LeapsIntent; quantity: number; objective: string;
  contract: Omit<ServerLeapsReview, 'qualification'>; qualification: ServerLeapsReview['qualification'];
  mechanics: Record<string, number | null>; unavailable: string[];
  provenance: { provider: 'tastytrade'; policyVersion: string; analysisLookupAt: string };
};
export type AnalysisRecord = { id: string; requestHash: string; status: LeapsAnalysisStatus; snapshot: Snapshot; output: AnalysisOutput | null; model: string | null; attempts: number; createdAt: string; expiresAt: string; current: boolean; usage: { promptTokens: number | null; completionTokens: number | null } | null };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export function requestFingerprint(value: unknown) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }

export function buildSnapshot(review: ServerLeapsReview, intent: LeapsIntent, quantity: number, objective: string): Snapshot {
  const mid = review.bid != null && review.ask != null ? (review.bid + review.ask) / 2 : null;
  const intrinsic = mid != null && review.spot != null ? Math.max(review.spot - review.strike, 0) : null;
  const extrinsic = mid != null && intrinsic != null ? Math.max(0, mid - intrinsic) : null;
  const mechanics = { multiplier: review.multiplier, midPerShare: mid, costPerContract: mid == null ? null : mid * review.multiplier, totalEstimatedCost: mid == null ? null : mid * review.multiplier * quantity, intrinsicPerShare: intrinsic, extrinsicPerShare: extrinsic, extrinsicPctOfMidCost: mid && extrinsic != null ? extrinsic / mid * 100 : null, breakeven: mid == null ? null : review.strike + mid, breakevenPctAboveSpot: mid != null && review.spot ? ((review.strike + mid - review.spot) / review.spot) * 100 : null, spreadPct: review.qualification.spreadPct };
  const contract = { occSymbol: review.occSymbol, symbol: review.symbol, strike: review.strike, expiration: review.expiration, dte: review.dte, bid: review.bid, ask: review.ask, spot: review.spot, delta: review.delta, openInterest: review.openInterest, impliedVolatility: review.impliedVolatility, optionQuoteTimestamp: review.optionQuoteTimestamp, underlyingQuoteTimestamp: review.underlyingQuoteTimestamp, instrumentType: review.instrumentType, multiplier: review.multiplier, provider: review.provider, fetchedAt: review.fetchedAt };
  const unsigned = { version: LEAPS_ANALYSIS_SNAPSHOT_VERSION, intent, quantity, objective, contract, qualification: review.qualification, mechanics, provenance: { provider: review.provider, policyVersion: review.qualification.policyVersion, analysisLookupAt: review.fetchedAt } };
  const hash = requestFingerprint(unsigned); const createdAt = new Date().toISOString();
  const unavailable = review.qualification.gates.filter(gate => gate.status === 'unavailable').map(gate => gate.id);
  return { ...unsigned, id: crypto.randomUUID(), hash, createdAt, expiresAt: new Date(Date.now() + LEAPS_ANALYSIS_TTL_SECONDS * 1000).toISOString(), unavailable };
}

const forbidden = /\b(best|safest|safe|recommended|recommendation|buy|approved|approval|guarantee(?:s|d)?|predict(?:ion|ed|s)?|position siz(?:e|ing)|submit(?:ting)? (?:an )?order|take (?:this|the) trade)\b/i;
function strings(value: unknown): string[] { if (typeof value === 'string') return [value]; if (Array.isArray(value)) return value.flatMap(strings); if (value && typeof value === 'object') return Object.values(value).flatMap(strings); return []; }
export function validateAnalysisOutput(value: unknown): { valid: boolean; output?: AnalysisOutput } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false };
  const v = value as Record<string, unknown>; const allowed = ['posture', 'evidence', 'inferences', 'mechanics', 'tradeoffs', 'cautions', 'missing'];
  if (Object.keys(v).some(key => !allowed.includes(key)) || !['SUPPORTS_FURTHER_REVIEW', 'WAIT_MONITOR', 'INSUFFICIENT_EVIDENCE'].includes(String(v.posture))) return { valid: false };
  if (!Array.isArray(v.evidence) || !v.evidence.every(item => item && typeof item.field === 'string' && typeof item.fact === 'string' && Object.keys(item).length === 2)) return { valid: false };
  if (!Array.isArray(v.inferences) || !v.inferences.every(item => item && typeof item.statement === 'string' && typeof item.uncertainty === 'string' && Object.keys(item).length === 2)) return { valid: false };
  if (typeof v.mechanics !== 'string' || typeof v.tradeoffs !== 'string' || !Array.isArray(v.cautions) || !v.cautions.every(x => typeof x === 'string') || !Array.isArray(v.missing) || !v.missing.every(x => typeof x === 'string')) return { valid: false };
  if (strings(v).some(text => forbidden.test(text))) return { valid: false };
  return { valid: true, output: v as unknown as AnalysisOutput };
}

export const ANALYSIS_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['posture', 'evidence', 'inferences', 'mechanics', 'tradeoffs', 'cautions', 'missing'], properties: { posture: { type: 'string', enum: ['SUPPORTS_FURTHER_REVIEW', 'WAIT_MONITOR', 'INSUFFICIENT_EVIDENCE'] }, evidence: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['field', 'fact'], properties: { field: { type: 'string' }, fact: { type: 'string' } } } }, inferences: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['statement', 'uncertainty'], properties: { statement: { type: 'string' }, uncertainty: { type: 'string' } } } }, mechanics: { type: 'string' }, tradeoffs: { type: 'string' }, cautions: { type: 'array', maxItems: 8, items: { type: 'string' } }, missing: { type: 'array', maxItems: 8, items: { type: 'string' } } } } as const;

export function redisForAnalysis() { const url = process.env.REDIS_URL || process.env.KV_URL; if (!url) throw new Error('Server storage is not configured'); return new Redis(url); }
const recordKey = (userId: string, id: string) => `leaps-analysis:record:${userId}:${id}`;
const idemKey = (userId: string, fingerprint: string) => `leaps-analysis:idem:${userId}:${fingerprint}`;
const indexKey = (userId: string) => `leaps-analysis:index:${userId}`;
const currentKey = (userId: string, snapshot: Snapshot) => `leaps-analysis:current:${userId}:${snapshot.contract.occSymbol}:${snapshot.qualification.policyVersion}:${snapshot.intent}`;

/** Atomic user rate-limit + idempotency claim. Cached requests do not consume quota. */
export async function claimAnalysis(redis: Redis, userId: string, fingerprint: string, proposedId: string): Promise<{ cachedId: string | null }> {
  const rateKey = `leaps-analysis:rate:${userId}`; const now = Date.now();
  const result = await redis.eval("local cached=redis.call('GET',KEYS[1]); if cached then return {'cached',cached} end; redis.call('ZREMRANGEBYSCORE',KEYS[2],0,ARGV[1]-3600000); local n=redis.call('ZCARD',KEYS[2]); if n>=10 then return {'limited',''} end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3],'NX'); redis.call('ZADD',KEYS[2],ARGV[1],ARGV[2]); redis.call('EXPIRE',KEYS[2],3600); return {'claimed',ARGV[2]}", 2, idemKey(userId, fingerprint), rateKey, now, proposedId, LEAPS_ANALYSIS_TTL_SECONDS) as [string, string];
  if (result[0] === 'limited') throw new Error('Analysis limit reached: 10 new analyses per hour. Cached results remain available.');
  return { cachedId: result[0] === 'cached' ? result[1] : null };
}
export async function saveAnalysisRecord(redis: Redis, userId: string, record: AnalysisRecord, fingerprint: string) {
  const json = JSON.stringify(record); const transaction = redis.multi();
  transaction.set(recordKey(userId, record.id), json, 'EX', LEAPS_ANALYSIS_TTL_SECONDS, 'NX');
  transaction.zadd(indexKey(userId), Date.parse(record.createdAt), record.id); transaction.expire(indexKey(userId), LEAPS_ANALYSIS_TTL_SECONDS);
  transaction.set(currentKey(userId, record.snapshot), record.id, 'EX', LEAPS_ANALYSIS_TTL_SECONDS);
  transaction.set(idemKey(userId, fingerprint), record.id, 'EX', LEAPS_ANALYSIS_TTL_SECONDS);
  const result = await transaction.exec(); if (!result || result[0]?.[1] !== 'OK') throw new Error('Analysis record could not be saved');
}
export async function getAnalysisRecord(redis: Redis, userId: string, id: string): Promise<AnalysisRecord | null> { const raw = await redis.get(recordKey(userId, id)); if (!raw) return null; return JSON.parse(raw); }
export async function listAnalysisRecords(redis: Redis, userId: string, limit = 25): Promise<AnalysisRecord[]> { const ids = await redis.zrevrange(indexKey(userId), 0, Math.max(0, Math.min(limit, 100) - 1)); const rows = await Promise.all(ids.map(id => getAnalysisRecord(redis, userId, id))); return rows.filter((row): row is AnalysisRecord => row != null); }
export async function markCurrent(redis: Redis, userId: string, record: AnalysisRecord) { const id = await redis.get(currentKey(userId, record.snapshot)); return { ...record, current: id === record.id }; }
export async function deleteAnalysisRecord(redis: Redis, userId: string, id: string) { const record = await getAnalysisRecord(redis, userId, id); if (!record) return false; const tx = redis.multi(); tx.del(recordKey(userId, id)); tx.zrem(indexKey(userId), id); tx.del(idemKey(userId, record.requestHash)); tx.set(`leaps-analysis:tombstone:${userId}:${id}`, new Date().toISOString(), 'EX', LEAPS_ANALYSIS_TTL_SECONDS); await tx.exec(); return true; }
