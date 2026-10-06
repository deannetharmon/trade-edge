// lib/discovery/leaps/rank.ts

// LEAPS-QV-0001 Gate 4b -- contract score (Section 8, ruling I5) and the canonical comparator (Section 8.1, Q5).
// Score 0-100 = time-value cost (70) + liquidity (30); delta and DTE are filters only. The comparator sorts by
// quantized integer keys, so the order is a total order and a pure function of the set of contracts.

import type { QvLeapsPolicy } from './policy';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface ScoreInputs {
  breakevenMovePct: number;
  spreadPctOfMid: number;
  openInterest: number;
}

export interface LeapsScore {
  score: number;
  components: { timeValueCost: number; liquidity: number };
}

export function scoreLeapsContract(inputs: ScoreInputs, policy: QvLeapsPolicy): LeapsScore {
  const r = policy.ranking;
  const timeValueCost = r.timeValueWeight * clamp01(1 - inputs.breakevenMovePct / r.timeValueZeroAtBreakevenMovePct);
  const liquidity = r.liquidityWeight * (0.5 * clamp01(1 - inputs.spreadPctOfMid / r.spreadZeroAtPct) + 0.5 * clamp01(inputs.openInterest / r.openInterestFullAt));
  return { score: timeValueCost + liquidity, components: { timeValueCost, liquidity } };
}

export interface RankKeyInputs {
  score: number;
  extrinsicPctOfMid: number;
  spreadPctOfMid: number;
  openInterest: number;
  dte: number;
  strike: number;
  expiration: string;
  occSymbol: string;
}

/** Section 8.1 key, ascending: (-scoreQ, extQ, spreadQ, -openInterest, -dte, strike, expiration, occSymbol). */
export function compareLeapsRank(a: RankKeyInputs, b: RankKeyInputs, policy: QvLeapsPolicy): number {
  const q = (x: number, quantum: number) => Math.round(x * quantum);
  const r = policy.ranking;
  const numeric: [number, number][] = [
    [-q(a.score, r.scoreQuantum), -q(b.score, r.scoreQuantum)],
    [q(a.extrinsicPctOfMid, r.ratioQuantum), q(b.extrinsicPctOfMid, r.ratioQuantum)],
    [q(a.spreadPctOfMid, r.ratioQuantum), q(b.spreadPctOfMid, r.ratioQuantum)],
    [-a.openInterest, -b.openInterest],
    [-a.dte, -b.dte],
    [q(a.strike, r.ratioQuantum), q(b.strike, r.ratioQuantum)],
  ];
  for (const [x, y] of numeric) if (x !== y) return x < y ? -1 : 1;
  if (a.expiration !== b.expiration) return a.expiration < b.expiration ? -1 : 1;
  if (a.occSymbol !== b.occSymbol) return a.occSymbol < b.occSymbol ? -1 : 1;
  return 0;
}
