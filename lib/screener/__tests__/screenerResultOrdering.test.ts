// lib/screener/__tests__/screenerResultOrdering.test.ts
//
// SCREENER-OI-0001 — regression coverage for the canonical minimum-OI
// filter and two-level sort module. Numbered comments below map to the
// ticket's required-test list (1-16 are covered purely at this lib level;
// 17-18 are covered at the app/screener page-wiring level, see
// app/screener/__tests__/OiAndSortWiring.test.tsx).

import { describe, expect, it } from 'vitest';
import {
  computeRelevantLegOI,
  evaluateOiEligibility,
  extractOiLegsFromSpreadCandidate,
  filterAndSortByOi,
  filterSortAndSliceTop,
  hasValidTwoSidedQuote,
  OI_PRESETS,
  setPrimarySortField,
  setSecondarySortField,
  sortItems,
  type OiCandidateLegs,
  type SortableMetrics,
  type SortSpec,
} from '../screenerResultOrdering';

function legs(overrides: Partial<OiCandidateLegs> & { strategy: OiCandidateLegs['strategy'] }): OiCandidateLegs {
  return overrides;
}

describe('canonical relevant-leg OI rules', () => {
  // 2. A vertical whose short leg fails.
  it('CSP: fails closed when the short put OI is below the floor', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'CSP', shortPutOI: 40 }), 100);
    expect(r.eligible).toBe(false);
    expect(r.relevantLegOI).toBe(40);
  });

  it('CC: uses short call OI as the relevant leg', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'CC', shortCallOI: 300 }), 250);
    expect(r.eligible).toBe(true);
    expect(r.relevantLegOI).toBe(300);
  });

  // 1. A vertical spread whose short leg passes while its protective long
  //    leg is below it -- remains eligible, exposes the weaker long-leg
  //    liquidity as a warning.
  it('BPS: short put passes, protective long put is weak -- still eligible, with a warning', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'BPS', shortPutOI: 600, longPutOI: 20 }), 500);
    expect(r.eligible).toBe(true);
    expect(r.relevantLegOI).toBe(600);
    expect(r.protectiveLegWarnings).toHaveLength(1);
    expect(r.protectiveLegWarnings[0]).toMatch(/below the selected minimum/);
  });

  it('BPS: protective long leg is never required to independently meet the floor', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'BPS', shortPutOI: 500, longPutOI: 0 }), 500);
    expect(r.eligible).toBe(true);
  });

  it('BCS: short call OI is the relevant leg; protective long call is diagnostic only', () => {
    const pass = evaluateOiEligibility(legs({ strategy: 'BCS', shortCallOI: 250, longCallOI: null }), 250);
    expect(pass.eligible).toBe(true);
    expect(pass.protectiveLegWarnings[0]).toMatch(/unavailable/);
  });

  it('BULL_CALL: short call OI is the relevant leg, mirroring BCS', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'BULL_CALL', shortCallOI: 500, longCallOI: 10 }), 500);
    expect(r.eligible).toBe(true);
    expect(r.relevantLegOI).toBe(500);
    expect(r.protectiveLegWarnings).toHaveLength(1);
  });

  // 3. An Iron Condor where both short legs pass.
  it('IC: both short legs pass -- eligible, relevant-leg OI is the lower of the two', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'IC', shortPutOI: 700, shortCallOI: 550 }), 500);
    expect(r.eligible).toBe(true);
    expect(r.relevantLegOI).toBe(550);
  });

  // 4. An Iron Condor where exactly one short leg fails.
  it('IC: one short leg fails the floor -- whole candidate fails closed', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'IC', shortPutOI: 700, shortCallOI: 200 }), 500);
    expect(r.eligible).toBe(false);
    expect(r.relevantLegOI).toBe(200);
  });

  // 5. An Iron Condor with missing OI on one short leg.
  it('IC: missing OI on one short leg fails closed, not treated as passing', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'IC', shortPutOI: 700, shortCallOI: null }), 500);
    expect(r.eligible).toBe(false);
    expect(r.relevantLegOI).toBe(null);
    expect(r.failureReason).toMatch(/Missing OI data/);
  });

  it('IC: protective long legs never required, warn independently when weak/missing', () => {
    const r = evaluateOiEligibility(
      legs({ strategy: 'IC', shortPutOI: 700, shortCallOI: 550, longPutOI: 5, longCallOI: null }),
      500,
    );
    expect(r.eligible).toBe(true);
    expect(r.protectiveLegWarnings).toHaveLength(2);
  });

  // 6. A PMCC where both relevant legs pass.
  it('PMCC: both the LEAPS long call and short call pass -- eligible', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'PMCC', longCallOI: 300, shortCallOI: 260 }), 250);
    expect(r.eligible).toBe(true);
    expect(r.relevantLegOI).toBe(260);
  });

  // 7. A PMCC where either the LEAPS or short call fails.
  it('PMCC: LEAPS long call fails the floor -- ineligible even though short call passes', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'PMCC', longCallOI: 90, shortCallOI: 900 }), 250);
    expect(r.eligible).toBe(false);
  });

  it('PMCC: short call fails the floor -- ineligible even though LEAPS long call passes', () => {
    const r = evaluateOiEligibility(legs({ strategy: 'PMCC', longCallOI: 900, shortCallOI: 90 }), 250);
    expect(r.eligible).toBe(false);
  });

  // 8. A Long LEAPS candidate using the long-call OI.
  it('LEAPS: uses the long call OI as the sole relevant leg', () => {
    const pass = evaluateOiEligibility(legs({ strategy: 'LEAPS', longCallOI: 150 }), 100);
    expect(pass.eligible).toBe(true);
    expect(pass.relevantLegOI).toBe(150);
    const fail = evaluateOiEligibility(legs({ strategy: 'LEAPS', longCallOI: 40 }), 100);
    expect(fail.eligible).toBe(false);
  });

  // 9. Each OI preset and a custom value.
  it('every preset (Any/100/250/500) and an arbitrary custom value apply the same floor logic', () => {
    const candidateLegs = legs({ strategy: 'CSP', shortPutOI: 260 });
    expect(OI_PRESETS.map((p) => p.value)).toEqual([0, 100, 250, 500]);
    expect(evaluateOiEligibility(candidateLegs, 0).eligible).toBe(true); // Any
    expect(evaluateOiEligibility(candidateLegs, 100).eligible).toBe(true);
    expect(evaluateOiEligibility(candidateLegs, 250).eligible).toBe(true);
    expect(evaluateOiEligibility(candidateLegs, 500).eligible).toBe(false);
    expect(evaluateOiEligibility(candidateLegs, 261).eligible).toBe(false); // custom value
    expect(evaluateOiEligibility(candidateLegs, 259).eligible).toBe(true); // custom value
  });

  // 10. Missing OI with "Any" versus a positive floor.
  it('"Any" (0) never fails on missing OI and never fabricates a value; a positive floor fails closed on missing OI', () => {
    const missing = legs({ strategy: 'CSP', shortPutOI: null });
    const any = evaluateOiEligibility(missing, 0);
    expect(any.eligible).toBe(true);
    expect(any.relevantLegOI).toBe(null); // not fabricated as 0 or any other number
    const floor = evaluateOiEligibility(missing, 1);
    expect(floor.eligible).toBe(false);
    expect(floor.failureReason).toMatch(/Missing OI data/);
  });

  it('computeRelevantLegOI is independent of any chosen floor', () => {
    expect(computeRelevantLegOI(legs({ strategy: 'IC', shortPutOI: 300, shortCallOI: 900 }))).toBe(300);
    expect(computeRelevantLegOI(legs({ strategy: 'CSP', shortPutOI: undefined }))).toBe(null);
  });
});

