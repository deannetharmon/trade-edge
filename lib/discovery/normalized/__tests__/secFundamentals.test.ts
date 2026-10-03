// lib/discovery/normalized/__tests__/secFundamentals.test.ts

import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { evaluateCriterion, invalidMetric, summarizeDataCompleteness, validMetric } from '../../metrics';
import {
  SEC_CONCEPT_MAP_VERSION,
  SEC_METRIC_IDS,
  SEC_RESULT_METRIC_IDS,
  buildSecFundamentals,
  compactCompanyFacts,
  conceptMapFingerprintSource,
  unavailableSecFundamentals,
} from '../sec';
import type { SecBuildContext, SecFundamentalsResult } from '../sec';
import {
  DEC_FY_ENDS,
  SEP_FY_ENDS,
  WEEK_FY_ENDS,
  addRow,
  currentHalfEnd,
  dropTag,
  makeCompanyFacts,
  plusDays,
  rowsOf,
} from './secFixtures';
import type { RawFacts } from './secFixtures';

const NOW = '2026-10-03T14:00:00.000Z';
const PRICE = validMetric('price_last_close', 50, '2026-10-02T00:00:00.000Z', { provider: 'y' });

function run(raw: RawFacts, ctx: Partial<SecBuildContext> = {}): SecFundamentalsResult {
  const compacted = compactCompanyFacts(raw, '0001234567');
  if (!compacted.ok) throw new Error(`fixture rejected: ${compacted.reason}`);
  return buildSecFundamentals(compacted.compact, { now: NOW, price: PRICE, closes: null, submissions: null, ...ctx });
}

const value = (r: SecFundamentalsResult, id: string): number => {
  const m = r.metrics[id];
  if (m.validity !== 'VALID') throw new Error(`${id} is ${m.validity}: ${JSON.stringify(m)}`);
  return m.value as number;
};
const reasonOf = (r: SecFundamentalsResult, id: string): string => {
  const m = r.metrics[id] as { reason?: string };
  return m.reason || '';
};

// Hand-derived TTM values at the current half-year (see secFixtures.ts):
//  revenue 1600 + 880 - 800 = 1680; operating income 320 + 200 - 160 = 360; EPS 2.2 + 1.3 - 1.1 = 2.4
//  OCF 400 + 220 - 200 = 420; capex 80 + 44 - 40 = 84; D&A 48 + 27 - 24 = 51; interest 10 + 6 - 5 = 11
const EXPECT = {
  margin: (360 / 1680) * 100,
  fcf: 336,
  pe: 50 / 2.4,
  marketCap: 25000,
};

