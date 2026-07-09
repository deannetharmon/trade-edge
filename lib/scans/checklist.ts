// lib/scans/checklist.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import type { ScreenResult, SpreadCandidate, TrendResult, CheckResult } from './types';
import type { RulesType } from './constants';
import { DEFAULT_ETF_RULES, INDEX_IVR_MIN } from './constants';
import { daysUntil, formatDisplayDate, estimateNextEarningsDate, normalizeIv } from './scan-utils';
import { findBestIC, findBestSpread, findBestICUnfiltered, findBestSpreadUnfiltered } from './spread-finder';

export function runChecklist(symbol: string, strategy: 'BPS' | 'BCS' | 'IC', metrics: any, chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex?: boolean; classification?: 'index' | 'etf' | 'stock' }, price: number | null, STOCK_RULES: RulesType, trendResult?: TrendResult, stockPresetLabel?: string, ETF_RULES_PARAM?: RulesType, etfPresetLabel?: string, strictOnly = false): ScreenResult {
  const failReasons: string[] = [], ivrValue = metrics.ivRank, earningsDate = metrics.earningsExpectedDate;
  const isIndex = chainData.isEtfOrIndex ?? false;
  // Auto-select the right rule set based on ticker type
  const RULES = isIndex ? (ETF_RULES_PARAM ?? { ...DEFAULT_ETF_RULES }) : STOCK_RULES;
  const appliedLabel = isIndex
    ? (etfPresetLabel ? `ETF — ${etfPresetLabel}` : 'ETF rules')
    : (stockPresetLabel ?? 'Custom');
  const effectiveRules: RulesType = RULES;
  const effectiveIvrMin = isIndex ? INDEX_IVR_MIN : effectiveRules.IVR_MIN;
  const ivrCheck: CheckResult = ivrValue == null ? { status: 'warn', value: 'N/A', reason: 'Not available' } : ivrValue < effectiveIvrMin ? (() => { failReasons.push(`IVR ${ivrValue.toFixed(1)}% < ${effectiveIvrMin}%`); return { status: 'fail' as const, value: `${ivrValue.toFixed(1)}%`, reason: `Below ${effectiveIvrMin}% minimum${isIndex ? ' (index)' : ''}` }; })() : { status: 'pass', value: `${ivrValue.toFixed(1)}%`, reason: isIndex ? `Above ${effectiveIvrMin}% (index floor)` : 'Above minimum' };

  // Earnings buffer auto-derived: DTE_MAX + 5 days cushion
  const earningsBuffer = RULES.DTE_MAX + 5;
  let earningsCheck: CheckResult;
  if (isIndex) {
    earningsCheck = { status: 'pass', value: 'N/A (index/ETF)', reason: 'No earnings events' };
  } else if (!earningsDate) {
    earningsCheck = { status: 'pass', value: 'None found', reason: 'Safe to trade' };
  } else {
    const d = daysUntil(earningsDate);
    if (d < 0) {
      earningsCheck = { status: 'pass', value: `${earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(earningsDate))}` };
    } else if (d < earningsBuffer) {
      if (strictOnly) {
        failReasons.push(`Earnings in ${d}d`);
        earningsCheck = { status: 'fail', value: `${d}d (${earningsDate})`, reason: `Within ${earningsBuffer}d — no qualifying ${RULES.DTE_MIN}-${RULES.DTE_MAX}d expiration clears it` };
      } else {
        earningsCheck = { status: 'warn', value: `${d}d (${earningsDate})`, reason: `Earnings within window — scored lower in rank mode` };
      }
    } else {
      earningsCheck = { status: 'pass', value: `${d}d (${earningsDate})`, reason: `Outside ${earningsBuffer}d buffer` };
    }
  }

  const validExpirations = chainData.expirations.filter(exp => { const dte = daysUntil(exp); if (dte < effectiveRules.DTE_MIN || dte > effectiveRules.DTE_MAX) return false; if (strictOnly && !isIndex && earningsDate) { const ed = daysUntil(earningsDate); if (ed >= 0 && ed <= dte) return false; } return true; });
  let bestCandidate: SpreadCandidate | null = null;
  
  // Rank mode fallback: if strict rules found nothing, try relaxed rules first, then fully unfiltered
  if (!strictOnly && !bestCandidate && ivrCheck.status !== 'fail' && validExpirations.length > 0) {
    const relaxedRules: RulesType = {
      ...effectiveRules,
      CREDIT_RATIO_MIN: 0.15,
      ROC_MIN_SPREAD: 8,
      ROC_MIN_IC: 12,
      OI_MIN: effectiveRules.OI_MIN,
      POP_MIN: 55,
      SPREAD_DELTA_MIN: 0.10,
      SPREAD_DELTA_MAX: 0.40,
      IC_DELTA_MIN: 0.10,
      IC_DELTA_MAX: 0.35,
    };
    for (const exp of validExpirations) { const chainItems = chainData.chains[exp] || []; const expIvxForPop =
  normalizeIv(metrics.expirationIvxMap?.[exp]) ??
  normalizeIv(metrics.ivx) ??
  normalizeIv(metrics.ivx30);

bestCandidate = strategy === 'IC'
  ? findBestIC(chainItems, exp, price, relaxedRules)
  : findBestSpread(chainItems, strategy, exp, price, relaxedRules, expIvxForPop); if (bestCandidate) break; }
  }
  // Last resort: fully unfiltered — show best available strike regardless of rules
  if (!strictOnly && !bestCandidate && validExpirations.length > 0) {
    for (const exp of validExpirations) { const chainItems = chainData.chains[exp] || []; bestCandidate = strategy === 'IC' ? findBestICUnfiltered(chainItems, exp, price) : findBestSpreadUnfiltered(chainItems, strategy, exp, price); if (bestCandidate) break; }
  }
  if (bestCandidate) {
    failReasons.length = 0;
    // Re-check earnings against the ACTUAL selected trade's DTE rather than
    // the generic RULES.DTE_MAX + 5 buffer used above (that buffer ran
    // before a specific expiration was picked, so it could flag earnings
    // that fall safely AFTER this trade's own expiry as a false positive).
    if (!isIndex && earningsDate) {
      const ed = daysUntil(earningsDate);
      if (ed < 0) {
        earningsCheck = { status: 'pass', value: `${earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(earningsDate))}` };
      } else if (ed <= bestCandidate.dte) {
        if (strictOnly) {
          failReasons.push(`Earnings in ${ed}d — before this trade's expiry`);
          earningsCheck = { status: 'fail', value: `${ed}d (${earningsDate})`, reason: `Falls before this trade's ${bestCandidate.dte}d expiry` };
        } else {
          earningsCheck = { status: 'warn', value: `${ed}d (${earningsDate})`, reason: `Falls within this trade's ${bestCandidate.dte}d expiry — scored lower in rank mode` };
        }
      } else {
        earningsCheck = { status: 'pass', value: `${ed}d (${earningsDate})`, reason: `Outside this trade's ${bestCandidate.dte}d expiry` };
      }
    }
  } else if (
    validExpirations.length === 0 &&
    !failReasons.some(r => r.includes('IVR') || r.includes('Earnings'))
  ) {
    failReasons.push(`No ${effectiveRules.DTE_MIN}-${effectiveRules.DTE_MAX} DTE expirations`);
  } else if (validExpirations.length > 0 && !failReasons.length) {
    failReasons.push('No qualifying strikes found');
  }
  // Weighted on the SHORT leg(s) — the leg you actively trade twice (sell to
  // open, buy to close at the GTC profit target) and the one that carries
  // assignment risk. The long leg is protection that typically only transacts
  // alongside the short leg in the same spread order, so its OI alone rarely
  // blocks a clean fill the way thin short-leg OI does. For IC, both short
  // legs (put + call) carry the same exposure, so the worse of the two gates.
  const oiCheck: CheckResult = !bestCandidate
    ? { status: 'fail', value: 'None', reason: failReasons[failReasons.length - 1] || 'No candidate' }
    : (() => {
        const shortLegOi = strategy === 'IC'
          ? Math.min(bestCandidate.shortOI, bestCandidate.shortCallOI ?? 0)
          : bestCandidate.shortOI;
        const val = strategy === 'IC'
          ? `P ${bestCandidate.shortOI}/${bestCandidate.longOI} · C ${bestCandidate.shortCallOI ?? '—'}/${bestCandidate.longCallOI ?? '—'}`
          : `${bestCandidate.shortOI}/${bestCandidate.longOI}`;
        if (shortLegOi >= effectiveRules.OI_MIN) return { status: 'pass' as const, value: val, reason: `Short leg${strategy === 'IC' ? 's' : ''} ≥ ${effectiveRules.OI_MIN}` };
        if (shortLegOi >= 100) return { status: 'warn' as const, value: val, reason: `Below target (${effectiveRules.OI_MIN}) on short leg — fills may be difficult` };
        return { status: 'warn' as const, value: val, reason: `Very low OI on short leg — spread likely untradeable` };
      })();
  const deltaCheck: CheckResult = bestCandidate ? { status: 'pass', value: bestCandidate.shortDelta.toFixed(2), reason: 'Within target range' } : { status: 'pending', value: '—', reason: 'No candidate' };

  const rawCredit = bestCandidate ? (bestCandidate.totalCredit ?? bestCandidate.credit) : 0;
  const creditCheck: CheckResult = bestCandidate
    ? { status: 'pass', value: `$${rawCredit.toFixed(2)}`, reason: `${(bestCandidate.creditRatio * 100).toFixed(0)}% of width` }
    : { status: 'pending', value: '—', reason: 'No candidate' };

  const rocMin = strategy === 'IC' ? effectiveRules.ROC_MIN_IC : effectiveRules.ROC_MIN_SPREAD;
  const rocCheck: CheckResult = bestCandidate ? { status: bestCandidate.roc >= rocMin ? 'pass' : 'fail', value: `${bestCandidate.roc.toFixed(0)}%`, reason: `Min ${rocMin}%` } : { status: 'pending', value: '—', reason: 'No candidate' };
  const candidatePop = bestCandidate ? (bestCandidate.pop ?? 0) : 0;
  const popMin = effectiveRules.POP_MIN;
  const popCheck: CheckResult = bestCandidate
    ? { status: candidatePop >= popMin ? 'pass' : 'fail', value: `${candidatePop.toFixed(0)}%`, reason: `Min ${popMin}%` }
    : { status: 'pending', value: '—', reason: 'No candidate' };
  if (bestCandidate && candidatePop < popMin) { failReasons.push(`POP ${candidatePop.toFixed(0)}% < ${popMin}%`); }
  if (symbol === 'MRVL' && bestCandidate) {
  console.log('FINAL_CARD_POP', {
    symbol,
    strategy,
    expiration: bestCandidate.expiration,
    shortStrike: bestCandidate.shortStrike,
    longStrike: bestCandidate.longStrike,
    credit: bestCandidate.credit,
    displayedPop: bestCandidate.pop,
    shortDelta: bestCandidate.shortDelta,
    deltaPop: (1 - bestCandidate.shortDelta) * 100,
  });
}
  const hv30 = metrics.hv30 ?? null;
  const strikeIv = bestCandidate?.shortIv ?? null;

  // ── Populate expirationIvx and expectedMove on bestCandidate ──────────────
  if (bestCandidate) {
    const expIvxMap: Record<string, number> = metrics.expirationIvxMap ?? {};
    const expIvx = expIvxMap[bestCandidate.expiration] ?? null;
    bestCandidate.expirationIvx = expIvx;
    if (expIvx != null && price != null && price > 0) {
      // Expected move = price × (ivx/100) × sqrt(dte/365)
      bestCandidate.expectedMove = parseFloat(
        (price * (expIvx / 100) * Math.sqrt(bestCandidate.dte / 365)).toFixed(2)
      );
    }
  }

  const ivCheck: CheckResult =
  strikeIv == null || hv30 == null
    ? {
        status: 'pending',
        value: '—',
        reason: 'Strike IV unavailable for this expiration'
      }
    : (() => {
        const edgePct = ((strikeIv / hv30 - 1) * 100);

        return {
          status:
            strikeIv >= hv30 * 1.1
              ? 'pass'
              : 'warn',

          value: `IV (${strikeIv.toFixed(0)}%) vs HV (${hv30.toFixed(0)}%)`,

          reason:
            edgePct >= 10
              ? `${edgePct.toFixed(0)}% volatility edge`
              : edgePct >= 0
                ? `${edgePct.toFixed(0)}% volatility edge (thin)`
                : `${Math.abs(edgePct).toFixed(0)}% below HV`
        };
      })();
  
  // ── Expected Move Clearance check ─────────────────────────────────────────
  const emClearanceCheck: CheckResult = (() => {
    if (!bestCandidate || bestCandidate.expectedMove == null || price == null) {
      return { status: 'pending' as const, value: '—', reason: 'IVx unavailable for this expiration' };
    }
    const em = bestCandidate.expectedMove;
    const shortStrike = bestCandidate.shortStrike;
    const emBoundary = bestCandidate.strategy === 'BPS' ? price - em : price + em;
    const clearancePct = bestCandidate.strategy === 'BPS'
      ? (emBoundary - shortStrike) / price * 100
      : (shortStrike - emBoundary) / price * 100;
    const clearanceDollar = Math.abs(emBoundary - shortStrike).toFixed(2);
    const emSign = bestCandidate.strategy === 'BPS' ? '-' : '+';
    const emLabel = `EM ${emSign}$${em.toFixed(2)} → boundary ${emBoundary.toFixed(2)}`;

    if (clearancePct >= 15) {
      return { status: 'pass' as const, value: `+$${clearanceDollar} beyond EM`, reason: `${emLabel} — strike well outside expected move` };
    } else if (clearancePct >= 5) {
      return { status: 'warn' as const, value: `+$${clearanceDollar} beyond EM`, reason: `${emLabel} — outside but close, one bad day tests this strike` };
    } else if (clearancePct >= 0) {
      return { status: 'warn' as const, value: `+$${clearanceDollar} beyond EM`, reason: `${emLabel} — barely outside expected move, high risk` };
    } else {
      return { status: 'fail' as const, value: `$${Math.abs(parseFloat(clearanceDollar)).toFixed(2)} INSIDE EM`, reason: `${emLabel} — strike is within the expected move, POP below 68%` };
    }
  })();

  const qualified = ivrCheck.status === 'pass' && earningsCheck.status === 'pass' && oiCheck.status === 'pass' && deltaCheck.status === 'pass' && creditCheck.status === 'pass' && rocCheck.status === 'pass' && popCheck.status === 'pass' && bestCandidate !== null;

  return {
    symbol, strategy, price, ivr: ivrValue,
    ivx: metrics.ivx ?? null,
    ivx30: metrics.ivx30 ?? null,
    ivHv30Diff: metrics.ivHv30Diff ?? null,
    liquidityRating: metrics.liquidityRating ?? null,
    qualified, bestCandidate, failReasons, earningsDate, trendResult,
    isEtf: isIndex, underlyingType: chainData.classification ?? 'stock', ruleSetApplied: appliedLabel,
    checks: { ivr: ivrCheck, earnings: earningsCheck, oi: oiCheck, delta: deltaCheck, iv: ivCheck, emClearance: emClearanceCheck, credit: creditCheck, roc: rocCheck, pop: popCheck },
  };
}


