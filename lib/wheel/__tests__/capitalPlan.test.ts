// lib/wheel/__tests__/capitalPlan.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- golden fixtures (Alan) and boundary cases for the capital plan arithmetic.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_PARAMS,
  allocate,
  cashForOnePutCents,
  computeLimits,
  contractsThatFit,
  fitsAtAccountCents,
  formatBps,
  formatCents,
  formatPctTenths,
  formatUnlock,
  isLeveragedEtf,
  isOverridden,
  maxCashPerNameCents,
  monthsToUnlock,
  resolveParams,
  stressLossCents,
  summarizeStress,
  validateParams,
  type PlanParams,
} from '../capitalPlan';

const dollars = (d: number) => Math.round(d * 100);
const balanced = resolveParams();
const careful = resolveParams({ profile: 'careful' });
const concentrated = resolveParams({ profile: 'concentrated' });

describe('defaults and overrides', () => {
  it('an empty plan resolves to every default', () => {
    expect(resolveParams({})).toEqual(DEFAULT_PLAN_PARAMS);
    expect(resolveParams(null)).toEqual(DEFAULT_PLAN_PARAMS);
  });

  it('an override wins and the rest stay default', () => {
    const p = resolveParams({ reserveBps: 500 });
    expect(p.reserveBps).toBe(500);
    expect(p.spreadCapBps).toBe(DEFAULT_PLAN_PARAMS.spreadCapBps);
  });

  it('reports a field as overridden only when it differs from the default', () => {
    expect(isOverridden({ reserveBps: 500 }, 'reserveBps')).toBe(true);
    expect(isOverridden({ reserveBps: 1000 }, 'reserveBps')).toBe(false);
    expect(isOverridden({}, 'reserveBps')).toBe(false);
  });
});

describe('limits at the default $50,000 account (Balanced)', () => {
  const limits = computeLimits(balanced);
  it('splits the account into reserve, spread cap and wheel cash', () => {
    expect(limits.reserveCents).toBe(dollars(5000));
    expect(limits.spreadCapCents).toBe(dollars(5000));
    expect(limits.singleSpreadCents).toBe(dollars(1000));
    expect(limits.wheelCashCents).toBe(dollars(40000));
    expect(limits.sectorLimitCents).toBe(dollars(17500));
  });
  it('sizes one name from the loss budget and the assumed drop', () => {
    expect(limits.maxCashPerNameCents).toBe(dollars(15000));
    expect(limits.highestStrikeDollars).toBe(150);
  });
  it('Careful and Concentrated', () => {
    expect(computeLimits(careful).maxCashPerNameCents).toBe(dollars(10000));
    expect(computeLimits(careful).highestStrikeDollars).toBe(100);
    expect(computeLimits(concentrated).maxCashPerNameCents).toBe(dollars(20000));
    expect(computeLimits(concentrated).highestStrikeDollars).toBe(200);
  });
  it('a custom loss budget is used', () => {
    expect(maxCashPerNameCents(resolveParams({ profile: 'custom', customLossBps: 1500 }))).toBe(dollars(25000));
  });
  it('a per-symbol drop override changes the limit (TQQQ at 0.70 -> 6,428.57 of cash, strike 64)', () => {
    const cash = maxCashPerNameCents(balanced, 7000);
    expect(cash).toBe(642_857);
    expect(Math.floor(cash / 10_000)).toBe(64);
  });
  it('other account sizes: A = 80,000', () => {
    const l = computeLimits(resolveParams({ accountCents: dollars(80000) }));
    expect(l.maxCashPerNameCents).toBe(dollars(24000));
    expect(l.reserveCents).toBe(dollars(8000));
    expect(l.spreadCapCents).toBe(dollars(8000));
    expect(l.wheelCashCents).toBe(dollars(64000));
  });
});

