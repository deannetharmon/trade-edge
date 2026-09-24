import type {
  PmccDecision,
  PmccDecisionGate,
  PmccPairResult,
  PmccPairingCriteria,
  PmccMarketSession,
} from './pmccTypes';
import { newYorkDateFromAsOf, normalizeEarningsDate, parseStrictIsoDate } from './pmccEarningsDates';

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

// PMCC-COMPARE-HELD-0001 — for a held long, only the short leg is
// actually being transacted. The long leg is already owned; there is
// nothing the trader can do about its bid/ask spread short of closing
// and reopening the LEAPS itself, so its quote quality must never gate
// whether the short call can be reviewed/sold. Gating on it made every
// held LEAPS with an inherently wide spread (routine for longer-dated,
// less-liquid strikes) permanently stuck in Wait/Monitor regardless of
// the short leg's own liquidity or market hours -- Ian's real, common-
// case complaint, not an edge case. Same held-mode bypass principle
// already applied to delta/OI/DTE below, now applied here too.
function quoteGate(pair: PmccPairResult, marketSession: PmccMarketSession): PmccDecisionGate {
  const held = pair.entryMode === 'covered-short-call-against-held-leaps';
  const quotes = held ? [pair.shortLeg.quote] : [pair.longLeg.quote, pair.shortLeg.quote];
  if (quotes.every(quote => quote.readyInput)) {
    return gate(
      'QUOTES_READY', 'pass',
      held ? 'Short-leg quote is current and actionable.' : 'Both-leg quotes are current and actionable.',
      'current', 'ready', 'snapshot.criteria.quotePolicy',
    );
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
      marketSession, held ? 'one usable two-sided short-leg snapshot quote' : 'two usable two-sided snapshot quotes', 'snapshot.marketSession',
    );
  }
  const unavailable = quotes.filter(quote => !quote.readyInput).map(quote => `${quote.status}: ${quote.reason}`).join(' · ');
  return gate(
    'QUOTES_NOT_ACTIONABLE', 'unavailable',
    unavailable || (held ? 'Short-leg quote evidence is unavailable.' : 'Both-leg quote evidence is unavailable.'),
    unavailable || null,
    held ? 'fresh, non-delayed, usable short-leg quote' : 'fresh, non-delayed, usable two-sided quotes',
    'snapshot.criteria.quotePolicy',
  );
}

/** The only PMCC decision boundary. Scoring and presentation consume this
 * result; neither may independently upgrade qualification or readiness. */
