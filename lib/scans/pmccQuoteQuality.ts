import { evaluateHybridSpread } from './hybridSpread';
import type {
  PmccChainLeg,
  PmccLegRole,
  PmccMarketSession,
  PmccQuotePolicy,
  PmccQuoteQuality,
} from './pmccTypes';

function finitePositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function parseTimestamp(value: PmccChainLeg['quoteTimestamp']): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function emptyQuality(
  leg: PmccChainLeg,
  reason: string,
): PmccQuoteQuality {
  return {
    bid: leg.bid,
    ask: leg.ask,
    midpoint: null,
    width: null,
    spreadPct: null,
    quoteTimestamp: null,
    ageSeconds: null,
    delayed: leg.delayed,
    structurallyUsable: false,
    withinQualifyingWidth: false,
    readyInput: false,
    status: 'insufficient',
    reason,
  };
}

export function evaluatePmccQuoteQuality(
  leg: PmccChainLeg,
  policy: PmccQuotePolicy,
  asOf: Date,
  marketSession: PmccMarketSession,
  // SCAN-ALIGN-0001C2: only the 'short' role gets the absolute width ceiling. Omitted (or 'long')
  // = percent-only band, so a $100 LEAP at 2% ($2.00 wide) is never rejected by the ceiling.
  role?: PmccLegRole,
): PmccQuoteQuality {
  if (!Number.isFinite(asOf.getTime())) return emptyQuality(leg, 'Invalid scan as-of timestamp');
  if (!finitePositive(leg.bid) || !finitePositive(leg.ask)) {
    return emptyQuality(leg, 'A positive two-sided quote is required');
  }
  if (leg.ask < leg.bid) return emptyQuality(leg, 'Crossed quote: ask is below bid');

  const midpoint = (leg.bid + leg.ask) / 2;
  if (!finitePositive(midpoint)) return emptyQuality(leg, 'Quote midpoint is invalid');

  const width = leg.ask - leg.bid;
  const spreadPct = (width / midpoint) * 100;
  if (!Number.isFinite(spreadPct) || spreadPct < 0) {
    return emptyQuality(leg, 'Bid/ask spread percentage is invalid');
  }

  const timestamp = parseTimestamp(leg.quoteTimestamp);
  const ageSeconds = timestamp == null
    ? null
    : Math.max(0, (asOf.getTime() - timestamp.getTime()) / 1000);
  // SCAN-ALIGN-0001C2: reject/warn decisions come from the shared hybrid function (integer
  // arithmetic, $0.05 floor, optional short-leg ceiling). spreadPct above stays display-only.
  const hybrid = evaluateHybridSpread(leg.bid, leg.ask, {
    rejectPct: policy.qualifyingSpreadPctMax,
    warnPct: policy.acceptableSpreadPctMax,
    ceiling: role === 'short' ? policy.shortWidthCeiling ?? null : null,
  });
  const withinQualifyingWidth = !hybrid.reject;
  const structurallyUsable = withinQualifyingWidth;
  const base = {
    bid: leg.bid,
    ask: leg.ask,
    midpoint,
    width,
    spreadPct,
    quoteTimestamp: timestamp?.toISOString() ?? null,
    ageSeconds,
    delayed: leg.delayed,
    structurallyUsable,
    withinQualifyingWidth,
  };

  if (!withinQualifyingWidth) {
    return { ...base, readyInput: false, status: 'too_wide', reason: hybrid.status === 'over_ceiling'
      ? `Bid/ask width $${width.toFixed(2)} exceeds the $${(policy.shortWidthCeiling ?? 0).toFixed(2)} ceiling`
      : `Bid/ask spread ${spreadPct.toFixed(2)}% exceeds ${policy.qualifyingSpreadPctMax}%` };
  }
  if (leg.delayed === true) {
    return { ...base, readyInput: false, status: 'delayed', reason: 'Quote source is delayed' };
  }
  if (marketSession !== 'open') {
    return { ...base, readyInput: false, status: 'market_closed', reason: 'Regular market session is not open' };
  }
  if (timestamp == null) {
    return { ...base, readyInput: false, status: 'timestamp_missing', reason: 'Quote timestamp is unavailable' };
  }
  if (ageSeconds! > policy.readyQuoteAgeSecondsMax) {
    return { ...base, readyInput: false, status: 'stale', reason: `Quote age ${Math.round(ageSeconds!)}s exceeds ${policy.readyQuoteAgeSecondsMax}s` };
  }
  if (hybrid.warn) {
    return { ...base, readyInput: true, status: 'wide_warning', reason: `Bid/ask spread ${spreadPct.toFixed(2)}% is usable but wider than ${policy.acceptableSpreadPctMax}%` };
  }
  return { ...base, readyInput: true, status: 'acceptable', reason: 'Quote is actionable and fresh' };
}