describe('one put: golden fixtures (Balanced, A = 50,000)', () => {
  const max = computeLimits(balanced).maxCashPerNameCents;
  const rows: [string, number, number, number, number][] = [
    // symbol, strike, cash dollars, contracts that fit, fits-at account dollars (cents rounded up)
    ['XLF', 51, 5100, 2, 1_700_000],
    ['XLE', 58, 5800, 2, 1_933_334],
    ['XLU', 37, 3700, 4, 1_233_334],
    ['XLP', 76, 7600, 1, 2_533_334],
    ['XLV', 159, 15900, 0, 5_300_000],
  ];
  it.each(rows)('%s at strike %d', (_symbol, strike, cash, fit, fitsAt) => {
    const cents = cashForOnePutCents(strike);
    expect(cents).toBe(dollars(cash));
    expect(contractsThatFit(max, cents)).toBe(fit);
    expect(fitsAtAccountCents(cents, balanced)).toBe(fitsAt);
  });

  it('a strike with cents converts exactly (37.5 -> 3,750 cents -> $3,750 of cash)', () => {
    expect(cashForOnePutCents(37.5)).toBe(dollars(3750));
  });

  it('boundary: cash exactly at the limit fits 1, one cent over fits 0', () => {
    expect(contractsThatFit(max, max)).toBe(1);
    expect(contractsThatFit(max, max + 1)).toBe(0);
  });

  it('Careful: XLU at 3,700 fits 2; Concentrated: XLV at 15,900 fits 1; Careful fits-at for XLV is 79,500', () => {
    expect(contractsThatFit(computeLimits(careful).maxCashPerNameCents, dollars(3700))).toBe(2);
    expect(contractsThatFit(computeLimits(concentrated).maxCashPerNameCents, dollars(15900))).toBe(1);
    expect(fitsAtAccountCents(dollars(15900), careful)).toBe(dollars(79500));
  });

  it('fits-at and the per-name limit agree at the boundary', () => {
    const cash = dollars(5800);
    const at = fitsAtAccountCents(cash, balanced);
    const l = (accountCents: number) => maxCashPerNameCents({ ...balanced, accountCents });
    expect(l(at)).toBeGreaterThanOrEqual(cash);
    expect(l(at - 1)).toBeLessThan(cash);
  });

  it('zero or negative inputs fit nothing', () => {
    expect(contractsThatFit(max, 0)).toBe(0);
    expect(contractsThatFit(0, 100)).toBe(0);
  });
});

describe('allocation and stress', () => {
  const limits = computeLimits(balanced);
  const inputs = [
    { symbol: 'XLF', sector: 'Financials', cashCents: dollars(5100), maxCashCents: limits.maxCashPerNameCents },
    { symbol: 'XLE', sector: 'Energy', cashCents: dollars(5800), maxCashCents: limits.maxCashPerNameCents },
    { symbol: 'XLU', sector: 'Utilities', cashCents: dollars(3700), maxCashCents: limits.maxCashPerNameCents },
    { symbol: 'XLP', sector: 'Staples', cashCents: dollars(7600), maxCashCents: limits.maxCashPerNameCents },
  ];

  it('gives each name min(per-name cap, cash left), in list order, so the later names are trimmed first', () => {
    const { rows, deployedCents } = allocate(inputs, limits.wheelCashCents, limits.sectorLimitCents);
    // XLF 2 (10,200), XLE 2 (11,600), XLU 4 (14,800) = 36,600; XLP fits 1 (7,600) but only 3,400 is left -> 0
    expect(rows.map((r) => r.contracts)).toEqual([2, 2, 4, 0]);
    expect(deployedCents).toBe(dollars(36600));
    expect(rows.map((r) => r.fitContracts)).toEqual([2, 2, 4, 1]);
  });

  it('the sample plan from the ticket (XLU trimmed to 2) is 36,800 with a 25% stress of 9,200 = 18.4%', () => {
    const list = [inputs[0], inputs[1], { ...inputs[2], maxCashCents: dollars(7400) }, inputs[3]];
    const { rows, deployedCents } = allocate(list, limits.wheelCashCents, limits.sectorLimitCents);
    expect(rows.map((r) => r.contracts)).toEqual([2, 2, 2, 1]);
    expect(deployedCents).toBe(dollars(36800));
    const s = summarizeStress(balanced, limits, deployedCents);
    expect(s.wheelLossCents).toBe(dollars(9200));
    expect(s.wheelLossPctTenths).toBe(184);
    expect(s.fullWheelLossCents).toBe(dollars(10000));
    expect(s.worstCaseCents).toBe(dollars(15000));
    expect(s.worstCasePctTenths).toBe(300);
  });

  it('the older fully-invested sample: 44,200 deployed at a 25% stress is 11,050 = 22.1% of 50,000', () => {
    expect(stressLossCents(dollars(44200), 2500)).toBe(dollars(11050));
    expect(formatPctTenths(Math.round((dollars(11050) * 1000) / dollars(50000)))).toBe('22.1%');
  });

  it('deployable cash exhausted: later names get only what is left', () => {
    const { rows } = allocate(inputs, dollars(12000), limits.sectorLimitCents);
    expect(rows.map((r) => r.contracts)).toEqual([2, 0, 0, 0]); // 10,200 used; 1,800 left buys nothing
  });

  it('the sector limit caps names in the same sector', () => {
    const same = [
      { symbol: 'AAA', sector: 'Tech', cashCents: dollars(5000), maxCashCents: dollars(15000) },
      { symbol: 'BBB', sector: 'Tech', cashCents: dollars(5000), maxCashCents: dollars(15000) },
    ];
    const { rows, bySector } = allocate(same, dollars(40000), dollars(12000));
    expect(rows.map((r) => r.contracts)).toEqual([2, 0]); // 15,000 would fit 3, but the sector room of 12,000 buys 2; the second Tech name gets 2,000 of room -> 0
    expect(bySector.Tech).toBeLessThanOrEqual(dollars(12000));
  });

  it('an empty list has zero stress', () => {
    const { deployedCents } = allocate([], limits.wheelCashCents, limits.sectorLimitCents);
    expect(deployedCents).toBe(0);
    expect(summarizeStress(balanced, limits, 0).wheelLossCents).toBe(0);
  });
});

