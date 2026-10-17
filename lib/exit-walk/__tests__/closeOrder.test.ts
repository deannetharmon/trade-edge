// lib/exit-walk/__tests__/closeOrder.test.ts
//
// EXIT-WALK-0001B step 3a: the order body, the refuse-to-start rules and the safety gate on walk prices.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildCanonicalCloseIdentity, type CanonicalCloseIdentity, type RawEconomicLeg } from '@/lib/portfolio/closeOrderSafety';
import type { Position } from '@/lib/portfolio-data/types';
import {
  buildExitCloseOrder,
  checkExitWalkEligibility,
  exitSideFor,
  exitWalkGateRefusal,
  expectedClosePnlDollars,
  instrumentTypeFor,
  isRegularSession,
  runExitWalkGate,
} from '../closeOrder';
import { runExitWalk, type ExitWalkDeps } from '../run';
import type { Quote } from '../types';

const NOW = Date.parse('2026-10-19T15:00:00Z'); // Mon 11:00 ET
const TQQQ_SYM = 'TQQQ  261106P00075500';
const MRNA_SYM = 'MRNA  261120P00140000';

function identityFor(symbol: string, direction: 'Short' | 'Long', avgOpen: number, strike: number, expiration: string): CanonicalCloseIdentity {
  const leg: RawEconomicLeg = { symbol, optionType: 'P', strikePrice: strike, direction, quantity: 1, avgOpenPrice: avgOpen };
  const built = buildCanonicalCloseIdentity({ structureType: 'NAKED', quantity: 1, legs: [leg] }, `k-${symbol}`, symbol.slice(0, 4).trim(), expiration);
  if (!built.ok) throw new Error(built.message);
  return built.identity;
}
const TQQQ_ID = identityFor(TQQQ_SYM, 'Short', 3.2, 75.5, '2026-11-06'); // credit entry, buy to close
const MRNA_ID = identityFor(MRNA_SYM, 'Long', 5.3, 140, '2026-11-20'); // debit entry, sell to close

const legOf = (symbol: string, direction: 'Short' | 'Long') =>
  ({ symbol, direction, quantity: 1, optionType: 'P', strikePrice: 0, avgOpenPrice: null, currentPrice: null, currentDelta: null }) as unknown as Position['legs'][number];
const TQQQ_POS = { symbol: 'TQQQ', legs: [legOf(TQQQ_SYM, 'Short')] };
const MRNA_POS = { symbol: 'MRNA', legs: [legOf(MRNA_SYM, 'Long')] };

const q = (bid_c: number, ask_c: number, t = new Date(NOW - 2000).toISOString()): Quote => ({ t, bid_c, ask_c });

describe('buildExitCloseOrder', () => {
  it('buy to close a short put: Debit, Day, Limit, price in dollars', () => {
    expect(buildExitCloseOrder(TQQQ_POS, 890, 'buy')).toEqual({
      'order-type': 'Limit', 'time-in-force': 'Day', price: '8.90', 'price-effect': 'Debit',
      legs: [{ symbol: TQQQ_SYM, quantity: 1, action: 'Buy to Close', 'instrument-type': 'Equity Option' }],
    });
  });
  it('sell to close a long put: Credit', () => {
    const body = buildExitCloseOrder(MRNA_POS, 254, 'sell');
    expect(body.price).toBe('2.54');
    expect(body['price-effect']).toBe('Credit');
    expect(body.legs[0].action).toBe('Sell to Close');
  });
  it('never sends a sub-penny or zero price, and keeps the space-padded symbol exactly', () => {
    expect(buildExitCloseOrder(MRNA_POS, 0, 'sell').price).toBe('0.01');
    expect(buildExitCloseOrder(MRNA_POS, 254, 'sell').legs[0].symbol).toBe('MRNA  261120P00140000');
  });
  it('is always a Day order (a walk never leaves a resting GTC)', () => {
    expect(buildExitCloseOrder(MRNA_POS, 254, 'sell')['time-in-force']).toBe('Day');
  });
  it('index underlyings use Index Option', () => {
    expect(instrumentTypeFor('SPX')).toBe('Index Option');
    expect(instrumentTypeFor('spx ')).toBe('Index Option');
    expect(instrumentTypeFor('MRNA')).toBe('Equity Option');
  });
  it('a multi-leg close maps each leg by direction', () => {
    const pos = { symbol: 'IWM', legs: [legOf('S', 'Short'), legOf('L', 'Long')] };
    expect(buildExitCloseOrder(pos, 130, 'buy').legs.map(l => l.action)).toEqual(['Buy to Close', 'Sell to Close']);
  });
});

describe('exitSideFor', () => {
  it('credit entry closes as a buy, debit entry as a sell, unknown has no walk', () => {
    expect(exitSideFor('Credit')).toBe('buy');
    expect(exitSideFor('Debit')).toBe('sell');
    expect(exitSideFor('Unknown')).toBeNull();
  });
});

