import { calculateCandidateEconomics } from './economics';
import { ACTIVE_CYCLE_DTE_MIN, BROKER_SNAPSHOT_MAX_AGE_MS, EVENT_MAX_AGE_MS, EXISTING_LEAPS_REVIEW_DTE, hasTwoSidedNonCrossedQuote, isFresh, MIN_UPSIDE_PARTICIPATION, PMCC_SHORT_DELTA_MAX, PMCC_SHORT_DELTA_MIN, PMCC_SHORT_DTE_MAX, PMCC_SHORT_DTE_MIN, PMCC_SHORT_OI_MIN, PMCC_SHORT_SPREAD_MAX, QUOTE_MAX_AGE_MS } from './policy';
import type { EvaluationFacts, Evidence, LeapsMonitorReason, LeapsPositionIntelligenceResult } from './types';

const out = (state: LeapsPositionIntelligenceResult['state'], evidence: Evidence[], monitorReason?: LeapsMonitorReason): LeapsPositionIntelligenceResult => ({ policyVersion: 'LEAPS-PI-1.1', state, evidence, ...(monitorReason ? { monitorReason } : {}) });
const block = (code: Evidence['code'], message: string): Evidence => ({ code, message, severity: 'blocking' });
const warn = (code: Evidence['code'], message: string): Evidence => ({ code, message, severity: 'warning' });

