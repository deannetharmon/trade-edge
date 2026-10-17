// lib/exit-walk/__tests__/panelModel.test.ts
//
// EXIT-WALK-0001B step 3b: the panel's numbers and words match Diane's v4 mock (MRNA sell, TQQQ buy).

import { describe, expect, it } from 'vitest';
import { buildExitWalk } from '../exitWalk';
import { clock, dollars, outcomeLine, planChips, planRows, refusalText, rowsWithLog, spreadPct, walkTitle } from '../panelModel';
import type { ExitWalkResult, Quote } from '../types';

const T1 = [{ threshold: null, value: 0.01 }];
const NOW = Date.parse('2026-10-19T15:00:00Z');
const quote = (bid_c: number, ask_c: number): Quote => ({ t: new Date(NOW - 1000).toISOString(), bid_c, ask_c });
function planOf(side: 'sell' | 'buy', q: Quote): Extract<ExitWalkResult, { ok: true }> {
  const r = buildExitWalk({ side, quote: q, nowMs: NOW, tickTable: T1 });
  if (!r.ok) throw new Error(r.message);
  return r;
}
const MRNA_Q = quote(208, 300);
const TQQQ_Q = quote(830, 950);

describe('formatting helpers', () => {
  it('dollars and clock', () => {
    expect(dollars(254)).toBe('$2.54');
    expect(dollars(5)).toBe('$0.05');
    expect(clock(0)).toBe('0:00');
    expect(clock(90000)).toBe('1:30');
    expect(clock(540000)).toBe('9:00');
  });
  it('spread percent of the mid', () => {
    expect(spreadPct(planOf('sell', MRNA_Q))).toBe(36);
    expect(spreadPct(planOf('buy', TQQQ_Q))).toBe(13);
  });
});

describe('planChips', () => {
  it('MRNA sell: mid, step, floor = live bid, wide spread 36%', () => {
    expect(planChips(planOf('sell', MRNA_Q), MRNA_Q)).toEqual([
      { text: 'Mid $2.54', tone: 'neutral' },
      { text: 'Step 9c', tone: 'neutral' },
      { text: 'Floor $2.08 = live bid', tone: 'teal' },
      { text: 'Wide spread 36%', tone: 'amber' },
    ]);
  });
  it('TQQQ buy: ceiling = live ask, wide spread 13%', () => {
    expect(planChips(planOf('buy', TQQQ_Q), TQQQ_Q).map(c => c.text)).toEqual(['Mid $8.90', 'Step 12c', 'Ceiling $9.50 = live ask', 'Wide spread 13%']);
  });
  it('a tight market has no spread chip', () => {
    const q = quote(200, 210);
    expect(planChips(planOf('sell', q), q).some(c => c.tone === 'amber')).toBe(false);
  });
  it('a boundary inside the market drops the "= live" suffix', () => {
    const r = buildExitWalk({ side: 'sell', quote: MRNA_Q, nowMs: NOW, tickTable: T1, config: { maxSlippagePct: 25 } });
    if (!r.ok) throw new Error(r.message);
    expect(planChips(r, MRNA_Q).find(c => c.tone === 'teal')?.text).toBe('Floor $2.31');
  });
});

describe('planRows', () => {
  it('MRNA sell matches the mock: -9c steps, 90 s apart, floor last', () => {
    const rows = planRows(planOf('sell', MRNA_Q), 3);
    expect(rows.map(r => r.price)).toEqual(['$2.54', '$2.45', '$2.36', '$2.27', '$2.18', '$2.09', '$2.08']);
    expect(rows.map(r => r.vsMid)).toEqual(['mid', '-9c', '-18c', '-27c', '-36c', '-45c', '-46c']);
    expect(rows.map(r => r.at)).toEqual(['0:00', '1:30', '3:00', '4:30', '6:00', '7:30', '9:00']);
    expect(rows.map(r => r.status)).toEqual(['Done', 'Done', 'Done', 'Now', 'Next', 'Next', 'Floor']);
  });
  it('TQQQ buy matches the mock: +12c steps, ceiling last', () => {
    const rows = planRows(planOf('buy', TQQQ_Q), 1);
    expect(rows.map(r => r.price)).toEqual(['$8.90', '$9.02', '$9.14', '$9.26', '$9.38', '$9.50']);
    expect(rows.map(r => r.vsMid)).toEqual(['mid', '+12c', '+24c', '+36c', '+48c', '+60c']);
    expect(rows.map(r => r.status)).toEqual(['Done', 'Now', 'Next', 'Next', 'Next', 'Ceiling']);
  });
  it('before the walk starts nothing is done or now', () => {
    expect(planRows(planOf('buy', TQQQ_Q), -1).map(r => r.status)).toEqual(['Next', 'Next', 'Next', 'Next', 'Next', 'Ceiling']);
  });
});