describe('SEC fundamentals: TTM construction', () => {
  it('builds TTM from FY(prev) + YTD(current) - YTD(prior) and derives the metrics', () => {
    const r = run(makeCompanyFacts());
    expect(r.status).toBe('OK');
    expect(value(r, 'operating_margin_ttm_pct')).toBeCloseTo(EXPECT.margin, 9);
    expect(value(r, 'fcf_ttm')).toBe(EXPECT.fcf);
    expect(value(r, 'fcf_margin_ttm_pct')).toBeCloseTo((336 / 1680) * 100, 9);
    expect(value(r, 'fcf_yield_pct')).toBeCloseTo((336 / EXPECT.marketCap) * 100, 9);
    expect(value(r, 'pe_ttm')).toBeCloseTo(EXPECT.pe, 9);
    expect(value(r, 'price_to_fcf')).toBeCloseTo(EXPECT.marketCap / 336, 9);
    expect(value(r, 'total_debt')).toBe(350);
    expect(value(r, 'net_debt')).toBe(230);
    expect(value(r, 'current_ratio')).toBeCloseTo(1.5, 9);
    expect(value(r, 'interest_coverage')).toBeCloseTo(360 / 11, 9);
    expect(value(r, 'ev_to_ebitda_ttm')).toBeCloseTo((25000 + 350 - 120) / (360 + 51), 9);
    expect(value(r, 'net_debt_to_ebitda')).toBeCloseTo(230 / 411, 9);
    expect(value(r, 'revenue_growth_yoy_ttm_pct')).toBeCloseTo((1680 / 1550 - 1) * 100, 9);
    expect(value(r, 'eps_growth_yoy_ttm_pct')).toBeCloseTo((2.4 / 2.1 - 1) * 100, 9);
    expect(value(r, 'operating_margin_change_yoy_pp')).toBeCloseTo((360 / 1680 - 310 / 1550) * 100, 9);
    expect(value(r, 'revenue_cagr_5y_pct')).toBeCloseTo((Math.pow(1600 / 1100, 1 / 5) - 1) * 100, 9);
    expect(value(r, 'eps_cagr_5y_pct')).toBeCloseTo((Math.pow(2.2 / 1.2, 1 / 5) - 1) * 100, 9);
    expect(value(r, 'operating_margin_trend_5y_pp')).toBeCloseTo(0, 9);
    expect(value(r, 'roic_v1_pct')).toBeGreaterThan(0);
  });

  it('never treats year-to-date cash flow as a quarter (cash flow exists only as YTD)', () => {
    const r = run(makeCompanyFacts());
    expect(value(r, 'fcf_ttm')).toBe(336); // 420 - 84; a quarter-style read would give 220 - 44 = 176
  });

  it('at a fiscal-year end TTM equals the fiscal year (Q4 is carried by the 10-K)', () => {
    const r = run(makeCompanyFacts({ currentHalf: false }), { now: '2026-03-01T00:00:00.000Z' });
    expect(value(r, 'operating_margin_ttm_pct')).toBeCloseTo(20, 9);
    expect(value(r, 'fcf_ttm')).toBe(400 - 80);
    expect(r.diagnostics.anchor?.bucket).toBe('FY');
  });

  it.each([
    ['September year end', SEP_FY_ENDS],
    ['52/53-week calendar', WEEK_FY_ENDS],
  ])('works for a %s (no calendar-quarter assumption)', (_name, ends) => {
    const r = run(makeCompanyFacts({ fyEnds: ends }), { now: '2026-06-01T00:00:00.000Z' });
    expect(r.status).toBe('OK');
    expect(value(r, 'operating_margin_ttm_pct')).toBeCloseTo(EXPECT.margin, 9);
    expect(value(r, 'fcf_ttm')).toBe(EXPECT.fcf);
    expect(value(r, 'eps_growth_yoy_ttm_pct')).toBeCloseTo((2.4 / 2.1 - 1) * 100, 9);
  });

  it('does not repeat or sum duplicate comparatives of the same period in later filings', () => {
    const r = run(makeCompanyFacts());
    expect(r.diagnostics.restatedPieces).toBe(0);
  });

  it('is UNAVAILABLE (not a guess) when the prior-year comparative period is absent', () => {
    const raw = makeCompanyFacts();
    const priorHalfEnd = plusDays(DEC_FY_ENDS[6], 1 + 181); // not used: prior-year half is the 2025 half
    void priorHalfEnd;
    dropTag(raw, 'Revenues', (row) => row.form === '10-Q' && row.end === plusDays(plusDays(DEC_FY_ENDS[5], 1), 181));
    const r = run(raw);
    expect(r.metrics.operating_margin_ttm_pct.validity).toBe('UNAVAILABLE');
    expect(r.diagnostics.anchor).not.toBeNull();
  });

  it('is deterministic', () => {
    const a = JSON.stringify(run(makeCompanyFacts()));
    const b = JSON.stringify(run(makeCompanyFacts()));
    expect(a).toBe(b);
  });
});

