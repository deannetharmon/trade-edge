// lib/wheel/candidateRank.ts
//
// WHEEL-SYSTEM-0002 (W2) -- the "Next candidate" checks, verdicts and order. Pure: no fetching, no clock except an
// optional `today`. Integer units throughout (basis points, hundredths, cents).
//
// The Checks decide WHETHER a name is a candidate; premium only decides WHICH put among acceptable ones and how names
// rank among those that pass (Dean: "don't chase premium"). Missing data is "unverified" or "unavailable", never a pass
// and never a fail. Information only: nothing here places an order or changes a recommendation.

import { rsiSeries } from '@/lib/indicators/rsi';
import { EARNINGS_MIN_DAYS_AFTER_EXPIRY, calendarDaysBetween, currentNewYorkDate, daysUntilNy } from '@/lib/scans/earningsPrecheck';
import { formatCents, formatRocBps, type InstrumentKind, type PlanParams } from './capitalPlan';
import { bidAskPercent, isLiquid } from './liquidity';
import type { PlanPut } from './planPut';

// ── Unit conversions ──────────────────────────────────────────────────────────────────────────────

/** IVR as a percent (38.5) to hundredths (3850), rounded so float error (28.999...) cannot flip an exact-floor case. */
export function ivrToHundredths(percent: number | null | undefined): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  const hundredths = Math.round(percent * 100);
  return hundredths >= 0 && hundredths <= 10_000 ? hundredths : null;
}

/** RSI(14) of daily closes: the last value in hundredths (7000 = 70.00), or null with too few or bad closes. */
export function rsiToHundredths(closes: unknown): number | null {
  const series = rsiSeries(closes);
  if (!series || series.length === 0) return null;
  const last = series[series.length - 1];
  return Number.isFinite(last) ? Math.round(last * 100) : null;
}

// ── Earnings timing (stocks only) ─────────────────────────────────────────────────────────────────

export type EarningsUnverifiedReason = 'no-date' | 'stale' | 'unavailable';

export type EarningsState =
  | { kind: 'not-applicable' } // an ETF or index has no earnings of its own
  | { kind: 'inside'; date: string } // on or before the put's expiry: the price can gap
  | { kind: 'near-after'; date: string; daysAfter: number } // 1 to 10 days after: dates can move earlier
  | { kind: 'clear'; date: string }
  | { kind: 'unverified'; reason: EarningsUnverifiedReason };

export function classifyEarnings(input: {
  instrument: InstrumentKind;
  /** false when the metrics call failed, or returned no record for this symbol. */
  dataAvailable: boolean;
  date: string | null | undefined;
  expiration: string;
  today?: string;
}): EarningsState {
  if (input.instrument === 'etf') return { kind: 'not-applicable' };
  if (!input.dataAvailable) return { kind: 'unverified', reason: 'unavailable' };
  if (!input.date) return { kind: 'unverified', reason: 'no-date' };
  const today = input.today ?? currentNewYorkDate();
  const until = daysUntilNy(input.date, today);
  if (until == null) return { kind: 'unverified', reason: 'no-date' };
  if (until < 0) return { kind: 'unverified', reason: 'stale' };
  const date = input.date.slice(0, 10);
  const daysAfter = calendarDaysBetween(input.expiration, date);
  if (daysAfter <= 0) return { kind: 'inside', date };
  if (daysAfter <= EARNINGS_MIN_DAYS_AFTER_EXPIRY) return { kind: 'near-after', date, daysAfter };
  return { kind: 'clear', date };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m >= 1 && m <= 12 && d ? `${MONTHS[m - 1]} ${d}` : iso;
};

// ── Chips, verdicts and order ─────────────────────────────────────────────────────────────────────

export type ChipTone = 'ok' | 'warn' | 'bad' | 'note';
export interface Chip {
  id: 'roc' | 'ivr' | 'rsi' | 'liquidity' | 'earnings' | 'fit';
  text: string;
  tone: ChipTone;
}

export type Verdict =
  | { kind: 'candidate' }
  | { kind: 'wait'; reason: string }
  | { kind: 'not-yet'; reason: string }
  | { kind: 'skip'; reason: string };

export type CandidateGroup = 'candidate' | 'candidate-flagged' | 'wait' | 'not-yet' | 'skip';

