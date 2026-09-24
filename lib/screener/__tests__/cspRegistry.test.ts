// SCREENER-CONFIG-0001A -- the CSP criterion registry: structure, receipts built from it,
// result counts, and retention. (What each lifecycle claims about the engine is proven in
// lib/scans/__tests__/cspConfigTruthfulness.test.ts.)

import { describe, it, expect } from 'vitest';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import {
  CSP_CARD_ORDER, CSP_CRITERIA, IVR_UNAVAILABLE_NOTE, buildCspReceipt, criteriaForCard, criteriaForMode, getCriterion,
  summarizeCspResults, valuesFromSnapshot, type CspConfigValues, type CspCountableResult,
} from '@/lib/screener/scanConfig/cspRegistry';
import { LIFECYCLES, LIFECYCLE_TAG_LABEL, RETENTION } from '@/lib/screener/scanConfig/types';

const values = (over: Partial<CspConfigValues> = {}): CspConfigValues => ({
  mode: 'targeted', rules: { ...DEFAULT_CSP_RULES }, popMin: 70, otmMin: 8, rocMin: 1.5,
  rankSecondary: 'none', affordableOnly: false, capitalLimit: null, ...over,
});

describe('registry structure: every criterion declares what it is', () => {
  it('has unique ids and a complete declaration for each criterion', () => {
    const ids = CSP_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CSP_CRITERIA) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(c.hint.length, c.id).toBeGreaterThan(10);
      expect(LIFECYCLES, c.id).toContain(c.lifecycle);
      expect(c.modes.length, c.id).toBeGreaterThan(0);
      expect(CSP_CARD_ORDER, c.id).toContain(c.card);
      expect(typeof c.summary, c.id).toBe('function');
      expect(typeof c.rescan, c.id).toBe('boolean');
    }
  });

  it('every optional Targeted gate has an explicit off state and a matching quick select', () => {
    for (const id of ['pop', 'otm', 'roc']) {
      const c = getCriterion(id);
      expect(c.off).toBe('Any');
      if (c.control.kind !== 'target') throw new Error('expected a target control');
      expect(c.control.presets[0]).toEqual({ label: 'Any', value: null });
      expect(c.control.presets.length).toBeGreaterThan(2);
    }
  });

  it('a fixed criterion has no control the trader could change', () => {
    for (const c of CSP_CRITERIA.filter((x) => x.fixed)) expect(c.control.kind, c.id).toBe('info');
  });

  it('every rule-backed control points at a real rule key', () => {
    const keys = Object.keys(DEFAULT_CSP_RULES);
    for (const c of CSP_CRITERIA) {
      if (c.control.kind === 'rule') expect(keys).toContain(c.control.key);
      if (c.control.kind === 'range') { expect(keys).toContain(c.control.minKey); expect(keys).toContain(c.control.maxKey); }
    }
  });

  it('no criterion offers bid/ask width as a setting', () => {
    for (const c of CSP_CRITERIA) {
      if (c.control.kind === 'rule') expect(c.control.key).not.toBe('BID_ASK_MAX');
      if (c.control.kind === 'range') { expect(c.control.minKey).not.toBe('BID_ASK_MAX'); expect(c.control.maxKey).not.toBe('BID_ASK_MAX'); }
    }
  });

  it('open-interest quick selects are 100, 200, 300, 500', () => {
    const oi = getCriterion('oi').control;
    if (oi.kind !== 'rule') throw new Error('expected a rule control');
    expect(oi.presets.map((p) => p.value)).toEqual([100, 200, 300, 500]);
  });

  it('the return control is named as period ROC on collateral, with its unit', () => {
    const roc = getCriterion('roc');
    expect(roc.label).toBe('Minimum period return on collateral (ROC)');
    expect(roc.unit).toContain('over the option period');
  });

  it('every lifecycle has a tag label and a retention rule', () => {
    for (const l of LIFECYCLES) {
      expect(LIFECYCLE_TAG_LABEL[l]).toBeTruthy();
      expect(RETENTION[l].disposition).toBeTruthy();
    }
    expect(RETENTION.fetch.recovery).toBe('no');
    expect(RETENTION.gate.recovery).toBe('if-retained');
    expect(RETENTION.rank.recovery).toBe('yes');
    expect(RETENTION['result-filter'].recovery).toBe('yes');
    expect(RETENTION['read-only'].recovery).toBe('not-applicable');
  });
});

