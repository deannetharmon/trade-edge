// features/portfolio/recommendations/recommendation-engine.ts

import type { PortfolioRecommendation, PortfolioRecommendationInput } from './recommendation-types';
import {
  hasHealthFactor,
  isShortPremiumStrategy,
  isUpcomingBeforeExpiration,
  makeRecommendation,
  normalizeRecommendationPct,
} from './recommendation-rules';

export function calculatePortfolioRecommendation(
  input: PortfolioRecommendationInput,
  now: Date = new Date()
): PortfolioRecommendation {
  const dte = Number.isFinite(input.dte ?? NaN) ? Number(input.dte) : null;
  const pnlPct = normalizeRecommendationPct(input.pnlPct);
  const buffer = normalizeRecommendationPct(input.buffer);
  const healthScore = input.healthScore?.score ?? null;
  const strategy = String(input.strategy ?? '').toUpperCase();
  const shortPremium = isShortPremiumStrategy(strategy);

  const supportingReasons = input.healthScore?.factors
    ?.slice(0, 3)
    .map(factor => `${factor.label}: ${factor.message}`) ?? [];

  const criticalExpiration = dte != null && dte <= 7;
  const itmOrCriticalBuffer =
    hasHealthFactor(input, 'itm') ||
    hasHealthFactor(input, 'buffer-critical') ||
    (buffer != null && buffer < 2);

  if (shortPremium && criticalExpiration && itmOrCriticalBuffer) {
    return makeRecommendation(
      input,
      'assignment-risk',
      'Assignment Risk',
      'critical',
      94,
      dte != null ? `${dte} DTE with tight or ITM strike buffer.` : 'Tight or ITM strike buffer near expiration.',
      'Review assignment, close, or roll plan before adding new risk.',
      supportingReasons,
      now
    );
  }

  if (pnlPct != null && pnlPct <= -100) {
    return makeRecommendation(
      input,
      'close-loser',
      'Close Loser',
      'critical',
      91,
      `Loss is near or beyond 1x credit (${pnlPct.toFixed(0)}%).`,
      'Review closing or rolling defensively.',
      supportingReasons,
      now
    );
  }

  if (pnlPct != null && pnlPct <= -50 && healthScore != null && healthScore < 50) {
    return makeRecommendation(
      input,
      'close-loser',
      'Close Loser',
      'high',
      84,
      `Material loss with weak health score (${healthScore}).`,
      'Review whether the thesis still holds; close or roll if risk is no longer acceptable.',
      supportingReasons,
      now
    );
  }

  if (isUpcomingBeforeExpiration(input.earningsDate, input.expDate, now)) {
    return makeRecommendation(
      input,
      'earnings-risk',
      'Earnings Risk',
      'high',
      86,
      `Upcoming earnings before expiration (${input.earningsDate}).`,
      'Decide whether to close, reduce risk, or intentionally hold through earnings.',
      supportingReasons,
      now
    );
  }

  if (input.hitTarget || hasHealthFactor(input, 'profit-target') || (pnlPct != null && pnlPct >= 50)) {
    return makeRecommendation(
      input,
      'close-winner',
      'Close Winner',
      'high',
      90,
      pnlPct != null ? `Profit target reached at approximately ${pnlPct.toFixed(0)}% of credit.` : 'Profit target reached.',
      'Take profit or confirm the GTC target order is working.',
      supportingReasons,
      now
    );
  }

  if (dte != null && dte <= 21 && dte > 7 && shortPremium) {
    return makeRecommendation(
      input,
      'roll-soon',
      'Roll Soon',
      'medium',
      80,
      `${dte} DTE is inside the standard management window.`,
      'Review close, roll, or let-decay plan.',
      supportingReasons,
      now
    );
  }

  if (shortPremium && input.hasGtc === false && pnlPct != null && pnlPct >= 20 && dte != null && dte > 14) {
    return makeRecommendation(
      input,
      'place-gtc',
      'Place GTC',
      'medium',
      78,
      `Position has profit (${pnlPct.toFixed(0)}%) but no working GTC detected.`,
      'Place or verify a profit-target GTC order.',
      supportingReasons,
      now
    );
  }

  if (dte != null && dte <= 3 && healthScore != null && healthScore >= 75 && !itmOrCriticalBuffer) {
    return makeRecommendation(
      input,
      'let-expire',
      'Let Expire',
      'low',
      72,
      `${dte} DTE with healthy score and no critical buffer flag.`,
      'Monitor through expiration only if assignment risk is acceptable.',
      supportingReasons,
      now
    );
  }

  if ((healthScore != null && healthScore < 75) || (buffer != null && buffer < 5)) {
    return makeRecommendation(
      input,
      'watch',
      'Watch',
      'medium',
      70,
      healthScore != null ? `Health score is ${healthScore}.` : 'One or more risk factors deserve attention.',
      'Monitor closely and avoid adding correlated risk.',
      supportingReasons,
      now
    );
  }

  return makeRecommendation(
    input,
    'hold',
    'Hold',
    'low',
    76,
    healthScore != null ? `Health score is ${healthScore}; no primary action rule triggered.` : 'No primary action rule triggered.',
    'Leave position alone unless market conditions or thesis change.',
    supportingReasons,
    now
  );
}
