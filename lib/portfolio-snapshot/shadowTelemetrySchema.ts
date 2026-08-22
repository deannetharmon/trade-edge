import type { CapacityShadowDifference, CapacityShadowResult } from './shadowParity';

export const CC_CAPACITY_SHADOW_MAX_BYTES = 32_768;
export const CC_CAPACITY_SHADOW_MAX_DIFFERENCES = 100;
export const CC_CAPACITY_SHADOW_RECENT_LIMIT = 500;
export const CC_CAPACITY_SHADOW_RETENTION_SECONDS = 60 * 60 * 24 * 90;

const CAPACITY_FIELDS = new Set([
  'sharesOwned', 'costBasis', 'costBasisComplete', 'grossCoveredContracts',
  'existingShortCallContracts', 'workingShortCallContracts', 'availableCoveredContracts',
  'oversubscribed', 'hasUnclassifiedExposure',
]);
const SKIP_REASONS = new Set([
  'snapshot-missing', 'snapshot-last-known', 'snapshot-unavailable', 'snapshot-capacity-unavailable',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(new Date(value).getTime());
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isShortString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9.^/-]{1,32}$/.test(value);
}

function isScalar(value: unknown): value is number | boolean | null {
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 50 && value.every(item => isShortString(item));
}

function isDifference(value: unknown): value is CapacityShadowDifference {
  if (!isObject(value) || !isShortString(value.kind, 32)) return false;
  switch (value.kind) {
    case 'status':
      return hasOnlyKeys(value, ['kind', 'legacy', 'snapshot'])
        && (value.legacy === 'ok' || value.legacy === 'unavailable')
        && (value.snapshot === 'ok' || value.snapshot === 'unavailable');
    case 'symbol-only':
      return hasOnlyKeys(value, ['kind', 'symbol', 'side'])
        && isSymbol(value.symbol)
        && (value.side === 'legacy' || value.side === 'snapshot');
    case 'field':
      return hasOnlyKeys(value, ['kind', 'symbol', 'field', 'legacy', 'snapshot'])
        && isSymbol(value.symbol)
        && typeof value.field === 'string'
        && CAPACITY_FIELDS.has(value.field)
        && isScalar(value.legacy)
        && isScalar(value.snapshot);
    case 'warnings':
      return hasOnlyKeys(value, ['kind', 'legacy', 'snapshot'])
        && isStringList(value.legacy)
        && isStringList(value.snapshot);
    case 'unavailableReason':
      return hasOnlyKeys(value, ['kind', 'legacy', 'snapshot'])
        && (value.legacy === null || isShortString(value.legacy))
        && (value.snapshot === null || isShortString(value.snapshot));
    default:
      return false;
  }
}

export function parseCapacityShadowTelemetry(value: unknown): CapacityShadowResult | null {
  if (!isObject(value)) return null;
  const baseKeys = ['outcome', 'comparedAt', 'snapshotAsOf', 'snapshotFreshness', 'differences'];
  const outcome = value.outcome;
  if (outcome !== 'parity' && outcome !== 'difference' && outcome !== 'skipped') return null;
  const allowed = outcome === 'skipped' ? [...baseKeys, 'reason'] : baseKeys;
  if (!hasOnlyKeys(value, allowed)) return null;
  if (!isTimestamp(value.comparedAt) || !isNullableTimestamp(value.snapshotAsOf)) return null;
  if (value.snapshotFreshness !== null && value.snapshotFreshness !== 'current' && value.snapshotFreshness !== 'last-known') return null;
  if (!Array.isArray(value.differences) || value.differences.length > CC_CAPACITY_SHADOW_MAX_DIFFERENCES) return null;
  if (!value.differences.every(isDifference)) return null;
  if (outcome === 'parity' && value.differences.length !== 0) return null;
  if (outcome === 'difference' && value.differences.length === 0) return null;
  if (outcome === 'skipped') {
    if (typeof value.reason !== 'string' || !SKIP_REASONS.has(value.reason) || value.differences.length !== 0) return null;
  }
  return value as unknown as CapacityShadowResult;
}
