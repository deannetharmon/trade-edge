// lib/portfolio-data/__tests__/buyingPower.test.ts
//
// BAL-0001/0002/0003: golden fixture from the redacted Tastytrade balances + requirements sample (2026-10-12, Reg T account).

import { describe, expect, it } from 'vitest';
import sample from '@/test/fixtures/tastytradeBuyingPower20261012.json';
import { buildBpModel, planFreeUp } from '@/lib/portfolio-data/buyingPower';

const NOW = new Date('2026-10-12T17:20:00.000Z');
const model = () => buildBpModel(sample.balances.data, sample.requirements.data, NOW);

describe('buildBpModel', () => {
  it('reads the account totals', () => {
    const m = model();
    expect(m.netLiq).toBeCloseTo(44478.62, 2);
    expect(m.optionBpLeft).toBeCloseTo(13910.877, 3);
    expect(m.bpUsed).toBeCloseTo(30656.963, 3);
    expect(m.capacity).toBeCloseTo(44567.84, 2);
    expect(m.usedPct).toBeCloseTo(68.8, 1);
    expect(m.accountType).toBe('Reg T');
  });

  it('reconciles per-ticker requirements plus other to buying power used', () => {
    const m = model();
    const sum = m.tickers.reduce((s, t) => s + t.requirement, 0);
    expect(sum).toBeCloseTo(29736.838, 3);
    expect(m.otherRequirement).toBeCloseTo(920.125, 3);
    expect(sum + m.otherRequirement).toBeCloseTo(m.bpUsed, 3);
  });

  it('orders tickers by requirement and assigns concentration tiers', () => {
    const m = model();
    expect(m.tickers.slice(0, 3).map(t => t.symbol)).toEqual(['GGLL', 'SOXL', 'TQQQ']);
    const tier = (s: string) => m.tickers.find(t => t.symbol === s)!.tier;
    expect(tier('GGLL')).toBe('red');
    expect(tier('SOXL')).toBe('red');
    expect(tier('TQQQ')).toBe('amber');
    expect(tier('METU')).toBe('normal');
  });

  it('measures the leveraged-ETF cluster', () => {
    const m = model();
    expect(m.clusterRequirement).toBeCloseTo(28847.5, 2);
    expect(m.clusterSharePct).toBeCloseTo(94.1, 1);
  });

  it('computes open P/L from open vs last close and DTE by calendar day', () => {
    const m = model();
    const soxl = m.tickers.find(t => t.symbol === 'SOXL')!;
    expect(soxl.openPL).toBeCloseTo(43, 2);
    expect(soxl.holdings[0].legs[0].dte).toBe(25);
    expect(m.tickers.find(t => t.symbol === 'MRNA')!.openPL).toBeCloseTo(-2313, 2);
  });

  it('flags a cash-secured put only when the requirement equals strike x 100', () => {
    const m = model();
    expect(m.tickers.find(t => t.symbol === 'GGLL')!.cashSecured).toBe(true);
    expect(m.tickers.find(t => t.symbol === 'SOXL')!.cashSecured).toBe(false);
  });

  it('handles an account with no positions', () => {
    const m = buildBpModel({ 'net-liquidating-value': '1000', 'derivative-buying-power': '1000', 'used-derivative-buying-power': '0' }, {}, NOW);
    expect(m.tickers).toEqual([]);
    expect(m.otherRequirement).toBe(0);
    expect(m.clusterSharePct).toBe(0);
    expect(planFreeUp(m, 500).primary.picks).toEqual([]);
  });
});

describe('planFreeUp', () => {
  it('picks the best value no-loss close and meets a $5,000 target', () => {
    const { primary } = planFreeUp(model(), 5000);
    expect(primary.picks.map(p => p.underlying)).toEqual(['SOXL']);
    expect(primary.freed).toBeCloseTo(7767.75, 2);
    expect(primary.givesUp).toBeCloseTo(412, 2);
    expect(primary.realized).toBeCloseTo(43, 2);
    expect(primary.meetsTarget).toBe(true);
    expect(primary.optionBpLeftAfter).toBeCloseTo(21678.627, 2);
    expect(primary.usedPctAfter).toBeCloseTo(51.4, 1);
  });

  it('warns when a pick raises a red-tier ticker and offers a reduce-largest alternative', () => {
    const { primary, alternative } = planFreeUp(model(), 5000);
    expect(primary.warnings.some(w => w.startsWith('GGLL rises from 31% to 42%'))).toBe(true);
    expect(alternative?.picks.map(p => p.underlying)).toEqual(['GGLL']);
    expect(alternative?.freed).toBeCloseTo(9600, 2);
  });

  it('uses loss-realizing candidates only after no-loss ones are exhausted', () => {
    const { primary } = planFreeUp(model(), 20000);
    expect(primary.picks.map(p => p.underlying).slice(0, 2)).toEqual(['SOXL', 'GGLL']);
    expect(primary.picks.some(p => p.realizesLoss)).toBe(true);
    expect(primary.warnings).toContain('Plan realizes a loss');
  });

  it('locks shares that back an open covered call', () => {
    const req = {
      groups: [{
        'underlying-symbol': 'ABC', 'margin-requirement': '5000',
        groups: [
          { description: 'LONG_UNDERLYING', 'margin-requirement': '2000', 'position-entries': [{ 'instrument-symbol': 'ABC', 'instrument-type': 'Equity', quantity: '100', 'average-open-price': '20', 'close-price': '20' }] },
          { description: 'COVERED_CALL', 'margin-requirement': '0', 'position-entries': [{ 'instrument-symbol': 'ABC  261120C00025000', 'instrument-type': 'Equity Option', quantity: '-1', 'average-open-price': '1', 'close-price': '0.5', 'strike-price': '25', 'option-type': 'C', 'expiration-date': '2026-11-20' }] },
        ],
      }],
    };
    const m = buildBpModel({ 'derivative-buying-power': '1000', 'used-derivative-buying-power': '5000' }, req, NOW);
    expect(planFreeUp(m, 1000).primary.picks).toEqual([]);
  });
});
