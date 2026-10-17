// lib/exit-walk/exitWalk.ts
//
// EXIT-WALK-0001A (Alan's A17.1-A17.5): the midpoint walk for exits. Start at the mid, step toward the market, stop at a
// boundary re-derived from the live quote. Pure and integer-cent: no clock, no network, no UI, no order path. The caller
// passes `nowMs`; the schedule is a recommendation the trader places and reprices by hand.
//
//   sell to close: price walks DOWN from mid to the floor   floor   = max(bid, mid - maxSlippage), rounded UP to a tick
//   buy  to close: price walks UP   from mid to the ceiling ceiling = min(ask, mid + maxSlippage), rounded DOWN to a tick
//   maxSlippage = maxSlippagePct x spread  (default 50%: the boundary is the live bid / ask)
//
// Internally values are held as cents x 200 so a half-cent mid and every whole-percent setting stay integers.

import { tickSizeFor, type TickTable } from '@/lib/portfolio/tickSize';
import type {
  ExitSide,
  ExitWalkConfig,
  ExitWalkInput,
  ExitWalkResult,
  NextWalkPrice,
  Quote,
  WalkBasis,
  WalkState,
  WalkStep,
} from './types';

export const DEFAULT_EXIT_WALK_CONFIG: ExitWalkConfig = {
  stepPctOfSpread: 10,
  maxSlippagePct: 50,
  startOffsetPct: 0,
  quoteMaxAgeMs: 60000,
  openingWindowMinutes: 15,
  dwellMs: 90000,
  zeroBidFloorCents: 5,
  spreadFlagPct: 10,
};

const SCALE = 200; // cents x 200
const MAX_STEPS = 500; // safety cap; a real schedule is a handful of prices
const OPEN_SECONDS_ET = 9 * 3600 + 30 * 60; // 09:30:00 ET

/** Dollars to integer cents. */
export const toCents = (dollars: number): number => Math.round(dollars * 100);

/** Tick in cents for a price held as cents x 200. */
const tickCentsAt = (v200: number, table: TickTable | null): number =>
  Math.max(1, Math.round(tickSizeFor(v200 / SCALE / 100, table) * 100));

/** Nearest tick multiple (cents) for a cents x 200 value in the given tick; an exact tie goes `tie`. */
function nearest(v200: number, tick: number, tie: 'down' | 'up'): number {
  const unit = tick * SCALE;
  const lower = Math.floor(v200 / unit);
  const rem = v200 - lower * unit;
  let ticks: number;
  if (rem * 2 < unit) ticks = lower;
  else if (rem * 2 > unit) ticks = lower + 1;
  else ticks = tie === 'down' ? lower : lower + 1;
  return ticks * tick;
}

/** Nearest valid price (cents); a result that crosses a tick band is re-checked in its own band. Never below one tick. */
function snapNearest(v200: number, table: TickTable | null, tie: 'down' | 'up'): number {
  const tick = tickCentsAt(v200, table);
  let c = nearest(v200, tick, tie);
  const t2 = tickCentsAt(c * SCALE, table);
  if (t2 !== tick) c = nearest(c * SCALE, t2, tie);
  return Math.max(c, tickCentsAt(0, table));
}

function ceilToTick(v200: number, table: TickTable | null): number {
  const tick = tickCentsAt(v200, table);
  let c = Math.ceil(v200 / (tick * SCALE)) * tick;
  const t2 = tickCentsAt(c * SCALE, table);
  if (t2 !== tick) c = Math.ceil(c / t2) * t2;
  return c;
}

function floorToTick(v200: number, table: TickTable | null): number {
  const tick = tickCentsAt(v200, table);
  let c = Math.floor(v200 / (tick * SCALE)) * tick;
  const t2 = tickCentsAt(c * SCALE, table);
  if (t2 !== tick) c = Math.floor(c / t2) * t2;
  return c;
}

const isWhole = (n: unknown, min: number, max: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Merge defaults; null when any value is out of range (whole numbers only, so the math stays integer). */
function resolveConfig(partial: Partial<ExitWalkConfig> | undefined): ExitWalkConfig | null {
  const c: ExitWalkConfig = { ...DEFAULT_EXIT_WALK_CONFIG, ...(partial || {}) };
  const ok =
    isWhole(c.stepPctOfSpread, 1, 100) &&
    isWhole(c.maxSlippagePct, 0, 100) &&
    isWhole(c.startOffsetPct, 0, 100) &&
    isWhole(c.quoteMaxAgeMs, 1, Number.MAX_SAFE_INTEGER) &&
    isWhole(c.openingWindowMinutes, 0, 390) &&
    isWhole(c.dwellMs, 1, Number.MAX_SAFE_INTEGER) &&
    isWhole(c.zeroBidFloorCents, 1, Number.MAX_SAFE_INTEGER) &&
    isWhole(c.spreadFlagPct, 1, 100);
  return ok ? c : null;
}

/** Spread flag: spread is more than pct% of the mid. Integer test; strict, so exactly pct% is not flagged. */
export function isSpreadFlagged(bid_c: number, ask_c: number, pct: number = DEFAULT_EXIT_WALK_CONFIG.spreadFlagPct): boolean {
  return 100 * 2 * (ask_c - bid_c) > pct * (bid_c + ask_c);
}

/** Seconds after midnight in New York for an instant. DST-correct; independent of the host time zone. */
function secondsOfDayEt(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(nowMs);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? NaN);
  const hour = get('hour') % 24; // some engines print midnight as 24
  return hour * 3600 + get('minute') * 60 + get('second');
}