describe('SEC fundamentals: concept resolution', () => {
  it('follows a revenue tag migration across years', () => {
    const raw = makeCompanyFacts();
    // Older years reported under the legacy tag, newer under Revenues.
    const rows = rowsOf(raw, 'Revenues');
    const legacy = rows.filter((row) => row.end <= '2021-12-31');
    raw.facts['us-gaap'].Revenues.units.USD = rows.filter((row) => row.end > '2021-12-31');
    legacy.forEach((row) => addRow(raw, 'SalesRevenueNet', 'USD', row));
    const r = run(raw);
    expect(value(r, 'revenue_cagr_5y_pct')).toBeCloseTo((Math.pow(1600 / 1100, 1 / 5) - 1) * 100, 9);
  });

  it('marks equivalent revenue tags that disagree AMBIGUOUS and never picks one', () => {
    const raw = makeCompanyFacts();
    const fy2025 = rowsOf(raw, 'Revenues').find((row) => row.end === '2025-12-31' && row.form === '10-K')!;
    addRow(raw, 'RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', { ...fy2025, val: fy2025.val + 7, accn: 'conflict-1' });
    const r = run(raw);
    ['operating_margin_ttm_pct', 'fcf_margin_ttm_pct', 'revenue_cagr_5y_pct'].forEach((id) => {
      expect(r.metrics[id].validity, id).toBe('INVALID');
      expect(reasonOf(r, id), id).toContain('AMBIGUOUS_CONCEPT:');
    });
    // Metrics that do not depend on revenue are untouched.
    expect(r.metrics.fcf_ttm.validity).toBe('VALID');
    expect(r.diagnostics.itemIssues.revenue.status).toBe('AMBIGUOUS');
  });

  it('uses the first ORDERED capex tag, and falls back only when it is entirely absent', () => {
    const raw = makeCompanyFacts();
    const viaFallback = makeCompanyFacts();
    rowsOf(raw, 'PaymentsToAcquirePropertyPlantAndEquipment').forEach((row) => addRow(raw, 'PaymentsToAcquireProductiveAssets', 'USD', { ...row, val: row.val * 3, accn: `x-${row.accn}` }));
    expect(value(run(raw), 'fcf_ttm')).toBe(336); // first tag wins; the second tag's different value is ignored
    const fallbackRows = rowsOf(viaFallback, 'PaymentsToAcquirePropertyPlantAndEquipment');
    fallbackRows.forEach((row) => addRow(viaFallback, 'PaymentsToAcquireProductiveAssets', 'USD', row));
    dropTag(viaFallback, 'PaymentsToAcquirePropertyPlantAndEquipment');
    expect(value(run(viaFallback), 'fcf_ttm')).toBe(336);
  });

  it('reports a missing item as UNAVAILABLE with the item named, not as a failure', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, 'PaymentsToAcquirePropertyPlantAndEquipment');
    const r = run(raw);
    ['fcf_ttm', 'fcf_margin_ttm_pct', 'fcf_yield_pct', 'price_to_fcf'].forEach((id) => {
      expect(r.metrics[id].validity, id).toBe('UNAVAILABLE');
      expect(reasonOf(r, id), id).toContain('SEC_ITEM_NOT_REPORTED:capex');
    });
    expect(r.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
  });

  it('takes the latest filed value for a restated period and flags it in provenance and diagnostics', () => {
    const raw = makeCompanyFacts();
    const fy2025 = rowsOf(raw, 'Revenues').find((row) => row.end === '2025-12-31' && row.form === '10-K')!;
    addRow(raw, 'Revenues', 'USD', { ...fy2025, val: 1610, form: '10-K/A', accn: 'amend-1', filed: '2026-04-01' });
    const r = run(raw);
    expect(value(r, 'operating_margin_ttm_pct')).toBeCloseTo((360 / (1610 + 880 - 800)) * 100, 9);
    expect(r.diagnostics.restatedPieces).toBeGreaterThan(0);
    const prov = r.provenance.operating_margin_ttm_pct.find((p) => p.item === 'revenue' && p.role === 'FY_PREVIOUS')!;
    expect(prov.restated).toBe(true);
    expect(prov.form).toBe('10-K/A');
    expect(prov.accn).toBe('amend-1');
  });

  it('marks a same-day conflicting value AMBIGUOUS (cannot tell which is the later one)', () => {
    const raw = makeCompanyFacts();
    const fy2025 = rowsOf(raw, 'Revenues').find((row) => row.end === '2025-12-31' && row.form === '10-K')!;
    addRow(raw, 'Revenues', 'USD', { ...fy2025, val: 1611, accn: 'same-day' });
    const r = run(raw);
    expect(r.metrics.operating_margin_ttm_pct.validity).toBe('INVALID');
    expect(reasonOf(r, 'operating_margin_ttm_pct')).toContain('AMBIGUOUS_CONCEPT:revenue');
  });

  it('uses only accepted forms and counts what it dropped', () => {
    const raw = makeCompanyFacts();
    const row = rowsOf(raw, 'Revenues')[0];
    addRow(raw, 'Revenues', 'USD', { ...row, form: '8-K', val: 999999 });
    addRow(raw, 'Revenues', 'USD', { ...row, end: '2025-02-30', val: 5 });
    const r = run(raw);
    expect(r.diagnostics.droppedFacts.FORM_NOT_USED).toBe(1);
    expect(r.diagnostics.droppedFacts.DATE_INVALID).toBe(1);
  });
});

