// lib/discovery/qv/__tests__/qvFixtures.ts

// LEAPS-QV-0001 Gate 3 -- test scaffolding: a healthy, fully-evidenced QV candidate whose single fields are overridden per test.
// Metric ids come from the policy so a renamed contract id fails loudly rather than silently testing nothing.

import { createStrategyInput, invalidMetric, runStrategy, staleMetric, unavailableMetric, validMetric } from '../..';
import type { CandidateState, NormalizedMetric, StrategyEvaluation, StrategyInput } from '../..';
import { createQvStrategyFor, QV_V1_0_POLICY } from '..';

export const ASOF = '2026-10-03T14:00:00.000Z';
const IN = QV_V1_0_POLICY.inputs;

export type Field =
  | 'margin' | 'revenueCagr' | 'fcf' | 'roic' | 'leverage' | 'fcfHistory'
  | 'pe' | 'percentile5y' | 'percentile3y' | 'discount5y' | 'discount3y'
  | 'revenueGrowth' | 'revenueTrend' | 'epsGrowth' | 'epsTrend' | 'marginChange'
  | 'weeklyRsi' | 'weeklyRsiChange' | 'price' | 'sma50' | 'sma200' | 'sma200Trend' | 'relativeStrength'
  | 'daysToEarnings' | 'eventFlags';

const ID: Record<Field, string> = {
  margin: IN.quality.operatingMargin, revenueCagr: IN.quality.revenueCagr, fcf: IN.quality.fcf, roic: IN.quality.roic,
  leverage: IN.quality.leverage, fcfHistory: IN.quality.fcfHistory,
  pe: IN.valuation.pe, percentile5y: IN.valuation.percentile5y, percentile3y: IN.valuation.percentile3y,
  discount5y: IN.valuation.discount5y, discount3y: IN.valuation.discount3y,
  revenueGrowth: IN.fundamentals.revenueGrowth, revenueTrend: IN.fundamentals.revenueTrend, epsGrowth: IN.fundamentals.epsGrowth,
  epsTrend: IN.fundamentals.epsTrend, marginChange: IN.fundamentals.marginChange,
  weeklyRsi: IN.technical.weeklyRsi, weeklyRsiChange: IN.technical.weeklyRsiChange, price: IN.technical.price,
  sma50: IN.technical.sma50, sma200: IN.technical.sma200, sma200Trend: IN.technical.sma200Trend,
  relativeStrength: IN.technical.relativeStrength,
  daysToEarnings: IN.risk.daysToEarnings, eventFlags: IN.risk.eventFlags,
};

// NOTE: 'revenueTrend' and 'revenueCagr' are the SAME metric (revenue_cagr_5y_pct), so the base sets it once via revenueCagr.
/** Healthy base: Quality PASS, STRONG dislocation, fundamentals intact, technical RECOVERING, no event risk. */
const BASE: Partial<Record<Field, number | number[] | string[]>> = {
  margin: 20, revenueCagr: 8, fcf: 1_000_000_000, roic: 18, leverage: 0.5,
  pe: 12, percentile5y: 15, discount5y: 25,
  revenueGrowth: 6, epsGrowth: 4, epsTrend: 5, marginChange: 0,
  weeklyRsi: 45, weeklyRsiChange: 2, price: 100, sma50: 95, sma200: 90, sma200Trend: 1, relativeStrength: 3,
  daysToEarnings: 40, eventFlags: [],
};

export type Override = number | number[] | string[] | NormalizedMetric | null;

export function metricsWith(overrides: Partial<Record<Field, Override>> = {}): Record<string, NormalizedMetric> {
  const merged: Partial<Record<Field, Override>> = { ...BASE, ...overrides };
  const out: Record<string, NormalizedMetric> = {};
  (Object.keys(merged) as Field[]).forEach((field) => {
    const value = merged[field];
    if (value === null || value === undefined) return; // absent -> UNAVAILABLE by contract
    out[ID[field]] = typeof value === 'object' && !Array.isArray(value) ? (value as NormalizedMetric) : validMetric(ID[field], value as number, ASOF);
  });
  return out;
}

export function inputWith(overrides: Partial<Record<Field, Override>> = {}, extra: NormalizedMetric[] = []): StrategyInput {
  const metrics = metricsWith(overrides);
  extra.forEach((metric) => (metrics[metric.id] = metric));
  return createStrategyInput({ symbol: 'ABC', asOf: ASOF, underlyingPrice: validMetric('underlying_price', 100, ASOF), metrics });
}

export const unavailable = (field: Field): NormalizedMetric => unavailableMetric(ID[field], 'TEST');
export const stale = (field: Field, value = 1): NormalizedMetric => staleMetric(ID[field], value, ASOF, 10, 5);
export const invalid = (field: Field): NormalizedMetric => invalidMetric(ID[field], 'x', 'TEST');
export const idOf = (field: Field): string => ID[field];

export function evaluate(overrides: Partial<Record<Field, Override>> = {}, previous: CandidateState | null = null, extra: NormalizedMetric[] = []): StrategyEvaluation {
  return runStrategy(createQvStrategyFor(previous), inputWith(overrides, extra));
}

export function stateOf(evaluation: StrategyEvaluation): string {
  return evaluation.outcome.kind === 'CLASSIFIED' ? evaluation.outcome.state : 'INSUFFICIENT_DATA';
}

export const codesOf = (evaluation: StrategyEvaluation): string[] => evaluation.reasonCodes.map((reason) => reason.code);

// Technical presets
export const STABILIZING_TECH: Partial<Record<Field, Override>> = { weeklyRsiChange: 0 };
export const OVERSOLD_TECH: Partial<Record<Field, Override>> = { weeklyRsi: 25, weeklyRsiChange: -2 };
export const DECLINING_TECH: Partial<Record<Field, Override>> = { weeklyRsi: 40, weeklyRsiChange: -2, price: 80 };
export const THREE_DETERIORATING: Partial<Record<Field, Override>> = { revenueGrowth: -5, epsGrowth: -10, marginChange: -3 };
