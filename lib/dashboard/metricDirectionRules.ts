// lib/dashboard/metricDirectionRules.ts
//
// TELEMETRY-METRIC-DIRECTION-0001 -- one declarative source for whether a
// metric's movement helps or hurts a position, replacing scattered
// per-cell conditionals. Same shape as driftEngine.ts / oiLiquidity.ts /
// expectedMove.ts tonight: a small, pure, directly-testable function,
// not logic re-derived in multiple places.
//
// Full reasoning for each rule lives in the ticket
// (TELEMETRY-METRIC-DIRECTION-0001.md) -- summary:
// - P/L: universal, strategy-independent.
// - Theta: universal, no strategy classification needed. Broker-reported
//   sign (brokerGreeks.theta, see lib/portfolio-data/acquisition.ts)
//   already encodes credit vs. debit -- negative = long/debit (decay
//   hurts), positive = short/credit (decay helps) -- so comparing the
//   value directly sidesteps mixed-strategy cases like PMCC entirely.
// - Gamma: universal risk metric, rising is worse for every position.
// - Delta (main row, net position), Vega, IV/IVR: deliberately neutral.
//   Not placeholders -- confirmed final with Dean. Forcing a verdict on
//   these would be a rule the team can't actually stand behind.
// - Short-leg Delta: NOT handled here -- reuses OptionsTelemetryCard's
//   existing, already-correct 0.40/0.50 threshold badge logic directly.
//   Not duplicated as a second rule.

export type MetricKey = 'plNow' | 'thetaNow' | 'gammaNow';
export type MetricVerdict = 'improving' | 'worsening' | 'neutral';

const UNIVERSAL_HIGHER_IS_BETTER: ReadonlySet<MetricKey> = new Set<MetricKey>(['plNow', 'thetaNow']);
const UNIVERSAL_LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set<MetricKey>(['gammaNow']);

/**
 * Returns whether a metric moving from `previous` to `current` is
 * improving, worsening, or exactly unchanged. Only call this for the
 * three metrics with a real universal rule (plNow, thetaNow, gammaNow) --
 * everything else (main-row delta, vega, IV/IVR) is intentionally neutral
 * and has no verdict function; render those with the existing neutral
 * sky-blue styling directly, don't call this for them.
 */
export function getMetricVerdict(metric: MetricKey, previous: number, current: number): MetricVerdict {
  if (current === previous) return 'neutral';
  if (UNIVERSAL_HIGHER_IS_BETTER.has(metric)) return current > previous ? 'improving' : 'worsening';
  if (UNIVERSAL_LOWER_IS_BETTER.has(metric)) return current < previous ? 'improving' : 'worsening';
  return 'neutral';
}

export const VERDICT_COLOR_CLASS: Record<MetricVerdict, string> = {
  improving: 'text-emerald-400',
  worsening: 'text-rose-400',
  neutral: 'text-sky-400',
};
