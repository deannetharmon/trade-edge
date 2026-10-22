// lib/scans/__tests__/quoteGuard.test.ts
//
// QUOTE-GUARD-0001 (Alan's fixtures): the Ranked scan must not rank a credit that only exists at mid.
// Golden fixture: SOXL Nov 20 2026 iron condor 63/58 puts + 175/180 calls, quotes and deltas read from the
// TastyTrade chain (market closed, 2026-10-22). The Ranked row used to show $2.99 (mid minus mid) while
// selling at the bid and buying at the ask is a $0.15 debit; the executable credit is $0.63.
// Fixed "today" is 2026-10-22 so the 29-day DTE does not drift.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exploreAllCandidatesForRank } from '../rank-scoring';
import { findBestICUnfiltered, findBestRankedIC } from '../spread-finder';
import { assessLegQuote, assessSpreadMarket, buildMarketCheck } from '../quoteQuality';
import { buildRankChecks, buildRankMarketFailReason } from '../rankChecks';
import { deriveQualificationState, deriveSpreadQualification, rankedGateKeysFor, RANKED_SPREAD_GATE_KEYS } from '../qualificationState';
import { DEFAULT_RULES } from '../constants';
import type { CheckResult, ScreenResult, SpreadCandidate } from '../types';

const EXP = '2026-11-20';
const SOXL_PRICE = 103.24;

const leg = (strikePrice: number, optionType: 'P' | 'C', bid: number, ask: number, delta: number, openInterest: number) => ({
  strikePrice, expirationDate: EXP, optionType, bid, ask, mid: (bid + ask) / 2, delta, openInterest,
  occSymbol: `SOXL ${strikePrice}${optionType}`, iv: 130.6,
});

const soxlChain = () => [
  leg(63, 'P', 1.45, 5.0, -0.1, 261),
  leg(58, 'P', 0.46, 1.5, -0.07, 2900),
  leg(175, 'C', 0.85, 2.27, 0.07, 838),
  leg(180, 'C', 0.7, 0.95, 0.05, 2210),
];

const metrics = { ivRank: 50, earningsExpectedDate: null, ivx: 130, expirationIvxMap: {} };
const explore = (chain: any[], price = SOXL_PRICE) =>
  exploreAllCandidatesForRank('TEST', metrics, { expirations: [EXP], chains: { [EXP]: chain }, isEtfOrIndex: false }, price, DEFAULT_RULES, undefined, false, DEFAULT_RULES as never);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T15:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('assessLegQuote / assessSpreadMarket', () => {
  const short = (bid: number | null, ask: number | null) => ({ label: '63P', role: 'short' as const, bid, ask });
  const long = (bid: number | null, ask: number | null) => ({ label: '58P', role: 'long' as const, bid, ask });

  it('a tight market is ok', () => {
    expect(assessLegQuote(short(1.2, 1.25), 0.5).status).toBe('ok');
  });
  it('a width exactly at the limit is ok; a cent over is wide, with the numbers in the reason', () => {
    expect(assessLegQuote(short(1.0, 1.5), 0.5).status).toBe('ok');
    const wide = assessLegQuote(short(1.0, 1.51), 0.5);
    expect(wide.status).toBe('wide');
    expect(wide.reason).toBe('63P is quoted 1.00 x 1.51 (0.51 wide, limit 0.50)');
  });
  it('fails closed: a short with no bid, a long with no ask, crossed, missing and non-finite quotes are invalid', () => {
    expect(assessLegQuote(short(0, 0.05), 0.5).status).toBe('invalid');
    expect(assessLegQuote(long(0, 0), 0.5).status).toBe('invalid');
    expect(assessLegQuote(long(0, 0), 0.5).reason).toContain('no ask to buy at');
    expect(assessLegQuote(short(1.3, 1.2), 0.5).status).toBe('invalid');
    expect(assessLegQuote(short(null, 1.2), 0.5).status).toBe('invalid');
    expect(assessLegQuote(short(Number.NaN, 1.2), 0.5).status).toBe('invalid');
  });
  it('a long leg may legitimately have a zero bid (a cheap far wing) as long as it has an ask', () => {
    expect(assessLegQuote(long(0, 0.05), 0.5).status).toBe('ok');
  });
  it('the spread status is the worst leg, invalid over wide over ok', () => {
    expect(assessSpreadMarket([short(1.2, 1.25), long(0.5, 0.55)], 0.5).status).toBe('ok');
    expect(assessSpreadMarket([short(1.0, 3.0), long(0.5, 0.55)], 0.5).status).toBe('wide');
    expect(assessSpreadMarket([short(1.0, 3.0), long(0, 0)], 0.5).status).toBe('invalid');
  });
  it('the market check is a pass with a reason when tight, and a fail that shows the worst leg when not', () => {
    const ok = buildMarketCheck(assessSpreadMarket([short(1.2, 1.25), long(0.5, 0.55)], 0.5));
    expect(ok.status).toBe('pass');
    const wide = buildMarketCheck(assessSpreadMarket([short(1.45, 5.0), long(0.46, 1.5)], 0.5));
    expect(wide.status).toBe('fail');
    expect(wide.value).toBe('wide market (63P 1.45 x 5.00)');
  });
});

