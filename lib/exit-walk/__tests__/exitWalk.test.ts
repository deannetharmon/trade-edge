// lib/exit-walk/__tests__/exitWalk.test.ts
//
// EXIT-WALK-0001A: Alan's goldens, Quinn's list. Pure module: every test passes `nowMs` and a tick table explicitly.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isOnTick, type TickTable } from '@/lib/portfolio/tickSize';
import {
  DEFAULT_EXIT_WALK_CONFIG,
  buildExitWalk,
  isInOpeningWindow,
  isSpreadFlagged,
  nextWalkPrice,
  toCents,
} from '../exitWalk';
import type { ExitSide, ExitWalkInput, Quote, WalkState } from '../types';
import {
  MRNA_CALM,
  MRNA_GOLDEN_1C,
  MRNA_MID_MOVE,
  MRNA_STALE_GAP,
  TQQQ_CALM,
  TQQQ_GOLDEN_1C,
  TQQQ_GOLDEN_5C,
  TQQQ_MID_MOVE,
} from './fixtures/quoteSequences';

// Tick tables: T1 penny everywhere; T2 the repo's documented example; T3 synthetic 5c everywhere.
const T1: TickTable = [{ threshold: null, value: 0.01 }];
const T2: TickTable = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }];
const T3: TickTable = [{ threshold: null, value: 0.05 }];

// 10:30 ET on Oct 19, 2026 (EDT): after the opening window. Quotes below are stamped 30 seconds before it.
const NOW = Date.parse('2026-10-19T10:30:30-04:00');
const q = (bid_c: number, ask_c: number, t = '2026-10-19T10:30:00-04:00'): Quote => ({ t, bid_c, ask_c });
const input = (side: ExitSide, quote: Quote | null, over: Partial<ExitWalkInput> = {}): ExitWalkInput => ({
  side, quote, nowMs: NOW, tickTable: T1, ...over,
});
const prices = (i: ExitWalkInput) => {
  const r = buildExitWalk(i);
  if (!r.ok) throw new Error(`halted: ${r.reason}`);
  return r.prices_c;
};
const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    Object.keys(o as object).forEach(k => deepFreeze((o as Record<string, unknown>)[k]));
  }
  return o;
};

describe("Alan's Oct 17 goldens (1: schedules)", () => {
  it('MRNA sell, 1c tick (T1 and T2 agree below $3)', () => {
    expect(prices(input('sell', q(208, 300), { tickTable: T1 }))).toEqual([...MRNA_GOLDEN_1C]);
    expect(prices(input('sell', q(208, 300), { tickTable: T2 }))).toEqual([...MRNA_GOLDEN_1C]);
  });
  it('MRNA sell, synthetic 5c tick', () => {
    expect(prices(input('sell', q(208, 300), { tickTable: T3 }))).toEqual([255, 245, 235, 225, 215, 210]);
  });
  it('MRNA sell, 25% slippage', () => {
    expect(prices(input('sell', q(208, 300), { tickTable: T1, config: { maxSlippagePct: 25 } }))).toEqual([254, 245, 236, 231]);
    expect(prices(input('sell', q(208, 300), { tickTable: T3, config: { maxSlippagePct: 25 } }))).toEqual([255, 245, 235]);
  });
  it('TQQQ buy, 1c tick (T1)', () => {
    expect(prices(input('buy', q(830, 950), { tickTable: T1 }))).toEqual([...TQQQ_GOLDEN_1C]);
  });
  it('TQQQ buy, 5c tick above $3 (T2)', () => {
    expect(prices(input('buy', q(830, 950), { tickTable: T2 }))).toEqual([...TQQQ_GOLDEN_5C]);
  });
  it('reports mid, spread, step, boundary, flag and basis', () => {
    const r = buildExitWalk(input('sell', q(208, 300)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mid_c2).toBe(508);
    expect(r.spread_c).toBe(92);
    expect(r.step_c).toBe(9);
    expect(r.boundary_c).toBe(208);
    expect(r.spreadFlagged).toBe(true);
    expect(r.basis.tick).toBe('table');
    expect(r.steps[0]).toEqual({ index: 0, price_c: 254, dwellMs: 90000, slippageVsMid_c2: 0 });
    expect(r.steps[6].slippageVsMid_c2).toBe(92); // 208 vs mid 254: 46c = 92 half-cents
  });
  it('basis says the tick fallback when there is no table', () => {
    const r = buildExitWalk(input('sell', q(208, 300), { tickTable: null }));
    expect(r.ok && r.basis.tick).toBe('fallback_0.01');
  });
});

// Quotes that sit on the tick, for the property grids.
const onTickQuotes = (table: TickTable): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let bid = 1; bid <= 400; bid += 7) {
    for (let w = 0; w <= 60; w += 3) {
      const ask = bid + w;
      if (isOnTick(bid / 100, table) && isOnTick(ask / 100, table)) out.push([bid, ask]);
    }
  }
  return out;
};

