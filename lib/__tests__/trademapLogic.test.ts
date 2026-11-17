// lib/__tests__/trademapLogic.test.ts
//
// OPTMAP-0001 S2: chance of profit, real-time gate v2, chain parsing and
// strategy builders. Chance-of-profit goldens come from an independent Python
// implementation (math.erfc). The quote fixtures are real payloads captured
// by the S0 spike on 2026-11-17.

import { describe, expect, it } from 'vitest';
import { chanceOfProfit } from '../trademap/pop';
import { evaluateGate, type GateInput, type GateQuote } from '../trademap/realtimeGate';
import {
  parseMetrics,
  parseNestedChain,
  parseOptionQuote,
  parseUnderlyingQuote,
  symbolKey,
  type ChainExpiration,
  type OptionQuote,
} from '../trademap/chain';
import { buildTradeLegs, defaultAnchorStrike, defaultWidthSteps, legSpecs } from '../trademap/strategies';
import type { TradeLeg } from '../trademap/strategyLegs';
import { ivToFraction } from '../trademap/pricing';

const leg = (over: Partial<TradeLeg>): TradeLeg => ({
  right: 'C', side: 'long', strike: 100, expiration: '2026-12-18', quantity: 1, entryPrice: 1, iv: 0.3, ...over,
});

describe('OPTMAP-0001 S2: chanceOfProfit', () => {
  const asOf = '2026-11-17'; // 31 days to 2026-12-18
  it('long call 100C debit 3.00 (breakeven 103)', () => {
    const p = chanceOfProfit([leg({ entryPrice: 3 })], 100, asOf, 0.3, 0.04, 0)!;
    expect(Math.abs(p - 0.36581944346657336)).toBeLessThan(1e-9);
  });
  it('bull put spread 95/90 credit 0.80 (breakeven 94.20)', () => {
    const p = chanceOfProfit([
      leg({ right: 'P', side: 'short', strike: 95, entryPrice: 1.2 }),
      leg({ right: 'P', side: 'long', strike: 90, entryPrice: 0.4 }),
    ], 100, asOf, 0.3, 0.04, 0)!;
    expect(Math.abs(p - 0.7512898511493307)).toBeLessThan(1e-9);
  });
  it('iron condor 85/90/110/115 credit 1.00 (breakevens 89 and 111)', () => {
    const p = chanceOfProfit([
      leg({ right: 'P', side: 'long', strike: 85, entryPrice: 0.3 }),
      leg({ right: 'P', side: 'short', strike: 90, entryPrice: 0.8 }),
      leg({ right: 'C', side: 'short', strike: 110, entryPrice: 0.7 }),
      leg({ right: 'C', side: 'long', strike: 115, entryPrice: 0.2 }),
    ], 100, asOf, 0.3, 0.04, 0)!;
    expect(Math.abs(p - 0.7925583431289485)).toBeLessThan(1e-9);
  });
  it('a dividend yield lowers a long call\'s chance', () => {
    const p = chanceOfProfit([leg({ entryPrice: 3 })], 100, asOf, 0.3, 0.04, 0.02)!;
    expect(Math.abs(p - 0.3585359330298762)).toBeLessThan(1e-9);
  });
  it('SOXL long 47P (the screenshot trade) is about 43%', () => {
    const p = chanceOfProfit([leg({ right: 'P', strike: 47, entryPrice: 9.625 })], 46.76, asOf, 1.79, 0.04, 0)!;
    expect(Math.abs(p - 0.43048833023422395)).toBeLessThan(1e-9);
  });
  it('fails closed: several expirations, bad inputs, expired', () => {
    expect(chanceOfProfit([leg({}), leg({ expiration: '2027-01-15' })], 100, asOf, 0.3, 0.04, 0)).toBeNull();
    expect(chanceOfProfit([leg({})], 100, asOf, 0, 0.04, 0)).toBeNull();
    expect(chanceOfProfit([leg({})], -1, asOf, 0.3, 0.04, 0)).toBeNull();
    expect(chanceOfProfit([leg({})], 100, '2026-12-18', 0.3, 0.04, 0)).toBeNull();
    expect(chanceOfProfit([], 100, asOf, 0.3, 0.04, 0)).toBeNull();
  });
});