/** True from 09:30:00 ET up to (not including) 09:30 + minutes. Time of day only: the trading calendar is not this module's job. */
export function isInOpeningWindow(nowMs: number, minutes: number): boolean {
  const s = secondsOfDayEt(nowMs);
  return s >= OPEN_SECONDS_ET && s < OPEN_SECONDS_ET + minutes * 60;
}

type Core =
  | {
      ok: true;
      prices_c: number[];
      boundary_c: number;
      step_c: number;
      mid_c2: number;
      spread_c: number;
      basis: WalkBasis;
    }
  | { ok: false; reason: 'boundary_beyond_start'; message: string };

/** The schedule from one quote. No halts here (those belong to the live quote); the quote is assumed valid. */
function buildSchedule(side: ExitSide, bid_c: number, ask_c: number, cfg: ExitWalkConfig, table: TickTable | null): Core {
  const sum = bid_c + ask_c;
  const spread = ask_c - bid_c;
  const mid200 = 100 * sum;
  const slip200 = 2 * cfg.maxSlippagePct * spread;
  const offset200 = cfg.startOffsetPct * spread;
  const step200 = 2 * cfg.stepPctOfSpread * spread;
  const sell = side === 'sell';

  let boundary_c: number;
  let start_c: number;
  if (sell) {
    let floor200 = Math.max(SCALE * bid_c, mid200 - slip200);
    if (bid_c === 0) floor200 = Math.max(floor200, SCALE * cfg.zeroBidFloorCents);
    boundary_c = ceilToTick(floor200, table);
    if (boundary_c > ask_c) {
      return { ok: false, reason: 'boundary_beyond_start', message: 'The floor is above the ask, so there is no price to work.' };
    }
    start_c = Math.max(snapNearest(mid200 + offset200, table, 'down'), boundary_c);
  } else {
    const ceil200 = Math.min(SCALE * ask_c, mid200 + slip200);
    boundary_c = floorToTick(ceil200, table);
    if (boundary_c < bid_c) {
      return { ok: false, reason: 'boundary_beyond_start', message: 'The ceiling is below the bid, so there is no price to work.' };
    }
    start_c = Math.min(snapNearest(mid200 - offset200, table, 'up'), boundary_c);
  }

  // Step: a whole percent of the spread, rounded to the tick at the start, ties toward the smaller step, never below one tick.
  const startTick = tickCentsAt(start_c * SCALE, table);
  const step_c = Math.max(startTick, nearest(step200, startTick, 'down'));

  const prices_c: number[] = [start_c];
  let cur = start_c;
  while (cur !== boundary_c && prices_c.length < MAX_STEPS) {
    const cand = sell ? cur - step_c : cur + step_c;
    let next = snapNearest(cand * SCALE, table, sell ? 'up' : 'down'); // an exact tie goes toward the previous price
    const noProgress = sell ? next >= cur : next <= cur;
    if (noProgress) {
      const raw = sell ? cur - 1 : cur + 1;
      const t = tickCentsAt(raw * SCALE, table);
      next = snapNearest((sell ? cur - t : cur + t) * SCALE, table, sell ? 'up' : 'down');
    }
    if (sell ? next <= boundary_c : next >= boundary_c) next = boundary_c;
    prices_c.push(next);
    cur = next;
  }

  const basis: WalkBasis = {
    mid: 'mid=(bid+ask)/2',
    start: sell
      ? `start=nearest tick to mid+${cfg.startOffsetPct}% of half-spread (tie toward market), not below floor`
      : `start=nearest tick to mid-${cfg.startOffsetPct}% of half-spread (tie toward market), not above ceiling`,
    step: `step=${cfg.stepPctOfSpread}% of spread, rounded to tick (tie toward smaller), min 1 tick`,
    boundary: sell
      ? `floor=max(bid, mid-${cfg.maxSlippagePct}%*spread), rounded up to tick${bid_c === 0 ? `; zero bid: at least ${cfg.zeroBidFloorCents}c` : ''}`
      : `ceiling=min(ask, mid+${cfg.maxSlippagePct}%*spread), rounded down to tick`,
    tick: table ? 'table' : 'fallback_0.01',
  };
  return { ok: true, prices_c, boundary_c, step_c, mid_c2: sum, spread_c: spread, basis };
}

