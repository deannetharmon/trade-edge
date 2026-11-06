// lib/market-movers/__tests__/marketMovers.test.ts

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_MOVERS_SETTINGS as S,
  buildCandidates,
  dayChangePct,
  dayOfWeek,
  evaluateMacroGate,
  evaluateVixGate,
  evaluateVolumeGate,
  exitLimitPrice,
  overallStatus,
  pickPut,
  topPick,
  volumeMultiple,
  type MacroEvent,
  type PutQuote,
  type TickerInput,
} from '..';

const events: MacroEvent[] = [
  { date: '2026-10-28', kind: 'FOMC' },
  { date: '2026-11-12', kind: 'CPI' },
];

describe('macro gate', () => {
  it('Wednesday with no event is Go', () => {
    expect(dayOfWeek('2026-10-21')).toBe(3);
    expect(evaluateMacroGate('2026-10-21', events, S).status).toBe('GO');
  });
  it('FOMC day is No-go, and its toggle turns it off', () => {
    expect(evaluateMacroGate('2026-10-28', events, S)).toMatchObject({ status: 'NO_GO', reason: 'FOMC decision today.' });
    const off = { ...S, macroToggles: { ...S.macroToggles, FOMC: false } };
    expect(evaluateMacroGate('2026-10-28', events, off).status).toBe('GO');
  });
  it('Thursday is No-go for jobless claims unless toggled off', () => {
    expect(dayOfWeek('2026-10-22')).toBe(4);
    expect(evaluateMacroGate('2026-10-22', events, S).status).toBe('NO_GO');
    expect(evaluateMacroGate('2026-10-22', events, { ...S, macroToggles: { ...S.macroToggles, JOBLESS_CLAIMS: false } }).status).toBe('GO');
  });
  it('fails closed on a stale or empty calendar, and on an unreadable date', () => {
    expect(evaluateMacroGate('2026-10-21', [], S).reason).toMatch(/Calendar stale/);
    expect(evaluateMacroGate('2026-10-21', [{ date: '2026-08-01', kind: 'CPI' }], S).status).toBe('NO_GO');
    expect(evaluateMacroGate('garbage', events, S).status).toBe('NO_GO');
  });
});

describe('VIX gate', () => {
  it('Go below 20, Amber 20 to 30, No-go at 30', () => {
    expect(evaluateVixGate(18.4, 18.0, S).status).toBe('GO');
    expect(evaluateVixGate(24, 23.5, S).status).toBe('AMBER');
    expect(evaluateVixGate(30, 29.9, S).status).toBe('NO_GO');
    expect(evaluateVixGate(31.6, 31, S).status).toBe('NO_GO');
  });
  it('No-go when up 10% or more on the day, even at a low level', () => {
    expect(evaluateVixGate(17.6, 16, S).status).toBe('NO_GO');
    expect(evaluateVixGate(17.5, 16, S).status).toBe('GO');
  });
  it('missing quote is No-go', () => {
    expect(evaluateVixGate(null, 18, S).reason).toMatch(/Data unavailable/);
    expect(evaluateVixGate(18, 0, S).status).toBe('NO_GO');
  });
});

describe('volume gate', () => {
  it('uses the highest multiple; 2x is No-go', () => {
    expect(volumeMultiple(170, 100)).toBe(1.7);
    expect(evaluateVolumeGate([{ symbol: 'MULL', multiple: 1.7 }, { symbol: 'TQQQ', multiple: 1.1 }], S).status).toBe('GO');
    expect(evaluateVolumeGate([{ symbol: 'MULL', multiple: 2 }], S).status).toBe('NO_GO');
  });
  it('no readable volume is No-go; missing inputs give null, never zero', () => {
    expect(evaluateVolumeGate([{ symbol: 'MULL', multiple: null }], S).status).toBe('NO_GO');
    expect(volumeMultiple(null, 100)).toBeNull();
    expect(volumeMultiple(100, 0)).toBeNull();
  });
  it('overall status: any No-go wins, then Amber', () => {
    const g = (status: 'GO' | 'AMBER' | 'NO_GO') => ({ id: 'vix' as const, status, reason: '' });
    expect(overallStatus([g('GO'), g('AMBER')])).toBe('AMBER');
    expect(overallStatus([g('AMBER'), g('NO_GO')])).toBe('NO_GO');
    expect(overallStatus([g('GO')])).toBe('GO');
  });
});

const t = (symbol: string, last: number, priorClose: number, ivPct: number | null, volume = 100, avg = 100): TickerInput => ({
  symbol, last, priorClose, ivPct, volume, avgVolume20: avg,
});

