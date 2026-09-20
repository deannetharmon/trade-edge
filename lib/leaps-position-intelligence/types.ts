/**
 * Canonical, serializable facts for a broker-held long call and its optional
 * income-call cycle. This package is deliberately UI-, fetch-, and store-free.
 */
export type LeapsPositionIntelligenceState =
  | 'health-only'
  | 'hold-uncovered'
  | 'review-income-call'
  | 'monitor'
  | 'reassess-thesis'
  | 'not-ready'
  | 'market-closed';

export type LeapsMonitorReason =
  | 'capacity-reserved'
  | 'no-qualifying-short-call'
  | 'quote-quality'
  | 'preference-not-met'
  | 'known-event'
  | 'event-data-unavailable'
  | 'assignment-or-corporate-action'
  | 'horizon-safeguard';

export type LeapsEvidenceCode =
  | 'missing-mandate'
  | 'stale-broker-snapshot'
  | 'stale-quote'
  | 'invalid-quote'
  | 'missing-entry-debit'
  | 'long-dte-health'
  | 'capacity-reserved'
  | 'event-data-unavailable'
  | 'known-event-blocked'
  | 'candidate-unavailable'
  | 'candidate-quote-quality'
  | 'income-cap'
  | 'upside-participation'
  | 'below-original-expiration-breakeven'
  | 'assignment-or-corporate-action';

export interface Evidence {
  code: LeapsEvidenceCode;
  message: string;
  severity: 'info' | 'warning' | 'blocking';
}

export interface LeapsMandate {
  version: 'LEAPS-PI-1.1';
  thesis: string;
  invalidation: string;
  thesisTargetHigh: number | null;
  invalidationPrice: number | null;
  posture: 'upside-first' | 'balanced' | 'income-first';
  /** Minimum acceptable short-call strike; never a maximum credit. */
  incomeCapStrike: number | null;
  minimumCycleCredit: number | null;
  allowKnownEarningsCycle: boolean;
}

export interface LongCallFacts {
  occSymbol: string;
  quantity: number;
  strike: number;
  dte: number;
  delta: number | null;
  entryDebitPerShare: number | null;
  bid: number | null;
  ask: number | null;
  quoteAsOf: string | null;
}

export interface ShortCallCandidate {
  occSymbol: string;
  expiration: string;
  strike: number;
  dte: number;
  delta: number;
  openInterest: number;
  spreadPct: number | null;
  quoteSnapshotId: string | null;
  bid: number | null;
  ask: number | null;
  quoteAsOf: string | null;
}

export interface EventFacts {
  status: 'clear' | 'known-event' | 'unavailable';
  asOf: string | null;
  eventDate?: string | null;
  eventType?: 'earnings' | 'other' | null;
}

export interface EvaluationFacts {
  asOf: string;
  marketOpen: boolean;
  brokerSnapshotAsOf: string | null;
  canonicalAccountId: string | null;
  longCall: LongCallFacts | null;
  underlyingPrice: number | null;
  mandate: LeapsMandate | null;
  event: EventFacts;
  capacity: 'available' | 'reserved' | 'ambiguous';
  assignmentOrCorporateAction: boolean;
  thesisInvalidated?: boolean;
  /** Candidate has been produced by the shared exact-held-LEAPS pairing path. */
  exactPairingVerified: boolean;
  activeCycle?: { shortExpiry: string; longDteAfterShortExpiry: number } | null;
  candidate: ShortCallCandidate | null;
}

export interface CandidateEconomics {
  executableCreditPerShare: number;
  totalCredit: number;
  creditAsPctOfLeapsCapital: number | null;
  netDeltaAfterShort: number | null;
  longExpirationBreakeven: number | null;
  upsideParticipationPct: number;
  belowOriginalExpirationBreakeven: boolean;
}

export interface LeapsPositionIntelligenceResult {
  policyVersion: 'LEAPS-PI-1.1';
  state: LeapsPositionIntelligenceState;
  monitorReason?: LeapsMonitorReason;
  evidence: Evidence[];
  candidate?: ShortCallCandidate;
  economics?: CandidateEconomics;
}