describe('quote-validity diagnostic is distinct from OI', () => {
  it('a valid two-sided, non-crossed quote passes', () => {
    expect(hasValidTwoSidedQuote({ bid: 1.2, ask: 1.4 })).toBe(true);
  });

  it('a crossed market, one-sided, missing, or non-finite quote fails', () => {
    expect(hasValidTwoSidedQuote({ bid: 1.5, ask: 1.2 })).toBe(false); // crossed
    expect(hasValidTwoSidedQuote({ bid: 0, ask: 1.2 })).toBe(false); // one-sided
    expect(hasValidTwoSidedQuote({ bid: 1.2, ask: null })).toBe(false); // missing
    expect(hasValidTwoSidedQuote({ bid: Infinity, ask: 1.2 })).toBe(false); // non-finite
  });

  it('OI eligibility passing does not imply anything about quote validity -- they are computed independently', () => {
    const oi = evaluateOiEligibility(legs({ strategy: 'CSP', shortPutOI: 900 }), 500);
    expect(oi.eligible).toBe(true);
    // A caller must check hasValidTwoSidedQuote separately; nothing on
    // OiEligibilityResult claims anything about quote quality.
    expect((oi as any).quoteValid).toBeUndefined();
  });
});

describe('sort field selection rules', () => {
  it('primary and secondary cannot be the same -- setting primary to the current secondary clears secondary', () => {
    const spec: SortSpec = { primary: 'score', secondary: 'creditPct' };
    const updated = setPrimarySortField(spec, 'creditPct');
    expect(updated).toEqual({ primary: 'creditPct', secondary: 'none' });
  });

  // 14. Duplicate primary/secondary prevention.
  it('setting secondary to the current primary is rejected (spec unchanged)', () => {
    const spec: SortSpec = { primary: 'score', secondary: 'none' };
    const updated = setSecondarySortField(spec, 'score');
    expect(updated).toEqual(spec);
  });

  it('"None" is a valid secondary selection', () => {
    const spec: SortSpec = { primary: 'score', secondary: 'creditPct' };
    expect(setSecondarySortField(spec, 'none')).toEqual({ primary: 'score', secondary: 'none' });
  });
});

