// lib/discovery/normalized/__tests__/optionMetrics.test.ts

import { describe, expect, it } from 'vitest';
import { CONTRACT_METRIC_IDS, VOLATILITY_EVENT_METRIC_IDS, buildContractMetrics, buildMarketMetrics, historicalIvMetrics } from '..';

const NOW = '2026-10-03T14:00:00.000Z';
const QUOTE = '2026-10-03T13:59:00.000Z';
const ctx = { now: NOW, quoteAsOf: QUOTE, provider: 'tastytrade' };

const call = {
  strikePrice: 80,
  bid: 24.0,
  ask: 24.4,
  delta: 0.85,
  theta: -0.02,
  vega: 0.3,
  implied_volatility: 0.31,
  open_interest: 1200,
  volume: 45,
  optionType: 'C',
  expirationDate: '2028-01-21',
};

function v(set: Record<string, any>, id: string): number {
  expect(set[id].validity, `${id}: ${JSON.stringify(set[id])}`).toBe('VALID');
  return set[id].value;
}

describe('buildContractMetrics', () => {
  it('derives the Section 25 metrics from a clean call', () => {
    const set = buildContractMetrics(call, 100, ctx);
    expect(Object.keys(set).sort()).toEqual([...CONTRACT_METRIC_IDS].sort());
    expect(v(set, 'contract_mid')).toBeCloseTo(24.2, 10);
    expect(v(set, 'contract_spread_pct_of_mid')).toBeCloseTo((0.4 / 24.2) * 100, 10);
    expect(v(set, 'contract_intrinsic_value')).toBe(20);
    expect(v(set, 'contract_extrinsic_value')).toBeCloseTo(4.2, 10);
    expect(v(set, 'contract_extrinsic_pct_of_mid')).toBeCloseTo((4.2 / 24.2) * 100, 10);
    expect(v(set, 'contract_debit_per_contract')).toBeCloseTo(2420, 8);
    expect(v(set, 'contract_dollar_delta')).toBeCloseTo(8500, 8);
    expect(v(set, 'contract_effective_leverage')).toBeCloseTo((0.85 * 100) / 24.2, 10);
    expect(v(set, 'contract_breakeven_price')).toBeCloseTo(104.2, 10);
    expect(v(set, 'contract_breakeven_move_pct')).toBeCloseTo(4.2, 10);
    expect(v(set, 'contract_dte')).toBe(Math.round((Date.parse('2028-01-21T00:00:00Z') - Date.parse('2026-10-03T00:00:00Z')) / 86400000));
    expect(v(set, 'contract_open_interest')).toBe(1200);
    expect(v(set, 'contract_volume')).toBe(45);
    expect(v(set, 'contract_theta')).toBe(-0.02);
    expect(v(set, 'contract_implied_volatility')).toBe(0.31);
  });

  it('converts plain numeric strings at the provider boundary but rejects anything else', () => {
    const set = buildContractMetrics({ ...call, bid: '24.0', ask: ' 24.4 ', delta: 'N/A', volume: '12abc' }, 100, ctx);
    expect(v(set, 'contract_mid')).toBeCloseTo(24.2, 10);
    expect(set.contract_delta.validity).toBe('INVALID');
    expect(set.contract_volume.validity).toBe('INVALID');
    expect(set.contract_dollar_delta.validity).toBe('INVALID');
    expect(set.contract_effective_leverage.validity).toBe('INVALID');
  });

  it('never turns a missing value into zero', () => {
    const { open_interest, bid, ...rest } = call;
    void open_interest;
    void bid;
    const set = buildContractMetrics(rest, 100, ctx);
    expect(set.contract_open_interest.validity).toBe('UNAVAILABLE');
    expect(set.contract_bid.validity).toBe('UNAVAILABLE');
    ['contract_mid', 'contract_spread_pct_of_mid', 'contract_extrinsic_value', 'contract_debit_per_contract', 'contract_breakeven_price'].forEach((id) => {
      expect(set[id].validity).toBe('UNAVAILABLE');
    });
    expect(buildContractMetrics({ ...call, open_interest: '' }, 100, ctx).contract_open_interest.validity).toBe('UNAVAILABLE');
  });

  it('allows a zero bid but flags a crossed market', () => {
    expect(v(buildContractMetrics({ ...call, bid: 0, ask: 1 }, 100, ctx), 'contract_mid')).toBe(0.5);
    const crossed = buildContractMetrics({ ...call, bid: 25, ask: 24 }, 100, ctx);
    expect(crossed.contract_mid.validity).toBe('INVALID');
    expect((crossed.contract_mid as any).reason).toBe('CROSSED_MARKET');
    expect(crossed.contract_debit_per_contract.validity).toBe('INVALID');
  });

  it('flags a mid below intrinsic value instead of reporting negative extrinsic', () => {
    const set = buildContractMetrics({ ...call, bid: 18, ask: 19 }, 100, ctx);
    expect(set.contract_extrinsic_value.validity).toBe('INVALID');
    expect((set.contract_extrinsic_value as any).reason).toBe('MID_BELOW_INTRINSIC');
    expect(set.contract_extrinsic_pct_of_mid.validity).toBe('INVALID');
  });

  it('refuses call-shaped numbers for a put, and never assumes a missing type', () => {
    const put = buildContractMetrics({ ...call, optionType: 'P' }, 100, ctx);
    CONTRACT_METRIC_IDS.forEach((id) => expect(put[id].validity).toBe('INVALID'));
    const { optionType, ...noType } = call;
    void optionType;
    const set = buildContractMetrics(noType, 100, ctx);
    expect(set.contract_bid.validity).toBe('VALID');
    ['contract_dollar_delta', 'contract_intrinsic_value', 'contract_extrinsic_value', 'contract_effective_leverage', 'contract_breakeven_price'].forEach((id) => {
      expect(set[id].validity).toBe('UNAVAILABLE');
      expect((set[id] as any).reason).toBe('OPTION_TYPE_MISSING');
      expect(set[id].id).toBe(id);
    });
  });

  it('does not accept an out-of-range delta, non-count open interest or past expiration', () => {
    expect(buildContractMetrics({ ...call, delta: 85 }, 100, ctx).contract_delta.validity).toBe('INVALID');
    expect(buildContractMetrics({ ...call, open_interest: 12.5 }, 100, ctx).contract_open_interest.validity).toBe('INVALID');
    expect(buildContractMetrics({ ...call, expirationDate: '2026-10-02' }, 100, ctx).contract_dte.validity).toBe('INVALID');
    expect(buildContractMetrics({ ...call, expirationDate: '2028-02-30' }, 100, ctx).contract_dte.validity).toBe('INVALID');
    expect(buildContractMetrics({ ...call, expirationDate: undefined }, 100, ctx).contract_dte.validity).toBe('UNAVAILABLE');
  });

  it('needs a valid underlying price for the price-dependent metrics', () => {
    [undefined, 0, -5, 'abc'].forEach((spot) => {
      const set = buildContractMetrics(call, spot, ctx);
      expect(set.contract_dollar_delta.validity).not.toBe('VALID');
      expect(set.contract_breakeven_move_pct.validity).not.toBe('VALID');
      expect(set.contract_mid.validity).toBe('VALID');
    });
  });

  it('goes STALE with an old quote and is never VALID without a quote time', () => {
    const stale = buildContractMetrics(call, 100, { ...ctx, quoteAsOf: '2026-10-03T12:00:00.000Z' });
    expect(stale.contract_bid.validity).toBe('STALE');
    expect(stale.contract_mid.validity).toBe('UNAVAILABLE');
    expect((stale.contract_mid as any).reason).toBe('INPUT_STALE:contract_bid');
    const untimed = buildContractMetrics(call, 100, { ...ctx, quoteAsOf: null });
    expect(untimed.contract_bid.validity).toBe('INVALID');
  });

  it('is UNAVAILABLE for every id when there is no contract', () => {
    const set = buildContractMetrics(null, 100, ctx);
    expect(Object.keys(set).sort()).toEqual([...CONTRACT_METRIC_IDS].sort());
    Object.values(set).forEach((m) => expect(m.validity).toBe('UNAVAILABLE'));
  });
});