describe('boundary identity and schedule invariants (2, 3)', () => {
  for (const [name, table] of [['T1', T1], ['T2', T2], ['T3', T3]] as Array<[string, TickTable]>) {
    it(`at 50%, sell floor is the bid and buy ceiling is the ask (${name})`, () => {
      for (const [bid, ask] of onTickQuotes(table)) {
        const s = buildExitWalk(input('sell', q(bid, ask), { tickTable: table }));
        const b = buildExitWalk(input('buy', q(bid, ask), { tickTable: table }));
        expect(s.ok && s.boundary_c).toBe(bid);
        expect(b.ok && b.boundary_c).toBe(ask);
      }
    });
    it(`schedules are monotonic, on tick, end at the boundary, never past bid/ask (${name})`, () => {
      for (const [bid, ask] of onTickQuotes(table)) {
        for (const pct of [0, 25, 50, 100]) {
          for (const side of ['sell', 'buy'] as ExitSide[]) {
            const r = buildExitWalk(input(side, q(bid, ask), { tickTable: table, config: { maxSlippagePct: pct } }));
            if (!r.ok) continue;
            const p = r.prices_c;
            expect(p[p.length - 1]).toBe(r.boundary_c);
            for (let i = 0; i < p.length; i++) {
              expect(isOnTick(p[i] / 100, table)).toBe(true);
              if (i > 0) expect(side === 'sell' ? p[i] < p[i - 1] : p[i] > p[i - 1]).toBe(true);
              if (side === 'sell') expect(p[i]).toBeGreaterThanOrEqual(bid);
              else expect(p[i]).toBeLessThanOrEqual(ask);
            }
          }
        }
      }
    });
  }
  it('100% slippage gives the same boundary as 50% (the bid/ask clamp)', () => {
    const a = buildExitWalk(input('sell', q(208, 300), { config: { maxSlippagePct: 50 } }));
    const b = buildExitWalk(input('sell', q(208, 300), { config: { maxSlippagePct: 100 } }));
    expect(a.ok && b.ok && a.boundary_c === b.boundary_c).toBe(true);
    const c = buildExitWalk(input('buy', q(830, 950), { config: { maxSlippagePct: 50 } }));
    const d = buildExitWalk(input('buy', q(830, 950), { config: { maxSlippagePct: 100 } }));
    expect(c.ok && d.ok && c.boundary_c === d.boundary_c).toBe(true);
  });
  it('0% slippage works only at the mid', () => {
    expect(prices(input('sell', q(208, 300), { config: { maxSlippagePct: 0 } }))).toEqual([254]);
    expect(prices(input('buy', q(830, 950), { config: { maxSlippagePct: 0 } }))).toEqual([890]);
  });
});

describe('rounding (4)', () => {
  it('start is the nearest tick; an exact tie goes toward the market (sell down, buy up)', () => {
    // bid 100 ask 105: mid 102.5, a tie at a 1c tick
    expect(prices(input('sell', q(100, 105)))[0]).toBe(102);
    expect(prices(input('buy', q(100, 105)))[0]).toBe(103);
    // at 0% slippage the boundary is the mid rounded the safe way, so the start is held to it (sell 103, buy 102)
    expect(prices(input('sell', q(100, 105), { config: { maxSlippagePct: 0 } }))).toEqual([103]);
    expect(prices(input('buy', q(100, 105), { config: { maxSlippagePct: 0 } }))).toEqual([102]);
  });
  it('sell floor rounds up and buy ceiling rounds down to a tick', () => {
    // 25% slippage, 5c tick: floor 231 -> 235, ceiling 890+30 -> 920
    expect((buildExitWalk(input('sell', q(208, 300), { tickTable: T3, config: { maxSlippagePct: 25 } })) as { boundary_c: number }).boundary_c).toBe(235);
    expect((buildExitWalk(input('buy', q(830, 950), { tickTable: T3, config: { maxSlippagePct: 25 } })) as { boundary_c: number }).boundary_c).toBe(920);
  });
  it('step ties go to the smaller step and never drop below one tick', () => {
    // spread 50, 5c tick: 10% = 5c exactly (no tie). spread 25 -> 2.5c, 5c tick -> min 1 tick = 5c
    const r = buildExitWalk(input('sell', q(200, 225), { tickTable: T3 }));
    expect(r.ok && r.step_c).toBe(5);
    // 1c tick, spread 5 -> 0.5c tie -> smaller (0) -> min 1 tick = 1c
    const s = buildExitWalk(input('sell', q(200, 205)));
    expect(s.ok && s.step_c).toBe(1);
  });
  it('re-checks the tick when the walk crosses a tick band', () => {
    // buy walking up from $2.90 (1c band) into the 5c band above $3.00
    const up = prices(input('buy', q(270, 310), { tickTable: T2 }));
    expect(up).toEqual([290, 294, 298, 300, 305, 310]);
    up.forEach(p => expect(isOnTick(p / 100, T2)).toBe(true));
    // sell walking down from $3.10 (5c band) into the 1c band
    const down = prices(input('sell', q(280, 340), { tickTable: T2 }));
    expect(down).toEqual([310, 305, 300, 295, 290, 285, 280]);
    down.forEach(p => expect(isOnTick(p / 100, T2)).toBe(true));
  });
});

