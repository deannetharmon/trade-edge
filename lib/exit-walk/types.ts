// lib/exit-walk/types.ts
//
// EXIT-WALK-0001A: types for the exit-price walk (pure math, no UI, no order path, no production callers).
// All prices are integer cents. Percent settings are whole numbers so every test stays in integer arithmetic.

import type { TickTable } from '@/lib/portfolio/tickSize';

export type ExitSide = 'sell' | 'buy';

/** A timestamped NBBO quote for one contract, in integer cents. `t` is an ISO-8601 timestamp with offset. */
export interface Quote {
  t: string;
  bid_c: number;
  ask_c: number;
}

export interface ExitWalkConfig {
  /** Step size as a whole percent of the live spread (default 10). */
  stepPctOfSpread: number;
  /** Max slippage from mid as a whole percent of the live spread, 0..100 (default 50: boundary is the live bid/ask). */
  maxSlippagePct: number;
  /** Favorable-side start offset as a whole percent of the half-spread, 0..100 (default 0). */
  startOffsetPct: number;
  /** A quote older than this (ms) is stale (default 60,000). */
  quoteMaxAgeMs: number;
  /** No walk guidance for this many minutes after 09:30 ET (default 15). */
  openingWindowMinutes: number;
  /** Time shown per step in the schedule (ms, default 90,000). */
  dwellMs: number;
  /** Sell-side floor used when the live bid is zero, in cents (default 5). */
  zeroBidFloorCents: number;
  /** Spread flag threshold, whole percent of mid (default 10). */
  spreadFlagPct: number;
}

export interface ExitWalkInput {
  side: ExitSide;
  quote: Quote | null;
  /** The evaluation instant, epoch milliseconds. The module never reads a clock. */
  nowMs: number;
  tickTable: TickTable | null;
  config?: Partial<ExitWalkConfig>;
}

export type ExitWalkHaltReason =
  | 'invalid_config'
  | 'quote_missing'
  | 'invalid_market'
  | 'quote_stale'
  | 'opening_window'
  | 'boundary_beyond_start';

export interface WalkStep {
  index: number;
  price_c: number;
  dwellMs: number;
  /** Signed give-up versus mid in half-cents (sell: mid minus price; buy: price minus mid). Negative = better than mid. */
  slippageVsMid_c2: number;
}

/** Derivation basis, so every number on screen can say how it was computed. */
export interface WalkBasis {
  mid: string;
  start: string;
  step: string;
  boundary: string;
  tick: 'table' | 'fallback_0.01';
}

export type ExitWalkResult =
  | {
      ok: true;
      side: ExitSide;
      prices_c: number[];
      steps: WalkStep[];
      /** Sell: the floor. Buy: the ceiling. Re-derived from the quote passed in. */
      boundary_c: number;
      /** Twice the mid, in cents (bid + ask), so a half-cent mid stays an integer. */
      mid_c2: number;
      spread_c: number;
      /** Step size in cents. */
      step_c: number;
      spreadFlagged: boolean;
      basis: WalkBasis;
    }
  | { ok: false; reason: ExitWalkHaltReason; message: string };

/** Where the walk is: the step to show now, and the quote its schedule was built from. */
export interface WalkState {
  stepIndex: number;
  anchor: Quote;
}

export type NextWalkPrice =
  | {
      ok: true;
      price_c: number;
      /** The step index actually used (clamped to the last step). */
      stepIndex: number;
      reanchored: boolean;
      /** The quote the schedule is now anchored to. */
      anchor: Quote;
      boundary_c: number;
      atBoundary: boolean;
    }
  | { ok: false; reason: ExitWalkHaltReason; message: string };