export interface CandidateInput {
  symbol: string;
  instrument: InstrumentKind;
  put: PlanPut;
  cashCents: number;
  /** IVR in hundredths (3850 = 38.5), or null when unavailable. */
  ivrHundredths: number | null;
  /** RSI(14) in hundredths, or null when unavailable. */
  rsiHundredths: number | null;
  earnings: EarningsState;
  /** At least one contract fits the profile's per-name limit. */
  fits: boolean;
  /** The trader typed a contract count, so the limits were not applied. */
  forced: boolean;
  /** "Fits at" account size in cents, used to order the Not yet group. */
  fitsAtCents: number;
  /** One line for the Not yet verdict, prepared by the caller (for example "Unlocks in 8 months"). */
  notYetReason: string;
  /** The over-the-limit chip text, prepared by the caller. */
  notFitText: string;
}

export interface RankedCandidate {
  input: CandidateInput;
  verdict: Verdict;
  chips: Chip[];
  group: CandidateGroup;
  rocBps: number;
  /** True when earnings fall inside this expiry: the return carries "includes earnings risk". */
  includesEarningsRisk: boolean;
  /** True when the earnings check is flagged or unverified (a stock only): it ranks after the clean candidates. */
  earningsFlagged: boolean;
}

export function earningsChip(state: EarningsState): Chip | null {
  switch (state.kind) {
    case 'not-applicable':
    case 'clear':
      return null;
    case 'inside':
      return { id: 'earnings', text: `Earnings ${shortDate(state.date)}, inside this expiry`, tone: 'warn' };
    case 'near-after':
      return { id: 'earnings', text: `Earnings ${shortDate(state.date)}, ${state.daysAfter} day${state.daysAfter === 1 ? '' : 's'} after expiry: date may move`, tone: 'note' };
    case 'unverified': {
      const why = state.reason === 'no-date' ? 'no date on file' : state.reason === 'stale' ? 'date is in the past' : 'data unavailable';
      return { id: 'earnings', text: `Earnings unverified: ${why}`, tone: 'warn' };
    }
  }
}

export interface EvaluateOptions {
  /** False outside regular market hours: the bid-ask gap is then unverified (quotes can be stale or wide) and cannot fail a put. */
  marketOpen?: boolean;
}

