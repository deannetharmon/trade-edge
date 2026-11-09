// lib/scans/pmccCompare.ts
//
// PMCC-COMPARE-0001 S1 (Ian, Alan, Paul, Diane; Dean 2026-11-09): for a LEAP you already hold, compare selling a
// short call against selling nothing. Pure and display-only: no order, score, ranking or qualification reads this.
//
// Rules (docs/tickets/PMCC-COMPARE-0001.md):
//   - Profit and loss is measured against what you PAID, never against today's value.
//   - "Odds" are model odds: 1 - |short delta| that the call expires worthless (the same delta the card already
//     reports as "chance of assignment"). Never presented as a forecast.
//   - Scenario values at the short call's expiration use Black-Scholes on the LEAP's own IV, backed out of its current
//     value (held constant, 4% rate, time remaining), labeled a model estimate. Null when the IV cannot be solved.
//   - Default stance: LEAP under water (value below cost) -> bullish, the farthest-strike (lowest delta) call.
//     At or above cost -> neutral. "No call" is always offered and is never the default.
//   - Minimum credit: a share of the LEAP's current value per 30 days (default 3%).

import { normalCdf } from './scan-utils';
import { PMCC_START_PRICE_RISK_FREE_RATE } from './pmccStartPrice';

export const COMPARE_MIN_CREDIT_PCT_PER_30D = 3;
const SCENARIO_MOVES: ReadonlyArray<{ key: CompareScenarioKey; label: string; pct: number }> = [
  { key: 'unchanged', label: 'Unchanged', pct: 0 },
  { key: 'up5', label: 'Up 5%', pct: 5 },
  { key: 'up10', label: 'Up 10%', pct: 10 },
];
/** The last row sits 10% past the highest strike offered, so the capped-rally case is always shown (and named by its price). */
export type CompareScenarioKey = 'unchanged' | 'up5' | 'up10' | 'pastStrikes';

export type CompareStance = 'none' | 'bullish' | 'neutral' | 'cautious';

export interface CompareCandidate {
  id: string;
  strike: number;
  dte: number;
  /** Short call delta (sign ignored). */
  delta: number;
  /** Executable credit per share (the bid). */
  credit: number;
}

export interface CompareInput {
  spot: number | null | undefined;
  longStrike: number;
  longDte: number;
  /** Current value of the LEAP per share. */
  longValue: number | null | undefined;
  /** What you paid per share. Null/zero means unknown and the comparison is not built. */
  paid: number | null | undefined;
  /** Number of LEAP contracts (a short call is never offered for more contracts than this). */
  quantity: number;
  candidates: ReadonlyArray<CompareCandidate>;
  rate?: number;
  minCreditPctPer30d?: number;
}

export interface CompareScenario {
  key: CompareScenarioKey;
  label: string;
  spot: number;
  /** Profit or loss for the whole position vs what you paid, dollars. */
  noCall: number;
  /** Same with the short call(s) sold. Null for the no-call option. */
  withCall: number | null;
}

export interface CompareOption {
  stance: CompareStance;
  /** Null for "No call". */
  candidate: CompareCandidate | null;
  /** Dollars collected for the contracts covered. */
  collect: number;
  /** Model odds (0..1) the call expires worthless; null for No call. */
  oddsWorthless: number | null;
  oddsAbove: number | null;
  clearsMinimumCredit: boolean | null;
  scenarios: CompareScenario[] | null;
}

export interface PmccCompare {
  quantity: number;
  paidTotal: number;
  worthTotal: number;
  /** Negative when under water. */
  downVsPaid: number;
  underwater: boolean;
  ivPct: number | null;
  shortDte: number;
  minCreditPerShare: number;
  defaultStance: CompareStance;
  options: CompareOption[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function blackScholesCall(spot: number, strike: number, years: number, sigma: number, rate: number): number {
  if (!(years > 0) || !(sigma > 0)) return Math.max(0, spot - strike);
  const sd = sigma * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * years) / sd;
  const d2 = d1 - sd;
  return spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2);
}

/** IV (decimal) that reproduces the LEAP's current value; null when the value is outside what the model can price. */
export function impliedCallIv(spot: number, strike: number, years: number, value: number, rate: number): number | null {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(value > 0)) return null;
  let lo = 0.01;
  let hi = 3;
  if (blackScholesCall(spot, strike, years, lo, rate) > value || blackScholesCall(spot, strike, years, hi, rate) < value) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholesCall(spot, strike, years, mid, rate) < value) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The expiration most candidates share (ties go to the nearest to 38 days), so one comparison uses one cycle. */
function pickCycle(candidates: ReadonlyArray<CompareCandidate>): CompareCandidate[] {
  const byDte = new Map<number, CompareCandidate[]>();
  for (const c of candidates) byDte.set(c.dte, [...(byDte.get(c.dte) ?? []), c]);
  let best: CompareCandidate[] = [];
  let bestDte = Infinity;
  byDte.forEach((group, dte) => {
    if (group.length > best.length || (group.length === best.length && Math.abs(dte - 38) < Math.abs(bestDte - 38))) { best = group; bestDte = dte; }
  });
  return best;
}