type Halt = { ok: false; reason: 'invalid_config' | 'quote_missing' | 'invalid_market' | 'quote_stale' | 'opening_window'; message: string };

/** Config, quote presence and shape, staleness, opening window. Returns a halt or the resolved config. */
function checkInput(input: ExitWalkInput): Halt | { ok: true; cfg: ExitWalkConfig; quote: Quote } {
  const cfg = resolveConfig(input.config);
  if (!cfg) return { ok: false, reason: 'invalid_config', message: 'A walk setting is out of range or not a whole number.' };
  const q = input.quote;
  if (!q) return { ok: false, reason: 'quote_missing', message: 'No live quote, so no walk guidance.' };
  const numbersOk = Number.isInteger(q.bid_c) && Number.isInteger(q.ask_c) && q.bid_c >= 0 && q.ask_c > 0 && q.ask_c >= q.bid_c;
  if (!numbersOk) return { ok: false, reason: 'invalid_market', message: 'The quote is missing or crossed.' };
  const age = input.nowMs - Date.parse(q.t);
  if (!Number.isFinite(age) || age < 0 || age > cfg.quoteMaxAgeMs) {
    return { ok: false, reason: 'quote_stale', message: 'The quote is stale or its timestamp is not usable.' };
  }
  if (isInOpeningWindow(input.nowMs, cfg.openingWindowMinutes)) {
    return { ok: false, reason: 'opening_window', message: `No walk guidance in the first ${cfg.openingWindowMinutes} minutes after the open.` };
  }
  return { ok: true, cfg, quote: q };
}

/** The walk schedule for a live quote. A halt (stale, missing, opening window, bad config or market) returns no prices. */
export function buildExitWalk(input: ExitWalkInput): ExitWalkResult {
  const checked = checkInput(input);
  if (!checked.ok) return checked;
  const { cfg, quote } = checked;
  const core = buildSchedule(input.side, quote.bid_c, quote.ask_c, cfg, input.tickTable);
  if (!core.ok) return core;
  const sell = input.side === 'sell';
  const steps: WalkStep[] = core.prices_c.map((price_c, index) => ({
    index,
    price_c,
    dwellMs: cfg.dwellMs,
    slippageVsMid_c2: sell ? core.mid_c2 - 2 * price_c : 2 * price_c - core.mid_c2,
  }));
  return {
    ok: true,
    side: input.side,
    prices_c: core.prices_c,
    steps,
    boundary_c: core.boundary_c,
    mid_c2: core.mid_c2,
    spread_c: core.spread_c,
    step_c: core.step_c,
    spreadFlagged: isSpreadFlagged(quote.bid_c, quote.ask_c, cfg.spreadFlagPct),
    basis: core.basis,
  };
}

/**
 * The price to show at `state.stepIndex` for the live quote. If the mid has moved by more than one step since the schedule's
 * anchor quote, the walk re-anchors to the live quote and keeps the step index (progress is not reset). Otherwise the anchored
 * schedule is used, clamped by the boundary re-derived from the live quote. Halts on any bad, stale or missing live quote.
 */
export function nextWalkPrice(input: ExitWalkInput, state: WalkState): NextWalkPrice {
  const live = buildExitWalk(input);
  if (!live.ok) return live;
  const cfg = resolveConfig(input.config) as ExitWalkConfig; // buildExitWalk already validated it
  const sell = input.side === 'sell';
  const liveQuote = input.quote as Quote;
  const index = Math.max(0, Math.floor(state.stepIndex));

  const anchored = buildSchedule(input.side, state.anchor.bid_c, state.anchor.ask_c, cfg, input.tickTable);
  const anchorMid200 = 100 * (state.anchor.bid_c + state.anchor.ask_c);
  const liveMid200 = 100 * live.mid_c2;
  const reanchor = !anchored.ok || Math.abs(liveMid200 - anchorMid200) > anchored.step_c * SCALE;

  if (reanchor || !anchored.ok) {
    const used = Math.min(index, live.prices_c.length - 1);
    return {
      ok: true,
      price_c: live.prices_c[used],
      stepIndex: used,
      reanchored: true,
      anchor: liveQuote,
      boundary_c: live.boundary_c,
      atBoundary: live.prices_c[used] === live.boundary_c,
    };
  }
  const used = Math.min(index, anchored.prices_c.length - 1);
  const raw = anchored.prices_c[used];
  const price_c = sell ? Math.max(raw, live.boundary_c) : Math.min(raw, live.boundary_c);
  return {
    ok: true,
    price_c,
    stepIndex: used,
    reanchored: false,
    anchor: state.anchor,
    boundary_c: live.boundary_c,
    atBoundary: price_c === live.boundary_c,
  };
}