describe('OPTMAP-0001 S2: real-time gate v2', () => {
  const NOW = Date.parse('2026-11-17T20:30:00Z');
  const q = (ageSec: number, over: Partial<GateQuote> = {}): GateQuote => ({
    symbol: 'SOXL  261218P00047000', updatedAtMs: NOW - ageSec * 1000, halted: false, bid: 9.6, ask: 9.65, ...over,
  });
  const base = (over: Partial<GateInput> = {}): GateInput => ({
    nowMs: NOW, legs: [q(2)], others: [q(1, { symbol: 'SOXL' })], lastSuccessMs: NOW - 1000, pollIntervalMs: 5000, successfulPolls: 3, ...over,
  });

  it('is live for fresh, two-sided, unhalted quotes after warm-up', () => {
    const r = evaluateGate(base());
    expect(r.status).toBe('live');
    expect(r.reasons).toEqual([]);
  });
  it('is warming until two polls have succeeded', () => {
    expect(evaluateGate(base({ successfulPolls: 1 })).status).toBe('warming');
  });
  it('goes stale when the median age exceeds 15s', () => {
    const r = evaluateGate(base({ legs: [q(30)], others: [q(30, { symbol: 'SOXL' })] }));
    expect(r.status).toBe('stale');
    expect(r.reasons.join(' ')).toContain('median quote age');
  });
  it('a single old leg (over 60s) is stale even when the median is fine', () => {
    const r = evaluateGate(base({ legs: [q(61)], others: [q(0), q(0), q(0)].map(x => ({ ...x, symbol: 'SOXL' })) }));
    expect(r.status).toBe('stale');
    expect(r.reasons.join(' ')).toContain('limit 60s');
  });
  it('an old leg under 60s does not by itself block (observed: legs reach ~30s in a live market)', () => {
    const r = evaluateGate(base({ legs: [q(29)], others: [q(0), q(0), q(0)].map(x => ({ ...x, symbol: 'SOXL' })) }));
    expect(r.status).toBe('live');
  });
  it('blocks halted, one-sided and crossed legs', () => {
    expect(evaluateGate(base({ legs: [q(1, { halted: true })] })).status).toBe('stale');
    expect(evaluateGate(base({ legs: [q(1, { bid: 0 })] })).status).toBe('stale');
    expect(evaluateGate(base({ legs: [q(1, { bid: 9.7, ask: 9.6 })] })).status).toBe('stale');
  });
  it('blocks a leg with no timestamp', () => {
    expect(evaluateGate(base({ legs: [q(1, { updatedAtMs: null })] })).status).toBe('stale');
  });
  it('blocks on clock skew (quote more than 5s in the future)', () => {
    const r = evaluateGate(base({ legs: [q(-8)] }));
    expect(r.status).toBe('stale');
    expect(r.reasons.join(' ')).toContain('clock skew');
  });
  it('tolerates sub-5s future timestamps', () => {
    expect(evaluateGate(base({ legs: [q(-2)] })).status).toBe('live');
  });
  it('goes stale when polling has stopped succeeding', () => {
    expect(evaluateGate(base({ lastSuccessMs: NOW - 11_000 })).status).toBe('stale');
    expect(evaluateGate(base({ lastSuccessMs: null })).status).toBe('stale');
  });
  it('no legs is stale', () => {
    expect(evaluateGate(base({ legs: [] })).status).toBe('stale');
  });
});

