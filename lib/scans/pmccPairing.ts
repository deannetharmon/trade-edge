import { isOccSymbolMatch } from './candidateIdentity';
import { isValidPmccDteRanges } from './pmccDteRanges';
import {
  isValidPmccDeltaRange,
  isValidPmccPairingLimits,
  isValidPmccQuotePolicy,
  PMCC_LONG_DELTA_BOUNDS,
  PMCC_SHORT_DELTA_BOUNDS,
} from './pmccConfig';
import { evaluatePmccQuoteQuality } from './pmccQuoteQuality';
import type {
  PmccChainLeg,
  PmccEligibleLeg,
  PmccFailureCode,
  PmccFailureReason,
  PmccLegRejection,
  PmccLegRole,
  PmccMarketSession,
  PmccPairMetrics,
  PmccPairResult,
  PmccPairingCounts,
  PmccPairingCriteria,
  PmccSessionResult,
  PmccOnDemandResult,
} from './pmccTypes';

const FAILURE_MESSAGES: Record<PmccFailureCode, string> = {
  INVALID_OPTION_TYPE: 'Contract is not a call',
  UNDERLYING_MISMATCH: 'Contract underlying does not match the scan symbol',
  INVALID_OCC_IDENTITY: 'OCC identity is missing, invalid, or does not match the contract',
  DUPLICATE_CONTRACT: 'Duplicate contract identity',
  DELTA_OUT_OF_RANGE: 'Delta is outside the submitted range',
  DTE_OUT_OF_RANGE: 'DTE is outside the submitted range',
  OPEN_INTEREST_BELOW_MINIMUM: 'Open interest is below the submitted minimum',
  INVALID_QUOTE: 'A valid positive two-sided quote is required',
  BID_ASK_TOO_WIDE: 'Bid/ask spread exceeds the qualifying maximum',
  LONG_NOT_ITM: 'Long call is not in the money',
  SHORT_NOT_OTM: 'Short call is not out of the money',
  LONG_EXPIRATION_NOT_LATER: 'Long expiration must be later than short expiration',
  LONG_STRIKE_NOT_BELOW_SHORT: 'Long strike must be below short strike',
  NET_DEBIT_NOT_POSITIVE: 'Net debit must be finite and positive',
  NET_DEBIT_NOT_BELOW_WIDTH: 'Net debit equals or exceeds strike width',
  INVALID_EXTRINSIC: 'Long-call extrinsic value is missing, negative, or invalid',
  INSUFFICIENT_DATA: 'Required contract data is missing or invalid',
};

function reason(code: PmccFailureCode, detail?: string): PmccFailureReason {
  return { code, message: detail ?? FAILURE_MESSAGES[code] };
}

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function pmccDte(expiration: string, asOf: Date): number | null {
  const match = expiration.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isFinite(asOf.getTime())) return null;
  const expiryDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(expiryDay);
  if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1 || parsed.getUTCDate() !== Number(match[3])) return null;
  return Math.round((expiryDay - utcDay(asOf)) / 86_400_000);
}

function stableLegOrder(a: PmccChainLeg, b: PmccChainLeg): number {
  return a.expiration.localeCompare(b.expiration)
    || a.strike - b.strike
    || String(a.occSymbol ?? '').localeCompare(String(b.occSymbol ?? ''));
}

function stablePairOrder(a: PmccPairResult, b: PmccPairResult): number {
  return a.symbol.localeCompare(b.symbol)
    || a.longLeg.expiration.localeCompare(b.longLeg.expiration)
    || a.shortLeg.expiration.localeCompare(b.shortLeg.expiration)
    || a.longLeg.strike - b.longLeg.strike
    || a.shortLeg.strike - b.shortLeg.strike
    || a.longLeg.occSymbol.localeCompare(b.longLeg.occSymbol)
    || a.shortLeg.occSymbol.localeCompare(b.shortLeg.occSymbol);
}

function validateCriteria(criteria: PmccPairingCriteria): void {
  if (!isValidPmccDteRanges(criteria.dte)) throw new Error('Invalid PMCC DTE ranges');
  if (!isValidPmccDeltaRange(criteria.longDelta, PMCC_LONG_DELTA_BOUNDS)) throw new Error('Invalid PMCC long delta range');
  if (!isValidPmccDeltaRange(criteria.shortDelta, PMCC_SHORT_DELTA_BOUNDS)) throw new Error('Invalid PMCC short delta range');
  if (!Number.isInteger(criteria.longOiMin) || criteria.longOiMin < 0) throw new Error('Invalid PMCC long OI minimum');
  if (!Number.isInteger(criteria.shortOiMin) || criteria.shortOiMin < 0) throw new Error('Invalid PMCC short OI minimum');
  if (!isValidPmccPairingLimits(criteria.limits)) throw new Error('Invalid PMCC pairing limits');
  if (!isValidPmccQuotePolicy(criteria.quotePolicy)) throw new Error('Invalid PMCC quote policy');
}

