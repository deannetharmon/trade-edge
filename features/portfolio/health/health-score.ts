// features/portfolio/health/health-score.ts

import type { PositionHealthFactor, PositionHealthInput, PositionHealthScore } from './health-types';
import { clampScore, daysBetween, factor, isDateOnOrBeforeExpiration, normalizePercent } from './health-factors';
import { healthGrade, healthSummary, inferHealthStrategy } from './health-rules';

export function calculatePositionHealthScore(position: PositionHealthInput, now: Date = new Date()): PositionHealthScore {
  const factors: PositionHealthFactor[] = [];
  let score = 80;

  const strategy = inferHealthStrategy(position);
  const dte = Number.isFinite(position.dte ?? NaN) ? Number(position.dte) : null;
  const pnlPct = normalizePercent(position.pnlPct);
  const buffer = normalizePercent(position.buffer);
  const ivr = normalizePercent(position.ivr);
  const iv = normalizePercent(position.iv);
  const hv30 = normalizePercent(position.hv30);
  const delta = Number.isFinite(position.netDelta ?? NaN)
    ? Number(position.netDelta)
    : Number.isFinite(position.delta ?? NaN)
    ? Number(position.delta)
    : null;

  if (position.hitTarget || (pnlPct != null && pnlPct >= 50)) {
    score += 10;
    factors.push(factor('profit-target', 'Profit target', 10, 'positive', `Profit target reached (${pnlPct?.toFixed(0) ?? 'target'}%).`));
  } else if (pnlPct != null && pnlPct >= 25) {
    score += 4;
    factors.push(factor('profit-progress', 'Profit progress', 4, 'positive', `Position has captured ${pnlPct.toFixed(0)}% of credit.`));
  } else if (pnlPct != null && pnlPct <= -100) {
    score -= 25;
    factors.push(factor('loss-1x-credit', 'Loss pressure', -25, 'critical', `Loss is near or beyond 1x credit (${pnlPct.toFixed(0)}%).`));
  } else if (pnlPct != null && pnlPct <= -50) {
    score -= 14;
    factors.push(factor('loss-watch', 'Loss pressure', -14, 'warning', `Loss is material (${pnlPct.toFixed(0)}% of credit).`));
  }

  if (dte != null) {
    if (dte <= 0) {
      score -= 35;
      factors.push(factor('expired', 'Expiration', -35, 'critical', 'Position is expired or expires today.'));
    } else if (dte <= 7) {
      score -= 25;
      factors.push(factor('dte-critical', 'Expiration', -25, 'critical', `${dte} DTE — expiration risk is urgent.`));
    } else if (dte <= 14) {
      score -= 16;
      factors.push(factor('dte-warning', 'Expiration', -16, 'warning', `${dte} DTE — review close or roll.`));
    } else if (dte <= 21 || position.needsClose) {
      score -= 9;
      factors.push(factor('dte-watch', 'Expiration', -9, 'watch', `${dte} DTE — standard management window.`));
    } else {
      score += 3;
      factors.push(factor('dte-ok', 'Expiration', 3, 'positive', `${dte} DTE leaves room to manage.`));
    }
  }

  if (buffer != null) {
    if (buffer < 0) {
      score -= 30;
      factors.push(factor('itm', 'Strike buffer', -30, 'critical', `Position appears ITM by ${Math.abs(buffer).toFixed(1)}%.`));
    } else if (buffer < 2) {
      score -= 22;
      factors.push(factor('buffer-critical', 'Strike buffer', -22, 'critical', `Only ${buffer.toFixed(1)}% buffer remains.`));
    } else if (buffer < 5) {
      score -= 12;
      factors.push(factor('buffer-watch', 'Strike buffer', -12, 'warning', `${buffer.toFixed(1)}% buffer is tight.`));
    } else {
      score += 5;
      factors.push(factor('buffer-good', 'Strike buffer', 5, 'positive', `${buffer.toFixed(1)}% buffer is comfortable.`));
    }
  }

  if (delta != null) {
    const absDelta = Math.abs(delta);
    if (absDelta >= 0.5) {
      score -= 16;
      factors.push(factor('delta-high', 'Delta', -16, 'warning', `High directional exposure: Δ ${delta.toFixed(2)}.`));
    } else if (absDelta >= 0.3) {
      score -= 7;
      factors.push(factor('delta-watch', 'Delta', -7, 'watch', `Moderate directional exposure: Δ ${delta.toFixed(2)}.`));
    } else {
      score += 3;
      factors.push(factor('delta-ok', 'Delta', 3, 'positive', `Controlled directional exposure: Δ ${delta.toFixed(2)}.`));
    }
  }

  if (position.earningsDate && isDateOnOrBeforeExpiration(position.earningsDate, position.expDate)) {
    const daysToEarnings = daysBetween(now, position.earningsDate);
    if (daysToEarnings != null && daysToEarnings >= 0) {
      const impact = daysToEarnings <= 7 ? -18 : -10;
      factors.push(factor('earnings-risk', 'Earnings', impact, daysToEarnings <= 7 ? 'critical' : 'warning', `Earnings in ${daysToEarnings} day${daysToEarnings === 1 ? '' : 's'} before expiration.`));
      score += impact;
    }
  }

  if (ivr != null) {
    if (ivr < 15 && strategy !== 'long-shares') {
      score -= 6;
      factors.push(factor('ivr-low', 'IVR', -6, 'watch', `Low IVR (${ivr.toFixed(0)}) means less premium cushion.`));
    } else if (ivr >= 25 && ivr <= 70) {
      score += 3;
      factors.push(factor('ivr-healthy', 'IVR', 3, 'positive', `IVR ${ivr.toFixed(0)} is reasonable for premium management.`));
    } else if (ivr > 80) {
      score -= 4;
      factors.push(factor('ivr-elevated', 'IVR', -4, 'watch', `IVR ${ivr.toFixed(0)} is elevated; watch expansion/crush dynamics.`));
    }
  }

  if (iv != null && hv30 != null) {
    if (iv < hv30 * 0.85) {
      score -= 6;
      factors.push(factor('iv-below-hv', 'IV vs HV', -6, 'watch', `IV ${iv.toFixed(0)}% is below HV30 ${hv30.toFixed(0)}%.`));
    } else if (iv > hv30) {
      score += 3;
      factors.push(factor('iv-premium', 'IV vs HV', 3, 'positive', `IV ${iv.toFixed(0)}% is above HV30 ${hv30.toFixed(0)}%.`));
    }
  }

  if (strategy !== 'long-shares' && position.hasGtc === false && pnlPct != null && pnlPct >= 20) {
    score -= 5;
    factors.push(factor('missing-gtc', 'Profit protection', -5, 'watch', 'Position has profit but no working GTC detected.'));
  }

  if (position.stopLossStatus === 'live') {
    score += 2;
    factors.push(factor('stop-live', 'Stop protection', 2, 'positive', 'Stop protection appears live.'));
  } else if (position.stopLossStatus === 'none' && pnlPct != null && pnlPct <= -50) {
    score -= 5;
    factors.push(factor('no-stop-loss', 'Stop protection', -5, 'watch', 'Loss is material and no stop protection is detected.'));
  }

  if (factors.length === 0) {
    factors.push(factor('limited-data', 'Available data', 0, 'neutral', 'Not enough position fields were available for detailed scoring.'));
  }

  const finalScore = clampScore(score);
  const grade = healthGrade(finalScore);

  return {
    positionId: position.positionId ?? position.key ?? `${position.symbol}-${position.expDate ?? 'unknown'}`,
    symbol: position.symbol,
    score: finalScore,
    grade,
    summary: healthSummary(grade),
    factors,
    computedAt: now.toISOString(),
  };
}
