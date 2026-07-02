// lib/scans/trend.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import type { TrendResult } from './types';
import { normalizeTickerToken } from './scan-utils';
import { YAHOO_INDEX_CHART_MAP } from './constants';

export async function getTrend(symbol: string, isIndexOrEtf?: boolean): Promise<TrendResult> {
  const cleanSymbol = normalizeTickerToken(symbol) ?? symbol.toUpperCase();
  const chartSymbol = YAHOO_INDEX_CHART_MAP[cleanSymbol] ?? cleanSymbol;
  const res = await fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' });

  if (!res.ok) throw new Error(`Yahoo chart fetch failed for ${cleanSymbol} (${res.status})`);

  const data = await res.json();
  const bars: { c: number }[] = data?.bars ?? [];
  const closes = bars.map(b => b.c).filter((c): c is number => Number.isFinite(c));

  const unknownResult = (reason: string): TrendResult => ({
    trend: 'unknown',
    strategy: 'NO_TRADE',
    subtype: 'UNKNOWN',
    confidence: 0,
    ma20: 0,
    ma50: 0,
    ma200: 0,
    reason,
  });

  if (closes.length < 90) {
    throw new Error(`no bars: ${cleanSymbol} returned only ${closes.length} closes — likely invalid symbol`);
  }

  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const pct = (current: number, prior: number) => prior === 0 ? 0 : (current - prior) / prior;
  const max = (values: number[]) => Math.max(...values);
  const min = (values: number[]) => Math.min(...values);
  const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
  const signedScale = (value: number, fullAt: number, maxPoints: number) => {
    const sign = value >= 0 ? 1 : -1;
    return sign * Math.min(1, Math.abs(value) / fullAt) * maxPoints;
  };
  const calcRsi = (values: number[], period = 14): number | null => {
    if (values.length < period + 1) return null;

    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  const currentPrice = closes[closes.length - 1];
  const rsi14 = calcRsi(closes, 14) ?? 50;
  const ma20 = avg(closes.slice(-20));
  const ma50 = avg(closes.slice(-50));
  const ma200 = closes.length >= 200 ? avg(closes.slice(-200)) : avg(closes);
  const ma20Prev = avg(closes.slice(-40, -20));
  const ma50Prev = closes.length >= 100 ? avg(closes.slice(-100, -50)) : avg(closes.slice(-90, -40));

  const ma20Slope = pct(ma20, ma20Prev);
  const ma50Slope = pct(ma50, ma50Prev);
  const momentum10 = pct(currentPrice, closes[closes.length - 11]);
  const momentum20 = pct(currentPrice, closes[closes.length - 21]);
  const momentum40 = pct(currentPrice, closes[closes.length - 41]);
  const momentum60 = pct(currentPrice, closes[closes.length - 61]);
  const momentum90 = pct(currentPrice, closes[closes.length - 91]);

  const last10 = closes.slice(-10);
  const last20 = closes.slice(-20);
  const prior20 = closes.slice(-40, -20);
  const last40 = closes.slice(-40);
  const prior40 = closes.slice(-80, -40);
  const last60 = closes.slice(-60);
  const prior60 = closes.slice(-120, -60);
  const last90 = closes.slice(-90);

  const high20 = max(last20), low20 = min(last20);
  const high40 = max(last40), low40 = min(last40);
  const high60 = max(last60), low60 = min(last60);
  const high90 = max(last90), low90 = min(last90);
  const priorHigh20 = max(prior20), priorLow20 = min(prior20);
  const priorHigh40 = max(prior40), priorLow40 = min(prior40);
  const priorHigh60 = prior60.length ? max(prior60) : priorHigh40;
  const priorLow60 = prior60.length ? min(prior60) : priorLow40;

  const range60 = pct(high60, low60);
  const net60 = Math.abs(momentum60);
  const chopRatio = net60 < 0.01 ? 99 : range60 / net60;
  const distFromMa20 = pct(currentPrice, ma20);
  const distFromMa50 = pct(currentPrice, ma50);
  const drawdownFrom60High = pct(currentPrice, high60); // negative number
  const drawdownFrom90High = pct(currentPrice, high90); // negative number
  const reboundFrom60Low = pct(currentPrice, low60);
  const reboundFrom90Low = pct(currentPrice, low90);
  const near60High = currentPrice >= high60 * 0.96;
  const near60Low = currentPrice <= low60 * 1.04;

  const higherLows = low20 > priorLow20 * 0.985;
  const higherHighs = high20 > priorHigh20 * 1.005;
  const lowerHighs = high20 < priorHigh20 * 1.015;
  const lowerLows = low20 < priorLow20 * 0.995;
  const regimeHigherLows = low40 > priorLow40 * 0.985;
  const regimeHigherHighs = high40 > priorHigh40 * 1.005;
  const regimeLowerHighs = high40 < priorHigh40 * 1.015;
  const regimeLowerLows = low40 < priorLow40 * 0.995;
  const brokePriorSupport = currentPrice < priorLow60 * 0.985 || currentPrice < priorLow40 * 0.985;
  const brokePriorResistance = currentPrice > priorHigh60 * 1.015 || currentPrice > priorHigh40 * 1.015;

  const isIdx = isIndexOrEtf ?? false;
  const highVolName = Math.abs(momentum60) > 0.18 || range60 > 0.34 || Math.abs(momentum90) > 0.30;
  const maxHealthyRange60 = isIdx ? 0.22 : highVolName ? 0.48 : 0.34;
  const maxChaoticRange60 = isIdx ? 0.30 : highVolName ? 0.72 : 0.52;

  let momentumScore = 0;
  momentumScore += signedScale(momentum20, 0.10, 18);
  momentumScore += signedScale(momentum60, 0.22, 22);
  // A small 90-day memory prevents a few right-edge candles from fully reversing the regime.
  momentumScore += signedScale(momentum90, 0.35, 8);

  let maAlignmentScore = 0;
  if (currentPrice > ma20) maAlignmentScore += 8; else maAlignmentScore -= 8;
  if (currentPrice > ma50) maAlignmentScore += 10; else maAlignmentScore -= 10;
  if (ma20 > ma50) maAlignmentScore += 10; else maAlignmentScore -= 10;
  // Distance from the 50MA matters, but too much distance is handled by maturity/exhaustion below.
  maAlignmentScore += signedScale(distFromMa50, 0.12, 6);

  let slopeScore = 0;
  slopeScore += signedScale(ma20Slope, 0.035, 13);
  slopeScore += signedScale(ma50Slope, 0.025, 9);

  let structureScore = 0;
  if (higherHighs) structureScore += 7;
  if (higherLows) structureScore += 9;
  if (regimeHigherHighs) structureScore += 8;
  if (regimeHigherLows) structureScore += 10;
  if (lowerHighs) structureScore -= 9;
  if (lowerLows) structureScore -= 7;
  if (regimeLowerHighs) structureScore -= 10;
  if (regimeLowerLows) structureScore -= 8;

  let regimeScore = 0;
  if (brokePriorResistance && momentum40 > 0) regimeScore += 12;
  if (brokePriorSupport && momentum40 < 0) regimeScore -= 12;
  if (currentPrice > high90 * 0.98 && momentum60 > 0.08) regimeScore += 8;
  if (currentPrice < low90 * 1.04 && momentum60 < -0.08) regimeScore -= 8;
  // Failed trend behavior: prior strength followed by a decisive break is bearish even if the long chart was once bullish.
  if (momentum90 > 0.10 && momentum20 < -0.07 && currentPrice < ma20 && drawdownFrom60High < -0.12) regimeScore -= 16;
  // Recovery behavior: prior weakness followed by reclaiming averages can be a bullish reversal.
  if (momentum90 < -0.10 && momentum20 > 0.07 && currentPrice > ma20 && reboundFrom60Low > 0.12) regimeScore += 14;

  const rawDirectionalScore = momentumScore + maAlignmentScore + slopeScore + structureScore + regimeScore;

  let volatilityPenalty = 0;
  if (range60 > maxHealthyRange60) volatilityPenalty += range60 > maxChaoticRange60 ? 22 : 9;

  let chopPenalty = 0;
  if (chopRatio > 6.0) chopPenalty += 18;
  else if (chopRatio > 4.0) chopPenalty += 10;
  else if (chopRatio > 3.0) chopPenalty += 5;

  // Trend maturity / exhaustion: direction may be right, but trade quality is poor when the move is vertical.
  let maturityPenalty = 0;
  const upsideExhausted =
    (momentum10 > 0.18 && momentum20 > 0.28) ||
    (distFromMa50 > 0.28 && reboundFrom60Low > 0.55) ||
    (near60High && reboundFrom60Low > 0.75 && range60 > 0.55);
  const downsideExhausted =
    (momentum10 < -0.18 && momentum20 < -0.28) ||
    (distFromMa50 < -0.25 && Math.abs(drawdownFrom60High) > 0.45) ||
    (near60Low && Math.abs(drawdownFrom60High) > 0.55 && range60 > 0.55);

  if (upsideExhausted || downsideExhausted) maturityPenalty += highVolName ? 16 : 24;
  if (Math.abs(momentum20) > 0.40) maturityPenalty += 12;

  const penalty = volatilityPenalty + chopPenalty + maturityPenalty;
  const directionalScore = rawDirectionalScore > 0
    ? rawDirectionalScore - penalty
    : rawDirectionalScore + penalty;

  const scores = {
    momentum: Math.round(momentumScore),
    maAlignment: Math.round(maAlignmentScore),
    slope: Math.round(slopeScore),
    structure: Math.round(structureScore + regimeScore),
    chop: Math.round(chopPenalty),
    volatility: Math.round(volatilityPenalty + maturityPenalty),
    total: Math.round(directionalScore),
  };

  const metrics = {
    price: currentPrice,
    ma20,
    ma50,
    ma200,
    momentum10,
    momentum20,
    momentum40,
    momentum60,
    momentum90,
    rsi14,
    ma20Slope,
    ma50Slope,
    range60,
    chopRatio,
    distFromMa20,
    distFromMa50,
    drawdownFrom60High,
    drawdownFrom90High,
    reboundFrom60Low,
    reboundFrom90Low,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    regimeHigherHighs,
    regimeHigherLows,
    regimeLowerHighs,
    regimeLowerLows,
    brokePriorSupport,
    brokePriorResistance,
    upsideExhausted,
    downsideExhausted,
  };



  // ── Spike-resistant range metrics ─────────────────────────────────────────
  // Raw high60/low60 are poisoned by single outlier candles (AFL Feb spike,
  // INTC April spike). Sort last60 closes and trim the top/bottom 3 values
  // to get a robust range that ignores event-driven wicks.
  const last60Sorted = [...last60].sort((a, b) => a - b);
  const trimN = Math.min(3, Math.floor(last60.length * 0.05));
  const trimmedLow60  = last60Sorted[trimN];
  const trimmedHigh60 = last60Sorted[last60Sorted.length - 1 - trimN];
  const trimmedRange60   = trimmedLow60 > 0 ? (trimmedHigh60 - trimmedLow60) / trimmedLow60 : range60;
  const trimmedNet60     = Math.abs(momentum60);
  const trimmedChopRatio = trimmedNet60 < 0.01 ? 99 : trimmedRange60 / trimmedNet60;
  const trimmedDrawdownFrom60High = trimmedHigh60 > 0 ? (currentPrice - trimmedHigh60) / trimmedHigh60 : drawdownFrom60High;
  const trimmedReboundFrom60Low  = trimmedLow60  > 0 ? (currentPrice - trimmedLow60)  / trimmedLow60  : reboundFrom60Low;

  // Use trimmed metrics for classification decisions; keep raw in `metrics` for display.
  const tRange60    = trimmedRange60;
  const tChopRatio  = trimmedChopRatio;
  const tDD60High   = trimmedDrawdownFrom60High;
  const tReb60Low   = trimmedReboundFrom60Low;

  const absScore = Math.abs(directionalScore);
  const conflictPenalty = Math.abs(momentumScore) > 12 && Math.abs(maAlignmentScore) > 12 && Math.sign(momentumScore) !== Math.sign(maAlignmentScore) ? 12 : 0;
  const confidence = Math.round(clamp(absScore - conflictPenalty - penalty * 0.35, 0, 100));

  // ── STEP 1: Hard exits — broken/untradeable charts ─────────────────────────
  // Catastrophic recent drop (>25% in last 10 bars) = event-driven, not tradeable.
  // Exception: stock already in a confirmed sustained downtrend (the drop is just the final leg).
  const recentCatastrophicDrop = pct(currentPrice, max(closes.slice(-11, -1))) < -0.25;
  const preCatastrophicDowntrend =
    (lowerHighs || regimeLowerHighs) &&
    (lowerLows || regimeLowerLows) &&
    tDD60High < -0.30 &&
    momentum60 < -0.10;
  if (recentCatastrophicDrop && !preCatastrophicDowntrend) {
    return {
      trend: 'unknown', strategy: 'NO_TRADE', subtype: 'CHOP', confidence: 20,
      ma20, ma50, ma200, scores, metrics,
      reason: `REVIEW: catastrophic drop >25% in last 10 bars — event-driven, chart not yet tradeable. Wait for structure to form.`,
    };
  }

  // ── STEP 2: Compute regime scores ─────────────────────────────────────────
  // Three competing scores: trendStrength, rangeScore, chaoticScore.
  // Classification is determined by which wins, not by gate order.

  // trendStrength: how cleanly directional is this chart?
  const trendStrength = absScore;

  // rangeScore: evidence the chart is IC-range-bound.
  // High when: recent range is tight, price is mid-channel, MAs are flat/converging,
  // no clear directional structure, oscillating behavior.
  let rangeScore = 0;
  const recentRange20Pct = high20 > 0 ? (high20 - low20) / low20 : 1;
  // Tight recent action
  if (recentRange20Pct < 0.08) rangeScore += 20;
  else if (recentRange20Pct < 0.12) rangeScore += 12;
  else if (recentRange20Pct < 0.18) rangeScore += 5;
  // Flat MAs (converging = sideways regime)
  const maSpreadPct = Math.abs(pct(ma20, ma50));
  if (maSpreadPct < 0.015) rangeScore += 18;
  else if (maSpreadPct < 0.03) rangeScore += 10;
  else if (maSpreadPct < 0.05) rangeScore += 4;
  // Weak momentum (price going nowhere on net)
  if (Math.abs(momentum60) < 0.03) rangeScore += 16;
  else if (Math.abs(momentum60) < 0.06) rangeScore += 8;
  else if (Math.abs(momentum60) < 0.10) rangeScore += 2;
  // Oscillating structure (no consistent higher-high/lower-low pattern)
  const mixedStructure = (higherHighs && lowerLows) || (lowerHighs && higherLows) ||
    (!higherHighs && !lowerHighs && !higherLows && !lowerLows);
  if (mixedStructure) rangeScore += 14;
  // Chop: only add range score when chop is genuine (trimmed), not spike-induced
  if (tChopRatio > 4.0) rangeScore += 10;
  else if (tChopRatio > 2.5) rangeScore += 5;
  // Price near MA20 (center of range)
  if (Math.abs(distFromMa20) < 0.03) rangeScore += 8;
  else if (Math.abs(distFromMa20) < 0.06) rangeScore += 3;
  // Penalize strong directional MA alignment
  if (Math.abs(maAlignmentScore) > 22) rangeScore -= 15;
  else if (Math.abs(maAlignmentScore) > 14) rangeScore -= 8;

  // chaoticScore: evidence the chart is broken/untradeable.
  let chaoticScore = 0;
  // Extreme trimmed range (even after spike removal, it's wild)
  if (tRange60 > maxChaoticRange60) chaoticScore += 30;
  else if (tRange60 > maxHealthyRange60 * 1.3) chaoticScore += 15;
  // Strong directional score + exhaustion = broken, not tradeable
  if (upsideExhausted && directionalScore > 45) chaoticScore += 25;
  if (downsideExhausted && directionalScore < -45) chaoticScore += 25;
  // Post-crash stabilization REDUCES chaoticScore — it's actually IC-eligible
  const postCrashStabilized =
    range60 > maxHealthyRange60 &&
    recentRange20Pct < 0.10 &&
    Math.abs(momentum20) < 0.05 &&
    Math.abs(momentum40) < 0.12 &&
    tDD60High < -0.15;
  if (postCrashStabilized) chaoticScore -= 20;

  // ── STEP 3: Directional memory — overrides marginal range calls ───────────
  // Two booleans only. Computed from trimmed metrics + structure.
  // Bearish: lower-high structure + slope confirmed + no strong bounce
  const clearBearishStructure =
    (lowerHighs || regimeLowerHighs) &&
    (lowerLows || regimeLowerLows || brokePriorSupport || (ma20Slope < -0.008 && tDD60High < -0.12)) &&
    (ma20Slope < -0.005 || momentum40 < -0.03 || ma50Slope < -0.008) &&
    tDD60High < -0.06 &&
    !(momentum90 > 0.25 && tDD60High < -0.20 && tRange60 > 0.35);

  const bearishDirectionalMemory =
    clearBearishStructure &&
    directionalScore <= -10 &&
    !(momentum20 > 0.08 && currentPrice > ma20 && tReb60Low > 0.20) &&
    !(momentum60 > 0.12 && currentPrice > ma50);

  // Bullish: higher-low structure + price above MA50 + slope confirmed + no sharp breakdown
  const clearBullishStructure =
    (higherLows || regimeHigherLows) &&
    currentPrice > ma50 &&
    (ma20Slope > 0.005 || momentum40 > 0.03) &&
    directionalScore >= 8 &&
    tDD60High > -0.25;

  const bullishDirectionalMemory =
    clearBullishStructure &&
    directionalScore >= 15 &&
    !(momentum20 < -0.06 && currentPrice < ma20);

  // ── STEP 4: Strong directional patterns (high confidence, fire first) ──────
  const bullishContinuation =
    directionalScore >= 68 && ma20 > ma50 && currentPrice > ma20 &&
    momentum60 > 0.07 && (higherLows || regimeHigherLows) && !upsideExhausted;

  const bearishContinuation =
    directionalScore <= -62 && currentPrice < ma20 &&
    (ma20 < ma50 || ma20Slope < -0.015) &&
    (momentum60 < -0.06 || momentum20 < -0.08) &&
    (lowerHighs || lowerLows || brokePriorSupport);

  const bullishReversal =
    directionalScore >= 48 && currentPrice > ma20 &&
    momentum20 > 0.035 && momentum60 > 0.07 &&
    (higherLows || regimeHigherLows) && regimeHigherLows &&
    momentum90 > -0.35 && !upsideExhausted;

  const bearishReversal =
    directionalScore <= -48 && currentPrice < ma20 &&
    momentum20 < -0.035 &&
    (momentum60 < -0.035 || ma20Slope < -0.012 || brokePriorSupport) &&
    (lowerHighs || lowerLows || regimeLowerHighs || regimeLowerLows) &&
    !downsideExhausted;

  // High-vol recovery: confirmed V-bounce above both MAs (catches DDOG/PANW-type recoveries)
  const volatileRecovery =
    momentum20 > 0.06 && momentum10 > 0.02 &&
    currentPrice > ma20 && currentPrice > ma50 &&
    (higherLows || regimeHigherLows) &&
    tReb60Low > 0.20 && !upsideExhausted;

  if (bullishContinuation) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'CONTINUATION', confidence,
      ma20, ma50, ma200, scores, metrics,
      reason: `BPS CONTINUATION: score ${scores.total}, momentum ${scores.momentum}, MA ${scores.maAlignment}, slope ${scores.slope}, structure/regime ${scores.structure}.` };
  }
  if (bearishContinuation) {
    return { trend: 'downtrend', strategy: 'BCS', subtype: 'CONTINUATION', confidence,
      ma20, ma50, ma200, scores, metrics,
      reason: `BCS CONTINUATION: score ${scores.total}, momentum ${scores.momentum}, MA ${scores.maAlignment}, slope ${scores.slope}, structure/regime ${scores.structure}.` };
  }
  if (bullishReversal) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'REVERSAL', confidence: Math.max(55, Math.min(74, confidence)),
      ma20, ma50, ma200, scores, metrics,
      reason: `BPS REVERSAL: recovery with improving structure. Score ${scores.total}, 20d mom ${(momentum20 * 100).toFixed(1)}%, 60d mom ${(momentum60 * 100).toFixed(1)}%.` };
  }
  if (bearishReversal) {
    return { trend: 'downtrend', strategy: 'BCS', subtype: 'REVERSAL', confidence: Math.max(55, Math.min(74, confidence)),
      ma20, ma50, ma200, scores, metrics,
      reason: `BCS REVERSAL: deterioration/failure after prior strength. Score ${scores.total}, 20d mom ${(momentum20 * 100).toFixed(1)}%, 60d mom ${(momentum60 * 100).toFixed(1)}%.` };
  }
  if (volatileRecovery) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'REVERSAL', confidence: Math.max(52, Math.min(72, confidence)),
      ma20, ma50, ma200, scores, metrics,
      reason: `BPS RECOVERY: confirmed V-bounce above both MAs. Score ${scores.total}, 20d mom +${(momentum20 * 100).toFixed(1)}%, rebound from low ${(tReb60Low * 100).toFixed(1)}%.` };
  }

  // ── STEP 5: Regime classification by score dominance ──────────────────────
  // Now that strong directional patterns have been handled, decide between
  // IC (rangeScore wins), BCS/BPS (trendStrength + directional memory wins),
  // or chaotic/extended (chaoticScore wins).

  // Chaotic/extended: broken chart, no clean trade
  if (chaoticScore >= 30 && chaoticScore > rangeScore && chaoticScore > trendStrength * 0.6) {
    if (upsideExhausted || downsideExhausted) {
      return { trend: directionalScore > 0 ? 'uptrend' : 'downtrend', strategy: 'NO_TRADE', subtype: 'UNKNOWN',
        confidence: Math.max(42, Math.min(58, confidence)), ma20, ma50, ma200, scores, metrics,
        reason: `REVIEW EXTENDED: ${directionalScore > 0 ? 'bullish' : 'bearish'} direction but move is mature/vertical. 20d mom ${(momentum20 * 100).toFixed(1)}%, dist 50MA ${(distFromMa50 * 100).toFixed(1)}%, trimmed range ${(tRange60 * 100).toFixed(1)}%.` };
    }
    return { trend: 'sideways', strategy: 'NO_TRADE', subtype: 'CHOP',
      confidence: Math.max(25, Math.min(48, confidence)), ma20, ma50, ma200, scores, metrics,
      reason: `NO_TRADE CHOP: trimmed 60d range ${(tRange60 * 100).toFixed(1)}%, chop ${tChopRatio.toFixed(1)}, directional score ${scores.total}.` };
  }

  // Directional memory overrides IC when structure is confirmed
  if (bearishDirectionalMemory && rangeScore < trendStrength + 15) {
    const isStrong = directionalScore <= -15 && (currentPrice < ma50 || (lowerHighs && regimeLowerHighs));
    return { trend: 'downtrend', strategy: 'BCS',
      subtype: isStrong ? 'CONTINUATION' : 'REVERSAL',
      confidence: Math.max(isStrong ? 52 : 45, Math.min(isStrong ? 70 : 62, confidence)),
      ma20, ma50, ma200, scores, metrics,
      reason: `BCS (bearish structure): score ${scores.total} — lower highs/lows confirmed, price rolling over. Trimmed range ${(tRange60 * 100).toFixed(1)}%, chop ${tChopRatio.toFixed(1)}.` };
  }

  if (bullishDirectionalMemory && rangeScore < trendStrength + 15) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'CONTINUATION',
      confidence: Math.max(52, Math.min(70, confidence)), ma20, ma50, ma200, scores, metrics,
      reason: `BPS (bullish structure): score ${scores.total} — higher lows, price above MA50, slope confirms direction. Trimmed range ${(tRange60 * 100).toFixed(1)}%, chop ${tChopRatio.toFixed(1)}.` };
  }

  // IC: range wins when rangeScore clearly dominates and no directional memory override
  const rangeDominates = rangeScore >= 40 && rangeScore > trendStrength * 0.7;
  if (rangeDominates || postCrashStabilized) {
    return { trend: 'sideways', strategy: 'IC', subtype: 'RANGE',
      confidence: Math.max(55, Math.min(78, Math.round(rangeScore * 0.78))),
      ma20, ma50, ma200, scores, metrics,
      reason: `IC RANGE: range score ${Math.round(rangeScore)} vs trend strength ${Math.round(trendStrength)}. Trimmed range ${(tRange60 * 100).toFixed(1)}%, chop ${tChopRatio.toFixed(1)}, MA spread ${(maSpreadPct * 100).toFixed(1)}%.${postCrashStabilized ? ` Post-crash stabilization: last 20 bars tight at ${(recentRange20Pct * 100).toFixed(1)}%.` : ''}` };
  }

  // Weak directional leans — assign direction if there's any structural support
  if (directionalScore <= -18 && currentPrice < ma50 && (lowerHighs || brokePriorSupport)) {
    return { trend: 'downtrend', strategy: 'BCS', subtype: 'REVERSAL',
      confidence: Math.max(40, Math.min(55, confidence)), ma20, ma50, ma200, scores, metrics,
      reason: `BCS (weak lean): score ${scores.total} — below MA50 with lower-high or support break. Monitor carefully.` };
  }
  if (directionalScore >= 18 && currentPrice > ma50 && (higherLows || regimeHigherLows) && momentum60 > 0.05) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'REVERSAL',
      confidence: Math.max(40, Math.min(55, confidence)), ma20, ma50, ma200, scores, metrics,
      reason: `BPS (weak lean): score ${scores.total} — above MA50 with higher-low structure. Monitor carefully.` };
  }
  if (directionalScore >= 45 && currentPrice > ma50 && momentum60 > 0.04 && ma20Slope > 0) {
    return { trend: 'uptrend', strategy: 'BPS', subtype: 'REVERSAL',
      confidence: Math.max(42, Math.min(58, confidence)), ma20, ma50, ma200, scores, metrics,
      reason: `BPS (strong score, recovering): score ${scores.total} — above MA50, positive slope and momentum. Higher-low structure not yet confirmed.` };
  }

  // Final fallback: genuinely ambiguous
  return {
    trend: 'unknown', strategy: 'NO_TRADE', subtype: 'UNKNOWN',
    confidence: Math.max(35, Math.min(54, confidence)),
    ma20, ma50, ma200, scores, metrics,
    reason: `REVIEW: conflicting signals — score ${scores.total}, range score ${Math.round(rangeScore)}, trend strength ${Math.round(trendStrength)}. Momentum ${scores.momentum}, MA ${scores.maAlignment}, slope ${scores.slope}, structure ${scores.structure}.`,
  };
}