export function buildPmccCompare(input: CompareInput): PmccCompare | null {
  const { spot, longStrike, longDte, longValue, paid } = input;
  const rate = input.rate ?? PMCC_START_PRICE_RISK_FREE_RATE;
  if (!finite(spot) || spot <= 0 || !finite(longValue) || longValue < 0 || !finite(paid) || paid <= 0) return null;
  if (!finite(longStrike) || longStrike <= 0 || !finite(longDte) || longDte <= 0) return null;
  const quantity = Number.isInteger(input.quantity) && input.quantity > 0 ? input.quantity : 1;

  const usable = input.candidates.filter(c => finite(c.strike) && c.strike > longStrike && finite(c.credit) && c.credit > 0 && finite(c.delta) && finite(c.dte) && c.dte > 0 && c.dte < longDte);
  const cycle = pickCycle(usable);
  // One candidate per strike, lowest delta first (farthest from the money).
  const sorted = Array.from(new Map(cycle.map(c => [c.strike, c] as const)).values()).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const shortDte = sorted[0]?.dte ?? 0;

  const years = longDte / 365;
  const iv = impliedCallIv(spot, longStrike, years, longValue, rate);
  const remaining = (longDte - shortDte) / 365;
  const canPrice = iv != null && remaining > 0;
  const longAt = (s: number) => blackScholesCall(s, longStrike, remaining, iv as number, rate);

  const stanceFor = (n: number, i: number): CompareStance => {
    if (n === 1) return 'bullish';
    if (n === 2) return i === 0 ? 'bullish' : 'cautious';
    return i === 0 ? 'bullish' : i === n - 1 ? 'cautious' : 'neutral';
  };
  const picks = sorted.length > 3 ? [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]] : sorted;
  const minCreditPerShare = longValue * ((input.minCreditPctPer30d ?? COMPARE_MIN_CREDIT_PCT_PER_30D) / 100) * (Math.max(1, shortDte) / 30);

  const scenariosFor = (candidate: CompareCandidate | null): CompareScenario[] | null => {
    if (!canPrice) return null;
    const highStrike = picks.length > 0 ? Math.max(...picks.map(c => c.strike)) : null;
    const points = SCENARIO_MOVES.map(m => ({ key: m.key, label: m.label, spot: spot * (1 + m.pct / 100) }));
    if (highStrike != null) points.push({ key: 'pastStrikes', label: `10% above $${Number.isInteger(highStrike) ? highStrike : highStrike.toFixed(2)}`, spot: highStrike * 1.1 });
    return points.map(pt => {
      const noCall = (longAt(pt.spot) - paid) * 100 * quantity;
      const withCall = candidate ? noCall + (candidate.credit - Math.max(0, pt.spot - candidate.strike)) * 100 * quantity : null;
      return { key: pt.key, label: pt.label, spot: pt.spot, noCall, withCall };
    });
  };

  const options: CompareOption[] = [{ stance: 'none', candidate: null, collect: 0, oddsWorthless: null, oddsAbove: null, clearsMinimumCredit: null, scenarios: scenariosFor(null) }];
  picks.forEach((c, i) => {
    const p = Math.min(1, Math.max(0, Math.abs(c.delta)));
    options.push({
      stance: stanceFor(picks.length, i), candidate: c, collect: c.credit * 100 * quantity,
      oddsWorthless: 1 - p, oddsAbove: p, clearsMinimumCredit: c.credit >= minCreditPerShare, scenarios: scenariosFor(c),
    });
  });

  const underwater = longValue < paid;
  const wanted: CompareStance = underwater ? 'bullish' : 'neutral';
  const defaultStance = options.find(o => o.stance === wanted)?.stance ?? options.find(o => o.stance !== 'none')?.stance ?? 'none';

  return {
    quantity, paidTotal: paid * 100 * quantity, worthTotal: longValue * 100 * quantity, downVsPaid: (longValue - paid) * 100 * quantity,
    underwater, ivPct: iv != null ? iv * 100 : null, shortDte, minCreditPerShare, defaultStance, options,
  };
}

type HeldPairLike = {
  entryMode?: string | null;
  longLeg: { strike: number; dte: number; executablePrice: number; quote: { midpoint?: number | null } };
  shortLeg: { candidateId?: string; strike: number; dte: number; delta: number; executablePrice: number };
  failureReasons: ReadonlyArray<{ code: string }>;
  heldLongLeg?: { occSymbol: string; quantity: number; avgOpenPrice?: number | null } | null;
};

/**
 * Builds the compare for ONE held LEAP from the short-call pairs the held scan found against it. The first held pair
 * names the LEAP; pairs on other LEAPs and calls at or below the LEAP strike (not covered) are ignored. Null when the
 * cost basis or price is unusable, so a card never guesses.
 */
export function buildHeldCompare(pairs: ReadonlyArray<HeldPairLike | null | undefined>, spot: number | null | undefined): PmccCompare | null {
  const held = pairs.filter((p): p is HeldPairLike => !!p && p.entryMode === 'covered-short-call-against-held-leaps' && !!p.heldLongLeg);
  const first = held[0];
  if (!first || !first.heldLongLeg) return null;
  const occ = first.heldLongLeg.occSymbol;
  const same = held.filter(p => p.heldLongLeg?.occSymbol === occ && !p.failureReasons.some(r => r.code === 'LONG_STRIKE_NOT_BELOW_SHORT'));
  const mid = first.longLeg.quote.midpoint;
  const longValue = finite(mid) && mid > 0 ? mid : first.longLeg.executablePrice;
  return buildPmccCompare({
    spot, longStrike: first.longLeg.strike, longDte: first.longLeg.dte, longValue,
    paid: first.heldLongLeg.avgOpenPrice, quantity: first.heldLongLeg.quantity,
    candidates: same.map((p, i) => ({ id: p.shortLeg.candidateId ?? `held-short-${i}`, strike: p.shortLeg.strike, dte: p.shortLeg.dte, delta: p.shortLeg.delta, credit: p.shortLeg.executablePrice })),
  });
}
