// app/api/autopilot/recommendations/route.ts
//
// Phase 2 of the screener bridge: this is the first route that actually
// evaluates real market data through the recommendation engine. The client
// (the screener page, after running a normal scan) adapts ScreenResult[]
// once through screenResultsToAutopilotCandidates(), then POSTs compact,
// byte-bounded AutopilotCandidate[] batches here. This route runs every batch
// through the full existing pipeline (candidate validation -> portfolio
// pre-gates -> shared decision-engine reasoning -> persistence -> audit
// trail). The legacy ScreenResult[] request contract remains available for
// compatible small callers.
//
// Still true after this route exists:
//   - No paper positions are opened. No live orders are placed.
//   - Every DecisionAnalysis carries executionAllowed: false and
//     paperExecutionAllowed: false.
//   - This does not wire anything into the cron job -- frameworkRunner.ts
//     (used by /api/autopilot/run and cron) still passes candidates: [].
//     Automatic, unattended candidate generation is a separate piece of
//     work (it would need the cron job to run the screener itself, which
//     needs a tastytrade-authenticated context cron doesn't have today).

import { NextResponse } from 'next/server';
import { runRecommendationEngine } from '@/lib/autopilot/decision/recommendationEngine';
import { screenResultsToAutopilotCandidates } from '@/lib/autopilot/decision/screenerCandidateAdapter';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { ScreenResult } from '@/lib/scans/types';
import { RECOMMENDATION_ENGINE_BUSY_CODE } from '@/lib/recommendations/screenerRecommendationTransport';

export const dynamic = 'force-dynamic';

const SCREENER_TRANSPORT_STRATEGIES = new Set(['BPS', 'BCS', 'IC', 'CSP']);
const MARKET_TRENDS = new Set(['uptrend', 'downtrend', 'sideways', 'unknown']);
const ENGINE_BUSY_MESSAGE = 'Autopilot recommendation engine is already running.';
const CANDIDATE_OPTIONAL_NUMBER_FIELDS = [
  'pop',
  'roc',
  'ivr',
  'annualizedYield',
  'technicalFit',
  'goalAlignment',
  'correlationPenalty',
  'concentrationPenalty',
  'betaWeightedDelta',
] as const;
const LEG_OPTIONAL_NUMBER_FIELDS = [
  'delta',
  'gamma',
  'theta',
  'vega',
  'bid',
  'ask',
  'mid',
] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isOptionalTimestamp(value: unknown): boolean {
  return (
    value === undefined
    || (
      typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value))
    )
  );
}

function isCandidateTransportArray(value: unknown): value is AutopilotCandidate[] {
  return Array.isArray(value) && value.every((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const item = candidate as Partial<AutopilotCandidate>;
    return (
      typeof item.id === 'string' && item.id.trim().length > 0
      && typeof item.symbol === 'string' && item.symbol.trim().length > 0
      && typeof item.strategy === 'string' && SCREENER_TRANSPORT_STRATEGIES.has(item.strategy)
      && isFiniteNumber(item.underlyingPrice) && item.underlyingPrice > 0
      && isFiniteNumber(item.estimatedCredit)
      && isFiniteNumber(item.theoreticalMaxLoss) && item.theoreticalMaxLoss >= 0
      && CANDIDATE_OPTIONAL_NUMBER_FIELDS.every((field) => isOptionalFiniteNumber(item[field]))
      && (
        item.marketTrend === undefined
        || (typeof item.marketTrend === 'string' && MARKET_TRENDS.has(item.marketTrend))
      )
      && (item.earningsDate === undefined || isIsoCalendarDate(item.earningsDate))
      && (
        item.sector === undefined
        || (typeof item.sector === 'string' && item.sector.trim().length > 0)
      )
      && (
        item.notes === undefined
        || (
          Array.isArray(item.notes)
          && item.notes.every((note) => typeof note === 'string' && note.trim().length > 0)
        )
      )
      && Array.isArray(item.legs) && item.legs.length > 0
      && item.legs.every(
        (leg) => (
          !!leg
          && typeof leg === 'object'
          && typeof leg.symbol === 'string' && leg.symbol.trim().length > 0
          && typeof leg.underlyingSymbol === 'string' && leg.underlyingSymbol.trim().length > 0
          && leg.assetType === 'option'
          && (leg.direction === 'long' || leg.direction === 'short')
          && (leg.optionType === 'call' || leg.optionType === 'put')
          && isFiniteNumber(leg.quantity) && leg.quantity > 0
          && isFiniteNumber(leg.strike) && leg.strike > 0
          && isIsoCalendarDate(leg.expiration)
          && LEG_OPTIONAL_NUMBER_FIELDS.every((field) => isOptionalFiniteNumber(leg[field]))
          && isOptionalTimestamp(leg.quoteTimestamp)
        ),
      )
    );
  });
}

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const screenResults = Array.isArray(body?.screenResults) ? (body.screenResults as ScreenResult[]) : [];
    const quantity = Number.isFinite(body?.quantity) ? Number(body.quantity) : 1;
    const compactCandidatesSupplied = body?.candidates !== undefined;
    if (compactCandidatesSupplied && !isCandidateTransportArray(body.candidates)) {
      return NextResponse.json(
        { error: 'candidates must be an array of structurally valid recommendation candidates.' },
        { status: 400 },
      );
    }

    const adapted = compactCandidatesSupplied
      ? { candidates: body.candidates as AutopilotCandidate[], skipped: [] }
      : screenResultsToAutopilotCandidates(screenResults, quantity);
    const { candidates, skipped } = adapted;

    if (!candidates.length) {
      return NextResponse.json(
        { error: 'candidates or screenResults is required and must produce a non-empty candidate array.' },
        { status: 400 },
      );
    }

    const result = await runRecommendationEngine(userId, {
      source: 'screener',
      candidates,
    });

    return NextResponse.json({
      success: true,
      mode: 'paper',
      liveTradingEnabled: false,
      result,
      skipped, // candidates the adapter couldn't/wouldn't convert (e.g. PMCC), with reasons
    });
  } catch (e: any) {
    if (e?.message === ENGINE_BUSY_MESSAGE) {
      return NextResponse.json(
        {
          error: ENGINE_BUSY_MESSAGE,
          code: RECOMMENDATION_ENGINE_BUSY_CODE,
          retryable: true,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
