// lib/ai-policy/launchGates.ts
//
// Launch-gate registry (AI-POLICY-0001F). The spec forbids enabling any AI route until a versioned, approved gate record
// exists with numeric or testable thresholds, a minimum sample, a hold period, and rollback triggers. This file is the
// in-code list of approved records plus the validation that decides whether a record can enable a route.
//
// APPROVAL IS A REVIEWED COMMIT: adding an entry to LAUNCH_GATES together with the matching markdown record
// docs/ai-policy/launch-gates/<id>.md. Code never records an approval, and no threshold is chosen in code: this file only
// says what a record must contain. Roll back by flipping the flag, setting the Redis kill key, or letting/pushing the gate
// to expire or be revoked; re-enabling needs a NEWLY approved version.
//
// The registry is EMPTY on purpose: until it holds a valid, unexpired entry for a route, that route is unavailable in
// Production even with its flags on (see isRouteEnabled in config.ts).

import type { AiRouteId, Env } from './types';
import { AI_ROUTE_IDS } from './types';

/** How each measure is judged. Comparators are fixed here so a record supplies only the number. */
export interface MeasureDef {
  label: string;
  comparator: 'gte' | 'lte';
  /** 'rate' is a fraction in [0, 1]; 'positive' is any number > 0; 'score' is a 1-5 mean. */
  kind: 'rate' | 'positive' | 'score';
  /** Who owns the number (per the launch-gate template). */
  owner: string;
}

export const MEASURES = {
  groundedAccuracy: { label: 'Grounded accuracy (human-reviewed)', comparator: 'gte', kind: 'rate', owner: 'Ian' },
  claimVerificationRate: { label: 'Claim verification rate (machine)', comparator: 'gte', kind: 'rate', owner: 'Alan' },
  prohibitedOutputRejectionRate: { label: 'Prohibited-output rejection rate (adversarial set)', comparator: 'gte', kind: 'rate', owner: 'Ian / Quinn' },
  falseRejectionRate: { label: 'False-rejection rate (benign set)', comparator: 'lte', kind: 'rate', owner: 'Quinn' },
  freshnessHandlingRate: { label: 'Freshness handling (stale/missing sources disclosed or blocked)', comparator: 'gte', kind: 'rate', owner: 'Ian' },
  p95LatencyMs: { label: 'p95 latency (ms)', comparator: 'lte', kind: 'positive', owner: 'Alan' },
  p95CostPerRequestUsd: { label: 'Cost per request, p95 (USD)', comparator: 'lte', kind: 'positive', owner: 'Paul' },
  userMonthlyBudgetUsd: { label: 'Per-user monthly budget (USD)', comparator: 'lte', kind: 'positive', owner: 'Paul' },
  usefulnessMean: { label: 'Usefulness (mean reviewer score, 1-5)', comparator: 'gte', kind: 'score', owner: 'Paul / Ian' },
} as const satisfies Record<string, MeasureDef>;

export type MeasureKey = keyof typeof MEASURES;
export const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[];

export interface RollbackTrigger {
  id: string;
  /** What is watched, in words a reviewer can check. */
  description: string;
  /** How it is measured (source and window). */
  measurement: string;
  action: 'flag_off' | 'kill_switch' | 'gate_expiry';
}

export interface LaunchGate {
  /** Must equal `${route}-v${version}`; the markdown record is docs/ai-policy/launch-gates/<id>.md. */
  id: string;
  route: AiRouteId;
  version: number;
  owner: string;
  approver: string;
  /** ISO date or date-time. */
  approvedAt: string;
  /** ISO date or date-time; the gate stops enabling the route at this instant. */
  expiresAt: string;
  /** Set (ISO) to revoke without deleting the record; a revoked gate never enables a route. */
  revokedAt?: string | null;
  thresholds: Record<MeasureKey, number>;
  minSample: { syntheticFixtures: number; consentedSnapshots: number; humanAuditedOutputs: number };
  /** Cohort hold period before wider enablement, in days. Process input; not measured by code. */
  holdPeriodDays: number;
  rollbackTriggers: RollbackTrigger[];
}

