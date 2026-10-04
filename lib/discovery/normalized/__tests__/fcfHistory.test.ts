// lib/discovery/normalized/__tests__/fcfHistory.test.ts

// LEAPS-QV-0001 Gate 2c (spec section 8) -- fcf_annual_history_5y. Hand-derived from secFixtures.ts:
//   FY i (i = 0..6): operating cash flow = 0.25 * revenue_i = 250 + 25 i; capex = 0.05 * revenue_i = 50 + 5 i
//   free cash flow_i = 200 + 20 i  =>  years 2019..2025 are 200, 220, 240, 260, 280, 300, 320.

import { describe, expect, it } from 'vitest';
import { FCF_HISTORY_METRIC_ID, buildSecFundamentals, compactCompanyFacts, unavailableSecFundamentals } from '../sec';
import type { SecBuildContext, SecFundamentalsResult } from '../sec';
import { DEC_FY_ENDS, WEEK_FY_ENDS, addRow, dropTag, makeCompanyFacts, rowsOf } from './secFixtures';
import type { RawFacts } from './secFixtures';

const NOW = '2026-10-03T14:00:00.000Z';
const OCF = 'NetCashProvidedByUsedInOperatingActivities';
const CAPEX = 'PaymentsToAcquirePropertyPlantAndEquipment';
const REVENUE = 'Revenues';

function run(raw: RawFacts, ctx: Partial<SecBuildContext> = {}): SecFundamentalsResult {
  const compacted = compactCompanyFacts(raw, '0001234567');
  if (!compacted.ok) throw new Error(`fixture rejected: ${compacted.reason}`);
  return buildSecFundamentals(compacted.compact, { now: NOW, price: null, closes: null, submissions: null, ...ctx });
}

const history = (r: SecFundamentalsResult) => r.metrics[FCF_HISTORY_METRIC_ID];
const fyRows = (raw: RawFacts, tag: string, end: string) => rowsOf(raw, tag).filter((row) => row.end === end);

describe('fcf_annual_history_5y: the happy path', () => {
  it('is the latest five fiscal years of FCF, oldest first, from hand-derived values', () => {
    const metric = history(run(makeCompanyFacts()));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([240, 260, 280, 300, 320]);
  });

  it('is consistent with the SEC annualSeries FCF (same per-year resolution) and with fcf_ttm at a fiscal-year end', () => {
    const result = run(makeCompanyFacts());
    const fromSeries = result.annualSeries.slice(-5).map((point) => point.freeCashFlow);
    expect((history(result) as { value: unknown }).value).toEqual(fromSeries);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(history(run(makeCompanyFacts())))).toBe(JSON.stringify(history(run(makeCompanyFacts()))));
  });

  it('provenance lists the SEC facts used, oldest fiscal year first', () => {
    const result = run(makeCompanyFacts());
    const prov = result.provenance[FCF_HISTORY_METRIC_ID];
    expect(prov).toHaveLength(10);
    expect(prov.map((p) => p.role)).toEqual(
      DEC_FY_ENDS.slice(2).flatMap((end) => [`FY_${end}`, `FY_${end}`]),
    );
    expect(prov[0].item).toBe('operatingCashFlow');
    expect(prov[1].item).toBe('capex');
  });

  it('handles 52/53-week fiscal years (371- and 364-day gaps are consecutive)', () => {
    const metric = history(run(makeCompanyFacts({ fyEnds: WEEK_FY_ENDS }), { now: '2026-06-15T14:00:00.000Z' }));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([240, 260, 280, 300, 320]);
  });
});

describe('fcf_annual_history_5y: contiguous suffix', () => {
  it('an OLDER calendar gap ends the suffix without invalidating three or more good recent years', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, REVENUE, (row) => row.end === DEC_FY_ENDS[2]); // fiscal year 2021 absent -> 2022..2025 contiguous
    const metric = history(run(raw));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([260, 280, 300, 320]);
  });

  it('an older year with missing capex ends the suffix; three recent years remain usable', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, CAPEX, (row) => row.end === DEC_FY_ENDS[3]);
    const metric = history(run(raw));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([280, 300, 320]);
  });

  it('a calendar gap INSIDE the newest three years is UNAVAILABLE (never bridged)', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, REVENUE, (row) => row.end === DEC_FY_ENDS[5]); // 2024 absent -> 2025 and 2023 are 731 days apart
    const metric = history(run(raw));
    expect(metric.validity).toBe('UNAVAILABLE');
    expect((metric as { reason: string }).reason).toBe('INSUFFICIENT_HISTORY');
  });

  it('missing capex in the NEWEST year is UNAVAILABLE; an older year is never substituted', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, CAPEX, (row) => row.end === DEC_FY_ENDS[6]);
    const metric = history(run(raw));
    expect(metric.validity).toBe('UNAVAILABLE');
    expect((metric as { reason: string }).reason).toBe('SEC_ITEM_NOT_REPORTED:capex');
  });

  it('missing operating cash flow inside the newest three years is UNAVAILABLE', () => {
    const raw = makeCompanyFacts();
    dropTag(raw, OCF, (row) => row.end === DEC_FY_ENDS[5]);
    const metric = history(run(raw));
    expect(metric.validity).toBe('UNAVAILABLE');
    expect((metric as { reason: string }).reason).toBe('SEC_ITEM_NOT_REPORTED:operatingCashFlow');
  });

  it('fewer than three fiscal years is UNAVAILABLE INSUFFICIENT_HISTORY', () => {
    const metric = history(run(makeCompanyFacts({ fyEnds: DEC_FY_ENDS.slice(5) })));
    expect(metric.validity).toBe('UNAVAILABLE');
    expect((metric as { reason: string }).reason).toBe('INSUFFICIENT_HISTORY');
  });

  it('exactly three usable years is the minimum and is accepted', () => {
    const metric = history(run(makeCompanyFacts({ fyEnds: DEC_FY_ENDS.slice(4) })));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([200, 220, 240]); // the three fixture years index from 0
  });
});

