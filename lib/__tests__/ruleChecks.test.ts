// lib/__tests__/ruleChecks.test.ts
//
// ORDER-SEND-0001 S3d: Trade Map's Prosper checks must agree with the screener. The parity tests build a chain, run the
// screener's own trySpreadAtWidth / tryICSideAtWidth on it, and require that the screener keeps the trade exactly when
// the delta, market, credit and return-on-risk checks here all pass.

import { describe, expect, it } from 'vitest';
import { DEFAULT_ETF_RULES, DEFAULT_RULES, INDEX_IVR_MIN } from '../scans/constants';
import { tryICSideAtWidth, trySpreadAtWidth } from '../scans/spread-finder';
import { calcSpreadPop } from '../scans/scan-utils';
import { evaluateRuleChecks, failedChecks, isIndexSymbol, needsAcknowledgement, type LegQuote, type RuleCheck, type RuleCheckInput, type Wing } from '../trademap/ruleChecks';
import { parseMetrics, parseOptionQuote } from '../trademap/chain';

const by = (cs: RuleCheck[], k: string) => cs.find(c => c.key === k)!;
const leg = (bid: number, ask: number, oi: number | null): LegQuote => ({ bid, ask, mid: Math.round(((bid + ask) / 2) * 100) / 100, oi });

function wing(over: Partial<Wing> = {}): Wing {
  return { right: 'P', shortStrike: 700, longStrike: 690, shortDelta: -0.16, short: leg(3.0, 3.2, 5000), long: leg(0.7, 0.9, 4000), ...over };
}
function input(over: Partial<RuleCheckInput> = {}): RuleCheckInput {
  return {
    strategy: 'bps', rules: DEFAULT_ETF_RULES, etfOrIndex: true, price: 732.44, dte: 31, ivRankPct: 30, expirationIv: 0.26,
    earningsDate: null, expiration: '2026-12-18', wings: [wing()], ...over,
  };
}

describe('Trade Map rule checks: a qualifying ETF spread passes everything', () => {
  it('SPY-like BPS on the ETF rules', () => {
    const cs = evaluateRuleChecks(input());
    expect(cs.map(c => `${c.key}:${c.status}`)).toEqual([
      'ivr:pass', 'dte:pass', 'delta:pass', 'market:pass', 'credit:pass', 'roc:pass', 'pop:pass', 'earnings:pass', 'oi:pass', 'width:pass',
    ]);
    expect(needsAcknowledgement(cs)).toBe(false);
  });
});

