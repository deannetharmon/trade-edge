import type {
  PmccDecision,
  PmccDecisionGate,
  PmccPairResult,
  PmccPairingCriteria,
  PmccMarketSession,
} from './pmccTypes';

export const PMCC_DECISION_POLICY_VERSION = 'pmcc-decision-v1';

function gate(
  code: string,
  status: PmccDecisionGate['status'],
  explanation: string,
  observedValue: string | number | null,
  threshold: string | number | null,
  policySource: string,
): PmccDecisionGate {
  return { code, status, explanation, observedValue, threshold, policySource };
}

function quoteGate(pair: PmccPairResult, marketSession: PmccMarketSession): PmccDecisionGate {
  const quotes = [pair.longLeg.quote, pair.shortLeg.quote];
  if (quotes.every(quote => quote.readyInput)) {
    return gate('QUOTES_READY', 'pass', 'Both-leg quotes are current and actionable.', 'current', 'ready', 'snapshot.criteria.quotePolicy');
  }
  const comparableClosedSnapshot = marketSession !== 'open' && quotes.every(quote =>
    quote.status === 'market_closed'
    && quote.structurallyUsable
    && quote.bid != null && quote.bid > 0
    && quote.ask != null && quote.ask >= quote.bid,
  );
  if (comparableClosedSnapshot) {
    return gate(
      'MARKET_CLOSED_QUOTES', 'warning',
      'Market closed — quotes are from the prior session. Recheck pricing after the market opens.',
      marketSession, 'two usable two-sided snapshot quotes', 'snapshot.marketSession',
    );
  }
  const unavailable = quotes.filter(quote => !quote.readyInput).map(quote => `${quote.status}: ${quote.reason}`).join(' · ');
  return gate('QUOTES_NOT_ACTIONABLE', 'unavailable', unavailable || 'Both-leg quote evidence is unavailable.', unavailable || null, 'fresh, non-delayed, usable two-sided quotes', 'snapshot.criteria.quotePolicy');
}

/** The only PMCC decision boundary. Scoring and presentation consume this
 * result; neither may independently upgrade qualification or readiness. */