describe('findBestRankedIC: SOXL golden fixture', () => {
  it('prices the condor at the executable credit, not at mid minus mid', () => {
    const c = findBestRankedIC(soxlChain(), EXP, SOXL_PRICE) as SpreadCandidate;
    expect(c).not.toBeNull();
    expect([c.shortStrike, c.longStrike, c.shortCallStrike, c.longCallStrike]).toEqual([63, 58, 175, 180]);
    // put: natural -0.05, mid 2.245 -> -0.05 + 0.25 * 2.295 = 0.52; call: natural -0.10, mid 0.735 -> 0.11
    expect(c.credit).toBe(0.52);
    expect(c.callCredit).toBe(0.11);
    expect(c.totalCredit).toBe(0.63);
    expect(c.midCredit).toBe(2.98);
    expect(c.naturalCredit).toBe(-0.15);
    expect(c.spreadFriction).toBe(3.13);
    expect(c.creditRatio).toBeCloseTo(0.104, 3); // put side, from the executable credit
    expect(c.roc).toBeCloseTo((0.63 / 4.37) * 100, 6); // 14.4%, not 149%
    expect(c.pop).toBeCloseTo(83, 6); // (1 - 0.10 - 0.07): independent of credit
  });

  it('flags the market: three legs are wider than the $0.50 limit for a $103 underlying', () => {
    const a = (findBestRankedIC(soxlChain(), EXP, SOXL_PRICE) as SpreadCandidate).marketAssessment!;
    expect(a.status).toBe('wide');
    expect(a.maxWidth).toBe(0.5);
    expect(a.legs.map(l => [l.label, l.status])).toEqual([['63P', 'wide'], ['58P', 'wide'], ['175C', 'wide'], ['180C', 'ok']]);
  });

  it('carries both sides\' quotes so the order ticket and audits can see them', () => {
    const c = findBestRankedIC(soxlChain(), EXP, SOXL_PRICE) as SpreadCandidate;
    expect([c.shortBid, c.shortAsk, c.longBid, c.longAsk]).toEqual([1.45, 5.0, 0.46, 1.5]);
    expect([c.shortCallBid, c.shortCallAsk, c.longCallBid, c.longCallAsk]).toEqual([0.85, 2.27, 0.7, 0.95]);
  });

  it('documents the old behavior stays put elsewhere: findBestICUnfiltered (Targeted, checklist) still prices at mid', () => {
    const old = findBestICUnfiltered(soxlChain(), EXP, SOXL_PRICE) as SpreadCandidate;
    expect(old.totalCredit).toBe(2.99);
  });

  it('a long leg with no ask is flagged invalid instead of inflating the credit silently', () => {
    const chain = soxlChain();
    chain[1] = leg(58, 'P', 0, 0, -0.07, 2900);
    const c = findBestRankedIC(chain, EXP, SOXL_PRICE) as SpreadCandidate;
    expect(c.marketAssessment!.status).toBe('invalid');
    expect(buildRankMarketFailReason(c)).toContain('No valid quote: ');
    expect(buildRankMarketFailReason(c)).toContain('58P has no ask to buy at');
  });

  it('requires the short call to sit above the short put', () => {
    const chain = [leg(63, 'P', 1.45, 1.5, -0.1, 261), leg(58, 'P', 0.46, 0.5, -0.07, 2900), leg(60, 'C', 0.85, 0.9, 0.07, 838), leg(65, 'C', 0.7, 0.75, 0.05, 2210)];
    expect(findBestRankedIC(chain, EXP, SOXL_PRICE)).toBeNull();
  });
});

