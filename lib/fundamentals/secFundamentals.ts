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
}

const SYMBOL_PATTERN = /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/;

/** Upper-cases and maps class-share dots to SEC's dash form (BRK.B -> BRK-B). Null when not a plain equity ticker. */
export function normalizeTicker(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(upper)) return null;
  return upper.replace('.', '-');
}

function failure(symbol: string, cik: string | null, coverage: Coverage, reason: string, priceIssue: string | null): LoadedFundamentals {
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
  };
}

export interface LoadDeps {
  readonly client: SecClient;
  /** Completed daily closes, oldest first, from the server-side price fetch; null when unavailable. */
  readonly closes: readonly DailyBar[] | null;
  readonly priceIssue: string | null;
  /** Evaluation time (ISO-8601). */
  readonly now: string;
}

export async function loadSecFundamentals(rawSymbol: string, deps: LoadDeps): Promise<LoadedFundamentals> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return failure(rawSymbol, null, 'NOT_COVERED', 'SYMBOL_NOT_SUPPORTED', deps.priceIssue);
  let cik: string | null = null;
  try {
    cik = await deps.client.lookupCik(symbol);
    if (!cik) return failure(symbol, null, 'NOT_COVERED', 'TICKER_NOT_IN_SEC_DIRECTORY', deps.priceIssue);
    const outcome = await deps.client.getCompanyFacts(cik);
    if (outcome.kind === 'NOT_FOUND') return failure(symbol, cik, 'NOT_COVERED', 'NO_SEC_COMPANYFACTS', deps.priceIssue);
    if (outcome.kind === 'NOT_US_GAAP') return failure(symbol, cik, 'NOT_COVERED', 'NOT_US_GAAP_XBRL', deps.priceIssue);

    // Submissions only supply the SIC code; a failure there must not hide the financial metrics.
    let submissions = null;
    try {
      submissions = await deps.client.getSubmissions(cik);
    } catch (err) {
      if (err instanceof SecProviderError && err.code === 'USER_AGENT_MISSING') throw err;
      submissions = null;
    }

    const technicals = deps.closes ? buildTechnicalMetrics(deps.closes, { now: deps.now, provider: 'yahoo' }) : null;
    const price = technicals ? technicals.price_last_close : null;
    const result = buildSecFundamentals(outcome.compact, { now: deps.now, price, closes: deps.closes, submissions });
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
    };
  } catch (err) {
    if (err instanceof SecProviderError) return failure(symbol, cik, 'PROVIDER_FAILURE', `SEC_${err.code}`, deps.priceIssue);
    return failure(symbol, cik, 'PROVIDER_FAILURE', 'SEC_UNEXPECTED_ERROR', deps.priceIssue);
  }
}
