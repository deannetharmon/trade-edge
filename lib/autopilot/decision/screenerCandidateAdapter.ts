// lib/autopilot/decision/screenerCandidateAdapter.ts
//
// Bridges real screener output (lib/scans/types.ts: ScreenResult /
// SpreadCandidate) into AutopilotCandidate, so the recommendation engine
// evaluates real market data instead of the empty candidates: [] it gets
// today.
//
// SCOPE: BPS, BCS, IC, CSP only. PMCC has no representation in
// AutopilotStrategy ('BPS' | 'BCS' | 'IC' | 'CSP' | 'CC') -- extending that
// type cascades into opportunity.ts's riskPenalty(), the decision-engine's
// actionForStrategy() switch, and portfolioState.ts's STRATEGIES list. That's
// a real product decision (does Autopilot recommend PMCC at all?), not
// something to decide silently inside an adapter. PMCC results from
// ScreenResult are skipped here and surfaced in the conversion summary
// instead of being dropped silently.
//
// Also out of scope: CC (covered call) candidates aren't produced by the
// standard screener scan at all (lib/scans/* has no CC path) -- they come
// from wheel/position management against owned shares, a separate,
// not-yet-built feature per the screener redesign plan. Nothing to adapt yet.

import type { AutopilotCandidate, AutopilotLeg, AutopilotStrategy } from '../types';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';

export interface ScreenerAdapterResult {
  candidates: AutopilotCandidate[];
  skipped: Array<{ symbol: string; strategy: string; reason: string }>;
}

const SUPPORTED_STRATEGIES: ReadonlySet<string> = new Set(['BPS', 'BCS', 'IC', 'CSP']);

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
function theoreticalMaxLoss(strategy: AutopilotStrategy, candidate: SpreadCandidate, quantity: number): number {
  if (strategy === 'CSP') {
    const requiredCash = candidate.requiredCash ?? 0;
    const credit = candidate.credit ?? 0;
    return Math.max(0, requiredCash - credit * quantity * 100);
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

  const shortLeg = (strike: number | undefined, optionType: 'call' | 'put', occSymbol?: string, delta?: number, bid?: number, ask?: number): AutopilotLeg | null => {
    if (!Number.isFinite(strike ?? NaN)) return null;
    return {
      symbol: occSymbol ?? symbol,
      optionSymbol: occSymbol,
      underlyingSymbol: symbol,
      assetType: 'option',
      direction: 'short',
      optionType,
      strike,
      expiration: candidate.expiration,
      quantity,
      delta,
      bid,
      ask,
      mid: bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined,
      quoteTimestamp,
    };
  };

  const longLeg = (strike: number | undefined, optionType: 'call' | 'put', occSymbol?: string, bid?: number, ask?: number): AutopilotLeg | null => {
    if (!Number.isFinite(strike ?? NaN)) return null;
    return {
      symbol: occSymbol ?? symbol,
      optionSymbol: occSymbol,
      underlyingSymbol: symbol,
      assetType: 'option',
      direction: 'long',
      optionType,
      strike,
      expiration: candidate.expiration,
      quantity,
      bid,
      ask,
      mid: bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined,
      quoteTimestamp,
    };
  };

  if (strategy === 'BPS') {
    const s = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk);
    const l = longLeg(candidate.longStrike, 'put', candidate.longOccSymbol, candidate.longBid, candidate.longAsk);
    if (s) legs.push(s);
    if (l) legs.push(l);
  } else if (strategy === 'BCS') {
    const s = shortLeg(candidate.shortStrike, 'call', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk);
    const l = longLeg(candidate.longStrike, 'call', candidate.longOccSymbol, candidate.longBid, candidate.longAsk);
    if (s) legs.push(s);
    if (l) legs.push(l);
  } else if (strategy === 'IC') {
    const shortPut = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk);
    const longPut = longLeg(candidate.longStrike, 'put', candidate.longOccSymbol, candidate.longBid, candidate.longAsk);
    const shortCall = shortLeg(candidate.shortCallStrike, 'call', candidate.shortCallOccSymbol, undefined, undefined, undefined);
    const longCall = longLeg(candidate.longCallStrike, 'call', candidate.longCallOccSymbol, undefined, undefined);
    if (shortPut) legs.push(shortPut);
    if (longPut) legs.push(longPut);
    if (shortCall) legs.push(shortCall);
    if (longCall) legs.push(longCall);
  } else if (strategy === 'CSP') {
    const s = shortLeg(candidate.shortStrike, 'put', candidate.shortOccSymbol, candidate.shortDelta, candidate.shortBid, candidate.shortAsk);
    if (s) legs.push(s);
  }

  return legs;
}

export function screenResultsToAutopilotCandidates(
  results: ScreenResult[],
  quantity = 1,
): ScreenerAdapterResult {
  const candidates: AutopilotCandidate[] = [];
  const skipped: ScreenerAdapterResult['skipped'] = [];

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
        reason:
          result.strategy === 'PMCC'
            ? 'PMCC has no AutopilotStrategy representation yet -- product decision needed before Autopilot can evaluate it.'
            : `Unsupported strategy "${result.strategy}".`,
      });
      continue;
    }

    const candidate = result.bestCandidate;
    const legs = buildLegs(strategy, result.symbol, candidate, quantity);
    if (!legs.length) {
      skipped.push({ symbol: result.symbol, strategy: result.strategy, reason: 'Could not build any valid legs from bestCandidate.' });
      continue;
    }

    const estimatedCredit = (candidate.totalCredit ?? candidate.credit ?? 0) * quantity;

    candidates.push({
      id: `screen_${result.symbol}_${strategy}_${candidate.expiration}_${candidate.shortStrike}`,
      // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — carry the
      // canonical ScreenResult.candidateId through unchanged, so
      // downstream joins never need to reparse `id` above (which is not a
      // stable, canonical identity -- it's an ad hoc string local to this
      // adapter) or fall back to symbol+strategy, which collides across
      // multiple contracts on the same symbol (e.g. CSP's six-strike AMD
      // fixture).
      screenerCandidateId: result.candidateId,
      strategy,
      symbol: result.symbol,
      underlyingPrice: result.price ?? 0,
      legs,
      estimatedCredit,
      theoreticalMaxLoss: theoreticalMaxLoss(strategy, candidate, quantity),
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