describe('which criteria apply to which mode', () => {
  const ids = (mode: 'rank' | 'targeted' | 'filter') => criteriaForMode(mode).map((c) => c.id);

  it('Targeted has the POP, OTM, and ROC gates and no Rank ordering or result chips', () => {
    expect(ids('targeted')).toEqual(expect.arrayContaining(['pop', 'otm', 'roc']));
    expect(ids('targeted')).not.toContain('rankSecondary');
    expect(ids('targeted')).not.toContain('resultChips');
  });

  it('Rank has the secondary sort and result chips and no Targeted gates', () => {
    expect(ids('rank')).toEqual(expect.arrayContaining(['rankSecondary', 'resultChips']));
    for (const id of ['pop', 'otm', 'roc']) expect(ids('rank')).not.toContain(id);
  });

  it('both modes share the search range, delta, open interest, IVR, liquidity, earnings, and capital', () => {
    for (const id of ['dte', 'delta', 'oi', 'ivrCap', 'ivrFloor', 'liquidity', 'earnings', 'capital']) {
      expect(ids('rank')).toContain(id);
      expect(ids('targeted')).toContain(id);
    }
  });

  it('an older Filter-mode session is described like Rank, without Targeted gates', () => {
    expect(ids('filter')).not.toContain('pop');
    expect(ids('filter')).toContain('dte');
  });

  it('cards group the criteria in the order the modal renders them', () => {
    expect(criteriaForCard('targeted', 'gates').map((c) => c.id)).toEqual(['pop', 'otm', 'roc']);
    expect(criteriaForCard('rank', 'gates')).toEqual([]);
    expect(criteriaForCard('rank', 'always').map((c) => c.id)).toEqual(['ivrCap', 'ivrFloor', 'liquidity', 'earnings']);
  });
});

describe('receipts are built from the registry', () => {
  const byKey = (r: ReturnType<typeof buildCspReceipt>) => Object.fromEntries(r.groups.map((g) => [g.key, g]));

  it('a Targeted receipt groups search range, gates, preferences, and capital', () => {
    const groups = byKey(buildCspReceipt(values()));
    expect(groups.search.items).toEqual(['30–45 DTE']);
    expect(groups.search.label).toContain('rescan to change');
    expect(groups.gates.items).toEqual(['POP ≥ 70%', 'OTM ≥ 8%', 'ROC ≥ 1.5%', 'IVR ≤ 70%', 'bid/ask tiers (fixed)', 'earnings inside expiration']);
    expect(groups.advisory.items).toEqual(['Δ 0.15–0.25 preferred (outside it: not a Best Opportunity)', 'OI 500', 'IVR floor 30%']);
    expect(groups.capital.items).toEqual(['Affordable only off']);
    expect(groups.order).toBeUndefined();
    expect(groups.adjustable).toBeUndefined();
  });

  it('a Rank receipt shows the order and what can be adjusted after the scan, with no Targeted gates', () => {
    const groups = byKey(buildCspReceipt(values({ mode: 'rank', popMin: null, otmMin: null, rocMin: null, rankSecondary: 'rocPct' })));
    expect(groups.order.items).toEqual(['Score → ROC %']);
    expect(groups.adjustable.items).toEqual(['POP · OTM · DTE · delta · Exp. IVX · IVR · Put OI chips']);
    expect(groups.gates.items).toEqual(['IVR ≤ 70%', 'bid/ask tiers (fixed)', 'earnings inside expiration']);
    expect(groups.adjustable.rescan).toBe(false);
    expect(groups.order.rescan).toBe(false);
  });

  it('marks which groups need a rescan to change', () => {
    const groups = byKey(buildCspReceipt(values()));
    expect(groups.search.rescan).toBe(true);
    expect(groups.gates.rescan).toBe(true);
    expect(groups.advisory.rescan).toBe(true);
  });

  it('leaves a Targeted gate out of the receipt when it is off', () => {
    const groups = byKey(buildCspReceipt(values({ popMin: null, rocMin: null })));
    expect(groups.gates.items).toContain('OTM ≥ 8%');
    expect(groups.gates.items.some((i) => i.startsWith('POP'))).toBe(false);
    expect(groups.gates.items.some((i) => i.startsWith('ROC'))).toBe(false);
  });

  it('describes capital when Affordable only is on, with and without a cash cap', () => {
    expect(byKey(buildCspReceipt(values({ affordableOnly: true }))).capital.items).toEqual(['Affordable only on']);
    expect(byKey(buildCspReceipt(values({ affordableOnly: true, capitalLimit: 8000 }))).capital.items).toEqual(['Affordable only on · cash cap $8000']);
  });

  it('always states the unavailable-IVR rule', () => {
    expect(buildCspReceipt(values()).notes).toEqual([IVR_UNAVAILABLE_NOTE]);
    expect(IVR_UNAVAILABLE_NOTE).toBe('A symbol with no IV rank is disqualified: the IVR cap cannot be verified.');
  });

  it('the result-chip line names the chips the CSP results view actually has, and says the OI chip defaults to Any', () => {
    const chips = getCriterion('resultChips');
    expect(chips.summary(values({ mode: 'rank' }))).toContain('Put OI');
    expect(chips.summary(values({ mode: 'rank' }))).not.toContain('credit-ratio');
    expect(getCriterion('oi').hint).toContain('Put OI: Any');
  });

  it('the modal summary and the result receipt agree for the same configuration', () => {
    const rules = { ...DEFAULT_CSP_RULES, DTE_MIN: 21, DTE_MAX: 60, OI_MIN: 300 };
    const snapshot = buildCspRuleSnapshot(rules, { mode: 'targeted', popMin: 65, otmMin: 5, rocMin: 1, source: 'user' });
    const fromSnapshot = buildCspReceipt(valuesFromSnapshot(snapshot));
    const fromDraft = buildCspReceipt(values({ rules, popMin: 65, otmMin: 5, rocMin: 1 }));
    expect(fromSnapshot.groups).toEqual(fromDraft.groups);
  });

  it('reads a Filter-mode snapshot from an older session without Targeted gates', () => {
    const snapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES, { mode: 'filter' });
    const receipt = buildCspReceipt(valuesFromSnapshot(snapshot));
    expect(receipt.mode).toBe('filter');
    expect(receipt.groups.find((g) => g.key === 'gates')?.items.some((i) => i.startsWith('POP'))).toBe(false);
  });
});

