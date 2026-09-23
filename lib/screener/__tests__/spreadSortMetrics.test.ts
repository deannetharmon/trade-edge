// lib/screener/__tests__/spreadSortMetrics.test.ts
//
// SCREENER-SORT-0001: Targeted spread results get the canonical two-level sort.
// These tests pin the shared metrics builder (used by Ranked and Targeted), the
// list of sort fields spreads can populate, and the ordering Targeted relies on.

import { describe, it, expect } from 'vitest';
import {
  SORT_FIELDS,
  SPREAD_SORT_FIELDS,
  buildSpreadSortMetrics,
  sortItems,
  setPrimarySortField,
  setSecondarySortField,
  type SortSpec,
  type SortableMetrics,
  type SpreadSortCandidate,
} from '@/lib/screener/screenerResultOrdering';

interface Entry {
  id: string;
  score: number;
  pop: number;
  otm: number | null;
  strategy: 'BPS' | 'BCS' | 'IC';
  candidate: SpreadSortCandidate;
}

function entry(id: string, o: Partial<Entry> & { candidate?: Partial<SpreadSortCandidate> } = {}): Entry {
  return {
    id,
    score: o.score ?? 70,
    pop: o.pop ?? 75,
    otm: o.otm === undefined ? 8 : o.otm,
    strategy: o.strategy ?? 'BPS',
    candidate: { credit: 1.0, creditRatio: 0.25, roc: 30, dte: 35, shortOI: 500, longOI: 400, ...(o.candidate ?? {}) },
  };
}

const metricsOf = (e: Entry): SortableMetrics =>
  buildSpreadSortMetrics({ score: e.score, pop: e.pop, otmPct: e.otm, strategy: e.strategy, candidate: e.candidate });

const order = (items: Entry[], spec: SortSpec) => sortItems(items, spec, metricsOf).map((e) => e.id);

describe('SCREENER-SORT-0001: buildSpreadSortMetrics', () => {
  it('maps a spread candidate into every sortable metric, with credit ratio as a percentage', () => {
    const m = metricsOf(entry('a', { score: 81, pop: 72, otm: 9.5, candidate: { credit: 1.4, creditRatio: 0.3, roc: 28, dte: 32, shortOI: 250, longOI: 900 } }));
    expect(m.score).toBe(81);
    expect(m.pop).toBe(72);
    expect(m.creditDollars).toBe(1.4);
    expect(m.creditPct).toBeCloseTo(30, 10);
    expect(m.rocPct).toBe(28);
    expect(m.otmPct).toBe(9.5);
    expect(m.dte).toBe(32);
    // BPS needs both put legs; relevant-leg OI is the weaker of the two.
    expect(m.relevantLegOI).toBe(250);
  });

  it('leaves the PMCC-only metrics null for every spread strategy', () => {
    for (const strategy of ['BPS', 'BCS', 'IC'] as const) {
      const m = metricsOf(entry('x', { strategy }));
      expect(m.widthMinusDebitPct).toBeNull();
      expect(m.breakevenPct).toBeNull();
      expect(m.annualizedRoiPct).toBeNull();
    }
  });

  it('returns null for anything the candidate does not carry, never a fabricated 0', () => {
    const m = buildSpreadSortMetrics({ score: null, pop: null, otmPct: null, strategy: null, candidate: null });
    for (const f of SORT_FIELDS) expect(m[f]).toBeNull();
    const partial = metricsOf(entry('p', { candidate: { credit: null, creditRatio: null, roc: null, dte: null } }));
    expect(partial.creditDollars).toBeNull();
    expect(partial.creditPct).toBeNull();
    expect(partial.rocPct).toBeNull();
    expect(partial.dte).toBeNull();
  });
});

describe('SCREENER-SORT-0001: SPREAD_SORT_FIELDS matches what the builder can populate', () => {
  it('offers exactly the fields a fully populated spread candidate fills, and none of the always-null ones', () => {
    const m = metricsOf(entry('full'));
    const populated = SORT_FIELDS.filter((f) => m[f] != null);
    expect([...SPREAD_SORT_FIELDS].sort()).toEqual([...populated].sort());
    expect(SPREAD_SORT_FIELDS).not.toContain('widthMinusDebitPct');
    expect(SPREAD_SORT_FIELDS).not.toContain('breakevenPct');
    expect(SPREAD_SORT_FIELDS).not.toContain('annualizedRoiPct');
    // The fields Dean sorts on must be present.
    expect(SPREAD_SORT_FIELDS).toEqual(expect.arrayContaining(['score', 'creditPct', 'creditDollars', 'pop', 'rocPct', 'otmPct', 'relevantLegOI', 'dte']));
  });
});