describe('the trader\'s own contract counts', () => {
  const limits = computeLimits(balanced);
  const base = [
    { symbol: 'XLF', sector: 'XLF', cashCents: dollars(5250), maxCashCents: limits.maxCashPerNameCents },
    { symbol: 'NVDA', sector: 'NVDA', cashCents: dollars(20500), maxCashCents: limits.maxCashPerNameCents, forcedContracts: 1 },
    { symbol: 'AMZN', sector: 'AMZN', cashCents: dollars(22500), maxCashCents: limits.maxCashPerNameCents, forcedContracts: 1 },
  ];

  it('are placed as asked, first, outside the per-name limit; the rest share what is left', () => {
    const { rows, deployedCents } = allocate(base, limits.wheelCashCents, limits.sectorLimitCents);
    expect(rows.map((r) => [r.symbol, r.contracts, r.forced])).toEqual([['XLF', 0, false], ['NVDA', 1, true], ['AMZN', 1, true]]);
    expect(rows[1].fitContracts).toBe(0); // it does not fit; the count is the trader's choice
    expect(deployedCents).toBe(dollars(43000)); // more than the 40,000 of wheel cash: the tab warns
  });

  it('a forced name is placed before earlier names in the list can use the cash', () => {
    const { rows } = allocate([base[0], { ...base[1] }], dollars(30000), limits.sectorLimitCents);
    expect(rows.map((r) => r.contracts)).toEqual([1, 1]); // 30,000 - 20,500 = 9,500 left buys one XLF (5,250)
  });

  it('a forced count is not capped by the sector limit', () => {
    const { rows, bySector } = allocate([{ ...base[1] }], limits.wheelCashCents, dollars(10000));
    expect(rows[0].contracts).toBe(1);
    expect(bySector.NVDA).toBe(dollars(20500));
  });

  it('without a forced count nothing changes', () => {
    const plain = base.map(({ forcedContracts: _f, ...rest }) => rest);
    const { rows } = allocate(plain, limits.wheelCashCents, limits.sectorLimitCents);
    expect(rows.every((r) => !r.forced)).toBe(true);
  });
});

