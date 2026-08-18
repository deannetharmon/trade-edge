// lib/scans/rank-scoring.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import type { ScreenResult, SpreadCandidate, TrendResult, RankConfig, DimensionScore, CheckResult } from './types';
import type { RulesType } from './constants';
import { RANK_SCAN_DTE_MIN, RANK_SCAN_DTE_MAX } from './constants';
import { daysUntil, formatDisplayDate, estimateNextEarningsDate, calcSpreadPop, normalizeIv } from './scan-utils';
import { findBestICUnfiltered } from './spread-finder';
import { runChecklist } from './checklist';

// Shared with the order-entry warning gate (TradeModal) so the hard-block
// threshold stays in lockstep with the score instead of drifting.
const BUFFER_THRESHOLDS: Record<'index' | 'etf' | 'stock', number[][]> = {
  index: [
    [3, 4, 5, 6, 8],
    [3, 4, 5, 6, 8],
    [3, 5, 6, 7, 8],
  ],
  etf: [
    [3, 3.5, 4, 5, 7],
    [3, 3.5, 4, 5, 7],
    [3, 4,   5, 6, 7],
  ],
  stock: [
    [3, 5,  6,  8, 10],
    [3, 6,  7,  8, 10],
    [6, 8, 10, 11, 12],
  ],
};

export function getBufferThresholds(dte: number, type: 'index' | 'etf' | 'stock'): { crit: number; marg: number; ok: number; good: number; full: number } {
  // DTE bucket: 0=tight(21-29), 1=mid(30-39), 2=sweet(40-45+)
  const dteBucket = dte >= 40 ? 2 : dte >= 30 ? 1 : 0;
  const [crit, marg, ok, good, full] = BUFFER_THRESHOLDS[type][dteBucket];
  return { crit, marg, ok, good, full };
}

// Below "marg" is the same zone scoreBuffer() starts treating as
// critical/near-zero — use it to hard-block premature order submission.
export function getOtmWarningThreshold(dte: number, type: 'index' | 'etf' | 'stock'): number {
  return getBufferThresholds(dte, type).marg;
}

export function scoreBuffer(bufferPct: number | null | undefined, dte: number, type: 'index' | 'etf' | 'stock'): number {
  if (bufferPct == null) return 0.4; // unknown — neutral, don't penalize
  const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const { crit, marg, ok, good, full } = getBufferThresholds(dte, type);

  if (bufferPct >= full) return 1.0;
  if (bufferPct >= good) return clamp(0.75 + (bufferPct - good) / (full - good) * 0.25);
  if (bufferPct >= ok)   return clamp(0.5  + (bufferPct - ok)   / (good - ok)   * 0.25);
  if (bufferPct >= marg) return clamp(0.25 + (bufferPct - marg) / (ok - marg)   * 0.25);
  if (bufferPct >= crit) return clamp(0.05 + (bufferPct - crit) / (marg - crit) * 0.20);
  return 0; // below critical — zero score
}

export interface PmccScoreBreakdown {
  wmdScore: number;
  longDeltaScore: number;
  roiScore: number;
  shortDeltaScore: number;
  totalScore: number;
  wmdPct: number;
  annualizedRoi: number;
}