describe('SEC fundamentals: debt recipes (debt-v1)', () => {
  const swapDebt = (raw: RawFacts, build: (end: string, add: (tag: string, val: number) => void) => void): void => {
    ['LongTermDebt', 'ShortTermBorrowings'].forEach((tag) => {
      const keep = rowsOf(raw, tag).map((r) => r.end);
      dropTag(raw, tag);
      keep.forEach((end) => {
        build(end, (t, v) => addRow(raw, t, 'USD', { end, val: v, accn: `d-${t}-${end}`, fy: 0, fp: 'Q2', form: '10-Q', filed: plusDays(end, 35) }));
      });
    });
  };

  it('recipe A: LongTermDebt + ShortTermBorrowings', () => {
    expect(value(run(makeCompanyFacts()), 'total_debt')).toBe(350);
  });

  it('recipe B: noncurrent + current portions (+ optional short-term borrowings)', () => {
    const raw = makeCompanyFacts();
    swapDebt(raw, (_end, put) => {
      put('LongTermDebtNoncurrent', 250);
      put('LongTermDebtCurrent', 50);
      put('ShortTermBorrowings', 40);
    });
    expect(value(run(raw), 'total_debt')).toBe(340);
  });

  it('recipe C: noncurrent + DebtCurrent', () => {
    const raw = makeCompanyFacts();
    swapDebt(raw, (_end, put) => {
      put('LongTermDebtNoncurrent', 250);
      put('DebtCurrent', 70);
    });
    expect(value(run(raw), 'total_debt')).toBe(320);
  });

  it('is AMBIGUOUS when recipes A and B disagree about the long-term part', () => {
    const raw = makeCompanyFacts();
    swapDebt(raw, (_end, put) => {
      put('LongTermDebt', 300);
      put('LongTermDebtNoncurrent', 250);
      put('LongTermDebtCurrent', 40); // 290 != 300
    });
    const r = run(raw);
    expect(r.metrics.total_debt.validity).toBe('INVALID');
    expect(reasonOf(r, 'total_debt')).toContain('AMBIGUOUS_CONCEPT:totalDebt');
    expect(r.metrics.net_debt_to_ebitda.validity).toBe('INVALID');
    expect(r.metrics.roic_v1_pct.validity).toBe('INVALID');
  });

  it('a company that tags no debt at all is UNAVAILABLE, never zero debt', () => {
    const raw = makeCompanyFacts();
    swapDebt(raw, () => undefined);
    const r = run(raw);
    expect(r.metrics.total_debt.validity).toBe('UNAVAILABLE');
    expect(r.metrics.net_debt.validity).toBe('UNAVAILABLE');
    expect(r.metrics.ev_to_ebitda_ttm.validity).toBe('UNAVAILABLE');
  });
});

describe('SEC fundamentals: price, shares and market cap', () => {
  it('needs a VALID price: missing is UNAVAILABLE, invalid is INVALID', () => {
    const none = run(makeCompanyFacts(), { price: null });
    expect(none.metrics.pe_ttm.validity).toBe('UNAVAILABLE');
    expect(reasonOf(none, 'pe_ttm')).toContain('price_last_close');
    expect(none.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
    const bad = run(makeCompanyFacts(), { price: invalidMetric('price_last_close', 'x', 'BAR_CLOSE_INVALID') });
    expect(bad.metrics.pe_ttm.validity).toBe('INVALID');
    expect(bad.metrics.fcf_yield_pct.validity).toBe('INVALID');
  });

  it('rejects a cover-page share count that disagrees with weighted diluted shares by more than 25% (multi-class risk)', () => {
    const raw = makeCompanyFacts();
    raw.facts.dei.EntityCommonStockSharesOutstanding.units.shares[0].val = 900;
    const r = run(raw);
    expect(r.metrics.fcf_yield_pct.validity).toBe('INVALID');
    expect(reasonOf(r, 'fcf_yield_pct')).toBe('SHARES_INCONSISTENT');
    expect(r.metrics.ev_to_ebitda_ttm.validity).toBe('INVALID');
    expect(r.metrics.pe_ttm.validity).toBe('VALID'); // P/E needs price and EPS only
  });

  it('is UNAVAILABLE when the cover-page share count is missing or older than the period', () => {
    const missing = makeCompanyFacts();
    delete missing.facts.dei;
    expect(reasonOf(run(missing), 'fcf_yield_pct')).toContain('sharesOutstanding');
    const old = makeCompanyFacts();
    old.facts.dei.EntityCommonStockSharesOutstanding.units.shares[0].end = '2026-05-01';
    expect(reasonOf(run(old), 'fcf_yield_pct')).toContain('COVER_DATE_BEFORE_PERIOD_END');
  });
});

describe('SEC fundamentals: invalid earnings and freshness', () => {
  it('non-positive earnings are INVALID for P/E and growth, not a number', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, 'EarningsPerShareDiluted', 'USD/shares').forEach((row) => {
      if (row.end > '2025-12-31') row.val = -5;
    });
    const r = run(raw);
    expect(r.metrics.pe_ttm.validity).toBe('INVALID');
    expect(r.metrics.eps_growth_yoy_ttm_pct.validity).toBe('INVALID');
  });

  it('metrics become STALE once the newest filing is older than the freshness window', () => {
    const r = run(makeCompanyFacts(), { now: '2027-02-20T00:00:00.000Z' });
    expect(r.metrics.operating_margin_ttm_pct.validity).toBe('STALE');
    expect(evaluateCriterion('c', [r.metrics.operating_margin_ttm_pct], () => true).result).toBe('NOT_EVALUABLE');
  });

  it('asOf is the newest filing date among the facts used', () => {
    const m = run(makeCompanyFacts()).metrics.operating_margin_ttm_pct as { asOf: string };
    expect(m.asOf).toBe(`${plusDays(currentHalfEnd(), 35)}T00:00:00.000Z`);
  });
});