describe('findBestRankedIC: tight markets and wing preference', () => {
  const tight = () => [
    leg(63, 'P', 1.175, 1.225, -0.1, 261), leg(58, 'P', 0.575, 0.625, -0.07, 2900),
    leg(175, 'C', 0.875, 0.925, 0.07, 838), leg(180, 'C', 0.475, 0.525, 0.05, 2210),
  ];

  it('tight markets: the market is ok and the executable credit sits just under mid', () => {
    const c = findBestRankedIC(tight(), EXP, SOXL_PRICE) as SpreadCandidate;
    expect(c.marketAssessment!.status).toBe('ok');
    // put: natural 0.55, mid 0.60 -> 0.56 (0.5625); call: natural 0.35, mid 0.40 -> 0.36 (0.3625)
    expect(c.credit).toBe(0.56);
    expect(c.callCredit).toBe(0.36);
    expect(c.totalCredit).toBe(0.92);
    expect(c.midCredit).toBe(1.0);
    expect(c.naturalCredit).toBe(0.9);
  });

  it('prefers a wing with usable quotes over a wider-market wing with a higher POP', () => {
    const chain = [
      ...soxlChain().filter(l => l.optionType === 'P'), // 63/58 puts, both wide, far OTM = highest POP
      leg(95, 'P', 4.0, 4.1, -0.4, 900), leg(90, 'P', 2.4, 2.5, -0.3, 900), // tight near-the-money wing
      leg(120, 'C', 2.0, 2.1, 0.3, 900), leg(125, 'C', 1.1, 1.2, 0.22, 900),
    ];
    const c = findBestRankedIC(chain, EXP, SOXL_PRICE) as SpreadCandidate;
    expect([c.shortStrike, c.longStrike]).toEqual([95, 90]);
    expect(c.marketAssessment!.status).toBe('ok');
  });
});