describe('SCREENER-SORT-0001: Targeted ordering', () => {
  // Distinct values per field so each primary sort has exactly one expected order.
  const items = [
    entry('A', { score: 60, pop: 80, otm: 5, candidate: { credit: 0.9, creditRatio: 0.20, roc: 25, dte: 45, shortOI: 100, longOI: 100 } }),
    entry('B', { score: 90, pop: 70, otm: 12, candidate: { credit: 1.5, creditRatio: 0.33, roc: 40, dte: 21, shortOI: 900, longOI: 900 } }),
    entry('C', { score: 75, pop: 85, otm: 9, candidate: { credit: 1.2, creditRatio: 0.25, roc: 32, dte: 30, shortOI: 300, longOI: 300 } }),
  ];

  const expectedByPrimary: Record<string, string[]> = {
    score: ['B', 'C', 'A'],
    pop: ['C', 'A', 'B'],
    creditDollars: ['B', 'C', 'A'],
    creditPct: ['B', 'C', 'A'],
    rocPct: ['B', 'C', 'A'],
    otmPct: ['B', 'C', 'A'],
    relevantLegOI: ['B', 'C', 'A'],
    dte: ['A', 'C', 'B'],
  };

  it.each(Object.entries(expectedByPrimary))('primary %s orders descending', (field, expected) => {
    expect(order(items, { primary: field as SortSpec['primary'], secondary: 'none' })).toEqual(expected);
  });

  it('Score then None reproduces the previous single-field Score order exactly, ties keeping input order', () => {
    const tied = [entry('t1', { score: 80 }), entry('t2', { score: 90 }), entry('t3', { score: 80 }), entry('t4', { score: 90 })];
    const legacy = [...tied].sort((a, b) => b.score - a.score).map((e) => e.id);
    expect(order(tied, { primary: 'score', secondary: 'none' })).toEqual(legacy);
    expect(legacy).toEqual(['t2', 't4', 't1', 't3']);
  });

  it('every previous single-field sort (POP, Credit $, Credit %, ROC %, OTM %) keeps its order under None', () => {
    const legacy = {
      pop: (a: Entry, b: Entry) => b.pop - a.pop,
      creditDollars: (a: Entry, b: Entry) => (b.candidate.credit ?? 0) - (a.candidate.credit ?? 0),
      creditPct: (a: Entry, b: Entry) => (b.candidate.creditRatio ?? 0) - (a.candidate.creditRatio ?? 0),
      rocPct: (a: Entry, b: Entry) => (b.candidate.roc ?? 0) - (a.candidate.roc ?? 0),
      otmPct: (a: Entry, b: Entry) => (b.otm ?? -999) - (a.otm ?? -999),
    } as const;
    for (const [field, cmp] of Object.entries(legacy)) {
      expect(order(items, { primary: field as SortSpec['primary'], secondary: 'none' }), field).toEqual([...items].sort(cmp).map((e) => e.id));
    }
  });

  it('the secondary sort breaks ties on the primary: score, then credit %', () => {
    const tied = [
      entry('low', { score: 80, candidate: { creditRatio: 0.20 } }),
      entry('high', { score: 80, candidate: { creditRatio: 0.33 } }),
      entry('mid', { score: 80, candidate: { creditRatio: 0.25 } }),
      entry('top', { score: 95, candidate: { creditRatio: 0.10 } }),
    ];
    expect(order(tied, { primary: 'score', secondary: 'creditPct' })).toEqual(['top', 'high', 'mid', 'low']);
    // Without a secondary the three tied entries keep their input order.
    expect(order(tied, { primary: 'score', secondary: 'none' })).toEqual(['top', 'low', 'high', 'mid']);
  });

  it('missing values sort last at both levels', () => {
    const rows = [
      entry('noRoc', { score: 80, candidate: { roc: null } }),
      entry('hasRoc', { score: 80, candidate: { roc: 30 } }),
      entry('noOtm', { score: 70, otm: null }),
      entry('hasOtm', { score: 70, otm: 10 }),
    ];
    expect(order(rows, { primary: 'score', secondary: 'rocPct' }).slice(0, 2)).toEqual(['hasRoc', 'noRoc']);
    expect(order(rows, { primary: 'otmPct', secondary: 'none' }).indexOf('noOtm')).toBeGreaterThan(order(rows, { primary: 'otmPct', secondary: 'none' }).indexOf('hasOtm'));
  });

  it('choosing the secondary as the current primary is refused, and choosing a new primary clears a matching secondary', () => {
    const spec: SortSpec = { primary: 'score', secondary: 'creditPct' };
    expect(setSecondarySortField(spec, 'score')).toEqual(spec);
    expect(setPrimarySortField(spec, 'creditPct')).toEqual({ primary: 'creditPct', secondary: 'none' });
  });

  it('sorting never mutates the input array', () => {
    const copy = [...items];
    sortItems(items, { primary: 'dte', secondary: 'score' }, metricsOf);
    expect(items).toEqual(copy);
  });
});
