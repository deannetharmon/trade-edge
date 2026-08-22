import type { CheckResult, ScreenResult, SpreadCandidate, TrendResult } from './types';
import { adaptPmccChain, type RawPmccChain } from './pmccChainAdapter';
import { pairPmccCandidates } from './pmccPairing';
import type { PmccMarketSession, PmccPairResult, PmccScanSnapshot, PmccSessionResult } from './pmccTypes';
// PMCC-TREND-GATE-0001 -- cross-domain import (lib/scans -> lib/portfolio)
// is intentional: technicalAlignmentForStrategy's own doc comment already
// declares itself "the single source of truth for both the screener's
// group-header trend badge... and the portfolio recommendation engine's
// technicalAlignment input" -- this is that function's second, previously
// unbuilt consumer, not a new mechanism.
import { technicalAlignmentForStrategy } from '@/lib/portfolio/trendClassification';

export interface PmccProductionContext {
  symbol: string; price: number; ivr: number | null; earningsDate?: string | null;
  trendResult?: TrendResult; underlyingType: 'index' | 'etf' | 'stock';
  // PMCC-TREND-GATE-0001 -- default true, same "trust the qualified realm,
  // adjust the criterion" pattern as requireDebitBelowWidth. Session
  // scoping note (Paul/Ian's resolved call): reads context.trendResult --
  // the SAME TrendResult already attached to every ScreenResult and
  // already read by the group-header trend badge -- not a separate trend
  // fetch/computation. This means the gate uses the screener's existing
  // ma20/ma50 trend engine (lib/scans/trend.ts), NOT the 60/90-day window
  // built for the portfolio recommendation engine (lib/portfolio/
  // trendClassification.ts's classifyTrendFromCloses) -- a known, disclosed
  // limitation, not an oversight. Badge/gate agreement was judged more
  // important than window length by Ian's own explicit resolution; the
  // window mismatch is tracked separately as
  // SCREENER-TREND-WINDOW-MIGRATION-0001, which will make this correct
  // automatically once it lands, with no further PMCC-specific change
  // needed here.
  requireTrendAlignmentForPmcc?: boolean;
}

const pending = (reason: string): CheckResult => ({ status: 'pending', value: '—', reason });

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCDate(1 + ((weekday - date.getUTCDay() + 7) % 7) + (nth - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function goodFriday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const date = new Date(Date.UTC(year, month - 1, day - 2));
  return date.toISOString().slice(0, 10);
}

function isNyseHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday(year),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
  return holidays.has(date);
}

