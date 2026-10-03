// lib/discovery/normalized/__tests__/secValuationHistory.test.ts

import { describe, expect, it } from 'vitest';
import { validMetric } from '../../metrics';
import { PE_HISTORY_METRIC_IDS, buildSecFundamentals, compactCompanyFacts } from '../sec';
import { discountToMedianPct } from '../sec/valuationHistory';
import type { SecFundamentalsResult } from '../sec';
import { epochDayOfDateString } from '../dates';
import type { DailyBar } from '../technicals';
import { addRow, makeCompanyFacts, plusDays, rowsOf } from './secFixtures';
import type { RawFacts } from './secFixtures';

const NOW = '2026-10-03T14:00:00.000Z';
const PRICE = validMetric('price_last_close', 50, '2026-10-02T00:00:00.000Z', { provider: 'y' });

function weekdayCloses(from: string, to: string, price = 50): DailyBar[] {
  const bars: DailyBar[] = [];
  const end = epochDayOfDateString(to) as number;
  for (let d = epochDayOfDateString(from) as number; d <= end; d += 1) {
    const weekday = (d + 4) % 7; // 1970-01-01 was a Thursday (4)
    if (weekday === 0 || weekday === 6) continue;
    bars.push({ t: d * 86400, c: price });
  }
  return bars;
}

function run(raw: RawFacts, closes: DailyBar[] | null): SecFundamentalsResult {
  const compacted = compactCompanyFacts(raw, '0001234567');
  if (!compacted.ok) throw new Error('fixture rejected');
  return buildSecFundamentals(compacted.compact, { now: NOW, price: PRICE, closes, submissions: null });
}

const FULL = weekdayCloses('2021-06-01', '2026-10-02');

describe('P/E history metrics', () => {
  it('computes median, percentile and discount for 3y and 5y from daily closes and as-published EPS', () => {
    const r = run(makeCompanyFacts(), FULL);
    PE_HISTORY_METRIC_IDS.forEach((id) => expect(r.metrics[id].validity, id).toBe('VALID'));
    // Independent recomputation from the observations the builder exposes.
    const obs = r.observations;
    expect(obs.length).toBeGreaterThan(10);
    const peNow = (r.metrics.pe_ttm as { value: number }).value;
    const recompute = (years: number): { median: number; percentile: number } => {
      const last = FULL[FULL.length - 1].t;
      const start = last - years * 365 * 86400;
      const pes: number[] = [];
      FULL.filter((b) => b.t >= start).forEach((bar) => {
        const day = new Date(bar.t * 1000).toISOString().slice(0, 10);
        const usable = obs.filter((o) => o.availableFrom <= day);
        if (usable.length === 0) return;
        const latest = usable[usable.length - 1];
        if (latest.epsTtm > 0) pes.push(bar.c / latest.epsTtm);
      });
      pes.sort((a, b) => a - b);
      const mid = Math.floor(pes.length / 2);
      const median = pes.length % 2 ? pes[mid] : (pes[mid - 1] + pes[mid]) / 2;
      return { median, percentile: (pes.filter((p) => p <= peNow).length / pes.length) * 100 };
    };
    [3, 5].forEach((years) => {
      const expected = recompute(years);
      const med = (r.metrics[`pe_ttm_median_${years}y`] as { value: number }).value;
      const pct = (r.metrics[`pe_ttm_percentile_${years}y`] as { value: number }).value;
      const disc = (r.metrics[`pe_ttm_discount_to_median_${years}y_pct`] as { value: number }).value;
      expect(med).toBeCloseTo(expected.median, 6);
      expect(pct).toBeCloseTo(expected.percentile, 6);
      expect(disc).toBeCloseTo(((expected.median - peNow) / expected.median) * 100, 6);
    });
    // Earnings grew while the price was flat, so today's multiple is the cheapest in its own history.
    expect((r.metrics.pe_ttm_discount_to_median_5y_pct as { value: number }).value).toBeGreaterThan(0); // cheaper than median = positive discount
  });

  it('only uses a period once it was public (no look-ahead to periods not yet filed)', () => {
    const r = run(makeCompanyFacts(), FULL);
    r.observations.forEach((o) => expect(o.availableFrom > o.periodEnd).toBe(true));
  });

  it('is UNAVAILABLE when the daily price history does not cover the window', () => {
    const short = weekdayCloses('2025-09-01', '2026-10-02');
    const r = run(makeCompanyFacts(), short);
    PE_HISTORY_METRIC_IDS.forEach((id) => {
      expect(r.metrics[id].validity, id).toBe('UNAVAILABLE');
      expect((r.metrics[id] as { reason?: string }).reason, id).toContain('INSUFFICIENT_PRICE_HISTORY');
    });
  });

  it('is UNAVAILABLE without price history, and blocked when the current P/E is not VALID', () => {
    PE_HISTORY_METRIC_IDS.forEach((id) => expect(run(makeCompanyFacts(), null).metrics[id].validity, id).not.toBe('VALID'));
    const compacted = compactCompanyFacts(makeCompanyFacts(), '1');
    if (!compacted.ok) throw new Error('fixture rejected');
    const noPrice = buildSecFundamentals(compacted.compact, { now: NOW, price: null, closes: FULL, submissions: null });
    PE_HISTORY_METRIC_IDS.forEach((id) => expect(noPrice.metrics[id].validity, id).not.toBe('VALID'));
  });

  it('fails closed on a suspected unrestated split: older observations are excluded, not rescaled', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
      if (row.end <= '2022-12-31') row.val = 250; // share count doubled afterwards: looks like a 2:1 split not restated
    });
    const r = run(raw, FULL);
    expect(r.diagnostics.excludedObservations.length).toBeGreaterThan(0);
    expect(r.diagnostics.excludedObservations.every((e) => e.reason === 'SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED')).toBe(true);
    expect(r.observations.every((o) => o.periodEnd > '2022-12-31')).toBe(true);
    expect(r.metrics.pe_ttm_median_5y.validity).not.toBe('VALID');
    expect((r.metrics.pe_ttm_median_5y as { reason?: string }).reason).toBeTruthy();
  });

  it('a restated (latest-filed) EPS is what the history uses (documented look-ahead)', () => {
    const raw = makeCompanyFacts();
    const fy2022 = rowsOf(raw, 'EarningsPerShareDiluted', 'USD/shares').find((row) => row.end === '2022-12-31' && row.form === '10-K')!;
    addRow(raw, 'EarningsPerShareDiluted', 'USD/shares', { ...fy2022, val: fy2022.val + 0.1, form: '10-K/A', accn: 'amend', filed: '2024-06-15' });
    const r = run(raw, FULL);
    const o = r.observations.find((x) => x.periodEnd === '2022-12-31')!;
    expect(o.epsTtm).toBeCloseTo(fy2022.val + 0.1, 9);
    expect(o.availableFrom).toBe(plusDays('2022-12-31', 45)); // first-published date, not the amendment date
  });
});