describe('SEC fundamentals: coverage and structure', () => {
  it('a payload with no revenue periods is INSUFFICIENT_FACTS with every metric UNAVAILABLE', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, 'Revenues');
    const r = run(raw);
    expect(r.status).toBe('INSUFFICIENT_FACTS');
    SEC_RESULT_METRIC_IDS.forEach((id) => expect(r.metrics[id].validity, id).toBe('UNAVAILABLE'));
  });

  it('non-US-GAAP payloads and wrong units are rejected / dropped explicitly', () => {
    expect(compactCompanyFacts({ facts: { 'ifrs-full': {} } }, '1')).toEqual({ ok: false, reason: 'NOT_US_GAAP_XBRL' });
    expect(compactCompanyFacts(null, '1')).toEqual({ ok: false, reason: 'SEC_PAYLOAD_INVALID' });
    const raw = makeCompanyFacts();
    raw.facts['us-gaap'].Revenues.units = { EUR: raw.facts['us-gaap'].Revenues.units.USD };
    const c = compactCompanyFacts(raw, '1');
    expect(c.ok && c.compact.dropped.UNEXPECTED_UNIT).toBeGreaterThan(0);
    expect(c.ok && c.compact.facts.some((f) => f.tag === 'Revenues')).toBe(false);
  });

  it('every metric id the result carries is declared, and only VALID metrics expose a value', () => {
    const r = run(makeCompanyFacts());
    expect(Object.keys(r.metrics).sort()).toEqual([...SEC_RESULT_METRIC_IDS].sort());
    Object.values(r.metrics).forEach((m) => {
      if (m.validity !== 'VALID') expect('value' in m).toBe(false);
    });
    expect(new Set(SEC_RESULT_METRIC_IDS).size).toBe(SEC_RESULT_METRIC_IDS.length);
  });

  it('unavailableSecFundamentals marks every id UNAVAILABLE with the reason (not covered is not an investment failure)', () => {
    const set = unavailableSecFundamentals('NOT_US_GAAP_XBRL');
    SEC_RESULT_METRIC_IDS.forEach((id) => {
      expect(set[id].validity).toBe('UNAVAILABLE');
      expect((set[id] as { reason?: string }).reason).toBe('NOT_US_GAAP_XBRL');
    });
    const outcome = evaluateCriterion('roic_floor', [set.roic_v1_pct], () => true);
    expect(outcome.result).toBe('NOT_EVALUABLE');
    const completeness = summarizeDataCompleteness(set, ['roic_v1_pct', 'pe_ttm'], ['roic_v1_pct']);
    expect(completeness.validCount).toBe(0);
  });

  it('provenance cites accession, form and filing date for every VALID SEC-derived metric', () => {
    const r = run(makeCompanyFacts());
    ['operating_margin_ttm_pct', 'fcf_ttm', 'pe_ttm', 'net_debt', 'ev_to_ebitda_ttm', 'roic_v1_pct'].forEach((id) => {
      expect(r.provenance[id]?.length, id).toBeGreaterThan(0);
      r.provenance[id].forEach((p) => {
        expect(p.accn).toBeTruthy();
        expect(p.form).toMatch(/^10-[KQ]/);
        expect(p.filed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  });

  it('exposes per-fiscal-year figures with nulls (not zeros) and the issue named', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, 'PaymentsToAcquirePropertyPlantAndEquipment', (row) => row.end === '2022-12-31');
    const r = run(raw);
    expect(r.annualSeries).toHaveLength(7);
    const y = r.annualSeries.find((p) => p.fiscalYearEnd === '2022-12-31')!;
    expect(y.capitalExpenditure).toBeNull();
    expect(y.freeCashFlow).toBeNull();
    expect(y.issues).toContain('MISSING:capex');
    expect(r.annualSeries[6].freeCashFlow).toBe(400 - 80);
  });

  it('sector classification comes from SIC and keeps its own freshness', () => {
    const ok = run(makeCompanyFacts(), { submissions: { sic: '3571', sicDescription: 'Electronic Computers', fetchedAt: '2026-10-03T00:00:00.000Z' } });
    expect(value(ok, 'sector_classification')).toBe('3571' as unknown as number);
    expect(run(makeCompanyFacts()).metrics.sector_classification.validity).toBe('UNAVAILABLE');
    const none = run(makeCompanyFacts(), { submissions: { sic: null, sicDescription: null, fetchedAt: '2026-10-03T00:00:00.000Z' } });
    expect(none.metrics.sector_classification.validity).toBe('UNAVAILABLE');
    const stale = run(makeCompanyFacts(), { submissions: { sic: '3571', sicDescription: null, fetchedAt: '2026-06-01T00:00:00.000Z' } });
    expect(stale.metrics.sector_classification.validity).toBe('STALE');
  });

  it('forward estimates, revisions, guidance and PEG are not produced here', () => {
    const r = run(makeCompanyFacts());
    ['pe_forward', 'peg_ratio', 'company_guidance', 'analyst_eps_revision_90d_pct', 'corporate_event_flags'].forEach((id) => expect(r.metrics[id]).toBeUndefined());
  });

  it('pins the concept map: any change to tags, units or modes must bump SECMAP-v and this fingerprint', () => {
    expect(SEC_CONCEPT_MAP_VERSION).toBe('SECMAP-v1.1');
    const hash = createHash('sha256').update(conceptMapFingerprintSource()).digest('hex').slice(0, 16);
    expect(hash).toBe('e93d5900bbdbf8da');
  });

  it('declares exactly the new SEC metric ids', () => {
    expect([...SEC_METRIC_IDS].sort()).toEqual(
      [
        'eps_cagr_5y_pct', 'eps_growth_yoy_ttm_pct', 'revenue_growth_yoy_ttm_pct', 'operating_margin_trend_5y_pp', 'operating_margin_change_yoy_pp',
        'total_debt', 'net_debt', 'current_ratio', 'interest_coverage', 'ev_to_ebitda_ttm', 'price_to_fcf', 'sector_classification',
        'pe_ttm_median_3y', 'pe_ttm_percentile_3y', 'pe_ttm_discount_to_median_3y_pct',
        'pe_ttm_median_5y', 'pe_ttm_percentile_5y', 'pe_ttm_discount_to_median_5y_pct',
      ].sort(),
    );
  });
});


// ---- Regression tests from the live AAPL smoke test (production, 2026-10-03) ----
describe('live-data regressions (AAPL smoke test)', () => {
  const setDebt = (raw: RawFacts, values: Record<string, number>): void => {
    ['LongTermDebt', 'ShortTermBorrowings', 'LongTermDebtNoncurrent', 'LongTermDebtCurrent', 'DebtCurrent'].forEach((tag) => dropTag(raw, tag));
    const ends = Array.from(new Set(rowsOf(raw, 'AssetsCurrent').map((r) => r.end)));
    ends.forEach((end) =>
      Object.keys(values).forEach((tag) => addRow(raw, tag, 'USD', { end, val: values[tag], accn: `d-${tag}-${end}`, fy: 0, fp: 'Q2', form: '10-Q', filed: plusDays(end, 35) })),
    );
  };

  it('a footnote LongTermDebt rounded to $0.1bn does not make debt AMBIGUOUS; the balance-sheet components are used', () => {
    const raw = makeCompanyFacts();
    // AAPL 2025-06-28: LongTermDebt 91,800 (rounded) vs noncurrent 82,430 + current 9,345 = 91,775.
    setDebt(raw, { LongTermDebt: 91_800, LongTermDebtNoncurrent: 82_430, LongTermDebtCurrent: 9_345 });
    const r = run(raw);
    expect(value(r, 'total_debt')).toBe(91_775);
    expect(r.provenance.total_debt.map((p) => p.role)).toEqual(['DEBT_B', 'DEBT_B']);
  });

  it('still fails closed when the recipes disagree by more than the tolerance', () => {
    const raw = makeCompanyFacts();
    setDebt(raw, { LongTermDebt: 100_000, LongTermDebtNoncurrent: 82_430, LongTermDebtCurrent: 9_345 });
    expect(run(raw).metrics.total_debt.validity).toBe('INVALID');
  });

  describe('per-share history on mixed split bases', () => {
    // Years before `breakAt` are on the pre-split basis: 4x the shares' inverse, i.e. shares / 4 and EPS x 4 (real structure:
    // older fiscal years keep pre-split figures because only later filings restate them as comparatives).
    const preSplit = (raw: RawFacts, olderThan: string): void => {
      rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
        if (row.end <= olderThan) row.val = 125;
      });
      rowsOf(raw, 'EarningsPerShareDiluted', 'USD/shares').forEach((row) => {
        if (row.end <= olderThan) row.val = row.val * 4;
      });
    };

    it('nulls pre-split annual EPS, names the issue, and leaves split-free metrics alone', () => {
      const raw = makeCompanyFacts();
      preSplit(raw, '2020-12-31');
      const r = run(raw);
      const byYear = (end: string) => r.annualSeries.find((p) => p.fiscalYearEnd === end)!;
      ['2019-12-31', '2020-12-31'].forEach((end) => {
        expect(byYear(end).dilutedEps, end).toBeNull();
        expect(byYear(end).issues, end).toContain('SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED:dilutedEps');
        expect(byYear(end).revenue, end).not.toBeNull();
      });
      expect(byYear('2021-12-31').dilutedEps).toBeCloseTo(1.4, 9);
      expect(value(r, 'revenue_cagr_5y_pct')).toBeCloseTo((Math.pow(1600 / 1100, 1 / 5) - 1) * 100, 9);
    });

    it('a split inside the six-year window makes EPS CAGR INVALID rather than mixing bases', () => {
      const raw = makeCompanyFacts();
      preSplit(raw, '2021-12-31');
      const r = run(raw);
      expect(r.metrics.eps_cagr_5y_pct.validity).toBe('INVALID');
      expect(reasonOf(r, 'eps_cagr_5y_pct')).toBe('SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED');
    });

    it('a split older than the six-year window does not block EPS CAGR', () => {
      const raw = makeCompanyFacts();
      preSplit(raw, '2019-12-31');
      const r = run(raw);
      expect(value(r, 'eps_cagr_5y_pct')).toBeCloseTo((Math.pow(2.2 / 1.2, 1 / 5) - 1) * 100, 9);
      expect(r.annualSeries[0].dilutedEps).toBeNull();
    });

    it('is UNAVAILABLE when the share count needed to verify the basis is missing', () => {
      const raw = makeCompanyFacts();
      dropTag(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', (row) => row.end === '2022-12-31');
      const r = run(raw);
      expect(r.metrics.eps_cagr_5y_pct.validity).toBe('UNAVAILABLE');
      expect(reasonOf(r, 'eps_cagr_5y_pct')).toContain('EPS_SPLIT_CHECK_NOT_POSSIBLE');
    });
  });
});

