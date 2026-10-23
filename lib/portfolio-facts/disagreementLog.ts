// lib/portfolio-facts/disagreementLog.ts
//
// RECO-UNIFY-0001C: the disagreement log. Each time the AI's second look differs from the official verdict, one entry is kept so Ian and Alan
// can review the disagreements against outcomes (no automatic tuning, no review screen in this ticket). Pure list rules here; the server route
// stores the list in Redis keyed by the signed-in user. No broker tokens and no account numbers are ever stored.
//
// Rules (Quinn): one entry per position per snapshot id; at most MAX_ENTRIES per user (oldest dropped first); entries older than KEEP_DAYS are
// dropped; the outcome is filled in when the position closes.

import type { PositionFacts } from './positionFacts';
import type { SecondLook } from './secondLook';
import type { Verdict } from './verdict';

export const MAX_ENTRIES = 500;
export const KEEP_DAYS = 180;

export interface DisagreementOutcome { closedAt: string; lastSeenPnl: number | null }

export interface DisagreementEntry {
  /** positionKey + snapshotId: one entry per position per snapshot. */
  id: string;
  loggedAt: string;
  positionKey: string;
  symbol: string;
  snapshotId: string;
  officialBucket: string;
  officialLabel: string;
  officialIntent: string;
  ruleIds: string[];
  aiRecommendation: string;
  aiBucket: string;
  dataPoint: string | null;
  dataPointValue: number | string | boolean | null;
  note: string | null;
  /** The facts the verdict and the AI used, without the engine input. */
  factsUsed: Omit<PositionFacts, 'engineInput'>;
  outcome: DisagreementOutcome | null;
}

export function buildDisagreementEntry(facts: PositionFacts, verdict: Verdict, look: SecondLook, now: Date = new Date()): DisagreementEntry | null {
  if (!look.differs || !look.aiRecommendation || !look.aiBucket) return null;
  const { engineInput: _omit, ...factsUsed } = facts;
  return {
    id: `${facts.positionKey}|${facts.snapshotId}`,
    loggedAt: now.toISOString(),
    positionKey: facts.positionKey,
    symbol: facts.identity.symbol,
    snapshotId: facts.snapshotId,
    officialBucket: verdict.bucket, officialLabel: verdict.label, officialIntent: verdict.intent,
    ruleIds: verdict.reasons.map(r => r.ruleId),
    aiRecommendation: look.aiRecommendation, aiBucket: look.aiBucket,
    dataPoint: look.dataPoint, dataPointValue: look.dataPointValue, note: look.note,
    factsUsed, outcome: null,
  };
}

const DAY_MS = 86_400_000;

/** Adds the entry (replacing one with the same id), drops entries older than KEEP_DAYS, then trims the oldest beyond MAX_ENTRIES. Returns a new list, newest last. */
export function appendDisagreement(list: readonly DisagreementEntry[], entry: DisagreementEntry, now: Date = new Date()): DisagreementEntry[] {
  const cutoff = now.getTime() - KEEP_DAYS * DAY_MS;
  const kept = list.filter(e => e.id !== entry.id && Date.parse(e.loggedAt) >= cutoff);
  const next = [...kept, entry].sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

/** Fills the outcome on every open entry for the position (it closed). Entries that already have an outcome are left alone. */
export function backfillOutcome(list: readonly DisagreementEntry[], positionKey: string, outcome: DisagreementOutcome): DisagreementEntry[] {
  return list.map(e => (e.positionKey === positionKey && e.outcome == null ? { ...e, outcome } : e));
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500;

/** Shape check for an entry arriving at the route. Rejects anything that is not a plain, bounded record. */
export function isValidEntry(v: unknown): v is DisagreementEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return isStr(e.id) && isStr(e.loggedAt) && Number.isFinite(Date.parse(e.loggedAt as string)) && isStr(e.positionKey) && isStr(e.symbol) && isStr(e.snapshotId)
    && isStr(e.officialBucket) && isStr(e.officialLabel) && isStr(e.officialIntent) && Array.isArray(e.ruleIds) && e.ruleIds.every(isStr)
    && isStr(e.aiRecommendation) && isStr(e.aiBucket) && typeof e.factsUsed === 'object' && e.factsUsed !== null
    && JSON.stringify(e).length <= 20_000 && !('accessToken' in e) && !('accountNumber' in e);
}