export function evaluatePmccDecision(input: {
  pair: PmccPairResult | null;
  criteria: PmccPairingCriteria;
  marketSession: PmccMarketSession;
  trendAgainst?: boolean;
  earningsDate?: string | null;
  /** PMCC-EARNINGS-PAST-0001 -- the scan's asOf string (snapshot.asOf). Missing or unparseable skips the earnings lower bound only. */
  asOf?: string | null;
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

  // PMCC-HEALTH-CHECK-0001 -- applies identically in held and new modes,
  // deliberately outside the held/else branch above. Ian's corrected
  // position: the short call is a fresh, discretionary choice every
  // single time regardless of whether the LEAP underneath it is already
  // owned, so there's no "already committed" argument for softening this
  // the way HELD_LONG_DELTA_PREFERENCE softens the long leg. Always a
  // warning, never a silent block or a hard fail -- an off-target short
  // delta is a real risk-tolerance trade-off (same category as OI), not
  // a data-integrity problem. Real observed/threshold numbers shown, per
  // the team's standing bar all night.
  {
    const { min, max } = criteria.shortDelta;
    if (pair.shortLeg.delta < min || pair.shortLeg.delta > max) {
      const variance = pair.shortLeg.delta < min ? min - pair.shortLeg.delta : pair.shortLeg.delta - max;
      gates.push(gate(
        'NEW_SHORT_DELTA', 'warning',
        `Short call Δ${pair.shortLeg.delta.toFixed(2)} is ${variance.toFixed(2)} ${pair.shortLeg.delta < min ? 'below' : 'above'} the preferred ${min.toFixed(2)}–${max.toFixed(2)} range. This changes the premium/assignment-risk trade-off but does not disqualify the structure.`,
        pair.shortLeg.delta, `${min.toFixed(2)}–${max.toFixed(2)}`, 'snapshot.criteria.shortDelta',
      ));
    } else {
      gates.push(gate('NEW_SHORT_DELTA', 'pass', 'Short call delta is within the preferred range.', pair.shortLeg.delta, `${min.toFixed(2)}–${max.toFixed(2)}`, 'snapshot.criteria.shortDelta'));
    }
  }

  // PMCC-HEALTH-CHECK-0002: EXTRINSIC_RATIO. Compares each leg's daily
  // extrinsic decay rate, not raw dollars, since the two legs run on
  // wildly different timeframes (short ~30-45 DTE, LEAP 270+ DTE).
  // Ratio > 1 means the short call earns faster than the LEAP bleeds
  // time value -- the textbook-favorable PMCC setup. Below 1, the
  // position pays more in LEAP decay than it collects, even if it still
  // looks fine on paper. 'unavailable' is deliberately distinct from
  // 'warning' -- a missing/invalid extrinsic input must never render as
  // a false caution about the ratio itself. Identical in held and new
  // modes, same reasoning as NEW_SHORT_DELTA above.
  {
    const shortExtrinsic = pair.shortLeg.extrinsic;
    const longExtrinsic = pair.longLeg.extrinsic;
    const shortDte = pair.shortLeg.dte;
    const longDte2 = pair.longLeg.dte;
    const inputsValid = shortExtrinsic != null && Number.isFinite(shortExtrinsic) && shortExtrinsic >= 0
      && longExtrinsic != null && Number.isFinite(longExtrinsic) && longExtrinsic > 0
      && shortDte > 0 && longDte2 > 0;
    if (!inputsValid) {
      gates.push(gate('EXTRINSIC_RATIO', 'unavailable', 'Extrinsic-value ratio is unavailable -- one or both legs are missing a valid extrinsic value.', null, '≥ 1.00', 'derived.extrinsicRatio'));
    } else {
      const shortDailyRate = shortExtrinsic / shortDte;
      const longDailyRate = longExtrinsic / longDte2;
      const ratio = shortDailyRate / longDailyRate;
      const ratioLabel = ratio.toFixed(2);
      const rateDetail = `Short call earns $${shortDailyRate.toFixed(3)}/day vs. $${longDailyRate.toFixed(3)}/day of LEAP time-value decay.`;
      if (ratio < 0.5) {
        gates.push(gate('EXTRINSIC_RATIO', 'warning', `Extrinsic ratio ${ratioLabel} is well below 1.00 -- the short call is earning far less than the LEAP is losing to time decay. ${rateDetail}`, ratioLabel, '≥ 1.00', 'derived.extrinsicRatio'));
      } else if (ratio < 1.0) {
        gates.push(gate('EXTRINSIC_RATIO', 'warning', `Extrinsic ratio ${ratioLabel} is below 1.00 -- the short call isn't keeping pace with LEAP decay. ${rateDetail}`, ratioLabel, '≥ 1.00', 'derived.extrinsicRatio'));
      } else {
        gates.push(gate('EXTRINSIC_RATIO', 'pass', `Extrinsic ratio ${ratioLabel} -- the short call is earning faster than the LEAP is losing to time decay. ${rateDetail}`, ratioLabel, '≥ 1.00', 'derived.extrinsicRatio'));
      }
    }
  }

  // PMCC-HEALTH-CHECK-0002: LEAP_APPROACHING_DANGER_ZONE. New, separate
  // gate from HELD_LONG_DTE_PREFERENCE above -- that gate asks "has this
  // drifted outside my general preference," this one specifically asks
  // "is this approaching the point where delta erosion accelerates."
  // Two tiers, not one binary flag: 90 DTE remaining gives real runway
  // to notice and plan; 60 DTE is the actual danger point Ian named.
  // Identical in held and new modes -- a fresh LEAP purchase and an
  // already-held one both age toward the same danger zone the same way.
  {
    const longDteRemaining = pair.longLeg.dte;
    if (longDteRemaining <= 60) {
      gates.push(gate('LEAP_APPROACHING_DANGER_ZONE', 'warning', `LEAP has ${longDteRemaining} DTE remaining -- inside the 60-day zone where delta erosion accelerates meaningfully. Worth an active roll/close decision, not passive monitoring.`, longDteRemaining, '> 60 DTE', 'policy.leapDangerZone'));
    } else if (longDteRemaining <= 90) {
      gates.push(gate('LEAP_APPROACHING_DANGER_ZONE', 'warning', `LEAP has ${longDteRemaining} DTE remaining -- approaching the 60-day danger zone where delta erosion accelerates. Real runway left, but worth tracking.`, longDteRemaining, '> 90 DTE', 'policy.leapDangerZone'));
    } else {
      gates.push(gate('LEAP_APPROACHING_DANGER_ZONE', 'pass', 'LEAP DTE is well outside the delta-erosion danger zone.', longDteRemaining, '> 90 DTE', 'policy.leapDangerZone'));
    }
  }

  if (input.trendAgainst) {
    gates.push(gate('TREND_AGAINST_BULLISH_THESIS', 'fail', "Trend is against PMCC's bullish thesis.", 'against', 'aligned or unknown', 'technicalAlignmentForStrategy'));
  }

  // PMCC-EARNINGS-PAST-0001 -- fires when T <= E <= X, all validated YYYY-MM-DD
  // strings. T is the New York date of asOf (missing/unparseable skips the
  // lower bound only); malformed E = no date on file; missing/malformed X = no gate.
  const earningsNormalized = normalizeEarningsDate(input.earningsDate);
  const shortExpiryDate = parseStrictIsoDate(pair.shortLeg.expiration);
  if (earningsNormalized && shortExpiryDate && earningsNormalized <= shortExpiryDate) {
    const today = newYorkDateFromAsOf(input.asOf);
    if (today === null || earningsNormalized >= today) {
      gates.push(gate('EARNINGS_BEFORE_SHORT_EXPIRY', 'warning', 'Earnings fall before short-call expiration.', earningsNormalized, shortExpiryDate, 'event-risk-v1'));
    }
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
