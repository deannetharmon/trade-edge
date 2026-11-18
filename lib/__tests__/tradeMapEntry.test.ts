// lib/__tests__/tradeMapEntry.test.ts
//
// ORDER-SEND-0001 S3a: the Trade Map order path must produce the same body as the screener path.

import { describe, expect, it } from 'vitest';
import {
  buildTradeMapEntryOrder, checkReprice, legsToOrderLegs, liveSubmitAllowed, netCreditAtMid, sendBlockers, sendSupported,
} from '../orders/tradeMapEntry';
import { buildOrderLegs } from '../orders/entryLegs';
import { bracketForPrice } from '../entry-walk/bracket';
import { buildCreditEntryOtoco } from '../screener/entryBracket';
import { snapEntryCredit } from '../portfolio/tickSize';
import type { LegSpec } from '../trademap/strategies';

const SP = 'SOXL  261218P00045000';
const LP = 'SOXL  261218P00040000';
const SC = 'SOXL  261218C00055000';
const LC = 'SOXL  261218C00060000';
const bps: LegSpec[] = [
  { right: 'P', side: 'short', strike: 45, symbol: SP },
  { right: 'P', side: 'long', strike: 40, symbol: LP },
];
const ic: LegSpec[] = [...bps, { right: 'C', side: 'short', strike: 55, symbol: SC }, { right: 'C', side: 'long', strike: 60, symbol: LC }];
const TABLE = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }];

describe('ORDER-SEND-0001 S3a: legs', () => {
  it('match the screener buildOrderLegs for BPS and IC (order, actions, padded symbols)', () => {
    const screenerBps = buildOrderLegs({ symbol: 'SOXL', underlyingType: 'equity' } as any, { strategy: 'BPS', shortOccSymbol: SP, longOccSymbol: LP } as any);
    expect(legsToOrderLegs(bps, false)).toEqual(screenerBps);
    const screenerIc = buildOrderLegs({ symbol: 'SOXL', underlyingType: 'equity' } as any, { strategy: 'IC', shortOccSymbol: SP, longOccSymbol: LP, shortCallOccSymbol: SC, longCallOccSymbol: LC } as any);
    expect(legsToOrderLegs(ic, false)).toEqual(screenerIc);
  });
  it('index underlyings use the Index Option type; no legs gives null', () => {
    expect(legsToOrderLegs(bps, true)![0]['instrument-type']).toBe('Index Option');
    expect(legsToOrderLegs([], false)).toBeNull();
  });
});

describe('ORDER-SEND-0001 S3a: net credit and re-price', () => {
  it('net credit is short mids minus long mids; a missing mid gives null', () => {
    expect(netCreditAtMid(bps, { SOXL261218P00045000: 4.05, SOXL261218P00040000: 2.6 })).toBe(1.45);
    expect(netCreditAtMid(bps, { SOXL261218P00045000: 4.05, SOXL261218P00040000: null })).toBeNull();
    expect(netCreditAtMid(bps, { SOXL261218P00045000: 4.05 })).toBeNull();
  });
  it('re-price: within $0.05 passes, beyond aborts and reports the new price', () => {
    expect(checkReprice(1.45, 1.5).ok).toBe(true);
    const r = checkReprice(1.45, 1.51);
    expect(r.ok).toBe(false);
    expect(r.newPrice).toBe(1.51);
    expect(r.moved).toBe(0.06);
    expect(checkReprice(1.45, NaN).ok).toBe(false);
  });
});

