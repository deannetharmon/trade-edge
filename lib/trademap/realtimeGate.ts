// lib/trademap/realtimeGate.ts
//
// OPTMAP-0001 gate v2 (Quinn proposed, Ian signed, decision record 2026-11-17).
// The broker sends no "delayed" flag, so freshness is judged from each quote's
// own `updated-at`. The map is LIVE only when, on the latest poll:
//   (a) the median quote age across everything polled is <= 15s;
//   (b) every strategy leg is <= 60s old, not halted, two-sided and uncrossed;
//   (c) the last successful poll is within two poll intervals;
// and it is WARMING until two polls have succeeded (a cold first poll can be
// stale, and a warming map never enables Send). A quote more than 5s in the
// future means the browser clock is off, which blocks as well.
// Pure function, no I/O.

export const GATE_MEDIAN_MAX_SEC = 15;
export const GATE_LEG_MAX_SEC = 60;
export const GATE_CLOCK_SKEW_SEC = 5;
export const GATE_WARMUP_POLLS = 2;

export interface GateQuote {
  symbol: string;
  /** Broker `updated-at`, epoch ms; null when the quote carries none. */
  updatedAtMs: number | null;
  halted: boolean | null;
  bid: number | null;
  ask: number | null;
}

export interface GateInput {
  nowMs: number;
  /** The strategy's option legs. */
  legs: GateQuote[];
  /** Other polled quotes (the underlying): counted in the median only. */
  others: GateQuote[];
  lastSuccessMs: number | null;
  pollIntervalMs: number;
  successfulPolls: number;
}

export type GateStatus = 'live' | 'warming' | 'stale';

export interface GateResult {
  status: GateStatus;
  reasons: string[];
  medianAgeSec: number | null;
  maxLegAgeSec: number | null;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function evaluateGate(input: GateInput): GateResult {
  const reasons: string[] = [];
  const ages: number[] = [];
  const legAges: number[] = [];
  let skew = false;

  if (input.legs.length === 0) reasons.push('no strategy legs');
  if (input.lastSuccessMs == null) {
    reasons.push('no successful poll yet');
  } else if (input.nowMs - input.lastSuccessMs > 2 * input.pollIntervalMs) {
    reasons.push(`last successful poll ${Math.round((input.nowMs - input.lastSuccessMs) / 1000)}s ago`);
  }

  const ageOf = (q: GateQuote): number | null => {
    if (q.updatedAtMs == null) return null;
    const age = (input.nowMs - q.updatedAtMs) / 1000;
    if (age < -GATE_CLOCK_SKEW_SEC) skew = true;
    return Math.max(0, age);
  };

  for (const q of input.others) {
    const age = ageOf(q);
    if (age != null) ages.push(age);
  }
  for (const q of input.legs) {
    const age = ageOf(q);
    if (age == null) {
      reasons.push(`${q.symbol.replace(/\s+/g, '')}: quote has no timestamp`);
    } else {
      ages.push(age);
      legAges.push(age);
      if (age > GATE_LEG_MAX_SEC) reasons.push(`${q.symbol.replace(/\s+/g, '')}: quote is ${Math.round(age)}s old (limit ${GATE_LEG_MAX_SEC}s)`);
    }
    if (q.halted === true) reasons.push(`${q.symbol.replace(/\s+/g, '')}: trading halted`);
    const twoSided = q.bid != null && q.ask != null && q.bid > 0 && q.ask >= q.bid;
    if (!twoSided) reasons.push(`${q.symbol.replace(/\s+/g, '')}: one-sided or crossed market`);
  }

  if (skew) reasons.push('browser clock is ahead of the broker (clock skew)');

  const medianAgeSec = ages.length > 0 ? median(ages) : null;
  if (medianAgeSec == null) reasons.push('no quote timestamps');
  else if (medianAgeSec > GATE_MEDIAN_MAX_SEC) reasons.push(`median quote age ${Math.round(medianAgeSec)}s (limit ${GATE_MEDIAN_MAX_SEC}s)`);

  const maxLegAgeSec = legAges.length > 0 ? Math.max.apply(null, legAges) : null;
  if (reasons.length > 0) return { status: 'stale', reasons, medianAgeSec, maxLegAgeSec };
  if (input.successfulPolls < GATE_WARMUP_POLLS) return { status: 'warming', reasons: ['warming up'], medianAgeSec, maxLegAgeSec };
  return { status: 'live', reasons: [], medianAgeSec, maxLegAgeSec };
}