describe('degenerate markets (5)', () => {
  it('locked market gives a single price', () => {
    expect(prices(input('sell', q(100, 100)))).toEqual([100]);
    expect(prices(input('buy', q(100, 100)))).toEqual([100]);
  });
  it('crossed or unreadable markets halt as invalid_market', () => {
    for (const bad of [q(110, 100), q(-1, 100), q(100, 0), { t: q(1, 2).t, bid_c: 1.5, ask_c: 2 }, { t: q(1, 2).t, bid_c: NaN, ask_c: 2 }]) {
      const r = buildExitWalk(input('sell', bad));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_market');
    }
  });
  it('a zero bid sells to a 5c fallback floor, not zero', () => {
    expect(prices(input('sell', q(0, 20)))).toEqual([10, 8, 6, 5]);
  });
  it('a zero bid with an ask under the fallback floor has nothing to work', () => {
    const r = buildExitWalk(input('sell', q(0, 4)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('boundary_beyond_start');
  });
  it('a one-tick-wide spread resolves to a single price at the market', () => {
    expect(prices(input('sell', q(100, 101)))).toEqual([100]);
    expect(prices(input('buy', q(100, 101)))).toEqual([101]);
  });
  it('config outside range or not whole halts as invalid_config', () => {
    for (const config of [
      { maxSlippagePct: 120 }, { maxSlippagePct: -1 }, { maxSlippagePct: 12.5 }, { stepPctOfSpread: 0 }, { stepPctOfSpread: 101 },
      { quoteMaxAgeMs: 0 }, { openingWindowMinutes: -1 }, { dwellMs: 0 }, { zeroBidFloorCents: 0 }, { startOffsetPct: 101 }, { spreadFlagPct: 0 },
    ]) {
      const r = buildExitWalk(input('sell', q(208, 300), { config }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_config');
    }
  });
  it('a favorable start offset starts above mid for a sell and below mid for a buy, bounded by the quote', () => {
    expect(prices(input('sell', q(208, 300), { config: { startOffsetPct: 50 } }))[0]).toBe(277); // mid 254 + 23
    expect(prices(input('buy', q(830, 950), { config: { startOffsetPct: 50 } }))[0]).toBe(860); // mid 890 - 30
    expect(prices(input('sell', q(208, 300), { config: { startOffsetPct: 100 } }))[0]).toBe(300); // capped at the ask
    expect(prices(input('buy', q(830, 950), { config: { startOffsetPct: 100 } }))[0]).toBe(830); // capped at the bid
  });
});

describe('re-anchor against quote sequences (6)', () => {
  const run = (side: ExitSide, seq: ReadonlyArray<Readonly<Quote>>, table: TickTable) => {
    let state: WalkState = { stepIndex: 0, anchor: { ...seq[0] } };
    const out: Array<{ price_c: number; reanchored: boolean; stepIndex: number }> = [];
    seq.forEach((quote, i) => {
      const r = nextWalkPrice(
        { side, quote: { ...quote }, nowMs: Date.parse(quote.t) + 5000, tickTable: table },
        { stepIndex: i, anchor: state.anchor },
      );
      if (!r.ok) throw new Error(`halted: ${r.reason}`);
      out.push({ price_c: r.price_c, reanchored: r.reanchored, stepIndex: r.stepIndex });
      state = { stepIndex: i, anchor: r.anchor };
    });
    return out;
  };
  it('a calm sequence (mid moves at most one step) never re-anchors', () => {
    expect(run('sell', MRNA_CALM, T1).map(x => x.reanchored)).toEqual([false, false, false]);
    expect(run('buy', TQQQ_CALM, T1).map(x => x.reanchored)).toEqual([false, false, false]);
  });
  it('a mid move of more than one step re-anchors and keeps the step index, in both directions', () => {
    const m = run('sell', MRNA_MID_MOVE, T1);
    expect(m.map(x => x.reanchored)).toEqual([false, true, true]);
    expect(m[1].stepIndex).toBe(1);
    // index 1 on the up move (mid 264, step 9): 264 - 9 = 255. Index 2 on the down move (mid 240, step 9): 240 - 18 = 222.
    expect(m[1].price_c).toBe(255);
    expect(m[2].price_c).toBe(222);
    const t = run('buy', TQQQ_MID_MOVE, T1);
    expect(t.map(x => x.reanchored)).toEqual([false, true, true]);
    // index 1 on the up move (mid 905, step 12): 917. Index 2 on the down move (mid 870, step 12): 870 + 24 = 894.
    expect(t[1].price_c).toBe(917);
    expect(t[2].price_c).toBe(894);
  });
  it('a mid move of exactly one step does not re-anchor', () => {
    const anchor = q(208, 300); // step 9c, mid 254
    const live = q(217, 309); // mid 263: moved exactly 9c
    const r = nextWalkPrice(input('sell', live), { stepIndex: 2, anchor });
    expect(r.ok && r.reanchored).toBe(false);
  });
  it('without a re-anchor the price is clamped by the live boundary', () => {
    // anchor floor 208; live bid rose to 214 with the mid moving only 3c: the sell price cannot stay below the new floor
    const anchor = q(208, 300);
    const live = q(214, 300);
    const r = nextWalkPrice(input('sell', live), { stepIndex: 5, anchor });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reanchored).toBe(false);
      expect(r.price_c).toBe(214);
      expect(r.atBoundary).toBe(true);
    }
  });
  it('a step index past the end uses the last price', () => {
    const r = nextWalkPrice(input('sell', q(208, 300)), { stepIndex: 99, anchor: q(208, 300) });
    expect(r.ok && r.price_c).toBe(208);
    expect(r.ok && r.stepIndex).toBe(6);
  });
});

describe('halts (7)', () => {
  it('missing quote halts', () => {
    const r = buildExitWalk(input('sell', null));
    expect(!r.ok && r.reason).toBe('quote_missing');
  });
  it('stale quote: exactly the max age is allowed, one millisecond more halts; a future timestamp halts', () => {
    const t0 = Date.parse('2026-10-19T10:30:00-04:00');
    const quote = q(208, 300);
    expect(buildExitWalk(input('sell', quote, { nowMs: t0 + 60000 })).ok).toBe(true);
    const late = buildExitWalk(input('sell', quote, { nowMs: t0 + 60001 }));
    expect(!late.ok && late.reason).toBe('quote_stale');
    const future = buildExitWalk(input('sell', quote, { nowMs: t0 - 1 }));
    expect(!future.ok && future.reason).toBe('quote_stale');
    const unreadable = buildExitWalk(input('sell', { t: 'not a time', bid_c: 208, ask_c: 300 }));
    expect(!unreadable.ok && unreadable.reason).toBe('quote_stale');
  });
  it('the stale-gap sequence halts at the evaluation instant', () => {
    const last = MRNA_STALE_GAP[MRNA_STALE_GAP.length - 1];
    const r = buildExitWalk({ side: 'sell', quote: { ...last }, nowMs: Date.parse('2026-10-19T10:31:20-04:00'), tickTable: T1 });
    expect(!r.ok && r.reason).toBe('quote_stale');
    const live = nextWalkPrice(
      { side: 'sell', quote: { ...last }, nowMs: Date.parse('2026-10-19T10:31:20-04:00'), tickTable: T1 },
      { stepIndex: 0, anchor: { ...MRNA_STALE_GAP[0] } },
    );
    expect(!live.ok && live.reason).toBe('quote_stale');
  });
  it('opening window is [09:30:00, 09:45:00) ET', () => {
    const at = (iso: string) => isInOpeningWindow(Date.parse(iso), 15);
    expect(at('2026-10-19T09:29:59-04:00')).toBe(false);
    expect(at('2026-10-19T09:30:00-04:00')).toBe(true);
    expect(at('2026-10-19T09:44:59-04:00')).toBe(true);
    expect(at('2026-10-19T09:45:00-04:00')).toBe(false);
  });
  it('opening window follows New York time across DST, independent of the host zone', () => {
    // Nov 2, 2026 is EST (-05:00) after the Nov 1 fall-back.
    expect(isInOpeningWindow(Date.parse('2026-11-02T09:44:59-05:00'), 15)).toBe(true);
    expect(isInOpeningWindow(Date.parse('2026-11-02T09:45:00-05:00'), 15)).toBe(false);
    expect(isInOpeningWindow(Date.parse('2026-11-02T14:44:59Z'), 15)).toBe(true); // 09:44:59 EST
    expect(isInOpeningWindow(Date.parse('2026-11-02T13:44:59Z'), 15)).toBe(false); // 08:44:59 EST, not 09:44:59
    expect(isInOpeningWindow(Date.parse('2026-10-19T13:44:59Z'), 15)).toBe(true); // 09:44:59 EDT
  });
  it('inside the opening window the walk halts with no prices; a zero-minute window never halts', () => {
    const nowMs = Date.parse('2026-10-19T09:40:00-04:00');
    const quote = { t: '2026-10-19T09:39:30-04:00', bid_c: 208, ask_c: 300 };
    const r = buildExitWalk({ side: 'sell', quote, nowMs, tickTable: T1 });
    expect(!r.ok && r.reason).toBe('opening_window');
    const open = buildExitWalk({ side: 'sell', quote, nowMs, tickTable: T1, config: { openingWindowMinutes: 0 } });
    expect(open.ok).toBe(true);
  });
});

describe('spread flag (8)', () => {
  it('exactly 10.00% is not flagged; 10.05% is', () => {
    expect(isSpreadFlagged(1900, 2100)).toBe(false); // spread 200 on mid 2000
    expect(isSpreadFlagged(1900, 2101)).toBe(true); // spread 201 on mid 2000.5
  });
  it('the 20x integer test: flagged iff 20 * (ask - bid) > bid + ask', () => {
    for (const [b, a] of [[208, 300], [830, 950], [100, 105], [100, 110], [100, 111], [1225, 1355]]) {
      expect(isSpreadFlagged(b, a)).toBe(20 * (a - b) > b + a);
    }
  });
  it('UBER knife-edge (implied snapshot quotes, replace with the exact export): 130c on a 1290c mid is flagged', () => {
    expect(isSpreadFlagged(1225, 1355)).toBe(true);
    expect(isSpreadFlagged(1225, 1354)).toBe(true); // 129c: still flagged by 1c
    expect(isSpreadFlagged(1225, 1353)).toBe(false); // 128c
  });
  it('threshold is configurable', () => {
    expect(isSpreadFlagged(1900, 2100, 9)).toBe(true);
    expect(isSpreadFlagged(1900, 2100, 11)).toBe(false);
  });
});

describe('determinism and purity (9, 10, 11)', () => {
  it('the same input twice gives deep-equal output and a frozen input is never mutated', () => {
    const i = deepFreeze(input('sell', q(208, 300), { tickTable: T2 }));
    expect(buildExitWalk(i)).toEqual(buildExitWalk(i));
    const state = deepFreeze<WalkState>({ stepIndex: 2, anchor: q(208, 300) });
    expect(nextWalkPrice(i, state)).toEqual(nextWalkPrice(i, state));
  });
  it('integer cents: dollars convert without float drift', () => {
    expect(toCents(2.54)).toBe(254);
    expect(toCents(8.9)).toBe(890);
    expect(toCents(0.29)).toBe(29);
    expect(toCents(1.15)).toBe(115);
    expect(toCents(0.07)).toBe(7);
  });
  it('defaults are the approved ones', () => {
    expect(DEFAULT_EXIT_WALK_CONFIG).toEqual({
      stepPctOfSpread: 10, maxSlippagePct: 50, startOffsetPct: 0, quoteMaxAgeMs: 60000,
      openingWindowMinutes: 15, dwellMs: 90000, zeroBidFloorCents: 5, spreadFlagPct: 10,
    });
  });
  it('no clock, randomness, or UI imports in the module source', () => {
    for (const file of ['exitWalk.ts', 'types.ts', 'index.ts']) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(src, file).not.toMatch(/new Date\(|Date\.now|Math\.random/);
      expect(src, file).not.toMatch(/from '@\/(app|features|components)/);
    }
  });
});