describe('summarizeCspResults', () => {
  const r = (over: Partial<CspCountableResult>): CspCountableResult => ({ symbol: 'AAA', ivr: 45, qualified: true, bestCandidate: null, ...over });

  it('counts qualified, targeted near-misses, and everything else disqualified', () => {
    const counts = summarizeCspResults([
      r({ qualified: true }),
      r({ symbol: 'BBB', qualified: false, bestCandidate: { cspMarketQualification: 'QUALIFIED', cspModeQualification: 'FAILED' } }),
      r({ symbol: 'CCC', qualified: false, bestCandidate: { cspMarketQualification: 'DISQUALIFIED_IVR', cspModeQualification: 'PASSED' } }),
      r({ symbol: 'DDD', qualified: false, bestCandidate: { cspMarketQualification: 'DISQUALIFIED_POOR_LIQUIDITY', cspModeQualification: 'FAILED' } }),
      r({ symbol: 'EEE', qualified: false, bestCandidate: null }),
    ]);
    expect(counts).toEqual({ qualified: 1, targetedNearMisses: 1, disqualified: 3, symbolsIvrUnavailable: 0 });
  });

  it('a liquidity warning that fails only the Targeted gate is still a near-miss', () => {
    const counts = summarizeCspResults([
      r({ qualified: false, bestCandidate: { cspMarketQualification: 'QUALIFIED_WITH_LIQUIDITY_WARNING', cspModeQualification: 'FAILED' } }),
    ]);
    expect(counts.targetedNearMisses).toBe(1);
  });

  it('counts each symbol with no IV rank once, however many contracts it has', () => {
    const counts = summarizeCspResults([r({ symbol: 'AAA', ivr: null }), r({ symbol: 'AAA', ivr: null }), r({ symbol: 'BBB', ivr: null }), r({ symbol: 'CCC', ivr: 50 })]);
    expect(counts.symbolsIvrUnavailable).toBe(2);
  });

  it('an empty result set counts nothing', () => {
    expect(summarizeCspResults([])).toEqual({ qualified: 0, targetedNearMisses: 0, disqualified: 0, symbolsIvrUnavailable: 0 });
  });
});