// ---- Quinn review round (a803512): current-basis guard, debt recipe rules, boundaries ----
describe('per-share basis at the current period (split after the latest 10-K)', () => {
  const H1_2025_END = plusDays('2025-01-01', 181);
  // Everything up to the latest fiscal year is on the pre-split basis (shares / 4, EPS x 4) EXCEPT the 2025 half-year
  // comparative, which the current 10-Q restates -- the structure a real post-10-K split produces.
  const splitAfterLatestTenK = (raw: RawFacts): void => {
    rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
      if (row.end <= '2025-12-31' && row.end !== H1_2025_END) row.val = 125;
    });
    rowsOf(raw, 'EarningsPerShareDiluted', 'USD/shares').forEach((row) => {
      if (row.end <= '2025-12-31' && row.end !== H1_2025_END) row.val = row.val * 4;
    });
  };

  it('makes P/E, EPS growth and the P/E history INVALID instead of mixing bases; share-free metrics are untouched', () => {
    const raw = makeCompanyFacts();
    splitAfterLatestTenK(raw);
    const r = run(raw);
    expect(r.metrics.pe_ttm.validity).toBe('INVALID');
    expect(reasonOf(r, 'pe_ttm')).toBe('SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED');
    expect(r.metrics.eps_growth_yoy_ttm_pct.validity).toBe('INVALID');
    expect(r.metrics.pe_ttm_median_5y.validity).not.toBe('VALID');
    expect(r.metrics.operating_margin_ttm_pct.validity).toBe('VALID');
    expect(r.metrics.fcf_ttm.validity).toBe('VALID');
    expect(r.diagnostics.itemIssues.epsBasis.status).toBe('INCONSISTENT');
  });

  it('a break between the prior fiscal year and the prior-year period blocks only EPS growth', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
      if (row.end === '2024-12-31') row.val = 125;
    });
    rowsOf(raw, 'EarningsPerShareDiluted', 'USD/shares').forEach((row) => {
      if (row.end === '2024-12-31') row.val = row.val * 4;
    });
    const r = run(raw);
    expect(r.metrics.pe_ttm.validity).toBe('VALID');
    expect(r.metrics.eps_growth_yoy_ttm_pct.validity).toBe('INVALID');
    expect(r.diagnostics.itemIssues.epsBasisPrior.status).toBe('INCONSISTENT');
  });

  it('is UNAVAILABLE (not VALID) when the share count needed to check the basis is missing', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', (row) => row.end === currentHalfEnd());
    const r = run(raw);
    expect(r.metrics.pe_ttm.validity).toBe('UNAVAILABLE');
    expect(reasonOf(r, 'pe_ttm')).toContain('EPS_SPLIT_CHECK_NOT_POSSIBLE');
  });

  describe('threshold boundary (SPLIT_SUSPECT_RATIO = 1.8; Ian owns the value)', () => {
    const setRatio = (raw: RawFacts, current: number, previous: number): void => {
      rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
        if (row.end === currentHalfEnd()) row.val = current;
        if (row.end === '2025-12-31') row.val = previous;
      });
    };
    it.each([
      ['1.79x is not a break', 179, 100, 'VALID'],
      ['exactly 1.8x is a break', 450, 250, 'INVALID'],
      ['a 2:1 reduction is a break', 250, 500, 'INVALID'],
    ])('%s', (_name, current, previous, expected) => {
      const raw = makeCompanyFacts();
      setRatio(raw, current as number, previous as number);
      expect(run(raw).metrics.pe_ttm.validity).toBe(expected);
    });
    it('KNOWN GAP (pinned for Ian): a 1.5x change (a 3:2 split) is below the threshold and is not flagged', () => {
      const raw = makeCompanyFacts();
      setRatio(raw, 150, 100);
      expect(run(raw).metrics.pe_ttm.validity).toBe('VALID');
    });
  });

  it('real issuance of 1.8x or more is labelled like a split (conservative)', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares').forEach((row) => {
      if (row.end >= '2023-12-31') row.val = 1000;
    });
    const r = run(raw);
    expect(r.metrics.eps_cagr_5y_pct.validity).toBe('INVALID');
    expect(reasonOf(r, 'eps_cagr_5y_pct')).toBe('SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED');
  });

  it('a missing share count for the oldest of the six years makes EPS CAGR UNAVAILABLE', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, 'WeightedAverageNumberOfDilutedSharesOutstanding', (row) => row.end === '2020-12-31' && row.form === '10-K');
    const r = run(raw);
    expect(r.metrics.eps_cagr_5y_pct.validity).toBe('UNAVAILABLE');
    expect(reasonOf(r, 'eps_cagr_5y_pct')).toContain('EPS_SPLIT_CHECK_NOT_POSSIBLE');
  });
});

