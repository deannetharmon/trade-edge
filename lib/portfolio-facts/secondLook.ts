// lib/portfolio-facts/secondLook.ts
//
// RECO-UNIFY-0001C: the AI "second look". The rules own the verdict; the AI may disagree openly, naming the data point, and can never change
// the verdict or any state. This module is pure: it reads the AI's reply and the app's verdict and returns a separate SecondLook object.
// Whether the AI disagrees is decided HERE, from the AI's recommendation bucket versus the official bucket, not from the AI's own claim.
// A disagreement counts as "named" only when the AI points at a data point that exists in the facts.

import type { PositionFacts } from './positionFacts';
import type { Verdict, VerdictBucket } from './verdict';

/** The data points the AI may name when it disagrees. Anything else is treated as not named. */
export const DATA_POINTS = [
  'rsi', 'rsiPrevious', 'rsiTurn', 'trend', 'ivr', 'iv', 'hv30', 'netDelta', 'theta', 'gamma', 'netVega', 'dte', 'pnl', 'pnlPct',
  'pctOfCreditCaptured', 'buffer', 'stockPrice', 'pop', 'popVsStrike', 'earnings', 'concentration', 'entryCredit', 'closeValue', 'currentValue', 'intent', 'note',
] as const;
export type DataPoint = (typeof DATA_POINTS)[number];

const AI_BUCKET: Record<string, VerdictBucket> = {
  HOLD: 'Hold', WATCH: 'Hold', MANAGE: 'Manage', TAKE_PROFIT: 'Close', CLOSE: 'Close', CUT_LOSSES: 'Close', ROLL: 'Roll',
};

export function aiBucketOf(recommendation: unknown): VerdictBucket | null {
  return typeof recommendation === 'string' ? AI_BUCKET[recommendation.trim().toUpperCase().replace(/\s+/g, '_')] ?? null : null;
}

function valueOf(facts: PositionFacts, point: DataPoint): number | string | boolean | null {
  switch (point) {
    case 'rsi': return facts.technicals.rsi;
    case 'rsiPrevious': return facts.technicals.rsiPrevious;
    case 'rsiTurn': return facts.technicals.rsiTurn;
    case 'trend': return facts.technicals.trend;
    case 'ivr': return facts.volatility.ivr;
    case 'iv': return facts.volatility.iv;
    case 'hv30': return facts.volatility.hv30;
    case 'netDelta': return facts.greeks.netDelta;
    case 'theta': return facts.greeks.theta;
    case 'gamma': return facts.greeks.gamma;
    case 'netVega': return facts.greeks.netVega;
    case 'dte': return facts.time.dte;
    case 'pnl': return facts.economics.pnl;
    case 'pnlPct': return facts.economics.pnlPct;
    case 'pctOfCreditCaptured': return facts.economics.pctOfCreditCaptured;
    case 'buffer': return facts.risk.bufferPct;
    case 'stockPrice': return facts.risk.stockPrice;
    case 'pop': return facts.risk.popBreakeven;
    case 'popVsStrike': return facts.risk.popVsStrike;
    case 'earnings': return facts.events.earningsBeforeExpiry ?? facts.events.nextEarnings;
    case 'concentration': return facts.risk.concentrationSharePct;
    case 'entryCredit': return facts.economics.entryCredit;
    case 'closeValue': return facts.economics.closeValue;
    case 'currentValue': return facts.economics.currentValue;
    case 'intent': return facts.identity.intent;
    case 'note': return facts.identity.note;
  }
}

export interface SecondLook {
  aiRecommendation: string | null;
  aiBucket: VerdictBucket | null;
  officialBucket: VerdictBucket | null;
  /** True when the AI's recommendation falls in a different bucket from the official verdict (decided here, not by the AI's claim). */
  differs: boolean;
  /** The data point the AI named, when it is one of DATA_POINTS. */
  dataPoint: DataPoint | null;
  /** That data point's value in the facts (null when the facts do not have it). */
  dataPointValue: number | string | boolean | null;
  /** The AI's own one-line reason for differing, when it gave one. */
  note: string | null;
  /** Short text for the chip beside the verdict; null when the AI agrees. */
  chip: string | null;
}

export function buildSecondLook(parsed: unknown, verdict: Verdict | null, facts: PositionFacts): SecondLook {
  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const aiRecommendation = typeof p.recommendation === 'string' ? p.recommendation : null;
  const aiBucket = aiBucketOf(aiRecommendation);
  const officialBucket = verdict?.bucket ?? null;
  const differs = aiBucket != null && officialBucket != null && aiBucket !== officialBucket;
  const named = typeof p.differenceDataPoint === 'string' ? p.differenceDataPoint.trim() : '';
  const dataPoint = (DATA_POINTS as readonly string[]).find(d => d.toLowerCase() === named.toLowerCase()) as DataPoint | undefined;
  const noteSource = typeof p.deviationNote === 'string' && p.deviationNote.trim() ? p.deviationNote.trim() : null;
  return {
    aiRecommendation, aiBucket, officialBucket, differs,
    dataPoint: differs && dataPoint ? dataPoint : null,
    dataPointValue: differs && dataPoint ? valueOf(facts, dataPoint) : null,
    note: differs ? noteSource : null,
    chip: differs ? `AI differs: ${dataPoint ?? 'no data point named'}` : null,
  };
}

/** The instruction appended to the Analyze prompt so the AI states, in two extra keys, whether it differs and on which data point. */
export const SECOND_LOOK_PROMPT_SUFFIX = `
SECOND LOOK: also add two keys to the JSON. "differsFromVerdict": true if your recommendation is in a different group from the official verdict (Hold, Manage, Close, Roll), else false. "differenceDataPoint": when it differs, exactly one of ${DATA_POINTS.join(', ')} that drives your difference, else null. If you differ, deviationNote is ONE sentence naming that data point and its value.`;
