// lib/autopilot/decision/screenerCandidateAdapter.ts
//
// Bridges real screener output (lib/scans/types.ts: ScreenResult /
// SpreadCandidate) into AutopilotCandidate, so the recommendation engine
// evaluates real market data instead of the empty candidates: [] it gets
// today.
//
// SCOPE: BPS, BCS, IC, CSP, PMCC, and CC. PMCC is a canonical first-class
// recommendation strategy. Its two call expirations remain distinct and its
// authoritative maximum loss is the total net debit paid.
//
// CC (covered call): this file's header previously said CC candidates
// "aren't produced by the standard screener scan at all... a separate,
// not-yet-built feature" -- that was true when this file was written but
// is stale now that lib/scans/covered-call-finder.ts exists and CC scans
// go through the same runCcScan/ScreenResult/bestCandidate pipeline as
// every other strategy here (confirmed via direct read of
// covered-call-finder.ts's real field names: shortStrike/shortOccSymbol/
// shortBid/shortAsk/shortDelta/shortOI, identical to CSP's single-leg
// pattern). Real, confirmed gap found via a genuinely failing test
// (SCREENER-RESULTS-0001), not assumed. Note: unlike every other strategy
// here, a covered call's true theoretical max loss requires the position's
// actual cost basis (the stock could go to $0), which a scan-level
// candidate does not carry -- CC scans against already-owned shares of
// unknown historical purchase price. theoreticalMaxLoss() below uses
// current market price as the best available proxy, not real cost basis;
// this is an honest approximation, not a fabricated precise figure.

import type { AutopilotCandidate, AutopilotLeg, AutopilotStrategy } from '../types';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import {
  calculateIronCondorCapital,
  calculatePmccCapital,
  resolveOptionContractMultiplier,
} from '@/lib/scans/financials';

export interface ScreenerAdapterResult {
  candidates: AutopilotCandidate[];
  skipped: Array<{ symbol: string; strategy: string; reason: string }>;
}

const SUPPORTED_STRATEGIES: ReadonlySet<string> = new Set(['BPS', 'BCS', 'IC', 'CSP', 'PMCC', 'CC']);

function toAutopilotStrategy(strategy: string): AutopilotStrategy | null {
  return SUPPORTED_STRATEGIES.has(strategy) ? (strategy as AutopilotStrategy) : null;
}

function isoFromQuoteFetchedAt(quoteFetchedAt?: number): string | undefined {
  if (!Number.isFinite(quoteFetchedAt ?? NaN)) return undefined;
  return new Date(quoteFetchedAt as number).toISOString();
}

// Mirrors the max-loss math already used across app/screener/page.tsx,
// lib/scans/rank-scoring.ts, and lib/scans/spread-finder.ts:
//   maxLoss = (spreadWidth - credit) * quantity * 100
// CSP has no spread width -- max loss (pre-assignment) is capital at risk,
// i.e. requiredCash minus premium collected.
function theoreticalMaxLoss(strategy: AutopilotStrategy, candidate: SpreadCandidate, quantity: number, underlyingPrice: number): number {
  if (strategy === 'PMCC') {
    return calculatePmccCapital({
      netDebit: Number(candidate.netDebit),
      netDebitUnit: candidate.netDebitUnit as 'per_share',
      contractMultiplier: Number(candidate.contractMultiplier),
      quantity,
    }).theoreticalMaxLoss;
  }
  if (strategy === 'IC') {
    return calculateIronCondorCapital({
      putWidth: candidate.spreadWidth,
      callWidth: Number(candidate.callWidth),
      totalCredit: Number(candidate.totalCredit),
      creditUnit: 'per_share',
      contractMultiplier: Number(candidate.contractMultiplier),
      quantity,
    }).theoreticalMaxLoss;
  }
  if (Number.isFinite(candidate.capitalRequired ?? NaN)) {
    return Number(candidate.capitalRequired) * quantity;
  }
  if (strategy === 'CSP') {
    const requiredCash = candidate.requiredCash ?? 0;
    const credit = candidate.credit ?? 0;
    return Math.max(0, requiredCash - credit * quantity * 100);
  }
  if (strategy === 'CC') {
    // Honest approximation, not real cost basis (see file header) --
    // current market price is the only downside reference a scan-level
    // candidate has. A real covered call's max loss depends on what the
    // shares were actually purchased at, which lives on the position,
    // not this candidate.
    const price = underlyingPrice;
    const credit = candidate.credit ?? candidate.totalCredit ?? 0;
    return Math.max(0, price - credit) * quantity * 100;
  }

  const width = candidate.spreadWidth ?? 0;
  const credit = candidate.totalCredit ?? candidate.credit ?? 0;
  return Math.max(0, (width - credit) * quantity * 100);
}

