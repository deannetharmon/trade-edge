// lib/indicators/rsiTurn.ts
//
// RSI-TURN-0001 (Alan's validated spec): classify whether RSI has bottomed (or topped) and turned.
// INFORMATION ONLY. Never a gate, a score input, a rank input or a qualification check. Every threshold below is
// PROVISIONAL until it is calibrated against Dean's own Trade Log entries.

import { rsiSeries } from './rsi';

export type RsiTurnState = 'TURNING_UP' | 'TURNING_DOWN' | 'OVERSOLD_NO_TURN' | 'OVERBOUGHT_NO_TURN' | 'NEUTRAL' | 'INSUFFICIENT';

export interface RsiTurnParams {
  low: number;
  high: number;
  /** Number of latest RSI values examined, the latest bar included. */
  window: number;
  /** Points RSI must have lifted off the window low (or dropped from the window high). */
  lift: number;
  /** A turn up must still be below this; a turn down must still be above it. */
  mid: number;
}

export const RSI_TURN_PARAMS: RsiTurnParams = { low: 30, high: 70, window: 8, lift: 3, mid: 50 };

/** First match wins. `rsi` is oldest first; the latest value is last. */
export function rsiState(rsi: unknown, params: RsiTurnParams = RSI_TURN_PARAMS): RsiTurnState {
  if (!Array.isArray(rsi) || rsi.length < params.window) return 'INSUFFICIENT';
  const w = rsi.slice(rsi.length - params.window) as unknown[];
  for (const value of w) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'INSUFFICIENT';
  }
  const values = w as number[];
  const t = values.length - 1;
  const r = values[t];
  const m = Math.min(...values);
  const big = Math.max(...values);
  const risingTwice = r > values[t - 1] && values[t - 1] > values[t - 2];
  const fallingTwice = r < values[t - 1] && values[t - 1] < values[t - 2];
  if (m <= params.low && r >= m + params.lift && r < params.mid && risingTwice) return 'TURNING_UP';
  if (big >= params.high && r <= big - params.lift && r > params.mid && fallingTwice) return 'TURNING_DOWN';
  if (m <= params.low && r < m + params.lift) return 'OVERSOLD_NO_TURN';
  if (big >= params.high && r > big - params.lift) return 'OVERBOUGHT_NO_TURN';
  return 'NEUTRAL';
}

export interface RsiTurnResult {
  state: RsiTurnState;
  /** Latest RSI, unrounded. */
  latest: number;
  /** The window low (for a turn up or oversold) or high (for a turn down or overbought); null when neutral. */
  extreme: number | null;
  /** Bars between the extreme and the latest bar; null when neutral. */
  extremeBarsAgo: number | null;
  /** The whole RSI series for drawing. */
  series: number[];
}

/** Closes (oldest first) to a result, or null when the closes are unusable or too few for the state. */
export function classifyRsiTurn(closes: unknown, params: RsiTurnParams = RSI_TURN_PARAMS): RsiTurnResult | null {
  const series = rsiSeries(closes);
  if (!series) return null;
  const state = rsiState(series, params);
  if (state === 'INSUFFICIENT') return null;
  const w = series.slice(series.length - params.window);
  const wantLow = state === 'TURNING_UP' || state === 'OVERSOLD_NO_TURN';
  const wantHigh = state === 'TURNING_DOWN' || state === 'OVERBOUGHT_NO_TURN';
  let extreme: number | null = null;
  let extremeBarsAgo: number | null = null;
  if (wantLow || wantHigh) {
    extreme = wantLow ? Math.min(...w) : Math.max(...w);
    extremeBarsAgo = w.length - 1 - w.lastIndexOf(extreme);
  }
  return { state, latest: series[series.length - 1], extreme, extremeBarsAgo, series };
}

export const RSI_STATE_LABEL: Record<Exclude<RsiTurnState, 'INSUFFICIENT'>, string> = {
  TURNING_UP: 'Turning up',
  TURNING_DOWN: 'Turning down',
  OVERSOLD_NO_TURN: 'Oversold, no turn yet',
  OVERBOUGHT_NO_TURN: 'Overbought, no turn yet',
  NEUTRAL: 'Neutral',
};

const bars = (n: number): string => `${n} bar${n === 1 ? '' : 's'} ago`;

/** One plain sentence for a caption or an order-window line. An entry timing hint, never a signal or a reversal call. */
export function describeRsiTurn(result: RsiTurnResult | null): string {
  if (!result) return 'RSI n/a';
  const now = Math.round(result.latest);
  const from = result.extreme == null ? null : Math.round(result.extreme);
  switch (result.state) {
    case 'TURNING_UP': return `RSI ${now} · turned up from ${from}, ${bars(result.extremeBarsAgo ?? 0)}`;
    case 'TURNING_DOWN': return `RSI ${now} · turned down from ${from}, ${bars(result.extremeBarsAgo ?? 0)}`;
    case 'OVERSOLD_NO_TURN': return `RSI ${now} · oversold (low ${from}), no turn yet`;
    case 'OVERBOUGHT_NO_TURN': return `RSI ${now} · overbought (high ${from}), no turn yet`;
    default: return `RSI ${now}`;
  }
}