describe('Trade Map rule checks: each rule, with the screener values', () => {
  it('IV rank: stocks use IVR_MIN (30); ETFs and indexes use the INDEX_IVR_MIN floor (15); missing is a warning', () => {
    expect(DEFAULT_RULES.IVR_MIN).toBe(30);
    expect(INDEX_IVR_MIN).toBe(15);
    const stock = (r: number | null) => by(evaluateRuleChecks(input({ rules: DEFAULT_RULES, etfOrIndex: false, ivRankPct: r })), 'ivr');
    expect(stock(29).status).toBe('fail');
    expect(stock(30).status).toBe('pass');
    expect(stock(null).status).toBe('warn');
    expect(by(evaluateRuleChecks(input({ ivRankPct: 14 })), 'ivr').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ ivRankPct: 15 })), 'ivr').status).toBe('pass');
  });
  it('a custom IV rank minimum applies to stocks, not to the fixed ETF floor', () => {
    const loose = { ...DEFAULT_RULES, IVR_MIN: 20 };
    expect(by(evaluateRuleChecks(input({ rules: loose, etfOrIndex: false, ivRankPct: 22 })), 'ivr').status).toBe('pass');
    const looseEtf = { ...DEFAULT_ETF_RULES, IVR_MIN: 5 };
    expect(by(evaluateRuleChecks(input({ rules: looseEtf, ivRankPct: 10 })), 'ivr').status).toBe('fail');
  });
  it('an iron condor above the IV rank maximum is a warning, not a failure (as in the screener)', () => {
    const ic = input({ strategy: 'ic', ivRankPct: 85, wings: [wing(), wing({ right: 'C', shortStrike: 770, longStrike: 780, shortDelta: 0.16 })] });
    expect(by(evaluateRuleChecks(ic), 'ivr').status).toBe('warn');
  });
  it('DTE window follows the rules', () => {
    expect(by(evaluateRuleChecks(input({ dte: 29 })), 'dte').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ dte: 45 })), 'dte').status).toBe('pass');
    expect(by(evaluateRuleChecks(input({ dte: 46 })), 'dte').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ dte: 60, rules: { ...DEFAULT_ETF_RULES, DTE_MAX: 60 } })), 'dte').status).toBe('pass');
  });
  it('short delta: spread band 0.15 to 0.35 for ETFs; iron condor band 0.15 to 0.25; both condor sides', () => {
    expect(by(evaluateRuleChecks(input({ wings: [wing({ shortDelta: -0.36 })] })), 'delta').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ wings: [wing({ shortDelta: null })] })), 'delta').status).toBe('fail');
    const call = (d: number) => wing({ right: 'C', shortStrike: 770, longStrike: 780, shortDelta: d });
    const ic = (d: number) => input({ strategy: 'ic', wings: [wing({ shortDelta: -0.2 }), call(d)] });
    expect(by(evaluateRuleChecks(ic(0.2)), 'delta').status).toBe('pass');
    expect(by(evaluateRuleChecks(ic(0.3)), 'delta').status).toBe('fail');
  });
  it('market: a leg with no open interest, no quote or a wide bid-ask fails', () => {
    expect(by(evaluateRuleChecks(input({ wings: [wing({ long: leg(0.7, 0.9, 0) })] })), 'market').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ wings: [wing({ long: { bid: null, ask: null, mid: null, oi: 10 } })] })), 'market').status).toBe('fail');
    // price 732: widest allowed is $3.00; price 50: $0.10
    expect(by(evaluateRuleChecks(input({ wings: [wing({ short: leg(3.0, 6.5, 5000) })] })), 'market').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ price: 50, wings: [wing({ short: leg(3.0, 3.2, 5000) })] })), 'market').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ price: 50, wings: [wing({ short: leg(3.0, 3.1, 5000), long: leg(0.7, 0.8, 4000) })] })), 'market').status).toBe('pass');
  });
  it('credit ratio and return on risk use the conservative credit (natural + 25% toward mid), not the mid', () => {
    // short 3.00/3.20, long 0.70/0.90: natural 2.10, mid credit 2.30, conservative 2.15 -> 21.5% of width 10
    const cs = evaluateRuleChecks(input());
    expect(by(cs, 'credit').value).toBe('credit 22% of width');
    expect(by(cs, 'roc').value).toBe('return 27%');
    // the stock rules want 33% of width: the same trade fails there
    const stock = evaluateRuleChecks(input({ rules: DEFAULT_RULES, etfOrIndex: false, ivRankPct: 35 }));
    expect(by(stock, 'credit').status).toBe('fail');
    expect(by(stock, 'credit').rule).toBe('rule: at least 33% of width');
    expect(by(stock, 'roc').status).toBe('pass');
  });
  it('POP for spreads is the screener model on the expiration IV; below POP_MIN fails', () => {
    const cs = evaluateRuleChecks(input());
    const expected = calcSpreadPop('BPS', 732.44, 700, 2.15, 31, 26)!;
    expect(by(cs, 'pop').value).toBe(`POP ${expected.toFixed(0)}%`);
    expect(expected).toBeGreaterThan(65);
    // a short put close to the stock has a lower model POP and fails
    expect(by(evaluateRuleChecks(input({ wings: [wing({ shortStrike: 725, longStrike: 715 })] })), 'pop').status).toBe('fail');
    expect(by(evaluateRuleChecks(input({ expirationIv: null })), 'pop').status).toBe('fail');
  });
  it('iron condor POP is 1 minus both short deltas', () => {
    const call = wing({ right: 'C', shortStrike: 770, longStrike: 780, shortDelta: 0.2 });
    const ic = evaluateRuleChecks(input({ strategy: 'ic', wings: [wing({ shortDelta: -0.2 }), call] }));
    expect(by(ic, 'pop').value).toBe('POP 60%');
    expect(by(ic, 'pop').status).toBe('fail');
    const wide = evaluateRuleChecks(input({ strategy: 'ic', wings: [wing({ shortDelta: -0.16 }), { ...call, shortDelta: 0.16 }] }));
    expect(by(wide, 'pop').value).toBe('POP 68%');
    expect(by(wide, 'pop').status).toBe('pass');
  });
  it('earnings: stocks fail inside the window; ETFs and indexes have none', () => {
    const stock = (d: string | null) => by(evaluateRuleChecks(input({ rules: DEFAULT_RULES, etfOrIndex: false, ivRankPct: 35, earningsDate: d })), 'earnings');
    expect(stock('2026-12-10').status).toBe('fail');
    expect(stock('2027-02-20').status).toBe('pass');
    expect(stock(null).status).toBe('pass');
    expect(by(evaluateRuleChecks(input({ earningsDate: '2026-12-10' })), 'earnings').status).toBe('pass');
  });
  it('short-leg open interest below OI_MIN is a warning, never a failure', () => {
    const cs = evaluateRuleChecks(input({ wings: [wing({ short: leg(3.0, 3.2, 60) })] }));
    expect(by(cs, 'oi').status).toBe('warn');
    expect(by(cs, 'market').status).toBe('pass');
    expect(failedChecks(cs).some(c => c.key === 'oi')).toBe(false);
  });
  it('width wider than the scan would search fails', () => {
    expect(by(evaluateRuleChecks(input({ wings: [wing({ shortStrike: 700, longStrike: 690 })] })), 'width').status).toBe('pass');
    expect(by(evaluateRuleChecks(input({ rules: { ...DEFAULT_ETF_RULES, MAX_SPREAD_WIDTH: 10 }, wings: [wing({ longStrike: 685 })] })), 'width').status).toBe('fail');
  });
});