function buildLegs(
  strategy: AutopilotStrategy,
  symbol: string,
  candidate: SpreadCandidate,
  quantity: number,
): AutopilotLeg[] {
  const quoteTimestamp = isoFromQuoteFetchedAt(candidate.quoteFetchedAt);
  const legs: AutopilotLeg[] = [];

  const multiplier = resolveOptionContractMultiplier(candidate.contractMultiplier);
  const shortLeg = (
    strike: number | undefined,
    optionType: 'call' | 'put',
    occSymbol?: string,
    delta?: number,
    bid?: number,
    ask?: number,
    expiration = candidate.expiration,
    openInterest?: number,
  ): AutopilotLeg | null => {
    if (!Number.isFinite(strike ?? NaN)) return null;
    return {
      symbol: occSymbol ?? symbol,
      optionSymbol: occSymbol,
      underlyingSymbol: symbol,
      assetType: 'option',
      direction: 'short',
      optionType,
      strike,
      expiration,
      quantity,
      contractMultiplier: multiplier,
      openInterest,
      delta,
      bid,
      ask,
      mid: bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined,
      quoteTimestamp,
    };
  };

  const longLeg = (
    strike: number | undefined,
    optionType: 'call' | 'put',
    occSymbol?: string,
    bid?: number,
    ask?: number,
    expiration = candidate.expiration,
    openInterest?: number,
  ): AutopilotLeg | null => {
    if (!Number.isFinite(strike ?? NaN)) return null;
    return {
      symbol: occSymbol ?? symbol,
      optionSymbol: occSymbol,
      underlyingSymbol: symbol,
      assetType: 'option',
      direction: 'long',
      optionType,
      strike,
      expiration,
      quantity,
      contractMultiplier: multiplier,
      openInterest,
      bid,
      ask,
      mid: bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined,
      quoteTimestamp,
    };
  };

  if (strategy === 'BPS') {
    const s = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk, candidate.expiration, candidate.shortOI);
    const l = longLeg(candidate.longStrike, 'put', candidate.longOccSymbol, candidate.longBid, candidate.longAsk, candidate.expiration, candidate.longOI);
    if (s) legs.push(s);
    if (l) legs.push(l);
  } else if (strategy === 'BCS') {
    const s = shortLeg(candidate.shortStrike, 'call', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk, candidate.expiration, candidate.shortOI);
    const l = longLeg(candidate.longStrike, 'call', candidate.longOccSymbol, candidate.longBid, candidate.longAsk, candidate.expiration, candidate.longOI);
    if (s) legs.push(s);
    if (l) legs.push(l);
  } else if (strategy === 'IC') {
    const shortPut = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk, candidate.expiration, candidate.shortOI);
    const longPut = longLeg(candidate.longStrike, 'put', candidate.longOccSymbol, candidate.longBid, candidate.longAsk, candidate.expiration, candidate.longOI);
    const shortCall = shortLeg(candidate.shortCallStrike, 'call', candidate.shortCallOccSymbol, undefined, undefined, undefined, candidate.expiration, candidate.shortCallOI);
    const longCall = longLeg(candidate.longCallStrike, 'call', candidate.longCallOccSymbol, undefined, undefined, candidate.expiration, candidate.longCallOI);
    if (shortPut) legs.push(shortPut);
    if (longPut) legs.push(longPut);
    if (shortCall) legs.push(shortCall);
    if (longCall) legs.push(longCall);
  } else if (strategy === 'CSP') {
    const s = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk, candidate.expiration, candidate.shortOI);
    if (s) legs.push(s);
  } else if (strategy === 'CC') {
    const s = shortLeg(candidate.shortStrike, 'call', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk, candidate.expiration, candidate.shortOI);
    if (s) legs.push(s);
  } else if (strategy === 'PMCC') {
    const longCall = longLeg(
      candidate.longStrike,
      'call',
      candidate.longOccSymbolPMCC,
      undefined,
      undefined,
      candidate.longExpiration,
      candidate.longOI,
    );
    const shortCall = shortLeg(
      candidate.shortStrike,
      'call',
      candidate.shortOccSymbolPMCC,
      candidate.shortDelta,
      candidate.shortBid,
      candidate.shortAsk,
      candidate.expiration,
      candidate.shortOI,
    );
    if (longCall) legs.push(longCall);
    if (shortCall) legs.push(shortCall);
  }

  return legs;
}