export function calculatePmccScore(
  shortStrike: number,
  longStrike: number,
  netDebit: number,
  longDelta: number,
  shortDelta: number,
  annualizedRoi: number
): PmccScoreBreakdown {
  const wmdPct = netDebit > 0 ? ((shortStrike - longStrike - netDebit) / netDebit) * 100 : 0;
  let wmdBase = 0;
  
  if (wmdPct <= 0) {
    wmdBase = 0;
  } else if (wmdPct < 1.0) {
    wmdBase = 25; 
  } else if (wmdPct < 4.0) {
    wmdBase = 40 + ((wmdPct - 1.0) / 3.0) * 29; 
  } else if (wmdPct < 8.0) {
    wmdBase = 70 + ((wmdPct - 4.0) / 4.0) * 29; 
  } else {
    wmdBase = 100;
  }

  let longDeltaBase = 0;
  const absLongDelta = Math.abs(longDelta);
  if (absLongDelta >= 0.82) longDeltaBase = 100;
  else if (absLongDelta >= 0.80) longDeltaBase = 90;
  else if (absLongDelta >= 0.77) longDeltaBase = 60;
  else if (absLongDelta >= 0.73) longDeltaBase = 30;
  else longDeltaBase = 0;

  let roiBase = 0;
  if (annualizedRoi > 75) roiBase = 70; 
  else if (annualizedRoi >= 45) roiBase = 100; 
  else if (annualizedRoi >= 35) roiBase = 80 + ((annualizedRoi - 35) / 10) * 15; 
  else if (annualizedRoi >= 25) roiBase = 60 + ((annualizedRoi - 25) / 10) * 19; 
  else roiBase = 40;

  let shortDeltaBase = 0;
  const absShortDelta = Math.abs(shortDelta);
  if (absShortDelta < 0.20) shortDeltaBase = 90; 
  else if (absShortDelta <= 0.24) shortDeltaBase = 100; 
  else if (absShortDelta <= 0.28) shortDeltaBase = 80; 
  else if (absShortDelta <= 0.33) shortDeltaBase = 50; 
  else shortDeltaBase = 20;

  const wmdScore = wmdBase * 0.35;
  const longDeltaScore = longDeltaBase * 0.25;
  const roiScore = roiBase * 0.25;
  const shortDeltaScore = shortDeltaBase * 0.15;
  const totalScore = wmdScore + longDeltaScore + roiScore + shortDeltaScore;

  return {
    wmdScore, longDeltaScore, roiScore, shortDeltaScore,
    totalScore: Math.round(totalScore),
    wmdPct, annualizedRoi
  };
}