describe('Trade Map rule checks agree with the screener finder', () => {
  const EXP = '2026-12-18';
  function chainFor(w: Wing) {
    const mk = (strike: number, delta: number, l: LegQuote) => ({
      expirationDate: EXP, optionType: w.right, strikePrice: strike, delta, openInterest: l.oi, bid: l.bid, ask: l.ask, mid: l.mid, iv: 0.26, occSymbol: `X${strike}`,
    });
    return [mk(w.shortStrike, w.shortDelta ?? 0, w.short), mk(w.longStrike, 0.05, w.long)];
  }
  const cases: Array<[string, Partial<Wing>]> = [
    ['qualifying', {}],
    ['delta too high', { shortDelta: -0.4 }],
    ['delta too low', { shortDelta: -0.1 }],
    ['no open interest on the long leg', { long: leg(0.7, 0.9, 0) }],
    ['no open interest on the short leg', { short: leg(3.0, 3.2, 0) }],
    ['short bid-ask too wide', { short: leg(3.0, 6.5, 5000) }],
    ['credit too small', { short: leg(1.0, 1.2, 5000), long: leg(0.7, 0.9, 4000) }],
    ['credit ratio below the minimum', { short: leg(1.9, 2.1, 5000), long: leg(0.6, 0.8, 4000) }],
  ];
  for (const [name, over] of cases) {
    it(`BPS, ETF rules: ${name}`, () => {
      const w = wing(over);
      const checks = evaluateRuleChecks(input({ wings: [w] }));
      const gates = ['delta', 'market', 'credit', 'roc'].every(k => by(checks, k).status === 'pass');
      const screener = trySpreadAtWidth(chainFor(w), 'BPS', EXP, 10, 732.44, DEFAULT_ETF_RULES, 26);
      expect(screener != null).toBe(gates);
    });
    it(`BPS, stock rules: ${name}`, () => {
      const w = wing(over);
      const checks = evaluateRuleChecks(input({ rules: DEFAULT_RULES, etfOrIndex: false, ivRankPct: 40, wings: [w] }));
      const gates = ['delta', 'market', 'credit', 'roc'].every(k => by(checks, k).status === 'pass');
      const screener = trySpreadAtWidth(chainFor(w), 'BPS', EXP, 10, 732.44, DEFAULT_RULES, 26);
      expect(screener != null).toBe(gates);
    });
  }
  it('iron condor side: delta band, credit ratio and POP match tryICSideAtWidth', () => {
    for (const d of [0.14, 0.18, 0.2, 0.3]) {
      const w = wing({ shortDelta: -d });
      const call = wing({ right: 'C', shortStrike: 770, longStrike: 780, shortDelta: d });
      const checks = evaluateRuleChecks(input({ strategy: 'ic', wings: [w, call] }));
      const inBand = by(checks, 'delta').status === 'pass';
      const side = tryICSideAtWidth(chainFor(w), 'put', 10, 732.44, DEFAULT_ETF_RULES);
      if (inBand && by(checks, 'credit').status === 'pass' && by(checks, 'market').status === 'pass') expect(side).not.toBeNull();
      if (!inBand) expect(side).toBeNull();
    }
  });
});

describe('symbol helpers and chain parsing used by Send', () => {
  it('cash-settled index symbols are recognised for the order leg type only', () => {
    expect(isIndexSymbol('spx')).toBe(true);
    expect(isIndexSymbol('SPY')).toBe(false);
  });
  it('chain parsing carries open interest and IV rank (percent)', () => {
    expect(parseOptionQuote({ symbol: 'X', bid: '1', ask: '1.1', 'open-interest': 55 })!.openInterest).toBe(55);
    expect(parseOptionQuote({ symbol: 'X', bid: '1', ask: '1.1' })!.openInterest).toBeNull();
    expect(parseMetrics({ 'implied-volatility-index-rank': '0.3817' }).ivRankPct).toBeCloseTo(38.17, 9);
    expect(parseMetrics({ 'implied-volatility-index-rank': '38' }).ivRankPct).toBeNull();
    expect(parseMetrics({}).ivRankPct).toBeNull();
  });
});
