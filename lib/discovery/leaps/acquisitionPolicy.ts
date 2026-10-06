// lib/discovery/leaps/acquisitionPolicy.ts

// LEAPS-QV-0001 Gate 4a -- acquisition limits for the QV LEAPS chain, in one place (spec Sections 10 and 11.3,
// rulings I1, I11, Q3, Q9 of revision 4). These are acquisition-cost and scope controls, not eligibility gates:
// none of them can produce a "no suitable contract" verdict. Changing any value is a deliberate, versioned change;
// a test pins the fingerprint of this object.

import { deepFreeze } from '../util';

export const QV_LEAPS_ACQUISITION_VERSION = 'QV-LEAPS-ACQ-v1';

export const QV_LEAPS_ACQUISITION_V1 = deepFreeze({
  version: QV_LEAPS_ACQUISITION_VERSION,
  // I1: DTE window, calendar days from the New York date of `now`.
  dteMin: 365,
  dteMax: 900,
  // Section 10 stage 2: at most 6 expirations, chosen by |DTE - 730| ascending, ties earlier expiration first.
  expirationCap: 6,
  expirationPriorityTargetDte: 730,
  // I11: calls with strikeBandLowFractionOfSpot * S <= K < S. K >= S is provably ineligible (stage 3a).
  strikeBandLowFractionOfSpot: 0.4,
  // Q3: market-data chunks of 100, at most 10 per underlying (1,000 contracts); over it the underlying is
  // acquisition-incomplete and nothing is quoted or ranked (never silently truncated).
  quoteChunkSize: 100,
  maxQuoteChunksPerUnderlying: 10,
  // Q9: run budget, GET requests including retries; HTTP 429 is retried once after the backoff.
  runRequestBudget: 300,
  rateLimitRetries: 1,
  rateLimitBackoffMs: 2000,
  // 11.3: per-run underlying cap, concurrency, per-underlying time budget.
  maxUnderlyingsPerRun: 25,
  concurrency: 3,
  perUnderlyingTimeoutMs: 20000,
});

export type QvLeapsAcquisitionPolicy = typeof QV_LEAPS_ACQUISITION_V1;