describe('OPTMAP-0001 S2: chain parsing (real spike payloads)', () => {
  const soxlOption = {
    ask: '6.5', 'ask-size': '568.0', bid: '5.4', 'bid-size': '664.0', delta: '0.494279348', 'is-trading-halted': false,
    mark: '5.95', mid: '5.95', 'open-interest': 55, symbol: 'SOXL  261204C00051000',
    'updated-at': '2026-11-17T20:25:44.380Z', volatility: '1.841942424', volume: '32.0',
  };
  it('parses an option quote: mid, IV as a fraction, delta, timestamp, halt flag', () => {
    const o = parseOptionQuote(soxlOption)!;
    expect(o.mid).toBeCloseTo(5.95, 9);
    expect(o.iv).toBeCloseTo(1.841942424, 9);
    expect(o.delta).toBeCloseTo(0.494279348, 9);
    expect(o.updatedAtMs).toBe(Date.parse('2026-11-17T20:25:44.380Z'));
    expect(o.halted).toBe(false);
  });
  it('no mid for a one-sided or crossed market; IV null when missing', () => {
    expect(parseOptionQuote({ ...soxlOption, bid: '0' })!.mid).toBeNull();
    expect(parseOptionQuote({ ...soxlOption, bid: '7', ask: '6' })!.mid).toBeNull();
    expect(parseOptionQuote({ ...soxlOption, volatility: undefined })!.iv).toBeNull();
    expect(parseOptionQuote({ bid: '1' })).toBeNull();
  });
  it('ivToFraction: fractions stay, percents convert, junk is null', () => {
    expect(ivToFraction('1.84')).toBeCloseTo(1.84, 9);
    expect(ivToFraction('0.39816347')).toBeCloseTo(0.39816347, 9);
    expect(ivToFraction(179)).toBeCloseTo(1.79, 9);
    expect(ivToFraction('')).toBeNull();
    expect(ivToFraction(-1)).toBeNull();
  });
  it('parses the underlying: last price, previous close, timestamp', () => {
    const u = parseUnderlyingQuote({ symbol: 'SOXL', last: '46.76', 'prev-close': '48.8', 'updated-at': '2026-11-17T20:25:44Z' })!;
    expect(u.price).toBe(46.76);
    expect(u.prevClose).toBe(48.8);
    expect(parseUnderlyingQuote({ symbol: 'SOXL' })).toBeNull();
  });
  it('parses market metrics: per-expiration IV, earnings, dividend yield (and ignores the junk)', () => {
    const m = parseMetrics({
      'option-expiration-implied-volatilities': [
        { 'expiration-date': '2026-11-20', 'implied-volatility': '3.037014781' },
        { 'expiration-date': '2026-12-18', 'implied-volatility': '1.79' },
        { 'expiration-date': '2026-12-24' },
      ],
      earnings: { 'expected-report-date': '2027-01-29' },
      'dividend-yield': '0.007621001',
    });
    expect(m.ivByExpiration['2026-12-18']).toBeCloseTo(1.79, 9);
    expect(m.ivByExpiration['2026-12-24']).toBeUndefined();
    expect(m.earningsDate).toBe('2027-01-29');
    expect(m.dividendYield).toBeCloseTo(0.007621001, 9);
    expect(parseMetrics({ 'dividend-yield': '0' }).dividendYield).toBeNull();
    expect(parseMetrics(undefined).earningsDate).toBeNull();
  });
  it('parses the nested chain: drops past/today expirations, sorts, keeps padded symbols', () => {
    const chain = parseNestedChain({ data: { items: [{ expirations: [
      { 'expiration-date': '2026-12-18', strikes: [
        { 'strike-price': '50.0', call: 'SOXL  261218C00050000', put: 'SOXL  261218P00050000' },
        { 'strike-price': '47.0', call: 'SOXL  261218C00047000', put: 'SOXL  261218P00047000' },
      ] },
      { 'expiration-date': '2026-11-17', strikes: [{ 'strike-price': '47.0', call: 'x', put: 'y' }] },
      { 'expiration-date': '2026-11-27', strikes: [{ 'strike-price': '47.0', call: 'a', put: 'b' }] },
    ] }] } }, '2026-11-17');
    expect(chain.map(c => c.date)).toEqual(['2026-11-27', '2026-12-18']);
    expect(chain[1].dte).toBe(31);
    expect(chain[1].strikes.map(s => s.strike)).toEqual([47, 50]);
    expect(chain[1].strikes[0].put).toBe('SOXL  261218P00047000');
    expect(symbolKey('SOXL  261218P00047000')).toBe('SOXL261218P00047000');
  });
});

