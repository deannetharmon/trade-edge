// lib/discovery/qv/assembleInput.ts

// LEAPS-QV-0001 -- Gate 3 input builder, pure assembly (spec docs/analysis/LEAPS-QV-0001-strategy-input-assembler.md).
// Joins the three normalized sources into one QV-v1.0 StrategyInput: the SEC metrics and the Yahoo technicals from
// /api/fundamentals, and the TastyTrade market-metrics item (earnings date). No I/O and no clock: the caller fetches and
// passes `asOf`, read once after all fetches. Nothing is defaulted: a failed source contributes its ids as UNAVAILABLE
// with a named reason, an id no source produces is UNAVAILABLE `NO_PROVIDER`, and an id produced by two sources is a
// contract error (never "last one wins").

import { createStrategyInput, type StrategyInput } from '../evaluation';
import { unavailableMetric, type MetricSet, type NormalizedMetric } from '../metrics';
import { buildMarketMetrics, VOLATILITY_EVENT_METRIC_IDS } from '../normalized';
import { QV_V1_0_POLICY } from './policy';

/** Every metric id QV-v1.0 reads, from its policy inputs (the single place the classifiers take ids from). */
export function qvRequiredMetricIds(): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string') { if (out.indexOf(value) < 0) out.push(value); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') Object.keys(value).forEach((k) => visit((value as Record<string, unknown>)[k]));
  };
  visit(QV_V1_0_POLICY.inputs);
  return out.sort();
}

/** Ids no provider produces in QV-v1.0 (Gate 3 A6 events; Section 15 analyst revisions). */
export const QV_NO_PROVIDER_METRIC_IDS: readonly string[] = [
  'analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d', 'corporate_event_flags',
];

/** What /api/fundamentals returned for one symbol: the payload, or why it is unusable. */
export type FundamentalsSource =
  | { ok: true; metrics: MetricSet; technicals: MetricSet; issues: string[] }
  | { ok: false; reason: string };

/** The symbol's TastyTrade /market-metrics item, or why it is unusable. */
export type MarketMetricsSource = { ok: true; item: Record<string, unknown> } | { ok: false; reason: string };

/** Ids each source is responsible for when it fails (so their absence is named, not silent). */
export const FUNDAMENTALS_SOURCE_IDS = (): string[] =>
  qvRequiredMetricIds().filter((id) => VOLATILITY_EVENT_METRIC_IDS.indexOf(id) < 0 && QV_NO_PROVIDER_METRIC_IDS.indexOf(id) < 0);

export class QvAssemblyContractError extends Error {}

export interface AssembledQvInput {
  input: StrategyInput;
  /** Source-level problems, e.g. FUNDAMENTALS_HTTP_502, PRICE_FETCH_FAILED, MARKET_METRICS_UNAVAILABLE. */
  sourceIssues: string[];
}

export function assembleQvStrategyInput(args: {
  symbol: string;
  asOf: string;
  fundamentals: FundamentalsSource;
  marketMetrics: MarketMetricsSource;
}): AssembledQvInput {
  const merged: Record<string, NormalizedMetric> = {};
  const owner: Record<string, string> = {};
  const add = (source: string, set: MetricSet) => {
    Object.keys(set).forEach((id) => {
      if (owner[id] !== undefined) throw new QvAssemblyContractError(`Metric "${id}" is produced by both ${owner[id]} and ${source}.`);
      owner[id] = source;
      merged[id] = set[id];
    });
  };
  const sourceIssues: string[] = [];

  if (args.fundamentals.ok) {
    add('SEC', args.fundamentals.metrics);
    add('TECHNICALS', args.fundamentals.technicals);
    args.fundamentals.issues.forEach((issue) => sourceIssues.push(issue));
  } else {
    sourceIssues.push(args.fundamentals.reason);
    const failed: Record<string, NormalizedMetric> = {};
    FUNDAMENTALS_SOURCE_IDS().forEach((id) => { failed[id] = unavailableMetric(id, args.fundamentals.ok ? 'UNKNOWN' : args.fundamentals.reason); });
    add('FUNDAMENTALS', failed);
  }

  if (args.marketMetrics.ok) {
    const item = args.marketMetrics.item;
    const earnings = item.earnings as Record<string, unknown> | undefined;
    const payloadAsOf = (typeof item['updated-at'] === 'string' ? item['updated-at'] : typeof earnings?.['updated-at'] === 'string' ? earnings['updated-at'] : null) as string | null;
    add('MARKET_METRICS', buildMarketMetrics(item, { now: args.asOf, payloadAsOf }));
  } else {
    sourceIssues.push(args.marketMetrics.reason);
    const failed: Record<string, NormalizedMetric> = {};
    VOLATILITY_EVENT_METRIC_IDS.forEach((id) => { failed[id] = unavailableMetric(id, args.marketMetrics.ok ? 'UNKNOWN' : args.marketMetrics.reason); });
    add('MARKET_METRICS', failed);
  }

  qvRequiredMetricIds().forEach((id) => {
    if (!merged[id]) merged[id] = unavailableMetric(id, QV_NO_PROVIDER_METRIC_IDS.indexOf(id) >= 0 ? 'NO_PROVIDER' : 'NOT_PRODUCED_BY_ANY_SOURCE');
  });

  const price = merged.price_last_close ?? unavailableMetric('price_last_close', 'NOT_PRODUCED_BY_ANY_SOURCE');
  const underlyingPrice = (price.validity === 'VALID' ? price : unavailableMetric('price_last_close', `PRICE_${price.validity}`)) as NormalizedMetric<number>;
  return { input: createStrategyInput({ symbol: args.symbol, asOf: args.asOf, underlyingPrice, metrics: merged }), sourceIssues };
}