describe('buildMarketMetrics / historical IV', () => {
  const payload = {
    'implied-volatility-index': '0.3412',
    'implied-volatility-30-day': '0.33',
    'historical-volatility-30-day': 0.28,
    'implied-volatility-index-rank': '0.62',
    'liquidity-rating': 4,
    beta: '1.18',
    earnings: { 'expected-report-date': '2026-10-28' },
  };
  const mctx = { now: NOW, payloadAsOf: QUOTE };

  it('normalizes the fields the app already reads', () => {
    const set = buildMarketMetrics(payload, mctx);
    expect(Object.keys(set).sort()).toEqual([...VOLATILITY_EVENT_METRIC_IDS].sort());
    expect(v(set, 'implied_volatility_index')).toBeCloseTo(0.3412, 10);
    expect(v(set, 'implied_volatility_30d')).toBeCloseTo(0.33, 10);
    expect(v(set, 'historical_volatility_30d')).toBe(0.28);
    expect(v(set, 'iv_rank_provider')).toBeCloseTo(0.62, 10);
    expect(v(set, 'underlying_liquidity_rating')).toBe(4);
    expect(v(set, 'underlying_beta')).toBeCloseTo(1.18, 10);
    expect(v(set, 'days_to_next_earnings')).toBe(25);
    expect(v(set, 'next_earnings_date' as any)).toBe('2026-10-28' as any);
  });

  it('never exposes an internal IV Rank or percentile (Section 26: no historical IV series)', () => {
    [buildMarketMetrics(payload, mctx), buildMarketMetrics(null, mctx), historicalIvMetrics()].forEach((set) => {
      expect(set.iv_rank_internal.validity).toBe('UNAVAILABLE');
      expect((set.iv_rank_internal as any).reason).toBe('NO_HISTORICAL_IV_SERIES');
      expect(set.iv_percentile_internal.validity).toBe('UNAVAILABLE');
    });
  });

  it('labels provider IV Rank with its source and rejects a percent-scaled value', () => {
    const set = buildMarketMetrics(payload, mctx);
    expect((set.iv_rank_provider as any).provenance).toEqual({ provider: 'tastytrade', field: 'implied-volatility-index-rank' });
    expect(buildMarketMetrics({ ...payload, 'implied-volatility-index-rank': '62' }, mctx).iv_rank_provider.validity).toBe('INVALID');
  });

  it("does not substitute 'beta-60-day' for beta", () => {
    const { beta, ...rest } = payload;
    void beta;
    expect(buildMarketMetrics({ ...rest, 'beta-60-day': '1.4' }, mctx).underlying_beta.validity).toBe('UNAVAILABLE');
  });

  it('flags a past or malformed report date and treats a missing one as UNAVAILABLE', () => {
    const past = buildMarketMetrics({ ...payload, earnings: { 'expected-report-date': '2026-10-01' } }, mctx);
    expect(past.days_to_next_earnings.validity).toBe('INVALID');
    expect(past.next_earnings_date.validity).toBe('INVALID');
    expect(buildMarketMetrics({ ...payload, earnings: { 'expected-report-date': 'soon' } }, mctx).next_earnings_date.validity).toBe('INVALID');
    expect(buildMarketMetrics({ ...payload, earnings: {} }, mctx).days_to_next_earnings.validity).toBe('UNAVAILABLE');
    expect(buildMarketMetrics({ ...payload, earnings: undefined }, mctx).next_earnings_date.validity).toBe('UNAVAILABLE');
  });

  it('is UNAVAILABLE without a payload, STALE when old, INVALID when untimed', () => {
    Object.values(buildMarketMetrics(null, mctx)).forEach((m) => expect(m.validity).toBe('UNAVAILABLE'));
    expect(buildMarketMetrics(payload, { now: NOW, payloadAsOf: '2026-09-20T14:00:00.000Z' }).implied_volatility_index.validity).toBe('STALE');
    expect(buildMarketMetrics(payload, { now: NOW, payloadAsOf: null }).implied_volatility_index.validity).toBe('INVALID');
  });
});