function legIdentity(leg: PmccChainLeg): string | null {
  if (!isOccSymbolMatch(leg.occSymbol, {
    strategy: 'PMCC',
    underlyingSymbol: leg.underlyingSymbol,
    expiration: leg.expiration,
    optionType: 'call',
    strike: leg.strike,
  })) return null;
  return `occ:${leg.occSymbol!.replace(/\s+/g, '').toUpperCase()}`;
}

function filterLegs(
  role: PmccLegRole,
  legs: PmccChainLeg[],
  symbol: string,
  underlyingPrice: number,
  criteria: PmccPairingCriteria,
  asOf: Date,
  marketSession: PmccMarketSession,
): { eligible: PmccEligibleLeg[]; rejected: PmccLegRejection[] } {
  const eligible: PmccEligibleLeg[] = [];
  const rejected: PmccLegRejection[] = [];
  const seen = new Set<string>();
  const deltaRange = role === 'long' ? criteria.longDelta : criteria.shortDelta;
  const oiMin = role === 'long' ? criteria.longOiMin : criteria.shortOiMin;
  const dteMin = role === 'long' ? criteria.dte.longMin : criteria.dte.shortMin;
  const dteMax = role === 'long' ? criteria.dte.longMax : criteria.dte.shortMax;

  for (const leg of [...legs].sort(stableLegOrder)) {
    const reasons: PmccFailureReason[] = [];
    const normalizedSymbol = leg.underlyingSymbol.trim().toUpperCase();
    if (leg.optionType !== 'C') reasons.push(reason('INVALID_OPTION_TYPE'));
    if (normalizedSymbol !== symbol) reasons.push(reason('UNDERLYING_MISMATCH'));
    const identity = legIdentity(leg);
    if (identity == null) reasons.push(reason('INVALID_OCC_IDENTITY'));
    else if (seen.has(identity)) reasons.push(reason('DUPLICATE_CONTRACT'));

    const dte = pmccDte(leg.expiration, asOf);
    if (dte == null) reasons.push(reason('INSUFFICIENT_DATA', 'Expiration or scan date is invalid'));
    else if (dte < dteMin || dte > dteMax) reasons.push(reason('DTE_OUT_OF_RANGE'));

    const delta = leg.delta == null ? null : Math.abs(leg.delta);
    if (delta == null || !Number.isFinite(delta)) reasons.push(reason('INSUFFICIENT_DATA', 'Delta is missing or invalid'));
    else if (delta < deltaRange.min || delta > deltaRange.max) reasons.push(reason('DELTA_OUT_OF_RANGE'));

    if (leg.openInterest == null || !Number.isFinite(leg.openInterest)) reasons.push(reason('INSUFFICIENT_DATA', 'Open interest is missing or invalid'));
    else if (leg.openInterest < oiMin) reasons.push(reason('OPEN_INTEREST_BELOW_MINIMUM'));

    if (role === 'long' && !(leg.strike < underlyingPrice)) reasons.push(reason('LONG_NOT_ITM'));
    if (role === 'short' && !(leg.strike > underlyingPrice)) reasons.push(reason('SHORT_NOT_OTM'));

    const quote = evaluatePmccQuoteQuality(leg, criteria.quotePolicy, asOf, marketSession);
    if (!quote.structurallyUsable) reasons.push(reason(quote.status === 'too_wide' ? 'BID_ASK_TOO_WIDE' : 'INVALID_QUOTE', quote.reason));

    const executablePrice = role === 'long' ? quote.ask : quote.bid;
    const intrinsic = role === 'long' ? Math.max(underlyingPrice - leg.strike, 0) : null;
    const extrinsic = role === 'long' && executablePrice != null && intrinsic != null ? executablePrice - intrinsic : null;
    if (role === 'long' && (extrinsic == null || !Number.isFinite(extrinsic) || extrinsic < 0)) reasons.push(reason('INVALID_EXTRINSIC'));

    if (reasons.length > 0 || identity == null || dte == null || delta == null || leg.openInterest == null || executablePrice == null) {
      rejected.push({ role, occSymbol: leg.occSymbol, strike: leg.strike, expiration: leg.expiration, reasons });
      continue;
    }
    seen.add(identity);
    eligible.push({
      candidateId: identity,
      role,
      underlyingSymbol: symbol,
      expiration: leg.expiration,
      dte,
      strike: leg.strike,
      delta,
      openInterest: leg.openInterest,
      occSymbol: leg.occSymbol!,
      quote,
      executablePrice,
      intrinsic,
      extrinsic,
    });
  }
  return { eligible, rejected };
}