describe('refusalText', () => {
  it('covers every refusal and ineligibility reason in short words', () => {
    const reasons = ['structure_unclear', 'entry_unknown', 'working_order', 'market_closed', 'hard_risk', 'gap_block', 'invalid_config',
      'quote_missing', 'invalid_market', 'quote_stale', 'opening_window', 'boundary_beyond_start'] as const;
    for (const r of reasons) { expect(refusalText(r).length).toBeGreaterThan(10); expect(refusalText(r).length).toBeLessThan(90); }
    expect(refusalText('opening_window')).toMatch(/9:45/);
    expect(refusalText('hard_risk')).toMatch(/slippage cap/);
  });
});

describe('outcomeLine', () => {
  it('says what happened in one line', () => {
    expect(outcomeLine({ kind: 'filled', price_c: 236, orderId: 'o3' }, 'sell')).toBe('Filled at $2.36.');
    expect(outcomeLine({ kind: 'cancelled' }, 'sell')).toBe('Stopped. Nothing is left working.');
    expect(outcomeLine({ kind: 'ended_working', price_c: 208, orderId: 'o7' }, 'sell')).toMatch(/At the floor.*\$2\.08/);
    expect(outcomeLine({ kind: 'ended_working', price_c: 950, orderId: 'o7' }, 'buy')).toMatch(/At the ceiling/);
    expect(outcomeLine({ kind: 'partial', price_c: 245, orderId: 'o2', filledQty: 1, totalQty: 2 }, 'sell')).toMatch(/1 of 2 filled/);
  });
  it('a stop with a live order says where it stays; without one it says only the message', () => {
    expect(outcomeLine({ kind: 'stopped', reason: 'halted', orderLive: true, price_c: 245, orderId: 'o2', message: 'Old quote.' }, 'sell')).toBe('Old quote. The order stays working at $2.45.');
    expect(outcomeLine({ kind: 'stopped', reason: 'resubmit_failed', orderLive: false, price_c: null, orderId: null, message: 'Refused.' }, 'sell')).toBe('Refused.');
  });
});

describe('rowsWithLog', () => {
  const plan = planOf('sell', MRNA_Q);
  it('marks the last tried price as Now while running, and shows the price actually tried', () => {
    const rows = rowsWithLog(plan, [254, 245, 236], true);
    expect(rows.map(r => r.status).slice(0, 4)).toEqual(['Done', 'Done', 'Now', 'Next']);
    expect(rows[2].price).toBe('$2.36');
  });
  it('after the walk every tried step is Done', () => {
    expect(rowsWithLog(plan, [254, 245], false).map(r => r.status).slice(0, 3)).toEqual(['Done', 'Done', 'Next']);
  });
  it('a re-anchored price replaces the plan price and recomputes the give-up', () => {
    const rows = rowsWithLog(plan, [254, 245, 230], true);
    expect(rows[2]).toMatchObject({ price: '$2.30', vsMid: '-24c', status: 'Now' });
  });
  it('before the walk it is the plan', () => {
    expect(rowsWithLog(plan, [], false)).toEqual(planRows(plan, -1));
  });
});

describe('walkTitle', () => {
  it('names a single option by strike and the multi-leg position by strategy', () => {
    expect(walkTitle({ symbol: 'MRNA', strategy: 'Long Put', legs: [{ optionType: 'P', strikePrice: 140 }] }, 'sell')).toBe('MRNA $140 put: sell to close');
    expect(walkTitle({ symbol: 'TQQQ', strategy: 'CSP', legs: [{ optionType: 'P', strikePrice: 75.5 }] }, 'buy')).toBe('TQQQ $75.5 put: buy to close');
    expect(walkTitle({ symbol: 'IWM', strategy: 'BPS', legs: [{ optionType: 'P', strikePrice: 1 }, { optionType: 'P', strikePrice: 2 }] }, 'buy')).toBe('IWM BPS: buy to close');
  });
});
