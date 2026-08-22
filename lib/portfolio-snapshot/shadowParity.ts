import type { CoveredCallCapacityReport as LegacyCapacityReport } from '@/lib/scans/covered-call-capacity';
import { buildSnapshotCapacityReport, type CoveredCallCapacity, type SnapshotCapacityReport } from './capacity';
import type { PortfolioSnapshot } from './types';

export const CC_CAPACITY_SHADOW_EVENT = 'lcc0001a.covered_call_capacity_shadow';

export function isCcCapacityShadowEnabled(
  value = process.env.NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED,
): boolean {
  return value === 'true';
}

export type CapacityField = keyof Pick<CoveredCallCapacity,
  | 'sharesOwned'
  | 'costBasis'
  | 'costBasisComplete'
  | 'grossCoveredContracts'
  | 'existingShortCallContracts'
  | 'workingShortCallContracts'
  | 'availableCoveredContracts'
  | 'oversubscribed'
  | 'hasUnclassifiedExposure'
>;

const CAPACITY_FIELDS: CapacityField[] = [
  'sharesOwned',
  'costBasis',
  'costBasisComplete',
  'grossCoveredContracts',
  'existingShortCallContracts',
  'workingShortCallContracts',
  'availableCoveredContracts',
  'oversubscribed',
  'hasUnclassifiedExposure',
];

export type CapacityShadowDifference =
  | { kind: 'status'; legacy: LegacyCapacityReport['status']; snapshot: SnapshotCapacityReport['status'] }
  | { kind: 'symbol-only'; symbol: string; side: 'legacy' | 'snapshot' }
  | { kind: 'field'; symbol: string; field: CapacityField; legacy: number | boolean | null; snapshot: number | boolean | null }
  | { kind: 'warnings'; legacy: string[]; snapshot: string[] }
  | { kind: 'unavailableReason'; legacy: string | null; snapshot: string | null };

export type CapacityShadowSkipReason =
  | 'snapshot-missing'
  | 'snapshot-last-known'
  | 'snapshot-unavailable'
  | 'snapshot-capacity-unavailable';

interface CapacityShadowBase {
  comparedAt: string;
  snapshotAsOf: string | null;
  snapshotFreshness: PortfolioSnapshot['freshness'] | null;
}

export type CapacityShadowResult =
  | (CapacityShadowBase & { outcome: 'skipped'; reason: CapacityShadowSkipReason; differences: [] })
  | (CapacityShadowBase & { outcome: 'parity' | 'difference'; differences: CapacityShadowDifference[] });

export type CapacityShadowLogger = (event: typeof CC_CAPACITY_SHADOW_EVENT, result: CapacityShadowResult) => void;

function redact(value: string, accountNumber: string | null): string {
  if (!accountNumber) return value.trim();
  return value.split(accountNumber).join('[REDACTED_ACCOUNT]').trim();
}

function normalizeWarnings(values: string[], accountNumber: string | null): string[] {
  return Array.from(new Set(values.map(value => redact(value, accountNumber)).filter(Boolean))).sort();
}

function normalizeReason(value: string | undefined, accountNumber: string | null): string | null {
  if (!value) return null;
  return redact(value, accountNumber) || null;
}

function valuesEqual(left: number | boolean | null, right: number | boolean | null): boolean {
  return Object.is(left, right);
}

export function compareCoveredCallCapacityShadow(
  legacy: LegacyCapacityReport,
  snapshot: PortfolioSnapshot | null,
  comparedAt = new Date().toISOString(),
): CapacityShadowResult {
  const base: CapacityShadowBase = {
    comparedAt,
    snapshotAsOf: snapshot?.asOf ?? null,
    snapshotFreshness: snapshot?.freshness ?? null,
  };

  if (!snapshot) {
    return { ...base, outcome: 'skipped', reason: 'snapshot-missing', differences: [] };
  }
  if (snapshot.freshness !== 'current') {
    return { ...base, outcome: 'skipped', reason: 'snapshot-last-known', differences: [] };
  }
  if (snapshot.dataQuality.status !== 'ok' || !snapshot.coverageEvidence.complete) {
    return { ...base, outcome: 'skipped', reason: 'snapshot-unavailable', differences: [] };
  }

  const snapshotReport = buildSnapshotCapacityReport(snapshot);
  if (snapshotReport.status !== 'ok') {
    return { ...base, outcome: 'skipped', reason: 'snapshot-capacity-unavailable', differences: [] };
  }

  const differences: CapacityShadowDifference[] = [];
  if (legacy.status !== snapshotReport.status) {
    differences.push({ kind: 'status', legacy: legacy.status, snapshot: snapshotReport.status });
  }

  const symbols = Array.from(new Set([
    ...Object.keys(legacy.bySymbol),
    ...Object.keys(snapshotReport.bySymbol),
  ])).sort();

  for (const symbol of symbols) {
    const legacyCapacity = legacy.bySymbol[symbol];
    const snapshotCapacity = snapshotReport.bySymbol[symbol];
    if (!legacyCapacity) {
      differences.push({ kind: 'symbol-only', symbol, side: 'snapshot' });
      continue;
    }
    if (!snapshotCapacity) {
      differences.push({ kind: 'symbol-only', symbol, side: 'legacy' });
      continue;
    }
    for (const field of CAPACITY_FIELDS) {
      if (!valuesEqual(legacyCapacity[field], snapshotCapacity[field])) {
        differences.push({
          kind: 'field',
          symbol,
          field,
          legacy: legacyCapacity[field],
          snapshot: snapshotCapacity[field],
        });
      }
    }
  }

  const accountNumber = snapshot.accountNumber;
  const legacyWarnings = normalizeWarnings(legacy.warnings, accountNumber);
  const snapshotWarnings = normalizeWarnings(snapshotReport.warnings, accountNumber);
  if (JSON.stringify(legacyWarnings) !== JSON.stringify(snapshotWarnings)) {
    differences.push({ kind: 'warnings', legacy: legacyWarnings, snapshot: snapshotWarnings });
  }

  const legacyReason = normalizeReason(legacy.unavailableReason, accountNumber);
  const snapshotReason = normalizeReason(snapshotReport.unavailableReason, accountNumber);
  if (legacyReason !== snapshotReason) {
    differences.push({ kind: 'unavailableReason', legacy: legacyReason, snapshot: snapshotReason });
  }

  return {
    ...base,
    outcome: differences.length === 0 ? 'parity' : 'difference',
    differences,
  };
}

export function emitCoveredCallCapacityShadow(
  legacy: LegacyCapacityReport,
  snapshot: PortfolioSnapshot | null,
  logger: CapacityShadowLogger = (event, result) => console.info(event, result),
  comparedAt?: string,
): CapacityShadowResult | null {
  try {
    const result = compareCoveredCallCapacityShadow(legacy, snapshot, comparedAt);
    logger(CC_CAPACITY_SHADOW_EVENT, result);
    return result;
  } catch {
    // Shadow instrumentation is best-effort and must never affect the authoritative workflow.
    return null;
  }
}