describe('ORDER-SEND-0001 S3a: the order body equals the screener body', () => {
  for (const [name, specs, strategy, entry] of [['BPS', bps, 'bps', 1.45], ['IC', ic, 'ic', 2.62]] as const) {
    it(`${name}: identical to bracketForPrice + buildCreditEntryOtoco on the same legs`, () => {
      const legs = legsToOrderLegs(specs as LegSpec[], false)!;
      const res = buildTradeMapEntryOrder({ strategy, legs, entryCredit: entry, quantity: 2, tickTable: TABLE });
      expect(res.ok).toBe(true);
      const snapped = snapEntryCredit(entry, TABLE);
      const b = bracketForPrice(snapped, 50, 2, TABLE);
      const expected = buildCreditEntryOtoco({ entryCredit: snapped, profitBuyback: b.profitBuyback, stopTrigger: b.stopTrigger, stopLimit: b.stopLimit, quantity: 2, legs });
      if (res.ok) expect(res.order).toEqual(expected);
    });
  }
  it('carries the 50% target and 2x stop, both exits closing the legs, GTC, quantity applied', () => {
    const res = buildTradeMapEntryOrder({ strategy: 'bps', legs: legsToOrderLegs(bps, false)!, entryCredit: 1.45, quantity: 3, tickTable: null });
    if (!res.ok) throw new Error(res.reason);
    const o: any = res.order;
    expect(o.type).toBe('OTOCO');
    expect(o['trigger-order'].price).toBe('1.45');
    expect(o['trigger-order']['price-effect']).toBe('Credit');
    expect(o.orders[0].price).toBe('0.72'); // 1.45 x 50% = 0.725; the screener's own rounding gives 0.72
    expect(o.orders[1]['stop-trigger']).toBe('2.90');
    expect(o['trigger-order'].legs.every((l: any) => l.quantity === 3)).toBe(true);
    expect(o.orders[0].legs.map((l: any) => l.action)).toEqual(['Buy to Close', 'Sell to Close']);
  });
  it('refuses unsupported strategies, wrong leg counts, bad quantity and non-positive credit', () => {
    const legs = legsToOrderLegs(bps, false)!;
    expect(buildTradeMapEntryOrder({ strategy: 'csp', legs: [legs[0]], entryCredit: 1, quantity: 1, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'long-call', legs, entryCredit: 1, quantity: 1, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'ic', legs, entryCredit: 1, quantity: 1, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'bps', legs, entryCredit: 1, quantity: 0, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'bps', legs, entryCredit: 1, quantity: 1.5, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'bps', legs, entryCredit: 0, quantity: 1, tickTable: null }).ok).toBe(false);
    expect(buildTradeMapEntryOrder({ strategy: 'bps', legs, entryCredit: -1, quantity: 1, tickTable: null }).ok).toBe(false);
  });
  it('v1 supports BPS, BCS and IC only', () => {
    expect(['bps', 'bcs', 'ic'].every(s => sendSupported(s as any))).toBe(true);
    expect(['csp', 'long-call', 'long-put'].some(s => sendSupported(s as any))).toBe(false);
  });
});

describe('ORDER-SEND-0001 S3a: Send blockers and the dry-run rule', () => {
  const ok = { gateStatus: 'live' as const, strategy: 'bps' as const, hasLegs: true, quantity: 1 };
  it('no blockers only when live, supported, quoted and quantity is whole', () => {
    expect(sendBlockers(ok)).toEqual([]);
    expect(sendBlockers({ ...ok, gateStatus: 'warming' }).length).toBe(1);
    expect(sendBlockers({ ...ok, gateStatus: 'stale' }).length).toBe(1);
    expect(sendBlockers({ ...ok, strategy: 'csp' }).length).toBe(1);
    expect(sendBlockers({ ...ok, hasLegs: false }).length).toBe(1);
    expect(sendBlockers({ ...ok, quantity: 0 }).length).toBe(1);
  });
  it('a live submit needs a successful, fresh dry run of the identical payload', () => {
    const payload = { a: 1, legs: [SP] };
    const v = { ok: true, payloadJson: JSON.stringify(payload), atMs: 1_000 };
    expect(liveSubmitAllowed(v, payload, 1_000 + 14_000)).toBe(true);
    expect(liveSubmitAllowed(v, payload, 1_000 + 16_000)).toBe(false);
    expect(liveSubmitAllowed(v, { ...payload, a: 2 }, 1_500)).toBe(false);
    expect(liveSubmitAllowed({ ...v, ok: false }, payload, 1_500)).toBe(false);
    expect(liveSubmitAllowed(null, payload, 1_500)).toBe(false);
    expect(liveSubmitAllowed(v, payload, 500)).toBe(false);
  });
});

import { evaluateRuleChecks, failedChecks, isIndexSymbol, needsAcknowledgement, rulesFor } from '../trademap/ruleChecks';
import { parseMetrics, parseOptionQuote } from '../trademap/chain';
import { DEFAULT_ETF_RULES, DEFAULT_RULES } from '../scans/constants';

