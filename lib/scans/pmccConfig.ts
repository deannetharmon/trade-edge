import type { PmccDeltaRange, PmccPairingLimits, PmccQuotePolicy, PmccScanSnapshot } from './pmccTypes';
import { isValidPmccDteRanges } from './pmccDteRanges';

export const DEFAULT_PMCC_LONG_DELTA_RANGE: PmccDeltaRange = {
  min: 0.70,
  max: 0.85,
};

export const DEFAULT_PMCC_SHORT_DELTA_RANGE: PmccDeltaRange = {
  min: 0.20,
  max: 0.30,
};

export const PMCC_LONG_DELTA_BOUNDS: PmccDeltaRange = {
  min: 0.65,
  max: 0.90,
};

export const PMCC_SHORT_DELTA_BOUNDS: PmccDeltaRange = {
  min: 0.10,
  max: 0.40,
};

export const DEFAULT_PMCC_LONG_OI_MIN = 100;
export const DEFAULT_PMCC_SHORT_OI_MIN = 100;

export const DEFAULT_PMCC_QUOTE_POLICY: PmccQuotePolicy = {
  acceptableSpreadPctMax: 5,
  qualifyingSpreadPctMax: 10,
  readyQuoteAgeSecondsMax: 120,
};

export const DEFAULT_PMCC_PAIRING_LIMITS: PmccPairingLimits = {
  maxCombinationsEvaluated: 25_000,
  maxQualifiedPairsRetained: 10,
  maxNearMissPairsRetained: 10,
};

export function isValidPmccDeltaRange(
  range: PmccDeltaRange,
  bounds: PmccDeltaRange,
): boolean {
  return Number.isFinite(range.min)
    && Number.isFinite(range.max)
    && range.min >= bounds.min
    && range.max <= bounds.max
    && range.min <= range.max;
}

export function isValidPmccPairingLimits(limits: PmccPairingLimits): boolean {
  return Number.isInteger(limits.maxCombinationsEvaluated)
    && limits.maxCombinationsEvaluated > 0
    && Number.isInteger(limits.maxQualifiedPairsRetained)
    && limits.maxQualifiedPairsRetained > 0
    && Number.isInteger(limits.maxNearMissPairsRetained)
    && limits.maxNearMissPairsRetained > 0;
}

export function isValidPmccQuotePolicy(value: unknown): value is PmccQuotePolicy {
  if (value == null || typeof value !== 'object') return false;
  const policy = value as PmccQuotePolicy;
  return Number.isFinite(policy.acceptableSpreadPctMax)
    && policy.acceptableSpreadPctMax >= 0
    && Number.isFinite(policy.qualifyingSpreadPctMax)
    && policy.qualifyingSpreadPctMax >= policy.acceptableSpreadPctMax
    && Number.isFinite(policy.readyQuoteAgeSecondsMax)
    && policy.readyQuoteAgeSecondsMax > 0;
}

export function isValidPmccScanSnapshot(value: unknown): value is PmccScanSnapshot {
  if (value == null || typeof value !== 'object') return false;
  const snapshot = value as PmccScanSnapshot;
  const criteria = snapshot.criteria;
  const sessions = new Set(['open', 'closed', 'pre_market', 'after_hours', 'unknown']);
  return typeof snapshot.asOf === 'string'
    && Number.isFinite(Date.parse(snapshot.asOf))
    && sessions.has(snapshot.marketSession)
    && criteria != null
    && isValidPmccDteRanges(criteria.dte)
    && isValidPmccDeltaRange(criteria.longDelta, PMCC_LONG_DELTA_BOUNDS)
    && isValidPmccDeltaRange(criteria.shortDelta, PMCC_SHORT_DELTA_BOUNDS)
    && Number.isInteger(criteria.longOiMin) && criteria.longOiMin >= 0
    && Number.isInteger(criteria.shortOiMin) && criteria.shortOiMin >= 0
    && typeof criteria.requireDebitBelowWidth === 'boolean'
    && isValidPmccQuotePolicy(criteria.quotePolicy)
    && isValidPmccPairingLimits(criteria.limits);
}