/** Approved gate records. EMPTY until a reviewed commit adds an entry (with its markdown record). */
export const LAUNCH_GATES: readonly LaunchGate[] = [];

export const ROLLBACK_ACTIONS: readonly RollbackTrigger['action'][] = ['flag_off', 'kill_switch', 'gate_expiry'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const PLACEHOLDER_RE = /^(?:<.*>|tbd|todo|n\/a|none|-+|\?+)$/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A real, filled-in string: not blank, not a template placeholder such as "<name>" or "TBD". */
function isFilledString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && !PLACEHOLDER_RE.test(v.trim());
}

export function parseGateDate(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Non-vacuous: a threshold that every possible result would pass is not a threshold. */
function thresholdError(key: MeasureKey, value: unknown): string | null {
  const def: MeasureDef = MEASURES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return `thresholds.${key} is missing or not a number`;
  if (def.kind === 'rate') {
    if (value < 0 || value > 1) return `thresholds.${key} must be a fraction between 0 and 1`;
    if (def.comparator === 'gte' && value <= 0) return `thresholds.${key} of 0 would pass every result`;
    if (def.comparator === 'lte' && value >= 1) return `thresholds.${key} of 1 would pass every result`;
  } else if (def.kind === 'score') {
    if (value < 1 || value > 5) return `thresholds.${key} must be between 1 and 5`;
    if (def.comparator === 'gte' && value <= 1) return `thresholds.${key} of 1 would pass every result`;
  } else if (value <= 0) {
    return `thresholds.${key} must be greater than 0`;
  }
  return null;
}

/** Everything wrong with one gate record (empty = valid). Accepts unknown so missing fields are caught, not typed away. */
export function validateGateRecord(record: unknown): string[] {
  if (!isObject(record)) return ['record is not an object'];
  const errors: string[] = [];
  const route = record.route;
  if (typeof route !== 'string' || !(AI_ROUTE_IDS as readonly string[]).includes(route)) errors.push('route is missing or unknown');
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) errors.push('version must be an integer of 1 or more');
  if (!isFilledString(record.id)) errors.push('id is missing');
  else if (typeof route === 'string' && typeof record.version === 'number' && record.id !== `${route}-v${record.version}`) errors.push(`id must be "${route}-v${record.version}"`);
  if (!isFilledString(record.owner)) errors.push('owner is missing');
  if (!isFilledString(record.approver)) errors.push('approver is missing');

  const approved = parseGateDate(record.approvedAt);
  const expires = parseGateDate(record.expiresAt);
  if (approved == null) errors.push('approvedAt is missing or not an ISO date');
  if (expires == null) errors.push('expiresAt is missing or not an ISO date');
  if (approved != null && expires != null && expires <= approved) errors.push('expiresAt must be after approvedAt');
  if (record.revokedAt != null && parseGateDate(record.revokedAt) == null) errors.push('revokedAt must be an ISO date when set');

  const thresholds = record.thresholds;
  if (!isObject(thresholds)) errors.push('thresholds are missing');
  else {
    for (const key of MEASURE_KEYS) {
      const problem = thresholdError(key, thresholds[key]);
      if (problem) errors.push(problem);
    }
    for (const key of Object.keys(thresholds)) if (!(MEASURE_KEYS as string[]).includes(key)) errors.push(`thresholds.${key} is not a known measure`);
  }

  const sample = record.minSample;
  if (!isObject(sample)) errors.push('minSample is missing');
  else {
    const positive = (k: string): void => {
      if (typeof sample[k] !== 'number' || !Number.isInteger(sample[k]) || (sample[k] as number) < 1) errors.push(`minSample.${k} must be an integer of 1 or more`);
    };
    positive('syntheticFixtures');
    positive('humanAuditedOutputs');
    if (typeof sample.consentedSnapshots !== 'number' || !Number.isInteger(sample.consentedSnapshots) || sample.consentedSnapshots < 0) {
      errors.push('minSample.consentedSnapshots must be an integer of 0 or more');
    }
  }

  if (typeof record.holdPeriodDays !== 'number' || !Number.isInteger(record.holdPeriodDays) || record.holdPeriodDays < 1) errors.push('holdPeriodDays must be an integer of 1 or more');

  const triggers = record.rollbackTriggers;
  if (!Array.isArray(triggers) || triggers.length === 0) errors.push('rollbackTriggers must list at least one trigger');
  else {
    const seen = new Set<string>();
    triggers.forEach((t, i) => {
      if (!isObject(t)) return errors.push(`rollbackTriggers[${i}] is not an object`);
      for (const field of ['id', 'description', 'measurement'] as const) if (!isFilledString(t[field])) errors.push(`rollbackTriggers[${i}].${field} is missing`);
      if (typeof t.action !== 'string' || !(ROLLBACK_ACTIONS as readonly string[]).includes(t.action)) errors.push(`rollbackTriggers[${i}].action must be one of ${ROLLBACK_ACTIONS.join(', ')}`);
      if (typeof t.id === 'string') {
        if (seen.has(t.id)) errors.push(`rollbackTriggers[${i}].id is a duplicate`);
        seen.add(t.id);
      }
    });
  }
  return errors;
}