describe('ORDER-SEND-0001 S3b: Prosper rule checks use the screener constants', () => {
  const base = {
    strategy: 'bps' as const, symbol: 'SOXL', dte: 31, ivRankPct: 45, shortDeltas: [-0.25], shortOis: [900],
    earningsDate: null as string | null, expiration: '2026-12-18', credit: 1.45, width: 5,
  };
  const by = (cs: ReturnType<typeof evaluateRuleChecks>, k: string) => cs.find(c => c.key === k)!;

  it('a qualifying BPS passes everything and needs no acknowledgement', () => {
    const cs = evaluateRuleChecks(base);
    expect(cs.map(c => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(needsAcknowledgement(cs)).toBe(false);
  });
  it('IV rank below the screener minimum fails, using the screener value (30)', () => {
    expect(DEFAULT_RULES.IVR_MIN).toBe(30);
    const cs = evaluateRuleChecks({ ...base, ivRankPct: 22 });
    expect(by(cs, 'ivr').status).toBe('fail');
    expect(by(cs, 'ivr').rule).toBe('rule: at least 30');
    expect(needsAcknowledgement(cs)).toBe(true);
    expect(evaluateRuleChecks({ ...base, ivRankPct: 30 }).find(c => c.key === 'ivr')!.status).toBe('pass');
  });
  it('missing IV rank, missing delta and missing OI fail closed (OI is a warning)', () => {
    const cs = evaluateRuleChecks({ ...base, ivRankPct: null, shortDeltas: [null], shortOis: [null] });
    expect(by(cs, 'ivr').status).toBe('fail');
    expect(by(cs, 'delta').status).toBe('fail');
    expect(by(cs, 'oi').status).toBe('warn');
  });
  it('DTE outside 30 to 45 fails; delta band is 0.20 to 0.30 for spreads and 0.16 to 0.20 for condors', () => {
    expect(by(evaluateRuleChecks({ ...base, dte: 21 }), 'dte').status).toBe('fail');
    expect(by(evaluateRuleChecks({ ...base, dte: 45 }), 'dte').status).toBe('pass');
    expect(by(evaluateRuleChecks({ ...base, shortDeltas: [-0.35] }), 'delta').status).toBe('fail');
    const ic = { ...base, strategy: 'ic' as const, shortDeltas: [-0.18, 0.18], shortOis: [900, 900], credit: 2.2, width: 5, ivRankPct: 50 };
    expect(by(evaluateRuleChecks(ic), 'delta').status).toBe('pass');
    expect(by(evaluateRuleChecks({ ...ic, shortDeltas: [-0.25, 0.18] }), 'delta').status).toBe('fail');
  });
  it('iron condors also cap IV rank at 70', () => {
    const ic = { ...base, strategy: 'ic' as const, shortDeltas: [-0.18, 0.18], shortOis: [900, 900], credit: 2.2, width: 5 };
    expect(by(evaluateRuleChecks({ ...ic, ivRankPct: 85 }), 'ivr').status).toBe('fail');
    expect(by(evaluateRuleChecks({ ...ic, ivRankPct: 60 }), 'ivr').status).toBe('pass');
  });
  it('return on risk: credit 1.45 on width 5 is 41% and passes; 0.8 is 19% and fails the 20% minimum', () => {
    expect(by(evaluateRuleChecks(base), 'roc').value).toBe('return 41%');
    expect(by(evaluateRuleChecks({ ...base, credit: 0.8 }), 'roc').status).toBe('fail');
  });
  it('earnings inside the window fail (the screener buffer); a date well after expiry passes; none listed passes', () => {
    expect(by(evaluateRuleChecks({ ...base, earningsDate: '2026-12-10' }), 'earnings').status).toBe('fail');
    expect(by(evaluateRuleChecks({ ...base, earningsDate: '2027-02-20' }), 'earnings').status).toBe('pass');
    expect(by(evaluateRuleChecks(base), 'earnings').status).toBe('pass');
  });
  it('low open interest is a warning that needs no acknowledgement', () => {
    const cs = evaluateRuleChecks({ ...base, shortOis: [120] });
    expect(by(cs, 'oi').status).toBe('warn');
    expect(failedChecks(cs)).toEqual([]);
    expect(needsAcknowledgement(cs)).toBe(false);
  });
  it('index symbols use the ETF/index rules', () => {
    expect(isIndexSymbol('spx')).toBe(true);
    expect(rulesFor('SPX')).toBe(DEFAULT_ETF_RULES);
    expect(rulesFor('SOXL')).toBe(DEFAULT_RULES);
    expect(by(evaluateRuleChecks({ ...base, symbol: 'SPX', ivRankPct: 18, shortOis: [150], shortDeltas: [-0.3] }), 'ivr').status).toBe('pass');
  });
  it('chain parsing now carries open interest and IV rank (percent)', () => {
    expect(parseOptionQuote({ symbol: 'X', bid: '1', ask: '1.1', 'open-interest': 55 })!.openInterest).toBe(55);
    expect(parseOptionQuote({ symbol: 'X', bid: '1', ask: '1.1' })!.openInterest).toBeNull();
    expect(parseMetrics({ 'implied-volatility-index-rank': '0.3817' }).ivRankPct).toBeCloseTo(38.17, 9);
    expect(parseMetrics({ 'implied-volatility-index-rank': '38' }).ivRankPct).toBeNull();
    expect(parseMetrics({}).ivRankPct).toBeNull();
  });
});