describe('isRegularSession (ET, DST-correct)', () => {
  it('weekday inside 9:30 to 16:00', () => {
    expect(isRegularSession(Date.parse('2026-10-19T15:00:00Z'))).toBe(true);
    expect(isRegularSession(Date.parse('2026-10-19T13:30:00Z'))).toBe(true); // 9:30 EDT
    expect(isRegularSession(Date.parse('2026-10-19T13:29:00Z'))).toBe(false);
    expect(isRegularSession(Date.parse('2026-10-19T19:59:00Z'))).toBe(true); // 15:59 EDT
    expect(isRegularSession(Date.parse('2026-10-19T20:00:00Z'))).toBe(false); // 16:00 EDT
  });
  it('after DST ends the same UTC times shift an hour', () => {
    expect(isRegularSession(Date.parse('2026-11-02T14:30:00Z'))).toBe(true); // 9:30 EST
    expect(isRegularSession(Date.parse('2026-11-02T14:29:00Z'))).toBe(false);
    expect(isRegularSession(Date.parse('2026-11-02T21:00:00Z'))).toBe(false); // 16:00 EST
  });
  it('weekends are closed', () => {
    expect(isRegularSession(Date.parse('2026-10-17T15:00:00Z'))).toBe(false);
    expect(isRegularSession(Date.parse('2026-10-18T15:00:00Z'))).toBe(false);
  });
});

describe('checkExitWalkEligibility: refuse before any order exists', () => {
  const clean = {
    structureAmbiguous: false, structureBlockMessage: null, identity: TQQQ_ID, entryPriceEffect: 'Credit' as const,
    hasGtc: false, legs: TQQQ_POS.legs, accountNumber: 'A1',
  };
  it('a clean credit position in session is eligible and walks as a buy', () => {
    expect(checkExitWalkEligibility(clean, [], NOW)).toMatchObject({ ok: true, side: 'buy' });
  });
  it('a clean debit position walks as a sell', () => {
    expect(checkExitWalkEligibility({ ...clean, identity: MRNA_ID, entryPriceEffect: 'Debit', legs: MRNA_POS.legs }, [], NOW)).toMatchObject({ ok: true, side: 'sell' });
  });
  it('an ambiguous structure or missing identity is refused with the position message', () => {
    expect(checkExitWalkEligibility({ ...clean, structureAmbiguous: true, structureBlockMessage: 'Two valid pairings.' }, [], NOW))
      .toMatchObject({ ok: false, reason: 'structure_unclear', message: 'Two valid pairings.' });
    expect(checkExitWalkEligibility({ ...clean, identity: null }, [], NOW)).toMatchObject({ ok: false, reason: 'structure_unclear' });
  });
  it('an unknown entry is refused', () => {
    expect(checkExitWalkEligibility({ ...clean, entryPriceEffect: 'Unknown' }, [], NOW)).toMatchObject({ ok: false, reason: 'entry_unknown' });
  });
  it('a working GTC on the position is refused', () => {
    expect(checkExitWalkEligibility({ ...clean, hasGtc: true }, [], NOW)).toMatchObject({ ok: false, reason: 'working_order' });
  });
  it('a pending order on any of its legs, same account, is refused', () => {
    const pending = [{ accountNumber: 'A1', legs: [{ symbol: TQQQ_SYM, action: 'Buy to Close', optionType: 'P' as const, strikePrice: 75.5, quantity: 1 }] }];
    expect(checkExitWalkEligibility(clean, pending, NOW)).toMatchObject({ ok: false, reason: 'working_order' });
  });
  it('a pending order on another account or other contracts does not block', () => {
    const otherAcct = [{ accountNumber: 'A2', legs: [{ symbol: TQQQ_SYM, action: 'x', optionType: 'P' as const, strikePrice: 1, quantity: 1 }] }];
    const otherLeg = [{ accountNumber: 'A1', legs: [{ symbol: 'NFLX  270917C00070000', action: 'x', optionType: 'C' as const, strikePrice: 70, quantity: 1 }] }];
    expect(checkExitWalkEligibility(clean, otherAcct, NOW).ok).toBe(true);
    expect(checkExitWalkEligibility(clean, otherLeg, NOW).ok).toBe(true);
  });
  it('outside the regular session is refused', () => {
    expect(checkExitWalkEligibility(clean, [], Date.parse('2026-10-17T15:00:00Z'))).toMatchObject({ ok: false, reason: 'market_closed' });
  });
});

describe('expectedClosePnlDollars', () => {
  it('TQQQ short put bought back at 8.90 against a 3.20 credit is -$570', () => {
    expect(expectedClosePnlDollars(TQQQ_ID, 'buy', 8.9)).toBeCloseTo(-570, 6);
  });
  it('MRNA long put sold at 2.54 against a 5.30 debit is -$276', () => {
    expect(expectedClosePnlDollars(MRNA_ID, 'sell', 2.54)).toBeCloseTo(-276, 6);
  });
});