/** Pure, ordered decision waterfall. It owns policy; callers supply verified facts only. */
export function evaluateLeapsPositionIntelligence(facts: EvaluationFacts): LeapsPositionIntelligenceResult {
  if (!facts.longCall || !facts.canonicalAccountId) return out('not-ready', [block('candidate-unavailable', 'Exact broker-held long-call identity is unavailable.')]);
  if (!isFresh(facts.brokerSnapshotAsOf, facts.asOf, BROKER_SNAPSHOT_MAX_AGE_MS)) return out('not-ready', [block('stale-broker-snapshot', 'Broker snapshot is stale or unavailable.')]);
  if (!facts.mandate) return out('health-only', [{ code: 'missing-mandate', message: 'Set a thesis mandate before evaluating an income call.', severity: 'info' }]);
  if (facts.thesisInvalidated || (facts.mandate.invalidationPrice != null && facts.underlyingPrice != null && Number.isFinite(facts.mandate.invalidationPrice) && Number.isFinite(facts.underlyingPrice) && facts.underlyingPrice <= facts.mandate.invalidationPrice)) return out('reassess-thesis', [block('long-dte-health', 'The trader-set thesis invalidation rule is breached.')]);
  if (facts.longCall.dte < EXISTING_LEAPS_REVIEW_DTE) return out('reassess-thesis', [block('long-dte-health', `Long-call DTE is below the ${EXISTING_LEAPS_REVIEW_DTE}-day existing-position review threshold.`)]);
  if (facts.assignmentOrCorporateAction) return out('monitor', [block('assignment-or-corporate-action', 'Assignment or corporate-action evidence requires review.')], 'assignment-or-corporate-action');
  if (!facts.marketOpen) return out('market-closed', [{ code: 'candidate-unavailable', message: 'Income-call quotes are evaluated during regular market hours.', severity: 'info' }]);
  if (facts.activeCycle && facts.activeCycle.longDteAfterShortExpiry < ACTIVE_CYCLE_DTE_MIN) return out('monitor', [block('long-dte-health', `Active cycle leaves fewer than ${ACTIVE_CYCLE_DTE_MIN} long-call DTE after short expiry; management review is required.`)], 'preference-not-met');
  if (facts.capacity !== 'available') return out('monitor', [block('capacity-reserved', 'A short call is open, working, or capacity is ambiguous.')], 'capacity-reserved');
  if (!isFresh(facts.event.asOf, facts.asOf, EVENT_MAX_AGE_MS) || facts.event.status === 'unavailable') return out('monitor', [block('event-data-unavailable', 'Event data is unavailable or stale; an income call cannot be reviewed.')], 'event-data-unavailable');
  if (!facts.candidate) return out('monitor', [block('candidate-unavailable', 'No qualifying short-call candidate is available.')], 'no-qualifying-short-call');
  const eventDate = facts.event.eventDate ? Date.parse(facts.event.eventDate) : Number.NaN;
  const shortExpiry = Date.parse(facts.candidate.expiration);
  const evaluationAt = Date.parse(facts.asOf);
  if (facts.event.status === 'known-event' && (!Number.isFinite(eventDate) || !Number.isFinite(shortExpiry) || !Number.isFinite(evaluationAt))) return out('monitor', [block('event-data-unavailable', 'Known event timing is unavailable or malformed.')], 'event-data-unavailable');
  const eventInCycle = Number.isFinite(eventDate) && eventDate >= evaluationAt && eventDate <= shortExpiry;
  if (facts.event.status === 'known-event' && eventInCycle && (!facts.mandate.allowKnownEarningsCycle || facts.event.eventType !== 'earnings')) return out('monitor', [block('known-event-blocked', 'A known event falls within this income cycle.')], 'known-event');
  if (facts.mandate.thesisTargetHigh == null || !Number.isFinite(facts.mandate.thesisTargetHigh) || facts.underlyingPrice == null || !Number.isFinite(facts.underlyingPrice) || facts.mandate.thesisTargetHigh <= facts.underlyingPrice || facts.mandate.incomeCapStrike == null || !Number.isFinite(facts.mandate.incomeCapStrike) || facts.mandate.minimumCycleCredit == null || !Number.isFinite(facts.mandate.minimumCycleCredit)) return out('monitor', [block('income-cap', 'Thesis target, income-cap strike, or minimum cycle credit is missing or invalid.')], 'preference-not-met');
  if (!facts.exactPairingVerified || !Number.isFinite(facts.candidate.strike) || !Number.isFinite(facts.candidate.dte) || !Number.isFinite(facts.candidate.delta) || !Number.isFinite(facts.candidate.openInterest) || facts.candidate.strike <= facts.longCall.strike || facts.candidate.dte < PMCC_SHORT_DTE_MIN || facts.candidate.dte > PMCC_SHORT_DTE_MAX || facts.candidate.dte >= facts.longCall.dte || facts.candidate.delta < PMCC_SHORT_DELTA_MIN || facts.candidate.delta > PMCC_SHORT_DELTA_MAX || facts.candidate.openInterest < PMCC_SHORT_OI_MIN) return out('monitor', [block('candidate-unavailable', 'Candidate does not meet exact PMCC DTE, delta, OI, or structural gates.')], 'no-qualifying-short-call');
  if (facts.longCall.dte - facts.candidate.dte < ACTIVE_CYCLE_DTE_MIN) return out('monitor', [block('long-dte-health', `Proposed cycle leaves fewer than ${ACTIVE_CYCLE_DTE_MIN} long-call DTE after short expiry.`)], 'horizon-safeguard');
  if (!facts.candidate.quoteSnapshotId || !isFresh(facts.longCall.quoteAsOf, facts.asOf, QUOTE_MAX_AGE_MS) || !hasTwoSidedNonCrossedQuote(facts.longCall.bid, facts.longCall.ask) || !isFresh(facts.candidate.quoteAsOf, facts.asOf, QUOTE_MAX_AGE_MS) || !hasTwoSidedNonCrossedQuote(facts.candidate.bid, facts.candidate.ask) || facts.candidate.spreadPct == null || !Number.isFinite(facts.candidate.spreadPct) || facts.candidate.spreadPct < 0 || facts.candidate.spreadPct > PMCC_SHORT_SPREAD_MAX) return out('monitor', [block('candidate-quote-quality', 'Candidate or held-long quote is stale, invalid, or wider than policy.')], 'quote-quality');
  const underlyingPrice = facts.underlyingPrice as number;
  const thesisTargetHigh = facts.mandate.thesisTargetHigh as number;
  const incomeCapStrike = facts.mandate.incomeCapStrike as number;
  const economics = calculateCandidateEconomics(facts.longCall, facts.candidate, underlyingPrice, thesisTargetHigh);
  if (!economics || economics.executableCreditPerShare < facts.mandate.minimumCycleCredit) return out('monitor', [block('candidate-quote-quality', 'Candidate does not provide the trader-set minimum cycle credit.')], 'quote-quality');
  if (facts.candidate.strike < incomeCapStrike) return out('monitor', [block('income-cap', 'Candidate short strike is below the trader-set income-cap strike.')], 'preference-not-met');
  const floor = MIN_UPSIDE_PARTICIPATION[facts.mandate.posture];
  if (economics.upsideParticipationPct < floor) return out('hold-uncovered', [block('upside-participation', `Candidate leaves ${economics.upsideParticipationPct.toFixed(0)}% upside participation; ${floor}% is required.`)]);
  const evidence: Evidence[] = [];
  if (facts.longCall.entryDebitPerShare == null) evidence.push(warn('missing-entry-debit', 'Capital-percentage and original break-even economics are unavailable.'));
  if (economics.belowOriginalExpirationBreakeven) evidence.push(warn('below-original-expiration-breakeven', 'Short strike is below the long call’s original expiration break-even.'));
  return { policyVersion: 'LEAPS-PI-1.1', state: 'review-income-call', evidence, candidate: facts.candidate, economics };
}