export function evaluatePmccDecision(input: {
  pair: PmccPairResult | null;
  criteria: PmccPairingCriteria;
  marketSession: PmccMarketSession;
  trendAgainst?: boolean;
  earningsDate?: string | null;
}): PmccDecision {
  const { pair, criteria } = input;
  const entryMode = pair?.entryMode ?? 'new-pmcc';
  const held = entryMode === 'covered-short-call-against-held-leaps';
  const gates: PmccDecisionGate[] = [];

  if (!pair) {
    gates.push(gate('PAIR_UNAVAILABLE', 'fail', 'No executable PMCC pair was produced.', null, 'valid long and short call pair', PMCC_DECISION_POLICY_VERSION));
    return { policyVersion: PMCC_DECISION_POLICY_VERSION, qualification: 'DISQUALIFIED', readiness: 'WAIT_MONITOR', action: 'BLOCKED', entryMode, gates };
  }

  if (pair.failureReasons.length > 0 || !pair.qualified) {
    for (const reason of pair.failureReasons) {
      gates.push(gate(`STRUCTURE_${reason.code}`, 'fail', reason.message, reason.code, 'PMCC structural rules', 'pmccPairing'));
    }
  } else {
    gates.push(gate('STRUCTURE_VALID', 'pass', 'Strike, expiration, debit, and contract-identity rules pass.', 'pass', 'PMCC structural rules', 'pmccPairing'));
  }

  if (held) {
    const { min, max } = criteria.longDelta;
    if (pair.longLeg.delta < min || pair.longLeg.delta > max) {
      const variance = pair.longLeg.delta < min ? min - pair.longLeg.delta : pair.longLeg.delta - max;
      gates.push(gate(
        'HELD_LONG_DELTA_PREFERENCE', 'warning',
        `Held LEAPS Δ${pair.longLeg.delta.toFixed(2)} is ${variance.toFixed(2)} ${pair.longLeg.delta < min ? 'below' : 'above'} the preferred ${min.toFixed(2)}–${max.toFixed(2)} range. This reduces stock-replacement/downside-buffer quality but does not disqualify an existing held contract.`,
        pair.longLeg.delta, `${min.toFixed(2)}–${max.toFixed(2)}`, 'snapshot.criteria.longDelta',
      ));
    } else {
      gates.push(gate('HELD_LONG_DELTA_PREFERENCE', 'pass', 'Held LEAPS delta is within the preferred range.', pair.longLeg.delta, `${min.toFixed(2)}–${max.toFixed(2)}`, 'snapshot.criteria.longDelta'));
    }
    if (pair.longLeg.openInterest < criteria.longOiMin) {
      gates.push(gate('HELD_LONG_OI_PREFERENCE', 'warning', 'Held LEAPS open interest is below the new-entry preference; ownership remains valid.', pair.longLeg.openInterest, criteria.longOiMin, 'snapshot.criteria.longOiMin'));
    }
    if (pair.longLeg.dte < criteria.dte.longMin || pair.longLeg.dte > criteria.dte.longMax) {
      gates.push(gate('HELD_LONG_DTE_PREFERENCE', 'warning', 'Held LEAPS DTE has drifted outside the new-entry preference.', pair.longLeg.dte, `${criteria.dte.longMin}–${criteria.dte.longMax}`, 'snapshot.criteria.dte'));
    }
  } else {
    gates.push(gate('NEW_LONG_DELTA', pair.longLeg.delta >= criteria.longDelta.min && pair.longLeg.delta <= criteria.longDelta.max ? 'pass' : 'fail', 'New PMCC long delta must remain inside the submitted range.', pair.longLeg.delta, `${criteria.longDelta.min.toFixed(2)}–${criteria.longDelta.max.toFixed(2)}`, 'snapshot.criteria.longDelta'));
  }

  if (input.trendAgainst) {
    gates.push(gate('TREND_AGAINST_BULLISH_THESIS', 'fail', "Trend is against PMCC's bullish thesis.", 'against', 'aligned or unknown', 'technicalAlignmentForStrategy'));
  }

  if (input.earningsDate && input.earningsDate <= pair.shortLeg.expiration) {
    gates.push(gate('EARNINGS_BEFORE_SHORT_EXPIRY', 'warning', 'Earnings fall before short-call expiration.', input.earningsDate, pair.shortLeg.expiration, 'event-risk-v1'));
  }

  const quotes = quoteGate(pair, input.marketSession);
  gates.push(quotes);
  const qualification = gates.some(item => item.status === 'fail') ? 'DISQUALIFIED' : 'QUALIFIED';
  const readiness = quotes.code === 'QUOTES_READY' ? 'READY' : quotes.code === 'MARKET_CLOSED_QUOTES' ? 'MARKET_CLOSED' : 'WAIT_MONITOR';
  const action = qualification === 'DISQUALIFIED' || readiness === 'WAIT_MONITOR'
    ? 'BLOCKED'
    : held ? 'HELD_PMCC_REVIEW_ONLY' : 'NEW_PMCC_REVIEW_ALLOWED';
  return { policyVersion: PMCC_DECISION_POLICY_VERSION, qualification, readiness, action, entryMode, gates };
}

export function pmccDecisionRankEligible(decision: PmccDecision | null | undefined): boolean {
  return decision?.qualification === 'QUALIFIED'
    && (decision.readiness === 'READY' || decision.readiness === 'MARKET_CLOSED');
}

export function unavailablePmccDecision(explanation: string): PmccDecision {
  return {
    policyVersion: PMCC_DECISION_POLICY_VERSION,
    qualification: 'DISQUALIFIED',
    readiness: 'WAIT_MONITOR',
    action: 'BLOCKED',
    entryMode: 'new-pmcc',
    gates: [gate('PAIR_UNAVAILABLE', 'fail', explanation, null, 'valid long and short call pair', PMCC_DECISION_POLICY_VERSION)],
  };
}