describe('Ranked rows: the market check is a gate that disqualifies', () => {
  it('the SOXL iron condor row is not qualified, shows the numbers, and leaves Best Opportunities', () => {
    const row = explore(soxlChain()).find(r => r.bestCandidate?.strategy === 'IC') as ScreenResult;
    expect(row).toBeDefined();
    expect(row.bestCandidate!.totalCredit).toBe(0.63);
    expect(row.checks.market!.status).toBe('fail');
    expect(row.checks.market!.value).toBe('wide market (63P 1.45 x 5.00)');
    expect(row.qualified).toBe(false);
    expect(row.failReasons.some(f => f.startsWith('Wide market: 63P is quoted 1.45 x 5.00'))).toBe(true);
    const derived = deriveSpreadQualification(row)!;
    expect(derived.state).toBe('disqualified');
    expect(derived.failing).toContain('market');
  });

  it('a tight-market chain passes the market check', () => {
    const chain = [
      leg(63, 'P', 1.175, 1.225, -0.1, 261), leg(58, 'P', 0.575, 0.625, -0.07, 2900),
      leg(175, 'C', 0.875, 0.925, 0.07, 838), leg(180, 'C', 0.475, 0.525, 0.05, 2210),
    ];
    const rows = explore(chain);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.checks.market!.status).toBe('pass');
      expect(deriveSpreadQualification(r)!.failing).not.toContain('market');
    }
  });

  it('the BPS row prefers a width whose quotes are usable, even with a lower credit ratio', () => {
    // 95P short: width 5 uses the wide 90P (higher credit ratio), width 10 uses the tight 85P.
    const chain = [
      leg(95, 'P', 4.0, 4.1, -0.4, 900), leg(90, 'P', 1.0, 2.0, -0.3, 900), leg(85, 'P', 1.4, 1.5, -0.2, 900),
    ];
    const row = explore(chain).find(r => r.bestCandidate?.strategy === 'BPS' && r.bestCandidate.shortStrike === 95) as ScreenResult;
    expect(row).toBeDefined();
    expect(row.bestCandidate!.longStrike).toBe(85);
    expect(row.bestCandidate!.marketAssessment!.status).toBe('ok');
    expect(row.checks.market!.status).toBe('pass');
  });

  it('the BPS row with only a wide market is kept, disqualified, with the reason', () => {
    const chain = [leg(95, 'P', 4.0, 4.1, -0.4, 900), leg(90, 'P', 1.0, 2.0, -0.3, 900)];
    const row = explore(chain).find(r => r.bestCandidate?.strategy === 'BPS' && r.bestCandidate.shortStrike === 95) as ScreenResult;
    expect(row.checks.market!.status).toBe('fail');
    expect(row.qualified).toBe(false);
  });
});

describe('gate wiring is additive', () => {
  const pass: CheckResult = { status: 'pass', value: 'x', reason: 'x' };
  const fail: CheckResult = { status: 'fail', value: 'x', reason: 'x' };
  const allPass = { ivr: pass, earnings: pass, oi: pass, roc: pass };

  it('a row without a market check keeps its previous state (Targeted rows, rows saved before this check)', () => {
    expect(rankedGateKeysFor(allPass)).toBe(RANKED_SPREAD_GATE_KEYS);
    expect(deriveQualificationState(allPass, rankedGateKeysFor(allPass)).state).toBe('qualified');
  });
  it('a row with a failing market check is disqualified and names it; a passing one is unaffected', () => {
    const failing = { ...allPass, market: fail };
    expect(deriveQualificationState(failing, rankedGateKeysFor(failing))).toMatchObject({ state: 'disqualified', failing: ['market'] });
    const passing = { ...allPass, market: pass };
    expect(deriveQualificationState(passing, rankedGateKeysFor(passing)).state).toBe('qualified');
  });
  it('buildRankChecks adds the market check only when the candidate carries an assessment', () => {
    const base: SpreadCandidate = { strategy: 'BPS', expiration: EXP, dte: 29, shortStrike: 95, longStrike: 90, shortDelta: 0.2, shortOI: 500, longOI: 500, credit: 1.2, spreadWidth: 5, creditRatio: 0.24, roc: 30, pop: 75 } as SpreadCandidate;
    const checksBase = { ivr: pass, earnings: pass, oi: pass, delta: pass, credit: pass, roc: pass, pop: pass, iv: pass, emClearance: pass };
    expect(buildRankChecks(checksBase, base, DEFAULT_RULES, pass).market).toBeUndefined();
    const withAssessment = { ...base, marketAssessment: assessSpreadMarket([{ label: '95P', role: 'short', bid: 1, ask: 3 }, { label: '90P', role: 'long', bid: 0.5, ask: 0.6 }], 0.5) };
    expect(buildRankChecks(checksBase, withAssessment, DEFAULT_RULES, pass).market!.status).toBe('fail');
  });
});