describe('months to unlock (simple monthly rate, ceil)', () => {
  const A = dollars(50000);
  it('XLV (53,000) and PLTR (58,700) at 0.75% a month', () => {
    expect(monthsToUnlock(dollars(53000), A, 75)).toEqual({ kind: 'months', months: 8 });
    expect(monthsToUnlock(dollars(58700), A, 75)).toEqual({ kind: 'months', months: 22 });
  });
  it('the ticket originally used 0.72%, which gives 9 and 23', () => {
    expect(monthsToUnlock(dollars(53000), A, 72)).toEqual({ kind: 'months', months: 9 });
    expect(monthsToUnlock(dollars(58700), A, 72)).toEqual({ kind: 'months', months: 23 });
  });
  it('already fits: nothing to wait for, including the exact edge', () => {
    expect(monthsToUnlock(dollars(50000), A, 75)).toEqual({ kind: 'fits' });
    expect(monthsToUnlock(dollars(40000), A, 75)).toEqual({ kind: 'fits' });
  });
  it('g = 0 or negative is "not reached"', () => {
    expect(monthsToUnlock(dollars(53000), A, 0)).toEqual({ kind: 'not-reached' });
    expect(monthsToUnlock(dollars(53000), A, -5)).toEqual({ kind: 'not-reached' });
  });
  it('a tiny g does not overflow and is capped at 50 years', () => {
    expect(monthsToUnlock(dollars(53000), A, 0.0001)).toEqual({ kind: 'over-50-years' });
    expect(monthsToUnlock(dollars(53000), A, 1e-9)).toEqual({ kind: 'over-50-years' });
  });
  it('the exact edge: growing 1% a month, 100 -> 101 takes exactly 1 month, and 101.01 takes 2', () => {
    expect(monthsToUnlock(10_100, 10_000, 100)).toEqual({ kind: 'months', months: 1 });
    expect(monthsToUnlock(10_101, 10_000, 100)).toEqual({ kind: 'months', months: 2 });
  });
  it('formats each outcome', () => {
    expect(formatUnlock({ kind: 'fits' })).toBe('');
    expect(formatUnlock({ kind: 'months', months: 1 })).toBe('1 month');
    expect(formatUnlock({ kind: 'months', months: 8 })).toBe('8 months');
    expect(formatUnlock({ kind: 'not-reached' })).toBe('not reached');
    expect(formatUnlock({ kind: 'over-50-years' })).toBe('over 50 years');
  });
});

describe('validation: hard errors block, soft warnings only warn', () => {
  const v = (over: Partial<PlanParams>) => validateParams(resolveParams(over));
  it('the defaults are clean', () => {
    expect(v({})).toEqual({ errors: [], warnings: [] });
  });
  it.each([
    [{ accountCents: 0 }],
    [{ accountCents: -1 }],
    [{ reserveBps: -1 }],
    [{ reserveBps: 10_001 }],
    [{ reserveBps: 6000, spreadCapBps: 5000 }],
    [{ dropBps: 0 }],
    [{ targetDeltaBps: 0 }],
    [{ targetDeltaBps: 10_000 }],
    [{ dteMin: 50, dteMax: 40 }],
    [{ monthlyGrowthBps: Number.NaN }],
    [{ profile: 'custom', customLossBps: 0 }],
  ] as [Partial<PlanParams>][])('%j is a hard error', (over) => {
    expect(v(over).errors.length).toBeGreaterThan(0);
  });
  it.each([
    [{ profile: 'custom', customLossBps: 1500 } as Partial<PlanParams>],
    [{ dropBps: 1500 }],
    [{ reserveBps: 300 }],
    [{ spreadCapBps: 2000 }],
    [{ targetDeltaBps: 4000 }],
    [{ singleSpreadCapBps: 1500 }],
  ])('%j is only a warning, never an error', (over) => {
    const r = v(over);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('leveraged and inverse ETFs', () => {
  it('flags the known ones case-insensitively and leaves ordinary ETFs alone', () => {
    expect(isLeveragedEtf('TQQQ')).toBe(true);
    expect(isLeveragedEtf(' soxl ')).toBe(true);
    expect(isLeveragedEtf('XLF')).toBe(false);
    expect(isLeveragedEtf('QQQ')).toBe(false);
  });
});

describe('formatting', () => {
  it('cents', () => {
    expect(formatCents(dollars(5100))).toBe('$5,100');
    expect(formatCents(1_933_334)).toBe('$19,333.34');
    expect(formatCents(-500)).toBe('-$5');
  });
  it('basis points', () => {
    expect(formatBps(900)).toBe('9%');
    expect(formatBps(75)).toBe('0.75%');
    expect(formatBps(2000)).toBe('20%');
  });
});