export function scoreCandidate(result: ScreenResult, cfg: RankConfig): { score: number; dims: DimensionScore } | null {
  const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const t = result.trendResult;
  const c = result.bestCandidate;
  const rsi14 = result.trendResult?.metrics?.rsi14 ?? null;

  // ── PMCC Dedicated Scoring Branch ──────────────────────────────────────────
  if (c && c.strategy === 'PMCC') {
    const netDebit = c.netDebit ?? (c.longCost != null && c.credit != null ? c.longCost - c.credit : 1);
    const annRoi = c.annualizedRoc ?? (c.roc * (365 / Math.max(1, c.dte)));

    const pmccScores = calculatePmccScore(
      c.shortStrike,
      c.longStrike ?? 0,
      netDebit,
      c.longDelta ?? 0.80,
      c.shortDelta ?? 0.20,
      annRoi
    );

    return {
      score: pmccScores.totalScore,
      dims: {
        momentum: 0,
        ivr: 0,
        emClearance: 0,
        range: Math.round(pmccScores.longDeltaScore),
        technical: Math.round(pmccScores.shortDeltaScore),
        liquidity: Math.round(pmccScores.roiScore),
        buffer: Math.round(pmccScores.wmdScore),
        total: pmccScores.totalScore,
      },
    };
  }

  // ── Momentum (30pts) ──────────────────────────────────────────────────────
  // trend engine momentum is signed (-48..+48); normalize by direction alignment
  // When total directional score is very strong (>100), boost momentum slightly
  let momentumRaw = 0;
  if (t?.scores?.momentum != null) {
    const raw = t.scores.momentum;
    const totalScore = Math.abs(t.scores.total ?? raw);
    // normalize: 45 = typical max momentum; total score >100 = very strong signal
    const absNorm = clamp(Math.abs(raw) / 45);
    const totalBoost = clamp(totalScore / 120); // strong total score adds up to 15% boost
    const expectedSign = t.strategy === 'BPS' ? 1 : t.strategy === 'BCS' ? -1 : 0;
    const aligned = expectedSign === 0 ? 0.7 : (Math.sign(raw) === expectedSign ? 1.0 : 0.3);
    // IVR boost: when momentum is very strong, reduce IVR penalty weight
    // (WFC fix: strong -135 BCS signal should rank high even with 39% IVR)
    momentumRaw = clamp(absNorm * 0.75 + totalBoost * 0.25) * aligned;
  } else if (t?.confidence != null) {
    momentumRaw = clamp(t.confidence / 80);
    if (t.trend === 'sideways' || t.trend === 'unknown') momentumRaw *= 0.5;
  } else if (c) {
    const pop = c.pop ?? 70;
    momentumRaw = clamp((pop - 60) / 25);
  }
  const momentumScore = clamp(momentumRaw) * cfg.weightMomentum;

  // ── IVR Quality (15pts) ───────────────────────────────────────────────────
  // IVR answers "should I be selling at all?" — bell curve peaking at 50-65
  const ivr = result.ivr ?? 0;
  const ivrRaw =
    ivr >= 50 && ivr <= 90 ? 1
    : ivr < 50 ? ivr / 50
    : 1 - (ivr - 90) / 50;
  const momentumStrength = t?.scores?.total != null ? clamp(Math.abs(t.scores.total) / 150) : 0;
  const effectiveIvrWeight = (cfg.weightIvr ?? 15) * (1 - momentumStrength * 0.35);
  const ivrScore = clamp(ivrRaw) * effectiveIvrWeight;

  // ── EM Clearance (15pts) ──────────────────────────────────────────────────
  // How far outside the expected move is the short strike?
  // >15% beyond EM = full score; inside EM = zero
  let emClearanceRaw = 0.5; // neutral default when EM unavailable
  if (c?.expectedMove != null && c.expectedMove > 0 && result.price != null && result.price > 0) {
    const shortStrike = c.shortStrike;
    const price = result.price;
    const em = c.expectedMove;
    // Distance from short strike to the EM boundary
    const emBoundary = c.strategy === 'BPS' ? price - em : price + em;
    const clearancePct = c.strategy === 'BPS'
      ? (emBoundary - shortStrike) / price * 100   // positive = outside EM
      : (shortStrike - emBoundary) / price * 100;
    // Score: inside EM = 0, 5% outside = 0.5, 15%+ outside = 1.0
    emClearanceRaw = clearancePct <= 0 ? 0
      : clearancePct >= 15 ? 1.0
      : clearancePct / 15;
  }
  const emClearanceScore = clamp(emClearanceRaw) * (cfg.weightEmClearance ?? 15);

  // ── 52W Range Position (20pts) ────────────────────────────────────────────
  // BPS near 52W highs (r60 > 0.85) gets penalized — stock is stretched
  // BCS near 52W lows (r60 < 0.15) gets penalized — stock is stretched
  // (CAT/GOOGL fix: at 93-97% of range, BPS is a risky setup)
  let rangeRaw = 0.5;
  if (t?.metrics?.range60 != null) {
    const r60 = clamp(t.metrics.range60);
    if (t.strategy === 'BPS') {
      // near lows = good, but also penalize if stock is at extreme highs (exhaustion risk)
      rangeRaw = r60 > 0.85 ? (1 - r60) * 2 : 1 - r60;
    } else if (t.strategy === 'BCS') {
      // near highs = good, but penalize extreme lows
      rangeRaw = r60 < 0.15 ? r60 * 2 : r60;
    } else {
      rangeRaw = 1 - Math.abs(r60 - 0.5) * 2;
    }
  } else if (t?.metrics?.distFromMa50 != null) {
    const dist = t.metrics.distFromMa50;
    if (t.strategy === 'BPS') rangeRaw = clamp(1 - (dist + 0.15) / 0.30);
    else if (t.strategy === 'BCS') rangeRaw = clamp((dist + 0.15) / 0.30);
    else rangeRaw = clamp(1 - Math.abs(dist) / 0.20);
  } else if (c) {
    rangeRaw = clamp(c.roc / 40);
  }
  const rangeScore = clamp(rangeRaw) * cfg.weightRange;

  // ── Technical (15pts) ─────────────────────────────────────────────────────
  // MA alignment signed (-34..+34), slope signed (-22..+22)
  let technicalRaw = 0;
  if (t?.scores != null) {
    const maRaw = t.scores.maAlignment ?? 0;
    const slopeRaw = t.scores.slope ?? 0;
    const expectedSign = t.strategy === 'BPS' ? 1 : t.strategy === 'BCS' ? -1 : 0;
    const maNorm = expectedSign === 0
      ? clamp(Math.abs(maRaw) / 34)
      : clamp((maRaw * expectedSign + 34) / 68);
    const slopeNorm = expectedSign === 0
      ? clamp(Math.abs(slopeRaw) / 22)
      : clamp((slopeRaw * expectedSign + 22) / 44);
    technicalRaw = maNorm * 0.6 + slopeNorm * 0.4;
  } else if (t?.confidence != null) {
    technicalRaw = clamp(t.confidence / 100) * 0.6;
  } else if (c) {
    const delta = c.shortDelta;
    technicalRaw = delta >= 0.20 && delta <= 0.30 ? 1.0 : clamp(1 - Math.abs(delta - 0.25) / 0.15);
  }
  const technicalScore = clamp(technicalRaw) * cfg.weightTechnical;

  // ── Liquidity (10pts) ─────────────────────────────────────────────────────
  // OI is weighted heavily here — low OI means the spread is physically untradeable
  // regardless of how good the other metrics look. OI < 100 is near-zero; OI >= 500 is full score.
  let liquidityRaw = 0.4;
  if (c) {
    const minOI = Math.min(c.shortOI, c.longOI);
    // Steep curve: OI=0→0, OI=100→0.18, OI=300→0.54, OI=500→1.0, OI>500→1.0
    const oiScore = minOI <= 0 ? 0 : clamp(Math.pow(minOI / 500, 0.7));
    const creditRatioScore = clamp((c.creditRatio - 0.15) / 0.35);
    const rocScore = clamp(c.roc / 35);
    // OI now carries 60% of liquidity score (was 40%) — low OI is a much bigger drag
    liquidityRaw = oiScore * 0.6 + creditRatioScore * 0.2 + rocScore * 0.2;
  }
  const liquidityScore = clamp(liquidityRaw) * cfg.weightLiquidity;

  // ── Buffer (25pts) ────────────────────────────────────────────────────────
  // Derive buffer from result.price vs short strike.
  // For BCS, buffer is distance above short call strike.
  // underlyingType drives which threshold table is used.
  let bufferScore = 0;
  if (c && result.price != null) {
    const bufferPct = c.strategy === 'BCS'
      ? ((c.shortStrike - result.price) / result.price) * 100
      : c.strategy === 'BPS'
        ? ((result.price - c.shortStrike) / result.price) * 100
        : Math.min(
            ((result.price - c.shortStrike) / result.price) * 100,
            ((c.shortCallStrike != null ? c.shortCallStrike - result.price : result.price) / result.price) * 100
          );
    const uType = result.underlyingType ?? 'stock';
    bufferScore = scoreBuffer(bufferPct, c.dte, uType) * (cfg.weightBuffer ?? 25);
  }

  let strategyAlignmentScore = 0;

  if (c && t?.scores?.total != null) {
    const trendScore = t.scores.total;
  
    if (c.strategy === 'BPS') {
      strategyAlignmentScore =
       trendScore > 75 ? 12 :
      trendScore > 40 ? 8 :
      trendScore > 0 ? 3 :
      -18;
    } else if (c.strategy === 'BCS') {
      strategyAlignmentScore =
        trendScore < -75 ? 12 :
        trendScore < -40 ? 8 :
        trendScore < 0 ? 3 :
        -18;
    } else if (c.strategy === 'IC') {
      strategyAlignmentScore =
        Math.abs(trendScore) < 40 ? 10 :
        Math.abs(trendScore) > 75 ? -10 :
        0;
    }
  }
  
  let deltaQualityScore = 0;
  
  if (c) {
    const d = c.shortDelta;
  
    deltaQualityScore =
      d >= 0.16 && d <= 0.22 ? 5 :
      d >= 0.12 && d <= 0.30 ? 3 :
      -8;
  }
  
  const total = Math.max(
    0,
    Math.round(
      momentumScore +
      ivrScore +
      emClearanceScore +
      rangeScore +
      technicalScore +
      liquidityScore +
      bufferScore +
      strategyAlignmentScore +
      deltaQualityScore
    )
  );
    return {
      score: Math.min(100, total),
      dims: {
        momentum: Math.round(momentumScore),
        ivr: Math.round(ivrScore),
        emClearance: Math.round(emClearanceScore),
        range: Math.round(rangeScore),
        technical: Math.round(technicalScore),
        liquidity: Math.round(liquidityScore),
        buffer: Math.round(bufferScore),
        total: Math.min(100, total),
      },
    };
  }