function pairMetrics(longLeg: PmccEligibleLeg, shortLeg: PmccEligibleLeg): PmccPairMetrics | null {
  const netDebit = longLeg.executablePrice - shortLeg.executablePrice;
  const width = shortLeg.strike - longLeg.strike;
  const longIntrinsic = longLeg.intrinsic;
  const longExtrinsic = longLeg.extrinsic;
  if (longIntrinsic == null || longExtrinsic == null || ![netDebit, width, longIntrinsic, longExtrinsic].every(Number.isFinite)) return null;
  const widthMinusDebit = width - netDebit;
  return {
    netDebitPerShare: netDebit,
    strikeWidth: width,
    widthMinusDebitPerShare: widthMinusDebit,
    widthMinusDebitPctOfDebit: netDebit > 0 ? (widthMinusDebit / netDebit) * 100 : 0,
    longIntrinsicPerShare: longIntrinsic,
    longExtrinsicPerShare: longExtrinsic,
    shortCreditToNetDebitPct: netDebit > 0 ? (shortLeg.executablePrice / netDebit) * 100 : 0,
    shortCreditToLongExtrinsicPct: longExtrinsic > 0 ? (shortLeg.executablePrice / longExtrinsic) * 100 : null,
    netDelta: longLeg.delta - shortLeg.delta,
  };
}

function evaluatePair(longLeg: PmccEligibleLeg, shortLeg: PmccEligibleLeg, criteria: PmccPairingCriteria): { pair: PmccPairResult; structurallyValid: boolean } {
  const failures: PmccFailureReason[] = [];
  if (longLeg.expiration <= shortLeg.expiration) failures.push(reason('LONG_EXPIRATION_NOT_LATER'));
  if (longLeg.strike >= shortLeg.strike) failures.push(reason('LONG_STRIKE_NOT_BELOW_SHORT'));
  const metrics = pairMetrics(longLeg, shortLeg);
  if (metrics == null) failures.push(reason('INSUFFICIENT_DATA'));
  else {
    if (!(metrics.netDebitPerShare > 0)) failures.push(reason('NET_DEBIT_NOT_POSITIVE'));
    if (criteria.requireDebitBelowWidth && !(metrics.netDebitPerShare < metrics.strikeWidth)) failures.push(reason('NET_DEBIT_NOT_BELOW_WIDTH'));
  }
  const structurallyValid = failures.every(item => item.code === 'NET_DEBIT_NOT_BELOW_WIDTH');
  return {
    structurallyValid,
    pair: {
      pairId: `${longLeg.candidateId}::${shortLeg.candidateId}`,
      symbol: longLeg.underlyingSymbol,
      longLeg,
      shortLeg,
      metrics,
      qualified: failures.length === 0,
      insufficientData: failures.some(item => item.code === 'INSUFFICIENT_DATA'),
      failureReasons: failures,
      primaryFailureReason: failures[0] ?? null,
      orderingLabel: 'Contract order',
    },
  };
}

function emptyCounts(): PmccPairingCounts {
  return {
    eligibleLongLegs: 0, eligibleShortLegs: 0, potentialCombinations: 0,
    combinationsEvaluated: 0, combinationsOmittedBySafetyLimit: 0,
    structurallyValidPairs: 0, qualifiedPairsBeforeRetention: 0,
    nearMissPairsBeforeRetention: 0, qualifiedPairsRetained: 0,
    nearMissPairsRetained: 0, qualifiedPairsOmittedByRetention: 0,
    nearMissPairsOmittedByRetention: 0,
  };
}