describe('candidates', () => {
  it('day change = (last - prior close) / prior close', () => {
    expect(dayChangePct(95, 100)).toBeCloseTo(-5, 10);
    expect(dayChangePct(null, 100)).toBeNull();
    expect(dayChangePct(95, 0)).toBeNull();
  });
  it('sorts by day change ascending; the biggest decliner at least 5% is the pick', () => {
    const list = buildCandidates([t('TQQQ', 98, 100, 55), t('MULL', 93, 100, 90), t('NVDL', 94.5, 100, 80)], S);
    expect(list.map((c) => c.symbol)).toEqual(['MULL', 'NVDL', 'TQQQ']);
    expect(topPick(list)?.symbol).toBe('MULL');
    expect(list.find((c) => c.symbol === 'TQQQ')).toMatchObject({ status: 'WATCH' });
  });
  it('a decliner under the minimum drop is a watch item, so there can be no pick', () => {
    expect(topPick(buildCandidates([t('TQQQ', 97, 100, 60)], S))).toBeNull();
  });
  it('blank IV and low IV exclude the ticker with a reason (fail closed)', () => {
    const list = buildCandidates([t('GGLL', 90, 100, null), t('SQQQ', 90, 100, 40)], S);
    expect(list.every((c) => c.status === 'EXCLUDED')).toBe(true);
    expect(list.find((c) => c.symbol === 'GGLL')?.reason).toBe('IV unavailable.');
    expect(list.find((c) => c.symbol === 'SQQQ')?.reason).toMatch(/below 50%/);
  });
  it('IV of exactly 50 qualifies; excluded rows sort last', () => {
    const list = buildCandidates([t('AAA', 90, 100, 49), t('BBB', 94, 100, 50)], S);
    expect(list.map((c) => c.symbol)).toEqual(['BBB', 'AAA']);
    expect(topPick(list)?.symbol).toBe('BBB');
  });
  it('a ticker at 2x volume is excluded from the pick', () => {
    const list = buildCandidates([t('MULL', 90, 100, 90, 250, 100), t('NVDL', 94, 100, 80)], S);
    expect(topPick(list)?.symbol).toBe('NVDL');
  });
});

const put = (strike: number, bid: number, ask: number, dte = 30, expiration = '2026-11-20'): PutQuote => ({ expiration, dte, strike, bid, ask });

describe('put pick', () => {
  it('picks the strike whose mid return is closest to 5%, with the math shown', () => {
    // capital 4000 -> mid 2.00 = 5.0%; strike 38 mid 1.50 = 3.95%; strike 42 mid 2.40 = 5.71%
    const pick = pickPut([put(38, 1.45, 1.55), put(40, 1.95, 2.05), put(42, 2.35, 2.45)], S)!;
    expect(pick.put.strike).toBe(40);
    expect(pick.capital).toBe(4000);
    expect(pick.midCredit).toBe(2);
    expect(pick.midReturnPct).toBeCloseTo(5, 10);
    expect(pick.bidReturnPct).toBeCloseTo(4.875, 10);
  });
  it('expiration nearest 30 DTE, ties to the shorter', () => {
    const pick = pickPut([put(40, 2, 2, 25, '2026-11-15'), put(40, 2, 2, 35, '2026-11-25'), put(40, 2, 2, 45, '2026-12-05')], S)!;
    expect(pick.put.dte).toBe(25);
  });
  it('strike ties go to the lower strike', () => {
    const pick = pickPut([put(41, 2.1, 2.1), put(40, 2.0, 2.0)], { ...S, targetReturnPct: 5.125 })!;
    // 40 -> 5.0%, 41 -> 5.122%; target between them closer to 41; set an exact tie instead
    expect(pick.put.strike).toBe(41);
    const tie = pickPut([put(40, 2.0, 2.0), put(50, 2.5, 2.5)], S)!;
    expect(tie.put.strike).toBe(40);
  });
  it('drops unusable or illiquid quotes; empty chain gives null', () => {
    expect(pickPut([put(40, 0, 0.1)], S)).toBeNull();
    expect(pickPut([put(40, 2, 2.1)], S, () => false)).toBeNull();
    expect(pickPut([], S)).toBeNull();
  });
  it('exit is a GTC buy-to-close at 50% of the premium', () => {
    expect(exitLimitPrice(2.0)).toBe(1);
    expect(exitLimitPrice(1.35)).toBe(0.68);
  });
});

describe('isolation (import boundary)', () => {
  it('lib/market-movers imports nothing outside its own folder', () => {
    const dir = join(__dirname, '..');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const s of specs) expect(s.startsWith('./'), `${f} imports ${s}`).toBe(true);
    }
  });
});