export function exploreAllCandidatesForRank(
  symbol: string,
  metrics: any,
  chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean },
  price: number | null,
  rules: RulesType,
  trendResult: TrendResult | undefined,
  isEtf: boolean,
  etfRules: RulesType,
  stockPresetLabel?: string,
  etfPresetLabel?: string,
): ScreenResult[] {
  const results: ScreenResult[] = [];
  const validExps = chainData.expirations.filter(exp => daysUntil(exp) >= RANK_SCAN_DTE_MIN && daysUntil(exp) <= RANK_SCAN_DTE_MAX);
  const appliedRules = isEtf ? etfRules : rules;

  for (const exp of validExps) {
    const dte = daysUntil(exp);
    const chainItems = chainData.chains[exp] ?? [];
    const singleExpChain = { ...chainData, expirations: [exp] };

    for (const strat of (['BPS', 'BCS', 'IC'] as const)) {
      try {
        if (strat === 'IC') {
          const candidate = findBestICUnfiltered(chainItems, exp, price);
          if (!candidate) continue;
          const result = runChecklist(symbol, strat, metrics, singleExpChain, price, appliedRules, trendResult, stockPresetLabel, isEtf ? etfRules : undefined, etfPresetLabel, true);
          const icBestCandidate = result.bestCandidate ?? candidate;
          // Recompute earnings against THIS candidate's actual dte -- the
          // strictOnly call into runChecklist above never set its internal
          // bestCandidate, so its earnings check is still the generic
          // DTE_MAX + 5 buffer text rather than this trade's real expiry.
          const icEarningsCheck: CheckResult = (() => {
            if (isEtf || !result.earningsDate) return result.checks.earnings;
            const ed = daysUntil(result.earningsDate);
            if (ed < 0) return { status: 'pass', value: `${result.earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(result.earningsDate))}` };
            if (ed <= icBestCandidate.dte) return { status: 'warn', value: `${ed}d (${result.earningsDate})`, reason: `Falls within this trade's ${icBestCandidate.dte}d expiry — scored lower in rank mode` };
            return { status: 'pass', value: `${ed}d (${result.earningsDate})`, reason: `Outside this trade's ${icBestCandidate.dte}d expiry` };
          })();
          results.push({
            ...result,
            bestCandidate: icBestCandidate,
            qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
            failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
            checks: { ...result.checks, earnings: icEarningsCheck },
          });
          continue;
        }

        const optType = strat === 'BPS' ? 'P' : 'C';
        const putCallLegs = chainItems.filter((o: any) => o.expirationDate === exp && o.optionType === optType);
        const stepSize = price == null ? 5 : price >= 2000 ? 25 : 5;
        const maxWidth = price == null ? 100 : Math.min(price * 0.15, 500);
        const seenStrikes = new Set<number>();

        for (const shortLeg of putCallLegs) {
          const delta = shortLeg.delta; if (delta == null) continue;
          const absDelta = Math.abs(delta);
          if (absDelta < 0.05 || absDelta > 0.60) continue;
          if (seenStrikes.has(shortLeg.strikePrice)) continue;
          seenStrikes.add(shortLeg.strikePrice);

          let bestCandidate: SpreadCandidate | null = null;
          let bestCreditRatio = -1;
          for (let width = stepSize; width <= maxWidth; width += stepSize) {
            const longStrike = strat === 'BPS' ? shortLeg.strikePrice - width : shortLeg.strikePrice + width;
            const longLeg = putCallLegs.find((o: any) => Math.abs(o.strikePrice - longStrike) < 0.01);
            if (!longLeg) continue;
            const credit = parseFloat((shortLeg.mid - longLeg.mid).toFixed(2));
            if (credit <= 0) continue; // structural floor — not a real premium-selling trade otherwise
            const creditRatio = credit / width;
            const maxLoss = width - credit;
            const roc = maxLoss > 0 ? (credit / maxLoss) * 100 : 0;

            const ivForPop =
              normalizeIv(metrics.expirationIvxMap?.[exp]) ??
              normalizeIv(metrics.ivx) ??
              normalizeIv(metrics.ivx30) ??
              normalizeIv(shortLeg.iv);

            const modelPop = calcSpreadPop(strat, price, shortLeg.strikePrice, credit, dte, ivForPop);
            if (modelPop == null) continue;

            if (creditRatio > bestCreditRatio) {
              bestCreditRatio = creditRatio;
              bestCandidate = {
                strategy: strat, expiration: exp, dte, shortStrike: shortLeg.strikePrice, longStrike,
                shortDelta: absDelta, shortOI: shortLeg.openInterest ?? 0, longOI: longLeg.openInterest ?? 0,
                credit, spreadWidth: width, creditRatio, roc, pop: modelPop, optimized: false,
                shortOccSymbol: shortLeg.occSymbol, longOccSymbol: longLeg.occSymbol,
                shortIv: normalizeIv(shortLeg.iv),
                expirationIvx: normalizeIv(metrics.expirationIvxMap?.[exp]) ?? null,
                expectedMove: null,
              };
            }
          }
          if (!bestCandidate) continue;

          const syntheticChain = { ...chainData, expirations: [exp], chains: { [exp]: chainItems } };
          const result = runChecklist(symbol, strat, metrics, syntheticChain, price, appliedRules, trendResult, stockPresetLabel, isEtf ? etfRules : undefined, etfPresetLabel, true);
          // Recompute earnings against THIS candidate's actual dte -- the
          // strictOnly call into runChecklist above never set its internal
          // bestCandidate, so its earnings check is still the generic
          // DTE_MAX + 5 buffer text rather than this trade's real expiry.
          const spreadEarningsCheck: CheckResult = (() => {
            if (isEtf || !result.earningsDate) return result.checks.earnings;
            const ed = daysUntil(result.earningsDate);
            if (ed < 0) return { status: 'pass', value: `${result.earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(result.earningsDate))}` };
            if (ed <= bestCandidate.dte) return { status: 'warn', value: `${ed}d (${result.earningsDate})`, reason: `Falls within this trade's ${bestCandidate.dte}d expiry — scored lower in rank mode` };
            return { status: 'pass', value: `${ed}d (${result.earningsDate})`, reason: `Outside this trade's ${bestCandidate.dte}d expiry` };
          })();
          results.push({
            ...result,
            bestCandidate,
            qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
            failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
            checks: {
              ...result.checks,
              earnings: spreadEarningsCheck,
              credit: { status: 'pass', value: `$${bestCandidate.credit.toFixed(2)}`, reason: `${(bestCandidate.creditRatio * 100).toFixed(0)}% of width` },
              delta: { status: 'pass', value: bestCandidate.shortDelta.toFixed(2), reason: 'Short leg delta' },
              pop: { status: 'pass', value: `${(bestCandidate.pop ?? 0).toFixed(0)}%`, reason: 'No floor — ranked by score' },
              roc: { status: bestCandidate.roc >= appliedRules.ROC_MIN_SPREAD ? 'pass' : 'fail', value: `${bestCandidate.roc.toFixed(0)}%`, reason: `Min ${appliedRules.ROC_MIN_SPREAD}%` },
              oi: (() => {
              // Gate on the SHORT leg only -- it's the one traded twice
              // (open + close) and the one carrying assignment risk. The
              // long leg is protection that typically only transacts as
              // part of the same combo order, so its OI alone rarely
              // blocks a clean fill the way thin short-leg OI does.
              const shortLegOi = bestCandidate.shortOI;
              return {
                status: shortLegOi >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                reason: shortLegOi >= appliedRules.OI_MIN
                  ? `Short leg ≥ ${appliedRules.OI_MIN}`
                  : `Below OI floor ${appliedRules.OI_MIN} on short leg`,
              };
            })(),
            },
          });
        }
      } catch {}
    }
  }
  return results;
}