describe('OPTMAP-0001 S2: strategy builders', () => {
  const strikes = [35, 37.5, 40, 42.5, 45, 47, 50, 52.5, 55, 57.5, 60];
  const chain: ChainExpiration = {
    date: '2026-12-18', dte: 31,
    strikes: strikes.map(k => ({ strike: k, call: `C${k}`, put: `P${k}` })),
  };
  const spot = 46.76;

  it('default anchors: ATM for long options, half the expected move away for premium selling', () => {
    expect(defaultAnchorStrike('long-put', strikes, spot, 0.52)).toBe(47);
    expect(defaultAnchorStrike('csp', strikes, spot, 0.2)).toBe(42.5);
    expect(defaultAnchorStrike('bcs', strikes, spot, 0.2)).toBe(52.5);
    expect(defaultAnchorStrike('bps', strikes, spot, null)).toBe(42.5);
  });
  it('default width is about 5% of the stock price in strike steps, at least one', () => {
    expect(defaultWidthSteps(strikes, spot)).toBe(1);
    expect(defaultWidthSteps([100, 101, 102, 103, 104, 105], 103)).toBe(6); // 5% of 103 is 5.15, so 6 one-dollar steps
    expect(defaultWidthSteps([100], 100)).toBe(1);
  });
  it('builds the legs of each v1 strategy', () => {
    expect(legSpecs('long-put', chain, 47, spot, 1)!.map(s => [s.right, s.side, s.strike])).toEqual([['P', 'long', 47]]);
    expect(legSpecs('csp', chain, 42.5, spot, 1)!.map(s => [s.right, s.side, s.strike])).toEqual([['P', 'short', 42.5]]);
    expect(legSpecs('bps', chain, 45, spot, 2)!.map(s => [s.right, s.side, s.strike])).toEqual([['P', 'short', 45], ['P', 'long', 40]]);
    expect(legSpecs('bcs', chain, 52.5, spot, 1)!.map(s => [s.right, s.side, s.strike])).toEqual([['C', 'short', 52.5], ['C', 'long', 55]]);
    expect(legSpecs('ic', chain, 42.5, spot, 1)!.map(s => [s.right, s.side, s.strike])).toEqual([
      ['P', 'short', 42.5], ['P', 'long', 40], ['C', 'short', 50], ['C', 'long', 52.5],
    ]);
  });
  it('returns null when a leg falls off the chain or the anchor is not a listed strike', () => {
    expect(legSpecs('bps', chain, 37.5, spot, 3)).toBeNull();
    expect(legSpecs('bcs', chain, 57.5, spot, 3)).toBeNull();
    expect(legSpecs('long-put', chain, 46, spot, 1)).toBeNull();
    expect(legSpecs('ic', chain, 55, spot, 1)).toBeNull();
    expect(legSpecs('bps', chain, 45, spot, 0)).toBeNull();
  });
  it('turns quotes into trade legs: mid entry, own IV, padded symbols matched', () => {
    const quotes: Record<string, OptionQuote> = {
      P47: { symbol: 'P47', bid: 9.6, ask: 9.65, mid: 9.625, iv: 1.79, delta: -0.46, updatedAtMs: 1, halted: false },
    };
    const r = buildTradeLegs(legSpecs('long-put', chain, 47, spot, 1)!, '2026-12-18', quotes);
    expect(r.error).toBeNull();
    expect(r.legs![0]).toEqual({ right: 'P', side: 'long', strike: 47, expiration: '2026-12-18', quantity: 1, entryPrice: 9.625, iv: 1.79 });
  });
  it('fails closed on a missing, one-sided or IV-less leg', () => {
    const specs = legSpecs('long-put', chain, 47, spot, 1)!;
    const quote = (over: Partial<OptionQuote>): Record<string, OptionQuote> => ({
      P47: { symbol: 'P47', bid: 9.6, ask: 9.65, mid: 9.625, iv: 1.79, delta: -0.46, updatedAtMs: 1, halted: false, ...over },
    });
    expect(buildTradeLegs(specs, '2026-12-18', {}).error).toContain('No quote');
    expect(buildTradeLegs(specs, '2026-12-18', quote({ mid: null })).error).toContain('one-sided');
    expect(buildTradeLegs(specs, '2026-12-18', quote({ iv: null })).error).toContain('implied volatility');
  });
});

import { formatModeValue, modeValue } from '../trademap/displayModes';

describe('OPTMAP-0001 S2: display modes', () => {
  const cell = { value: 600, pl: -300 };
  it('debit trade: $ and value pass through, % uses the debit, max-risk uses max loss', () => {
    const basis = { netDebit: 900, maxLoss: 900 };
    expect(modeValue('pl-dollar', cell, basis)).toBe(-300);
    expect(modeValue('value', cell, basis)).toBe(600);
    expect(modeValue('pl-pct', cell, basis)).toBeCloseTo(-33.3333333, 6);
    expect(modeValue('pct-max-risk', cell, basis)).toBeCloseTo(-33.3333333, 6);
  });
  it('credit trade: % is of the credit received (+50% = profit exit, -100% = 2x-credit stop)', () => {
    expect(modeValue('pl-pct', { value: -50, pl: 40 }, { netDebit: -80, maxLoss: 420 })).toBeCloseTo(50, 9);
    expect(modeValue('pl-pct', { value: -160, pl: -80 }, { netDebit: -80, maxLoss: 420 })).toBeCloseTo(-100, 9);
  });
  it('fails closed: unbounded or zero basis, null cell', () => {
    expect(modeValue('pct-max-risk', cell, { netDebit: -80, maxLoss: null })).toBeNull();
    expect(modeValue('pl-pct', cell, { netDebit: 0, maxLoss: null })).toBeNull();
    expect(modeValue('pl-dollar', null, { netDebit: 1, maxLoss: 1 })).toBeNull();
  });
  it('formats dollars and percents', () => {
    expect(formatModeValue('pl-dollar', 1775)).toBe('$1,775');
    expect(formatModeValue('pl-dollar', -2025.4)).toBe('-$2,025');
    expect(formatModeValue('pct-max-risk', -47.26)).toBe('-47.3%');
    expect(formatModeValue('pl-pct', null)).toBe('—');
  });
});
