// lib/fundamentals/secFundamentals.ts

// LEAPS-QV-0001 Gate 2b -- loads SEC facts for a ticker and runs the pure normalized builder. Coverage semantics:
// a security SEC does not cover (no ticker match, no companyfacts, no us-gaap XBRL) is NOT_COVERED -- every metric
// UNAVAILABLE, never an investment failure. A provider failure is PROVIDER_FAILURE and is reported as such.

import { buildSecFundamentals, unavailableSecFundamentals } from '@/lib/discovery/normalized/sec';
import type { SecFundamentalsResult } from '@/lib/discovery/normalized/sec';
import { buildTechnicalMetrics } from '@/lib/discovery/normalized/technicals';
import type { DailyBar } from '@/lib/discovery/normalized/technicals';
import { SEC_CONCEPT_MAP_VERSION } from '@/lib/discovery/normalized/sec/conceptMap';
import type { MetricSet } from '@/lib/discovery/metrics';
import { SecProviderError } from './sec/client';
import type { SecClient } from './sec/client';

export type Coverage = 'COVERED' | 'NOT_COVERED' | 'PROVIDER_FAILURE' | 'INSUFFICIENT_FACTS';

export interface LoadedFundamentals {
  readonly symbol: string;
  readonly cik: string | null;
  readonly coverage: Coverage;
  readonly reason: string | null;
  readonly conceptMapVersion: string;
  readonly metrics: MetricSet;
  readonly provenance: SecFundamentalsResult['provenance'];
  readonly annualSeries: SecFundamentalsResult['annualSeries'];
  readonly diagnostics: SecFundamentalsResult['diagnostics'] | null;
  /** Why the price history was not usable (null when it was). */
  readonly priceIssue: string | null;
  /** Gate 2c: why the SPY benchmark was not usable (null when it was) and whether the exchange calendar could not decide. */
  readonly benchmarkIssue: string | null;
  readonly calendarIssue: string | null;
  readonly benchmarkCalendarIssue: string | null;
  /**
   * Gate 2c: Yahoo-derived technical metrics (always present, independent of SEC coverage): built from completed bars only.
   * An unusable stock history makes every one UNAVAILABLE; an unusable SPY history only the benchmark-derived ones.
   */
  readonly technicals: MetricSet;
}

const SYMBOL_PATTERN = /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/;

/** Upper-cases and maps class-share dots to SEC's dash form (BRK.B -> BRK-B). Null when not a plain equity ticker. */
export function normalizeTicker(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(upper)) return null;
  return upper.replace('.', '-');
}

function technicalsOf(deps: LoadDeps, now: string): MetricSet {
  return buildTechnicalMetrics(
    deps.closes,
    {
      now,
      provider: 'yahoo',
      priceBasis: deps.priceBasis,
      benchmarkBasis: deps.benchmarkBasis,
      benchmarkUnavailableReason: deps.benchmarkIssue || null,
      calendarUnavailable: !!deps.calendarIssue,
      benchmarkCalendarUnavailable: !!deps.benchmarkCalendarIssue,
    },
    deps.benchmark || null,
  );
}

function failure(symbol: string, cik: string | null, coverage: Coverage, reason: string, deps: LoadDeps): LoadedFundamentals {
  const priceIssue = deps.priceIssue;
  return {
    symbol,
    cik,
    coverage,
    reason,
    conceptMapVersion: SEC_CONCEPT_MAP_VERSION,
    metrics: unavailableSecFundamentals(reason),
    provenance: {},
    annualSeries: [],
    diagnostics: null,
    priceIssue,
    benchmarkIssue: deps.benchmarkIssue || null,
    calendarIssue: deps.calendarIssue || null,
    benchmarkCalendarIssue: deps.benchmarkCalendarIssue || null,
    technicals: technicalsOf(deps, deps.nowIso()),
  };
}

export interface LoadDeps {
  readonly client: SecClient;
  /** Completed daily closes, oldest first, from the server-side price fetch; null when unavailable. */
  readonly closes: readonly DailyBar[] | null;
  readonly priceIssue: string | null;
  /** Gate 2c: price basis of `closes` / `benchmark` (they must match), the SPY series (completed sessions only) and its issue. */
  readonly priceBasis?: string;
  readonly benchmark?: readonly DailyBar[] | null;
  readonly benchmarkBasis?: string;
  readonly benchmarkIssue?: string | null;
  readonly calendarIssue?: string | null;
  readonly benchmarkCalendarIssue?: string | null;
  /** Evaluation clock (ISO-8601). Read AFTER all I/O so no fetched timestamp can be later than "now". */
  readonly nowIso: () => string;
}

export async function loadSecFundamentals(rawSymbol: string, deps: LoadDeps): Promise<LoadedFundamentals> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return failure(rawSymbol, null, 'NOT_COVERED', 'SYMBOL_NOT_SUPPORTED', deps);
  let cik: string | null = null;
  try {
    cik = await deps.client.lookupCik(symbol);
    if (!cik) return failure(symbol, null, 'NOT_COVERED', 'TICKER_NOT_IN_SEC_DIRECTORY', deps);
    const outcome = await deps.client.getCompanyFacts(cik);
    if (outcome.kind === 'NOT_FOUND') return failure(symbol, cik, 'NOT_COVERED', 'NO_SEC_COMPANYFACTS', deps);
    if (outcome.kind === 'NOT_US_GAAP') return failure(symbol, cik, 'NOT_COVERED', 'NOT_US_GAAP_XBRL', deps);

    // Submissions only supply the SIC code; a failure there must not hide the financial metrics.
    let submissions = null;
    try {
      submissions = await deps.client.getSubmissions(cik);
    } catch (err) {
      if (err instanceof SecProviderError && err.code === 'USER_AGENT_MISSING') throw err;
      submissions = null;
    }

    const now = deps.nowIso();
    const technicals = technicalsOf(deps, now);
    const price = technicals.price_last_close;
    const result = buildSecFundamentals(outcome.compact, { now, price, closes: deps.closes, submissions });
    return {
      symbol,
      cik,
      coverage: result.status === 'OK' ? 'COVERED' : 'INSUFFICIENT_FACTS',
      reason: result.status === 'OK' ? null : 'INSUFFICIENT_FACTS',
      conceptMapVersion: SEC_CONCEPT_MAP_VERSION,
      metrics: result.metrics,
      provenance: result.provenance,
      annualSeries: result.annualSeries,
      diagnostics: result.diagnostics,
      priceIssue: deps.priceIssue,
      benchmarkIssue: deps.benchmarkIssue || null,
      calendarIssue: deps.calendarIssue || null,
    benchmarkCalendarIssue: deps.benchmarkCalendarIssue || null,
      technicals,
    };
  } catch (err) {
    if (err instanceof SecProviderError) return failure(symbol, cik, 'PROVIDER_FAILURE', `SEC_${err.code}`, deps);
    return failure(symbol, cik, 'PROVIDER_FAILURE', 'SEC_UNEXPECTED_ERROR', deps);
  }
}
