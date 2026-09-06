/**
 * Deterministic, fail-closed LEAPS contract qualification. This deliberately
 * evaluates contract mechanics only; it is not an underlying recommendation.
 */
export type LeapsEntryStatus = 'CONTRACT_QUALIFIED' | 'REVIEW_REQUIRED' | 'NOT_QUALIFIED' | 'DATA_UNAVAILABLE';
export type LeapsEntryGateStatus = 'pass' | 'fail' | 'unavailable' | 'not_applied';

export interface LeapsEntryCriteria {
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  oiMin: number;
  /** null means discovery mode, never a fully-qualified entry. */
  extrinsicPctMax: number | null;
  spreadPctMax: number;
  requireQuoteTimestamp?: boolean;
  policyVersion: string;
}

export interface LeapsEntryCandidate {
  occSymbol: string | null;
  strike: number;
  dte: number;
  delta: number | null;
  openInterest: number | null;
  bid: number | null;
  ask: number | null;
  underlyingPrice: number | null;
  quoteTimestamp?: string | null;
}

export interface LeapsEntryGate {
  id: 'marketData' | 'delta' | 'dte' | 'openInterest' | 'extrinsicPct' | 'spreadPct' | 'freshness';
  status: LeapsEntryGateStatus;
  message: string;
}

export interface LeapsEntryQualification {
  status: LeapsEntryStatus;
  gates: LeapsEntryGate[];
  extrinsicPctOfCost: number | null;
  spreadPct: number | null;
  policyVersion: string;
}

const finite = (value: number | null): value is number => value != null && Number.isFinite(value);

export function evaluateLeapsEntry(candidate: LeapsEntryCandidate, criteria: LeapsEntryCriteria): LeapsEntryQualification {
  const validQuote = finite(candidate.bid) && candidate.bid > 0 && finite(candidate.ask) && candidate.ask > 0 && candidate.ask >= candidate.bid;
  const hasMarketData = Boolean(candidate.occSymbol) && validQuote && finite(candidate.underlyingPrice) && candidate.underlyingPrice > 0;
  const mid = validQuote ? (candidate.bid! + candidate.ask!) / 2 : null;
  const intrinsic = hasMarketData && mid != null ? Math.max(candidate.underlyingPrice! - candidate.strike, 0) : null;
  const extrinsicPctOfCost = mid != null && intrinsic != null && mid > 0 ? ((mid - intrinsic) / mid) * 100 : null;
  const spreadPct = mid != null ? ((candidate.ask! - candidate.bid!) / mid) * 100 : null;
  const gates: LeapsEntryGate[] = [{ id: 'marketData', status: hasMarketData ? 'pass' : 'unavailable', message: hasMarketData ? 'Valid OCC identity and two-sided quote' : 'OCC identity, underlying price, and a valid two-sided quote are required' }];
  gates.push({ id: 'delta', status: finite(candidate.delta) ? (candidate.delta >= criteria.deltaMin && candidate.delta <= criteria.deltaMax ? 'pass' : 'fail') : 'unavailable', message: `Delta must be ${criteria.deltaMin.toFixed(2)}–${criteria.deltaMax.toFixed(2)}` });
  gates.push({ id: 'dte', status: Number.isFinite(candidate.dte) ? (candidate.dte >= criteria.dteMin ? 'pass' : 'fail') : 'unavailable', message: `DTE must be at least ${criteria.dteMin}` });
  gates.push({ id: 'openInterest', status: finite(candidate.openInterest) ? (candidate.openInterest >= criteria.oiMin ? 'pass' : 'fail') : 'unavailable', message: `Open interest must be at least ${criteria.oiMin}` });
  gates.push({ id: 'spreadPct', status: spreadPct == null ? 'unavailable' : (spreadPct <= criteria.spreadPctMax ? 'pass' : 'fail'), message: `Spread must be at most ${criteria.spreadPctMax}%` });
  gates.push({ id: 'extrinsicPct', status: criteria.extrinsicPctMax == null ? 'not_applied' : extrinsicPctOfCost == null ? 'unavailable' : (extrinsicPctOfCost <= criteria.extrinsicPctMax ? 'pass' : 'fail'), message: criteria.extrinsicPctMax == null ? 'Extrinsic ceiling is in discovery mode' : `Extrinsic must be at most ${criteria.extrinsicPctMax}%` });
  gates.push({ id: 'freshness', status: criteria.requireQuoteTimestamp ? (candidate.quoteTimestamp ? 'pass' : 'unavailable') : 'not_applied', message: criteria.requireQuoteTimestamp ? 'Quote timestamp is required' : 'Freshness policy is not enabled' });
  const hasUnavailable = gates.some(gate => gate.status === 'unavailable');
  const hasFailure = gates.some(gate => gate.status === 'fail');
  // Discovery-mode extrinsic is the only intentionally non-applied policy
  // that blocks a fully-qualified result. Freshness may be unsupported by a
  // data provider and is explicitly marked not-applied without fabricating a
  // stale-data failure.
  const hasReview = gates.some(gate => gate.id === 'extrinsicPct' && gate.status === 'not_applied');
  return { status: hasUnavailable ? 'DATA_UNAVAILABLE' : hasFailure ? 'NOT_QUALIFIED' : hasReview ? 'REVIEW_REQUIRED' : 'CONTRACT_QUALIFIED', gates, extrinsicPctOfCost, spreadPct, policyVersion: criteria.policyVersion };
}