describe('fcf_annual_history_5y: ambiguous, restated and invalid SEC data', () => {
  it('conflicting same-day filings for a required item are INVALID (ambiguous), not guessed', () => {
    const raw = makeCompanyFacts();
    const existing = fyRows(raw, CAPEX, DEC_FY_ENDS[6]).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    addRow(raw, CAPEX, 'USD', { ...existing, val: existing.val + 1, accn: 'conflict-0001' });
    const metric = history(run(raw));
    expect(metric.validity).toBe('INVALID');
    expect((metric as { reason: string }).reason).toBe('AMBIGUOUS_CONCEPT:capex');
  });

  it('ambiguity in an OLDER year (beyond the newest three) only ends the suffix', () => {
    const raw = makeCompanyFacts();
    const existing = fyRows(raw, CAPEX, DEC_FY_ENDS[3]).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    addRow(raw, CAPEX, 'USD', { ...existing, val: existing.val + 1, accn: 'conflict-0002' });
    const metric = history(run(raw));
    expect(metric.validity).toBe('VALID');
    expect((metric as { value: unknown }).value).toEqual([280, 300, 320]);
  });

  it('a restated year uses the LATEST filing and is flagged restated in provenance', () => {
    const raw = makeCompanyFacts();
    const original = fyRows(raw, OCF, DEC_FY_ENDS[4]).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    addRow(raw, OCF, 'USD', { ...original, val: original.val + 10, accn: 'restated-0001', filed: '2026-05-01' });
    const result = run(raw);
    expect((history(result) as { value: unknown }).value).toEqual([240, 260, 290, 300, 320]); // FY2023: 360 - 70 instead of 350 - 70
    const restated = result.provenance[FCF_HISTORY_METRIC_ID].filter((p) => p.restated);
    expect(restated.map((p) => `${p.item}:${p.role}`)).toEqual([`operatingCashFlow:FY_${DEC_FY_ENDS[4]}`]);
  });

  it('a negative capex figure (not an outflow) is INVALID', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, CAPEX).forEach((row) => {
      if (row.end === DEC_FY_ENDS[6]) row.val = -row.val;
    });
    const metric = history(run(raw));
    expect(metric.validity).toBe('INVALID');
    expect((metric as { reason: string }).reason).toBe('CAPEX_MUST_BE_A_POSITIVE_OUTFLOW');
  });

  it('negative annual FCF is data and is preserved as is (no classification here)', () => {
    const raw = makeCompanyFacts();
    rowsOf(raw, OCF).forEach((row) => {
      if (row.end === DEC_FY_ENDS[6]) row.val = 10; // OCF 10 - capex 80 = -70
    });
    expect((history(run(raw)) as { value: unknown }).value).toEqual([240, 260, 280, 300, -70]);
  });
});

describe('fcf_annual_history_5y: freshness and coverage', () => {
  it('is VALID when the SEC dataset is fresh and STALE (no usable value) when it is older than the SEC freshness rule', () => {
    expect(history(run(makeCompanyFacts())).validity).toBe('VALID');
    expect(history(run(makeCompanyFacts(), { now: '2027-09-01T14:00:00.000Z' })).validity).toBe('STALE');
  });

  it('is present and UNAVAILABLE with the reason when SEC does not cover the issuer', () => {
    const set = unavailableSecFundamentals('NOT_US_GAAP_XBRL');
    expect(set[FCF_HISTORY_METRIC_ID].validity).toBe('UNAVAILABLE');
  });

  it('carries no investment logic: the value is a plain list of numbers', () => {
    const metric = history(run(makeCompanyFacts())) as { value: unknown };
    expect(Array.isArray(metric.value)).toBe(true);
    (metric.value as unknown[]).forEach((entry) => expect(typeof entry).toBe('number'));
  });
});
