import type { PmccPairResult, PmccPairingCriteria } from './pmccTypes';

export const PMCC_LONG_EXIT_BUFFER_DAYS = 60;
export const PMCC_NEAR_DELTA_TOLERANCE = 0.03;
export const PMCC_NEAR_DTE_TOLERANCE_DAYS = 7;
export const PMCC_DECISION_FORMULA_VERSION = 'pmcc-decision-card-v1';

export type PmccTargetStatus = 'target_match' | 'near_target' | 'outside_target' | 'unavailable';

export interface PmccDecisionCardMetrics {
  formulaVersion: typeof PMCC_DECISION_FORMULA_VERSION;
  shareCost: number | null;
  longCallCost: number;
  currentCycleCredit: number;
  initialNetDebit: number | null;
  cashOutlayReduction: number | null;
  cashOutlayReductionPct: number | null;
  currentCycleCreditPct: number | null;
  targetStatus: PmccTargetStatus;
  cycleExpirations: string[];
  totalCycles: number;
  futureRolls: number;
  longExitBufferDays: number;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function nearRange(value: number, min: number, max: number, tolerance: number): boolean {
  return value >= min - tolerance && value <= max + tolerance;
}

export function pmccTargetStatus(
  pair: PmccPairResult,
  criteria: PmccPairingCriteria | null | undefined,
): PmccTargetStatus {
  if (!criteria || !Number.isFinite(pair.shortLeg.delta) || !Number.isFinite(pair.shortLeg.dte)) return 'unavailable';
  const deltaMatch = inRange(pair.shortLeg.delta, criteria.shortDelta.min, criteria.shortDelta.max);
  const dteMatch = inRange(pair.shortLeg.dte, criteria.dte.shortMin, criteria.dte.shortMax);
  if (deltaMatch && dteMatch) return 'target_match';
  const deltaNear = nearRange(pair.shortLeg.delta, criteria.shortDelta.min, criteria.shortDelta.max, PMCC_NEAR_DELTA_TOLERANCE);
  const dteNear = nearRange(pair.shortLeg.dte, criteria.dte.shortMin, criteria.dte.shortMax, PMCC_NEAR_DTE_TOLERANCE_DAYS);
  return deltaNear && dteNear ? 'near_target' : 'outside_target';
}

function utcDay(value: string): number | null {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : null;
}

/**
 * Counts actual listed expirations, anchored by the selected initial short
 * call. Each later cycle must be separated by the scan's configured short-DTE
 * window and must expire before the long-call exit buffer begins.
 */
export function pmccCycleExpirations(args: {
  initialExpiration: string;
  longExpiration: string;
  availableExpirations: string[];
  shortDteMin: number;
  shortDteMax: number;
  longExitBufferDays?: number;
}): string[] {
  const initialDay = utcDay(args.initialExpiration);
  const longDay = utcDay(args.longExpiration);
  const buffer = args.longExitBufferDays ?? PMCC_LONG_EXIT_BUFFER_DAYS;
  if (initialDay == null || longDay == null || args.shortDteMin < 0 || args.shortDteMax < args.shortDteMin) return [];
  const cutoff = longDay - buffer;
  if (initialDay > cutoff) return [];
  const days = Array.from(new Set([args.initialExpiration, ...args.availableExpirations]))
    .map(expiration => ({ expiration, day: utcDay(expiration) }))
    .filter((item): item is { expiration: string; day: number } => item.day != null && item.day >= initialDay && item.day <= cutoff)
    .sort((a, b) => a.day - b.day);
  const selected = [args.initialExpiration];
  let anchor = initialDay;
  while (true) {
    const next = days.find(item => item.day >= anchor + args.shortDteMin && item.day <= anchor + args.shortDteMax);
    if (!next) break;
    selected.push(next.expiration);
    anchor = next.day;
  }
  return selected;
}

export function buildPmccDecisionCardMetrics(args: {
  pair: PmccPairResult;
  underlyingPrice: number | null;
  criteria?: PmccPairingCriteria | null;
  availableCycleExpirations?: string[];
}): PmccDecisionCardMetrics {
  const { pair, underlyingPrice, criteria } = args;
  const multiplier = 100;
  const shareCost = underlyingPrice != null && Number.isFinite(underlyingPrice) && underlyingPrice > 0
    ? underlyingPrice * multiplier
    : null;
  const longCallCost = pair.longLeg.executablePrice * multiplier;
  const currentCycleCredit = pair.shortLeg.executablePrice * multiplier;
  const initialNetDebit = pair.metrics ? pair.metrics.netDebitPerShare * multiplier : null;
  const cashOutlayReduction = shareCost != null && initialNetDebit != null ? shareCost - initialNetDebit : null;
  const cashOutlayReductionPct = cashOutlayReduction != null && shareCost
    ? (cashOutlayReduction / shareCost) * 100
    : null;
  const currentCycleCreditPct = initialNetDebit != null && initialNetDebit > 0
    ? (currentCycleCredit / initialNetDebit) * 100
    : null;
  const cycleExpirations = criteria ? pmccCycleExpirations({
    initialExpiration: pair.shortLeg.expiration,
    longExpiration: pair.longLeg.expiration,
    availableExpirations: args.availableCycleExpirations ?? [],
    shortDteMin: criteria.dte.shortMin,
    shortDteMax: criteria.dte.shortMax,
  }) : [];
  return {
    formulaVersion: PMCC_DECISION_FORMULA_VERSION,
    shareCost,
    longCallCost,
    currentCycleCredit,
    initialNetDebit,
    cashOutlayReduction,
    cashOutlayReductionPct,
    currentCycleCreditPct,
    targetStatus: pmccTargetStatus(pair, criteria),
    cycleExpirations,
    totalCycles: cycleExpirations.length,
    futureRolls: Math.max(0, cycleExpirations.length - 1),
    longExitBufferDays: PMCC_LONG_EXIT_BUFFER_DAYS,
  };
}