export function screenResultsToAutopilotCandidates(
  results: ScreenResult[],
  quantity = 1,
): ScreenerAdapterResult {
  const candidates: AutopilotCandidate[] = [];
  const skipped: ScreenerAdapterResult['skipped'] = [];
  const sourceIdentity = new Map<string, ScreenResult>();
  const resolvedSourceIds = new Map<ScreenResult, string>();

  for (const result of results) {
    const sourceResultId = result.sourceResultId ?? result.bestCandidate?.sourceResultId ?? crypto.randomUUID();
    resolvedSourceIds.set(result, sourceResultId);
    const prior = sourceIdentity.get(sourceResultId);
    if (prior) {
      throw new Error(
        `Duplicate sourceResultId "${sourceResultId}" for ${prior.symbol} ${prior.strategy} and ${result.symbol} ${result.strategy}.`,
      );
    }
    sourceIdentity.set(sourceResultId, result);
  }

  for (const result of results) {
    if (!result.qualified || !result.bestCandidate) {
      skipped.push({ symbol: result.symbol, strategy: result.strategy, reason: 'Not qualified or no best candidate.' });
      continue;
    }

    const strategy = toAutopilotStrategy(result.strategy);
    if (!strategy) {
      skipped.push({
        symbol: result.symbol,
        strategy: result.strategy,
        reason: `Unsupported strategy "${result.strategy}".`,
      });
      continue;
    }

    const candidate = result.bestCandidate;
    const sourceResultId = resolvedSourceIds.get(result)!;
    if (strategy === 'PMCC') {
      const multiplier = candidate.contractMultiplier;
      const valid = (
        Number.isFinite(candidate.netDebit ?? NaN)
        && Number(candidate.netDebit) > 0
        && candidate.netDebitUnit === 'per_share'
        && Number.isFinite(multiplier)
        && Number(multiplier) > 0
        && Number.isFinite(quantity)
        && quantity > 0
        && candidate.longStrike < candidate.shortStrike
        && Boolean(candidate.longExpiration)
        && new Date(candidate.longExpiration as string).getTime() > new Date(candidate.expiration).getTime()
        && Boolean(candidate.longOccSymbolPMCC)
        && Boolean(candidate.shortOccSymbolPMCC)
      );
      if (!valid) {
        skipped.push({
          symbol: result.symbol,
          strategy: result.strategy,
          reason: 'Invalid PMCC: requires identified long/short call legs, later long expiration, lower long strike, matched positive quantity/multiplier, and positive finite per-share net debit.',
        });
        continue;
      }
    }
    const legs = buildLegs(strategy, result.symbol, candidate, quantity);
    if (!legs.length) {
      skipped.push({ symbol: result.symbol, strategy: result.strategy, reason: 'Could not build any valid legs from bestCandidate.' });
      continue;
    }

    const estimatedCredit = strategy === 'PMCC'
      ? candidate.credit * quantity
      : (candidate.totalCredit ?? candidate.credit ?? 0) * quantity;
    let maxLoss: number;
    try {
      maxLoss = theoreticalMaxLoss(strategy, candidate, quantity, result.price ?? 0);
    } catch {
      skipped.push({ symbol: result.symbol, strategy: result.strategy, reason: 'Invalid canonical capital inputs.' });
      continue;
    }
    candidates.push({
      id: `screen_${sourceResultId}`,
      // Preserve the modern Screener's canonical per-contract identity for
      // downstream joins (especially multi-contract CSP result sets).
      screenerCandidateId: result.candidateId,
      strategy,
      symbol: result.symbol,
      underlyingPrice: result.price ?? 0,
      legs,
      estimatedCredit,
      theoreticalMaxLoss: maxLoss,
      netDebit: strategy === 'PMCC' ? candidate.netDebit : undefined,
      netDebitUnit: strategy === 'PMCC' ? 'per_share' : undefined,
      sourceResultId,
      pop: candidate.pop ?? undefined,
      roc: candidate.roc ?? undefined,
      ivr: result.ivr ?? undefined,
      annualizedYield: candidate.annualizedRoc ?? undefined,
      // DimensionScore.total from lib/scans/rank-scoring.ts is already a
      // 0-100 composite (momentum/IVR/EM-clearance/range/technical/
      // liquidity/buffer). trendResult.scores.total is a narrower
      // technical-only signal. Prefer whichever is present; this is the
      // single most direct fix for technicalFit defaulting to a flat 50.
      technicalFit: result.trendResult?.scores?.total ?? undefined,
      sector: undefined, // not tracked by the screener today -- same gap as before
      earningsDate: result.earningsDate ?? undefined,
      marketTrend: result.trendResult?.trend,
      notes: result.failReasons?.length ? [`Screener notes: ${result.failReasons.join('; ')}`] : undefined,
    });
  }

  return { candidates, skipped };
}