describe('discount-to-median sign convention (G2b-B1): positive = discount, negative = premium', () => {
  it('discount: current 20 vs median 25 is +20', () => expect(discountToMedianPct(20, 25)).toBeCloseTo(20, 9));
  it('premium: current 30 vs median 25 is -20', () => expect(discountToMedianPct(30, 25)).toBeCloseTo(-20, 9));
  it('at median: 0', () => expect(discountToMedianPct(25, 25)).toBe(0));
  it('live AAPL pin: current above the median never yields a positive discount (38.2672 vs 34.3638 and 31.2508)', () => {
    expect(discountToMedianPct(38.2672, 34.3638)).toBeCloseTo(-11.359, 2);
    expect(discountToMedianPct(38.2672, 31.2508)).toBeCloseTo(-22.452, 2);
    [[40, 30], [30.01, 30], [100, 1]].forEach(([cur, med]) => expect(discountToMedianPct(cur, med)).toBeLessThan(0));
  });
  it('the built metric is negative when today\'s P/E is above every historical P/E (price rose, EPS flat)', () => {
    const raw = makeCompanyFacts();
    const expensive = weekdayCloses('2019-01-01', '2026-10-02', 50);
    const compacted = compactCompanyFacts(raw, '0001234567');
    if (!compacted.ok) throw new Error('fixture rejected');
    const r = buildSecFundamentals(compacted.compact, {
      now: NOW, price: validMetric('price_last_close', 5000, '2026-10-02T00:00:00.000Z', { provider: 'y' }), closes: expensive, submissions: null,
    });
    const d = r.metrics.pe_ttm_discount_to_median_3y_pct;
    expect(d.validity).toBe('VALID');
    expect((d as { value: number }).value).toBeLessThan(0);
  });
});