describe('debt recipe rules (DEBT-v1.1)', () => {
  const setDebt = (raw: RawFacts, values: Record<string, number>): void => {
    ['LongTermDebt', 'ShortTermBorrowings', 'LongTermDebtNoncurrent', 'LongTermDebtCurrent', 'DebtCurrent', 'CommercialPaper'].forEach((tag) => dropTag(raw, tag));
    const ends = Array.from(new Set(rowsOf(raw, 'AssetsCurrent').map((r) => r.end)));
    ends.forEach((end) =>
      Object.keys(values).forEach((tag) => addRow(raw, tag, 'USD', { end, val: values[tag], accn: `d-${tag}-${end}`, fy: 0, fp: 'Q2', form: '10-Q', filed: plusDays(end, 35) })),
    );
  };
  const debt = (values: Record<string, number>): SecFundamentalsResult => {
    const raw = makeCompanyFacts();
    setDebt(raw, values);
    return run(raw);
  };

  it('only the first computable recipe is used: B beats C beats A; A and C alone use C (documented, not cross-checked)', () => {
    expect(value(debt({ LongTermDebtNoncurrent: 600, LongTermDebtCurrent: 400, DebtCurrent: 1500 }), 'total_debt')).toBe(1000); // B, C ignored
    expect(value(debt({ LongTermDebt: 1000, LongTermDebtNoncurrent: 900, DebtCurrent: 5 }), 'total_debt')).toBe(905); // C, A ignored
    expect(value(debt({ LongTermDebt: 1000 }), 'total_debt')).toBe(1000); // A fall-back
  });

  it('A and B: 1.9% apart passes, 2.1% apart fails closed', () => {
    expect(value(debt({ LongTermDebt: 1019, LongTermDebtNoncurrent: 600, LongTermDebtCurrent: 400 }), 'total_debt')).toBe(1000);
    expect(debt({ LongTermDebt: 1022, LongTermDebtNoncurrent: 600, LongTermDebtCurrent: 400 }).metrics.total_debt.validity).toBe('INVALID');
  });

  it('optional components (short-term borrowings, commercial paper) never trip the A/B check and are added once', () => {
    expect(value(debt({ LongTermDebt: 1000, LongTermDebtNoncurrent: 600, LongTermDebtCurrent: 400, ShortTermBorrowings: 50, CommercialPaper: 25 }), 'total_debt')).toBe(1075);
  });

  it('KNOWN LIMIT (fail closed): a rounded footnote on very small debt can exceed the 2% tolerance', () => {
    expect(debt({ LongTermDebt: 11, LongTermDebtNoncurrent: 6, LongTermDebtCurrent: 4 }).metrics.total_debt.validity).toBe('INVALID');
  });
});