export function derivePmccMarketSession(asOf: Date): PmccMarketSession {
  if (!Number.isFinite(asOf.getTime())) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(asOf);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  const weekday = value('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';
  const marketDate = `${value('year')}-${value('month')}-${value('day')}`;
  if (isNyseHoliday(marketDate)) return 'closed';
  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  if (!Number.isFinite(minutes)) return 'unknown';
  if (minutes < 570) return 'pre_market';
  if (minutes < 960) return 'open';
  if (minutes < 1200) return 'after_hours';
  return 'closed';
}

function compatibilityCandidate(pair: PmccPairResult): SpreadCandidate | null {
  const metrics = pair.metrics;
  if (!metrics) return null;
  return {
    strategy: 'PMCC', candidateId: pair.pairId, expiration: pair.shortLeg.expiration, dte: pair.shortLeg.dte,
    shortStrike: pair.shortLeg.strike, longStrike: pair.longLeg.strike, shortDelta: pair.shortLeg.delta,
    longDelta: pair.longLeg.delta, credit: pair.shortLeg.executablePrice, longCost: pair.longLeg.executablePrice,
    netDebit: metrics.netDebitPerShare, spreadWidth: metrics.strikeWidth, creditRatio: 0,
    roc: metrics.shortCreditToNetDebitPct, pop: 0, shortOI: pair.shortLeg.openInterest, longOI: pair.longLeg.openInterest,
    longExpiration: pair.longLeg.expiration, longDte: pair.longLeg.dte,
    longOccSymbolPMCC: pair.longLeg.occSymbol, shortOccSymbolPMCC: pair.shortLeg.occSymbol,
  };
}

export function pmccAuditReasons(session: PmccSessionResult): string[] {
  const reasons: string[] = [];
  if (session.counts.eligibleLongLegs === 0) reasons.push('No eligible long legs');
  if (session.counts.eligibleShortLegs === 0) reasons.push('No eligible short legs');
  if (session.counts.eligibleLongLegs > 0 && session.counts.eligibleShortLegs > 0 && session.counts.qualifiedPairsRetained === 0) reasons.push('No valid combinations');
  if (session.incompleteAnalysis) reasons.push('Incomplete analysis');
  for (const rejection of session.legRejections) for (const item of rejection.reasons) {
    reasons.push(`${rejection.role === 'long' ? 'Long' : 'Short'} ${rejection.expiration} $${rejection.strike}: ${item.message}`);
  }
  return Array.from(new Set(reasons));
}

function checksFor(pair: PmccPairResult | null): ScreenResult['checks'] {
  return {
    ivr: pending('Context only; not used by the PMCC pairing engine'), earnings: pending('Event/readiness context'),
    oi: pair ? { status: 'pass', value: `${pair.shortLeg.openInterest}/${pair.longLeg.openInterest}`, reason: 'Submitted OI floors satisfied' } : pending('No retained pair'),
    delta: pair ? { status: 'pass', value: `Long Δ${pair.longLeg.delta.toFixed(2)} / Short Δ${pair.shortLeg.delta.toFixed(2)}`, reason: 'Submitted delta ranges satisfied' } : pending('No retained pair'),
    credit: pair ? { status: 'pass', value: `$${pair.shortLeg.executablePrice.toFixed(2)} credit`, reason: 'Executable short bid' } : pending('No retained pair'),
    roc: pending('Generic spread scoring is not used for PMCC'), pop: pending('No whole-strategy POP is asserted for PMCC'),
    iv: pending('Not a PMCC pairing input'), emClearance: pending('Not a PMCC pairing input'),
  };
}

function resultForPair(pair: PmccPairResult, session: PmccSessionResult, context: PmccProductionContext, order: number, cycleExpirations: string[] = []): ScreenResult {
  // PMCC-TREND-GATE-0001 -- reads context.trendResult, the same object
  // already attached below as `trendResult` (and already read by the
  // screener's group-header trend badge) -- one shared trend read, not a
  // second computation, per Quinn/Diane's explicit requirement.
  // technicalAlignmentForStrategy already returns 'unknown' for a missing
  // trend, which correctly never gates (matches every other "missing data
  // never fails closed the wrong direction" convention in this file).
  const requireTrendAlignment = context.requireTrendAlignmentForPmcc ?? true;
  const trendAgainst = requireTrendAlignment
    && technicalAlignmentForStrategy(context.trendResult?.trend ?? 'unknown', 'PMCC') === 'against';
  const readinessReasons = [
    ...pair.failureReasons.map(item => item.message),
    ...(!pair.longLeg.quote.readyInput ? [`Long quote not ready: ${pair.longLeg.quote.reason}`] : []),
    ...(!pair.shortLeg.quote.readyInput ? [`Short quote not ready: ${pair.shortLeg.quote.reason}`] : []),
    ...(trendAgainst ? [`Trend against PMCC's bullish thesis`] : []),
  ];
  return {
    symbol: context.symbol, strategy: 'PMCC', price: context.price, ivr: context.ivr,
    // Trend gate demotes qualified -> false here, at the ScreenResult
    // layer, WITHOUT touching pair.qualified itself -- the pairing
    // engine's own qualified/failureReasons remain pure structural/
    // economic truth (same layering already used for the quote-readiness
    // reasons above, which also never touch pair.qualified/
    // pair.failureReasons).
    qualified: pair.qualified && !trendAgainst,
    bestCandidate: compatibilityCandidate(pair), candidateId: pair.pairId, failReasons: readinessReasons,
    earningsDate: context.earningsDate, trendResult: context.trendResult, isEtf: context.underlyingType !== 'stock',
    underlyingType: context.underlyingType, ruleSetApplied: 'PMCC pairing engine v2', publishedOrder: order, checks: checksFor(pair),
    pmccPair: pair, pmccPairingCounts: session.counts, pmccIncompleteAnalysis: session.incompleteAnalysis,
    pmccLegRejections: session.legRejections, pmccAsOf: session.asOf,
    pmccCriteria: session.criteria, pmccCycleExpirations: cycleExpirations,
  };
}

export function buildPmccScreenResults(session: PmccSessionResult, context: PmccProductionContext, cycleExpirations: string[] = []): ScreenResult[] {
  const retained = [...session.qualifiedPairs, ...session.nearMissPairs];
  if (retained.length) return retained.map((pair, index) => resultForPair(pair, session, context, index + 1, cycleExpirations));
  const failReasons = pmccAuditReasons(session);
  return [{
    symbol: context.symbol, strategy: 'PMCC', price: context.price, ivr: context.ivr, qualified: false, bestCandidate: null,
    candidateId: `pmcc-audit:${context.symbol}:${session.asOf}`, failReasons: failReasons.length ? failReasons : ['No valid combinations'],
    earningsDate: context.earningsDate, trendResult: context.trendResult, isEtf: context.underlyingType !== 'stock', underlyingType: context.underlyingType,
    ruleSetApplied: 'PMCC pairing engine v2', checks: checksFor(null), pmccPairingCounts: session.counts,
    pmccIncompleteAnalysis: session.incompleteAnalysis, pmccLegRejections: session.legRejections, pmccAsOf: session.asOf,
    pmccCriteria: session.criteria, pmccCycleExpirations: cycleExpirations,
  }];
}

export type PmccProductionStage = 'CHAIN_ADAPTATION_FAILURE' | 'PAIRING_ENGINE_FAILURE';

export class PmccProductionError extends Error {
  constructor(readonly stage: PmccProductionStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PmccProductionError';
  }
}

export interface PmccProductionDependencies {
  adapt: typeof adaptPmccChain;
  pair: typeof pairPmccCandidates;
}

/** Callable production seam used by the page and runtime integration tests.
 * Deliberately has no legacy/greedy fallback. */
export function runPmccProduction(
  chain: RawPmccChain,
  context: PmccProductionContext,
  snapshot: PmccScanSnapshot,
  dependencies: PmccProductionDependencies = { adapt: adaptPmccChain, pair: pairPmccCandidates },
): ScreenResult[] {
  let adapted: ReturnType<typeof adaptPmccChain>;
  try {
    adapted = dependencies.adapt(context.symbol, chain);
  } catch (error) {
    throw new PmccProductionError('CHAIN_ADAPTATION_FAILURE', error);
  }
  try {
    const pairing = dependencies.pair({
      symbol: context.symbol,
      underlyingPrice: context.price,
      longLegs: adapted.longLegs,
      shortLegs: adapted.shortLegs,
      criteria: snapshot.criteria,
      asOf: new Date(snapshot.asOf),
      marketSession: snapshot.marketSession,
    });
    return buildPmccScreenResults(pairing, context, chain.cycleExpirations ?? chain.shortExpirations);
  } catch (error) {
    throw new PmccProductionError('PAIRING_ENGINE_FAILURE', error);

  }
}
export function buildPmccFailureAuditResult(
  context: Omit<PmccProductionContext, 'price'> & { price: number | null },
  asOf: string,
  kind: NonNullable<ScreenResult['pmccAuditKind']>,
  detail: string,
): ScreenResult {
  const labels = {
    MARKET_DATA_FAILURE: 'Market-data acquisition failure',
    CHAIN_ADAPTATION_FAILURE: 'Chain adaptation failure',
    PAIRING_ENGINE_FAILURE: 'Pairing-engine/configuration failure',
  };
  return {
    symbol: context.symbol, strategy: 'PMCC', price: context.price, ivr: context.ivr,
    qualified: false, bestCandidate: null, candidateId: `pmcc-audit:${context.symbol}:${asOf}:${kind}`,
    failReasons: [labels[kind], detail].filter(Boolean), earningsDate: context.earningsDate,
    trendResult: context.trendResult, isEtf: context.underlyingType !== 'stock', underlyingType: context.underlyingType,
    ruleSetApplied: 'PMCC pairing engine v2', checks: checksFor(null), pmccAsOf: asOf, pmccAuditKind: kind,
  };
}
export type PmccSymbolProductionOutcome =
  | { status: 'evaluated'; results: ScreenResult[] }
  | { status: 'failed'; audit: ScreenResult };

export async function runPmccSymbolProduction(args: {
  snapshot: PmccScanSnapshot;
  fallbackContext: Omit<PmccProductionContext, 'price'> & { price: number | null };
  acquire: () => Promise<{ chain: RawPmccChain; context: PmccProductionContext }>;
  dependencies?: PmccProductionDependencies;
}): Promise<PmccSymbolProductionOutcome> {
  let acquired: { chain: RawPmccChain; context: PmccProductionContext };
  try {
    acquired = await args.acquire();
    if (!Number.isFinite(acquired.context.price) || acquired.context.price <= 0) {
      throw new Error('Invalid PMCC underlying price');
    }
  } catch (error) {
    return {
      status: 'failed',
      audit: buildPmccFailureAuditResult(
        args.fallbackContext, args.snapshot.asOf, 'MARKET_DATA_FAILURE',
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  try {
    return {
      status: 'evaluated',
      results: runPmccProduction(acquired.chain, acquired.context, args.snapshot, args.dependencies),
    };
  } catch (error) {
    const kind = error instanceof PmccProductionError ? error.stage : 'PAIRING_ENGINE_FAILURE';
    return {
      status: 'failed',
      audit: buildPmccFailureAuditResult(
        acquired.context, args.snapshot.asOf, kind,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