export function pairPmccCandidates(input: {
  symbol: string;
  underlyingPrice: number;
  longLegs: PmccChainLeg[];
  shortLegs: PmccChainLeg[];
  criteria: PmccPairingCriteria;
  asOf: Date;
  marketSession: PmccMarketSession;
}): PmccSessionResult {
  validateCriteria(input.criteria);
  if (!Number.isFinite(input.underlyingPrice) || input.underlyingPrice <= 0) throw new Error('Invalid PMCC underlying price');
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('Invalid PMCC symbol');

  const longs = filterLegs('long', input.longLegs, symbol, input.underlyingPrice, input.criteria, input.asOf, input.marketSession);
  const shorts = filterLegs('short', input.shortLegs, symbol, input.underlyingPrice, input.criteria, input.asOf, input.marketSession);
  const counts = emptyCounts();
  counts.eligibleLongLegs = longs.eligible.length;
  counts.eligibleShortLegs = shorts.eligible.length;
  counts.potentialCombinations = longs.eligible.length * shorts.eligible.length;
  const allQualified: PmccPairResult[] = [];
  const allNearMisses: PmccPairResult[] = [];

  outer: for (const longLeg of longs.eligible) {
    for (const shortLeg of shorts.eligible) {
      if (counts.combinationsEvaluated >= input.criteria.limits.maxCombinationsEvaluated) break outer;
      const evaluated = evaluatePair(longLeg, shortLeg, input.criteria);
      counts.combinationsEvaluated += 1;
      if (evaluated.structurallyValid) counts.structurallyValidPairs += 1;
      if (evaluated.pair.qualified) allQualified.push(evaluated.pair);
      else allNearMisses.push(evaluated.pair);
    }
  }
  counts.combinationsOmittedBySafetyLimit = counts.potentialCombinations - counts.combinationsEvaluated;
  allQualified.sort(stablePairOrder);
  allNearMisses.sort(stablePairOrder);
  counts.qualifiedPairsBeforeRetention = allQualified.length;
  counts.nearMissPairsBeforeRetention = allNearMisses.length;
  const qualifiedPairs = allQualified.slice(0, input.criteria.limits.maxQualifiedPairsRetained);
  const nearMissPairs = allNearMisses.slice(0, input.criteria.limits.maxNearMissPairsRetained);
  counts.qualifiedPairsRetained = qualifiedPairs.length;
  counts.nearMissPairsRetained = nearMissPairs.length;
  counts.qualifiedPairsOmittedByRetention = allQualified.length - qualifiedPairs.length;
  counts.nearMissPairsOmittedByRetention = allNearMisses.length - nearMissPairs.length;

  return {
    symbol,
    asOf: input.asOf.toISOString(),
    marketSession: input.marketSession,
    criteria: input.criteria,
    qualifiedPairs,
    nearMissPairs,
    legRejections: [...longs.rejected, ...shorts.rejected],
    counts,
    incompleteAnalysis: counts.combinationsOmittedBySafetyLimit > 0,
    orderingLabel: 'Contract order',
  };
}

/**
 * Checks one specific long/short pair on demand, reusing the exact same
 * filterLegs/evaluatePair gates as the full scan -- per Alan's requirement,
 * this always evaluates against the CURRENT criteria passed in, never a
 * cached/stale session's criteria. Answers "was this specific structure
 * ever evaluated, and if so what happened to it" independent of the
 * retention limit that governs what a full scan's PmccSessionResult keeps.
 *
 * longChainLeg/shortChainLeg are null when the requested strike/expiration
 * doesn't exist in the fetched chain at all -- distinct from existing in
 * the chain but failing eligibility.
 */
export function evaluatePmccPairOnDemand(input: {
  symbol: string;
  underlyingPrice: number;
  longChainLeg: PmccChainLeg | null;
  shortChainLeg: PmccChainLeg | null;
  criteria: PmccPairingCriteria;
  asOf: Date;
  marketSession: PmccMarketSession;
}): PmccOnDemandResult {
  const { symbol, underlyingPrice, longChainLeg, shortChainLeg, criteria, asOf, marketSession } = input;
  validateCriteria(criteria);

  const chainMissing = { long: longChainLeg == null, short: shortChainLeg == null };
  if (chainMissing.long || chainMissing.short) {
    return { outcome: 'not_found_in_chain', pair: null, longLegRejection: null, shortLegRejection: null, chainMissing };
  }

  const { eligible: eligibleLong, rejected: rejectedLong } =
    filterLegs('long', [longChainLeg!], symbol, underlyingPrice, criteria, asOf, marketSession);
  const { eligible: eligibleShort, rejected: rejectedShort } =
    filterLegs('short', [shortChainLeg!], symbol, underlyingPrice, criteria, asOf, marketSession);

  if (eligibleLong.length === 0 || eligibleShort.length === 0) {
    return {
      outcome: 'leg_rejected',
      pair: null,
      longLegRejection: rejectedLong[0] ?? null,
      shortLegRejection: rejectedShort[0] ?? null,
      chainMissing,
    };
  }

  const { pair, structurallyValid } = evaluatePair(eligibleLong[0], eligibleShort[0], criteria);
  if (pair.qualified) {
    return { outcome: 'qualified', pair, longLegRejection: null, shortLegRejection: null, chainMissing };
  }
  if (structurallyValid) {
    return { outcome: 'near_miss', pair, longLegRejection: null, shortLegRejection: null, chainMissing };
  }
  return { outcome: 'pair_rejected', pair, longLegRejection: null, shortLegRejection: null, chainMissing };
}