describe('runExitWalkGate: the existing close-order safety gate on every walk price', () => {
  const gate = (over: Partial<Parameters<typeof runExitWalkGate>[0]> = {}) =>
    runExitWalkGate({ pos: TQQQ_POS, identity: TQQQ_ID, side: 'buy', price_c: 890, quote: q(830, 950), nowMs: NOW, ...over });

  it('passes TQQQ buy at the mid and at the live ask', () => {
    expect(gate().ok).toBe(true);
    expect(gate({ price_c: 950 }).ok).toBe(true);
  });
  it('passes MRNA sell at the mid and at the live bid', () => {
    const base = { pos: MRNA_POS, identity: MRNA_ID, side: 'sell' as const, quote: q(208, 300) };
    expect(gate({ ...base, price_c: 254 }).ok).toBe(true);
    expect(gate({ ...base, price_c: 208 }).ok).toBe(true);
  });
  it('blocks a price too far from the marketable price (MATERIAL_PNL_DEVIATION), with the gate message', () => {
    const result = gate({ price_c: 500 });
    expect(result.ok).toBe(false);
    expect(exitWalkGateRefusal({ pos: TQQQ_POS, identity: TQQQ_ID, side: 'buy', price_c: 500, quote: q(830, 950), nowMs: NOW })).toMatch(/MATERIAL_PNL_DEVIATION/);
  });
  it('blocks a very wide market whose mid is more than 30% from the marketable side (safe failure, not a bypass)', () => {
    expect(exitWalkGateRefusal({ pos: MRNA_POS, identity: MRNA_ID, side: 'sell', price_c: 200, quote: q(100, 300), nowMs: NOW })).toMatch(/MATERIAL_PNL_DEVIATION/);
  });
  it('blocks a missing or old quote', () => {
    expect(exitWalkGateRefusal({ pos: TQQQ_POS, identity: TQQQ_ID, side: 'buy', price_c: 890, quote: q(830, 950, new Date(NOW - 20 * 60000).toISOString()), nowMs: NOW })).not.toBeNull();
  });
  it('returns null when the gate passes', () => {
    expect(exitWalkGateRefusal({ pos: TQQQ_POS, identity: TQQQ_ID, side: 'buy', price_c: 890, quote: q(830, 950), nowMs: NOW })).toBeNull();
  });
});

describe('integration: the walk with the gate as its checkPrice', () => {
  function walkDeps(h: { submits: number[]; quote: Quote; clock: { now: number } }, gate: (price: number, quote: Quote) => string | null): ExitWalkDeps {
    let n = 0;
    const live = new Map<string, boolean>([['o1', true]]);
    return {
      async submit(price) { n += 1; const id = `o${n + 1}`; live.set(id, true); h.submits.push(price); return id; },
      async getStatus(id) { return { state: live.get(id) ? 'live' : 'closed', filledQty: 0, totalQty: 1 }; },
      async cancel(id) { live.set(id, false); },
      async getQuote() { return { ...h.quote, t: new Date(h.clock.now - 1000).toISOString() }; },
      checkPrice: gate,
      nowMs: () => h.clock.now,
      async sleep(ms) { h.clock.now += ms; },
      cancelRequested: () => false,
      abandoned: () => false,
    };
  }
  const T1 = [{ threshold: null, value: 0.01 }];

  it('TQQQ buy walks to the ask with every price passing the gate', async () => {
    const h = { submits: [] as number[], quote: q(830, 950), clock: { now: NOW } };
    const deps = walkDeps(h, (price, quote) => exitWalkGateRefusal({ pos: TQQQ_POS, identity: TQQQ_ID, side: 'buy', price_c: price, quote, nowMs: h.clock.now }));
    const out = await runExitWalk({ side: 'buy', tickTable: T1, firstOrderId: 'o1', firstPrice_c: 890, anchor: h.quote, deps });
    expect(out.kind).toBe('ended_working');
    expect(h.submits).toEqual([902, 914, 926, 938, 950]);
  });
  it('a gate refusal mid-walk leaves the order working, nothing cancelled', async () => {
    const h = { submits: [] as number[], quote: q(830, 950), clock: { now: NOW } };
    const deps = walkDeps(h, price => (price >= 926 ? 'MATERIAL_PNL_DEVIATION: test refusal' : null));
    const out = await runExitWalk({ side: 'buy', tickTable: T1, firstOrderId: 'o1', firstPrice_c: 890, anchor: h.quote, deps });
    expect(out).toMatchObject({ kind: 'stopped', reason: 'price_blocked', orderLive: true, price_c: 914 });
    expect(h.submits).toEqual([902, 914]);
  });
});

describe('closeOrder.ts purity guard', () => {
  it('has no network, storage, UI or app imports, and no clock reads', () => {
    const src = readFileSync(join(__dirname, '..', 'closeOrder.ts'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/Date\.now|Math\.random|setTimeout|fetch\(|localStorage|window\./);
    expect(src).not.toMatch(/from '@\/(app|components|features)/);
  });
});
