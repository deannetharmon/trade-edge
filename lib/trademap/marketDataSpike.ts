// lib/trademap/marketDataSpike.ts
//
// OPTMAP-0001 S0 spike: pure helpers for the read-only market-data probe on
// /debug/market-data-spike. No network, no orders, no side effects. The probe
// answers: is the TastyTrade option data real-time, how old is each quote,
// and which per-leg fields (greeks, IV, volume, open interest) actually come
// back. Nothing here assumes a field name: it reports what the payload has.

export type SpikeItem = Record<string, unknown>;

export type SpikeConceptKey =
  | 'bid' | 'ask' | 'mark' | 'delta' | 'gamma' | 'theta' | 'vega'
  | 'iv' | 'volume' | 'openInterest';

export const SPIKE_CONCEPTS: Record<SpikeConceptKey, RegExp> = {
  bid: /^bid$/i,
  ask: /^ask$/i,
  mark: /^(mark|mark-price)$/i,
  delta: /^delta$/i,
  gamma: /^gamma$/i,
  theta: /^theta$/i,
  vega: /^vega$/i,
  iv: /^(volatility|implied-volatility|iv)$/i,
  volume: /^volume$/i,
  openInterest: /^open-interest$/i,
};

const DELAY_KEY = /delay/i;
const TIME_KEY = /(time|updated|received|stamp)/i;

export type Tri = 'YES' | 'NO' | 'UNKNOWN';

export interface ConceptCoverage {
  keys: string[];
  present: number;
}

export interface AgeStats {
  count: number;
  minSec: number;
  medianSec: number;
  maxSec: number;
}

export interface QuoteSummary {
  total: number;
  delayedTrue: number;
  delayedFalse: number;
  delayedUnknown: number;
  delayKeys: string[];
  coverage: Record<SpikeConceptKey, ConceptCoverage>;
  ageByKey: Record<string, AgeStats>;
  /** symbol -> newest parsed time (ms) across all time-like keys, for sample-to-sample comparison. */
  newestTimeBySymbol: Record<string, number>;
}