export function evaluateCandidate(input: CandidateInput, params: PlanParams, options: EvaluateOptions = {}): RankedCandidate {
  const marketOpen = options.marketOpen ?? true;
  const { put } = input;
  const chips: Chip[] = [];

  // 2. Return against the hurdle
  const rocPass = put.rocBps >= params.hurdleBps;
  chips.push({
    id: 'roc',
    text: rocPass ? `ROC ${formatRocBps(put.rocBps)} clears ${formatRocBps(params.hurdleBps)}` : `ROC ${formatRocBps(put.rocBps)}, under ${formatRocBps(params.hurdleBps)}`,
    tone: rocPass ? 'ok' : 'bad',
  });

  // 3. IVR floor
  const ivrFloor = (input.instrument === 'etf' ? params.ivrEtf : params.ivrStock) * 100;
  let ivrPass = true;
  if (input.ivrHundredths == null) {
    chips.push({ id: 'ivr', text: 'IVR unavailable', tone: 'note' });
  } else {
    ivrPass = input.ivrHundredths >= ivrFloor;
    const shown = Math.round(input.ivrHundredths / 100);
    chips.push({ id: 'ivr', text: ivrPass ? `IVR ${shown}` : `IVR ${shown}, under ${ivrFloor / 100}`, tone: ivrPass ? 'ok' : 'bad' });
  }

  // 5. RSI (not stretched)
  const rsiLimit = params.rsiMax * 100;
  let rsiPass = true;
  if (input.rsiHundredths == null) {
    chips.push({ id: 'rsi', text: 'RSI unavailable', tone: 'note' });
  } else {
    rsiPass = input.rsiHundredths <= rsiLimit;
    const shown = Math.round(input.rsiHundredths / 100);
    if (!rsiPass) chips.push({ id: 'rsi', text: `RSI ${shown}, over ${params.rsiMax}`, tone: 'bad' });
    else if (input.rsiHundredths >= rsiLimit - 300) chips.push({ id: 'rsi', text: `RSI ${shown}, close to ${params.rsiMax}`, tone: 'warn' });
    else chips.push({ id: 'rsi', text: `RSI ${shown}`, tone: 'ok' });
  }

  // 6. Liquid put (bid-ask gap and open interest)
  // Outside market hours the gap is not trusted, so only open interest (which updates overnight) decides.
  const liquid = isLiquid(put.leg, { maxBidAskBps: marketOpen ? params.maxBidAskBps : Number.MAX_SAFE_INTEGER / 1e6, minOpenInterest: params.minOpenInterest });
  const gap = bidAskPercent(put.leg);
  const oi = put.leg.openInterest.toLocaleString('en-US');
  chips.push({
    id: 'liquidity',
    text: marketOpen
      ? `Bid-ask ${gap == null ? 'n/a' : `${gap}%`}, OI ${oi}${liquid ? '' : ', illiquid'}`
      : `Bid-ask unverified (market closed), OI ${oi}${liquid ? '' : ', illiquid'}`,
    tone: liquid ? (marketOpen ? 'ok' : 'note') : 'bad',
  });

  // 4. Earnings timing
  const eChip = earningsChip(input.earnings);
  if (eChip) chips.push(eChip);
  const includesEarningsRisk = input.earnings.kind === 'inside';
  const earningsFlagged = input.earnings.kind === 'inside' || input.earnings.kind === 'unverified';

  // 7. Fit
  if (input.fits) chips.push({ id: 'fit', text: 'Fits plan', tone: 'ok' });
  else if (!input.forced) chips.push({ id: 'fit', text: input.notFitText, tone: 'note' });

  // Verdict: first that applies (the precedence in the ticket)
  let verdict: Verdict;
  if (!input.fits && !input.forced) verdict = { kind: 'not-yet', reason: input.notYetReason };
  else if (!liquid) verdict = { kind: 'skip', reason: 'Put is illiquid' };
  else if (!rocPass) verdict = { kind: 'wait', reason: 'Premium too thin' };
  else if (!ivrPass) verdict = { kind: 'wait', reason: 'Not enough premium yet (low IVR)' };
  else if (!rsiPass) verdict = { kind: 'wait', reason: 'Wait for a pullback' };
  else if (input.earnings.kind === 'inside' && params.earningsRule === 'wait') verdict = { kind: 'wait', reason: `Wait until after earnings ${shortDate(input.earnings.date)}` };
  else verdict = { kind: 'candidate' };

  const group: CandidateGroup =
    verdict.kind === 'candidate' ? (earningsFlagged ? 'candidate-flagged' : 'candidate') : verdict.kind === 'wait' ? 'wait' : verdict.kind === 'not-yet' ? 'not-yet' : 'skip';

  return { input, verdict, chips, group, rocBps: put.rocBps, includesEarningsRisk, earningsFlagged };
}

const GROUP_ORDER: CandidateGroup[] = ['candidate', 'candidate-flagged', 'wait', 'not-yet', 'skip'];

/** Candidates without an earnings issue first, then flagged or unverified; Wait; Not yet; Skip. Inside a group: see the ticket. */
export function rankCandidates(list: RankedCandidate[]): RankedCandidate[] {
  return [...list].sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (g !== 0) return g;
    if (a.group === 'not-yet') return a.input.fitsAtCents - b.input.fitsAtCents || a.input.symbol.localeCompare(b.input.symbol);
    if (a.group === 'skip') return a.input.symbol.localeCompare(b.input.symbol);
    return b.rocBps - a.rocBps || a.input.cashCents - b.input.cashCents || a.input.symbol.localeCompare(b.input.symbol);
  });
}

export const GROUP_LABEL: Record<CandidateGroup, string> = {
  candidate: 'Candidates',
  'candidate-flagged': 'Candidates with an earnings flag',
  wait: 'Wait',
  'not-yet': 'Not yet',
  skip: 'Skip',
};

/** "Cash $16,200, over your $15,000 limit" for the fit chip. */
export const notFitText = (cashCents: number, maxCashCents: number): string => `Cash ${formatCents(cashCents)}, over your ${formatCents(maxCashCents)} limit`;