function metrics(overrides: Partial<SortableMetrics>): SortableMetrics {
  return {
    score: null,
    pop: null,
    creditDollars: null,
    creditPct: null,
    rocPct: null,
    otmPct: null,
    relevantLegOI: null,
    dte: null,
    widthMinusDebitPct: null,
    breakevenPct: null,
    annualizedRoiPct: null,
    ...overrides,
  };
}

describe('two-level sorting', () => {
  // 11. Score -> Credit percentage.
  it('Score -> Credit percentage: ties on score break by credit percentage', () => {
    const items = [
      { id: 'a', m: metrics({ score: 80, creditPct: 20 }) },
      { id: 'b', m: metrics({ score: 80, creditPct: 35 }) },
      { id: 'c', m: metrics({ score: 90, creditPct: 5 }) },
    ];
    const sorted = sortItems(items, { primary: 'score', secondary: 'creditPct' }, (x) => x.m);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  // 12. Score -> ROC percentage.
  it('Score -> ROC percentage: ties on score break by ROC percentage', () => {
    const items = [
      { id: 'a', m: metrics({ score: 50, rocPct: 10 }) },
      { id: 'b', m: metrics({ score: 50, rocPct: 22 }) },
    ];
    const sorted = sortItems(items, { primary: 'score', secondary: 'rocPct' }, (x) => x.m);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a']);
  });

  // 13. Score -> OTM percentage.
  it('Score -> OTM percentage: ties on score break by OTM percentage', () => {
    const items = [
      { id: 'a', m: metrics({ score: 50, otmPct: 4 }) },
      { id: 'b', m: metrics({ score: 50, otmPct: 9 }) },
    ];
    const sorted = sortItems(items, { primary: 'score', secondary: 'otmPct' }, (x) => x.m);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a']);
  });

  // 15. Deterministic tie-breaking.
  it('fully tied items (including secondary) preserve original input order deterministically across repeated sorts', () => {
    const items = [
      { id: 'a', m: metrics({ score: 50, creditPct: 10 }) },
      { id: 'b', m: metrics({ score: 50, creditPct: 10 }) },
      { id: 'c', m: metrics({ score: 50, creditPct: 10 }) },
    ];
    const spec: SortSpec = { primary: 'score', secondary: 'creditPct' };
    const first = sortItems(items, spec, (x) => x.m).map((x) => x.id);
    const second = sortItems(items, spec, (x) => x.m).map((x) => x.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(second).toEqual(['a', 'b', 'c']);
  });

  it('missing metric values always sort last, at either sort level', () => {
    const items = [
      { id: 'known', m: metrics({ score: 10 }) },
      { id: 'unknown', m: metrics({ score: null }) },
    ];
    const sorted = sortItems(items, { primary: 'score', secondary: 'none' }, (x) => x.m);
    expect(sorted.map((x) => x.id)).toEqual(['known', 'unknown']);
  });

  it('secondary "none" applies only the primary field', () => {
    const items = [
      { id: 'a', m: metrics({ score: 10, dte: 5 }) },
      { id: 'b', m: metrics({ score: 10, dte: 40 }) },
    ];
    const sorted = sortItems(items, { primary: 'score', secondary: 'none' }, (x) => x.m);
    // Tied on the only active field (score) -- stable order preserved,
    // dte (secondary would-be field) plays no role.
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('combined filter + sort pipeline, and Show-Top-N ordering', () => {
  interface FakeCandidate {
    id: string;
    strategy: 'CSP' | 'IC';
    shortPutOI?: number | null;
    shortCallOI?: number | null;
    score: number;
  }

  function pipelineFor(items: FakeCandidate[], minOi: number, sort: SortSpec) {
    return filterAndSortByOi(items, {
      minOi,
      getLegs: (c) => ({ strategy: c.strategy, shortPutOI: c.shortPutOI, shortCallOI: c.shortCallOI }),
      getMetrics: (c) => metrics({ score: c.score }),
      sort,
    });
  }

  // 16. Filtering and sorting occurring before "Show Top N."
  it('filters ineligible candidates out and sorts BEFORE any Show-Top-N slice is applied', () => {
    const items: FakeCandidate[] = [
      { id: 'low-oi', strategy: 'CSP', shortPutOI: 10, score: 99 }, // would top a raw score sort, but fails OI
      { id: 'mid', strategy: 'CSP', shortPutOI: 600, score: 50 },
      { id: 'high', strategy: 'CSP', shortPutOI: 600, score: 80 },
    ];
    const top1 = filterSortAndSliceTop(
      items,
      {
        minOi: 500,
        getLegs: (c) => ({ strategy: c.strategy, shortPutOI: c.shortPutOI, shortCallOI: c.shortCallOI }),
        getMetrics: (c) => metrics({ score: c.score }),
        sort: { primary: 'score', secondary: 'none' },
      },
      1,
    );
    // "low-oi" is never even a candidate for Top N -- it's excluded by the
    // OI floor before the slice, not merely sorted to the bottom.
    expect(top1).toHaveLength(1);
    expect(top1[0].item.id).toBe('high');
  });

  it('the OI eligibility detail is available alongside each sorted item, for display/diagnostics', () => {
    const result = pipelineFor(
      [{ id: 'a', strategy: 'CSP', shortPutOI: 900, score: 1 }],
      500,
      { primary: 'score', secondary: 'none' },
    );
    expect(result[0].oi.eligible).toBe(true);
    expect(result[0].oi.relevantLegOI).toBe(900);
  });
});

describe('SpreadCandidate adapter', () => {
  it('maps CSP/CC/BPS/BCS/PMCC through the shared shortOI/longOI fields', () => {
    expect(extractOiLegsFromSpreadCandidate('CSP', { shortOI: 400 })).toEqual({ strategy: 'CSP', shortPutOI: 400 });
    expect(extractOiLegsFromSpreadCandidate('CC', { shortOI: 400 })).toEqual({ strategy: 'CC', shortCallOI: 400 });
    expect(extractOiLegsFromSpreadCandidate('BPS', { shortOI: 400, longOI: 20 })).toEqual({
      strategy: 'BPS',
      shortPutOI: 400,
      longPutOI: 20,
    });
    expect(extractOiLegsFromSpreadCandidate('PMCC', { shortOI: 300, longOI: 150 })).toEqual({
      strategy: 'PMCC',
      shortCallOI: 300,
      longCallOI: 150,
    });
  });

  it('maps IC through both the generic and *CallOI fields', () => {
    expect(
      extractOiLegsFromSpreadCandidate('IC', { shortOI: 700, longOI: 15, shortCallOI: 550, longCallOI: 10 }),
    ).toEqual({ strategy: 'IC', shortPutOI: 700, longPutOI: 15, shortCallOI: 550, longCallOI: 10 });
  });
});