/** Epoch seconds, epoch ms, numeric strings and ISO strings -> epoch ms, else null. */
export function parseQuoteTime(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return normalizeEpoch(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return normalizeEpoch(parseFloat(trimmed));
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function normalizeEpoch(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) return n; // already ms
  if (n > 1e9) return n * 1000; // seconds
  return null; // too small to be an epoch
}

function present(value: unknown): boolean {
  return value != null && value !== '' && !(typeof value === 'number' && !Number.isFinite(value));
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeQuotes(items: SpikeItem[], nowMs: number): QuoteSummary {
  const concepts = Object.keys(SPIKE_CONCEPTS) as SpikeConceptKey[];
  const coverage = {} as Record<SpikeConceptKey, ConceptCoverage>;
  for (const c of concepts) coverage[c] = { keys: [], present: 0 };

  let delayedTrue = 0;
  let delayedFalse = 0;
  let delayedUnknown = 0;
  const delayKeys: string[] = [];
  const agesByKey: Record<string, number[]> = {};
  const newestTimeBySymbol: Record<string, number> = {};

  for (const item of items) {
    const keys = Object.keys(item);

    for (const c of concepts) {
      let hit = false;
      for (const k of keys) {
        if (!SPIKE_CONCEPTS[c].test(k)) continue;
        if (coverage[c].keys.indexOf(k) < 0) coverage[c].keys.push(k);
        if (present(item[k])) hit = true;
      }
      if (hit) coverage[c].present += 1;
    }

    let verdict: boolean | null = null;
    for (const k of keys) {
      if (!DELAY_KEY.test(k)) continue;
      if (delayKeys.indexOf(k) < 0) delayKeys.push(k);
      const v = item[k];
      if (v === true || v === 'true') verdict = true;
      else if ((v === false || v === 'false') && verdict !== true) verdict = false;
    }
    if (verdict === true) delayedTrue += 1;
    else if (verdict === false) delayedFalse += 1;
    else delayedUnknown += 1;

    let newest = 0;
    for (const k of keys) {
      if (!TIME_KEY.test(k) || DELAY_KEY.test(k)) continue;
      const ms = parseQuoteTime(item[k]);
      if (ms == null) continue;
      if (!agesByKey[k]) agesByKey[k] = [];
      agesByKey[k].push((nowMs - ms) / 1000);
      if (ms > newest) newest = ms;
    }
    const sym = typeof item.symbol === 'string' ? item.symbol.replace(/\s+/g, '') : '';
    if (sym && newest > 0) newestTimeBySymbol[sym] = newest;
  }

  const ageByKey: Record<string, AgeStats> = {};
  for (const k of Object.keys(agesByKey)) {
    const sorted = agesByKey[k].slice().sort((a, b) => a - b);
    ageByKey[k] = {
      count: sorted.length,
      minSec: sorted[0],
      medianSec: median(sorted),
      maxSec: sorted[sorted.length - 1],
    };
  }

  return {
    total: items.length,
    delayedTrue,
    delayedFalse,
    delayedUnknown,
    delayKeys,
    coverage,
    ageByKey,
    newestTimeBySymbol,
  };
}

export interface SpikeVerdict {
  notDelayed: Tri;
  quoteFresh: Tri;
  ivPerLeg: Tri;
  /** Time key the freshness verdict was judged on, if any. */
  freshnessKey: string | null;
}

export const IV_COVERAGE_MIN = 0.9;

export function spikeVerdict(summary: QuoteSummary, maxAgeSec: number): SpikeVerdict {
  let notDelayed: Tri = 'UNKNOWN';
  if (summary.delayedTrue > 0) notDelayed = 'NO';
  else if (summary.total > 0 && summary.delayedFalse === summary.total) notDelayed = 'YES';

  // Freshness: a time key present on every quote, judged on its median age.
  let quoteFresh: Tri = 'UNKNOWN';
  let freshnessKey: string | null = null;
  const keys = Object.keys(summary.ageByKey);
  for (const k of keys) {
    const s = summary.ageByKey[k];
    if (s.count !== summary.total) continue;
    if (freshnessKey == null || s.medianSec < summary.ageByKey[freshnessKey].medianSec) freshnessKey = k;
  }
  if (freshnessKey != null) {
    quoteFresh = summary.ageByKey[freshnessKey].medianSec <= maxAgeSec ? 'YES' : 'NO';
  }

  let ivPerLeg: Tri = 'NO';
  if (summary.total > 0 && summary.coverage.iv.present / summary.total >= IV_COVERAGE_MIN) ivPerLeg = 'YES';

  return { notDelayed, quoteFresh, ivPerLeg, freshnessKey };
}

export interface ExpirationChoice {
  date: string;
  dte: number;
}

/** The expiration nearest each target DTE (dte >= 1), distinct, ascending by DTE. */
export function pickExpirations(all: ExpirationChoice[], targets: number[]): ExpirationChoice[] {
  const usable = all.filter(e => e.dte >= 1);
  const chosen: ExpirationChoice[] = [];
  for (const target of targets) {
    let best: ExpirationChoice | null = null;
    for (const e of usable) {
      if (chosen.some(c => c.date === e.date)) continue;
      if (best == null || Math.abs(e.dte - target) < Math.abs(best.dte - target)) best = e;
    }
    if (best) chosen.push(best);
  }
  return chosen.sort((a, b) => a.dte - b.dte);
}

/** The n strikes nearest spot, ascending. */
export function pickStrikes(strikes: number[], spot: number, n: number): number[] {
  return strikes
    .filter(s => Number.isFinite(s))
    .slice()
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b)
    .slice(0, n)
    .sort((a, b) => a - b);
}

/** How many symbols have a newer quote time in the second sample than in the first. */
export function countAdvanced(first: Record<string, number>, second: Record<string, number>): { compared: number; advanced: number } {
  let compared = 0;
  let advanced = 0;
  for (const sym of Object.keys(first)) {
    if (second[sym] == null) continue;
    compared += 1;
    if (second[sym] > first[sym]) advanced += 1;
  }
  return { compared, advanced };
}