/** Registry-level checks: every record valid, ids unique. Returns "<id>: <problem>" lines. */
export function validateRegistry(gates: readonly unknown[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  gates.forEach((gate, index) => {
    const label = isObject(gate) && typeof gate.id === 'string' ? gate.id : `entry ${index}`;
    for (const problem of validateGateRecord(gate)) errors.push(`${label}: ${problem}`);
    if (isObject(gate) && typeof gate.id === 'string') {
      if (ids.has(gate.id)) errors.push(`${label}: duplicate id`);
      ids.add(gate.id);
    }
  });
  return errors;
}

/** A gate enables a route only if it is valid, approved, not yet expired, and not revoked. Any doubt means inactive. */
export function isGateActive(gate: unknown, nowMs: number): boolean {
  if (validateGateRecord(gate).length > 0) return false;
  const g = gate as LaunchGate;
  const approved = parseGateDate(g.approvedAt) as number;
  const expires = parseGateDate(g.expiresAt) as number;
  if (g.revokedAt != null && (parseGateDate(g.revokedAt) as number) <= nowMs) return false;
  return approved <= nowMs && nowMs < expires;
}

export function findActiveGate(route: AiRouteId, gates: readonly unknown[], nowMs: number): LaunchGate | null {
  const hit = gates.find((g) => isObject(g) && g.route === route && isGateActive(g, nowMs));
  return (hit as LaunchGate | undefined) ?? null;
}

/** Production = VERCEL_ENV production; with no VERCEL_ENV (not on Vercel), NODE_ENV production. Preview builds run NODE_ENV=production, so NODE_ENV alone is not enough. */
export function isProductionEnv(env: Env = process.env): boolean {
  return env.VERCEL_ENV ? env.VERCEL_ENV === 'production' : env.NODE_ENV === 'production';
}

/** Preview and dev may bypass the gate with AI_POLICY_ALLOW_UNGATED_PREVIEW=true. The bypass is ignored in Production. */
export function isUngatedPreviewAllowed(env: Env = process.env): boolean {
  return !isProductionEnv(env) && env.AI_POLICY_ALLOW_UNGATED_PREVIEW === 'true';
}

export function hasLaunchGate(route: AiRouteId, env: Env, gates: readonly unknown[] = LAUNCH_GATES, nowMs: number = Date.now()): boolean {
  return isUngatedPreviewAllowed(env) || findActiveGate(route, gates, nowMs) !== null;
}

/** Where the markdown record for a gate lives (checked by the registry test for every approved entry). */
export const gateRecordPath = (gate: Pick<LaunchGate, 'id'>): string => `docs/ai-policy/launch-gates/${gate.id}.md`;
