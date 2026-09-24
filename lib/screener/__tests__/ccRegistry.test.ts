// SCREENER-CONFIG-0001B -- the covered-call criterion registry: structure, receipts built from it,
// result counts, and validation. (What each lifecycle claims about the engine is proven in
// lib/scans/__tests__/ccConfigTruthfulness.test.ts.)

import { describe, it, expect } from 'vitest';
import { DEFAULT_CC_RULES } from '@/lib/scans/constants';
import {
  CC_CARD_ORDER, CC_CRITERIA, buildCcReceipt, ccCriteriaForCard, ccFieldErrors, getCcCriterion, summarizeCcResults,
  type CcConfigValues,
} from '@/lib/screener/scanConfig/ccRegistry';
import { LIFECYCLES } from '@/lib/screener/scanConfig/types';

const values = (over: Partial<CcConfigValues> = {}): CcConfigValues => ({ rules: { ...DEFAULT_CC_RULES }, positionsSelected: 3, contractsAvailable: 7, ...over });
const byKey = (r: ReturnType<typeof buildCcReceipt>) => Object.fromEntries(r.groups.map((g) => [g.key, g]));

describe('registry structure: every criterion declares what it is', () => {
  it('has unique ids and a complete declaration for each criterion', () => {
    const ids = CC_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CC_CRITERIA) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(c.hint.length, c.id).toBeGreaterThan(10);
      expect(LIFECYCLES, c.id).toContain(c.lifecycle);
      expect(typeof c.rescan, c.id).toBe('boolean');
      expect(typeof c.summary, c.id).toBe('function');
    }
  });

  it('every rule-backed control points at a real CC rule key', () => {
    const keys = Object.keys(DEFAULT_CC_RULES);
    for (const c of CC_CRITERIA) {
      if (c.control.kind === 'rule') expect(keys).toContain(c.control.key);
      if (c.control.kind === 'range') { expect(keys).toContain(c.control.minKey); expect(keys).toContain(c.control.maxKey); }
    }
  });

  it('a fixed criterion has no control the trader could change', () => {
    for (const c of CC_CRITERIA.filter((x) => x.fixed)) expect(c.control.kind, c.id).toBe('info');
  });

  it('the width is an editable percent-of-mid setting (SCAN-ALIGN-0001C2) on its own field, never the shared BID_ASK_MAX', () => {
    const width = getCcCriterion('width');
    expect(width.fixed).toBe(false);
    expect(width.unit).toBe('% of mid');
    expect(width.control.kind === 'rule' && width.control.key).toBe('WIDTH_PCT_MAX');
    if (width.control.kind !== 'rule') throw new Error('expected a rule control');
    expect(width.control.presets.map((p) => p.value)).toEqual([5, 10, 15]);
    expect(width.summary({ rules: { ...DEFAULT_CC_RULES } })).toBe('width ≤ 10% of mid (min $0.05)');
    expect(DEFAULT_CC_RULES.WIDTH_PCT_MAX).toBe(10);
    expect('BID_ASK_MAX' in DEFAULT_CC_RULES).toBe(false);
  });

  it('the width ceiling is a separate dollar control: default 0.50, presets $0.30/$0.50/$0.75', () => {
    const ceiling = getCcCriterion('widthCeiling');
    expect(ceiling.fixed).toBe(false);
    expect(ceiling.unit).toBe('$ per share');
    expect(DEFAULT_CC_RULES.WIDTH_CEILING).toBe(0.5);
    if (ceiling.control.kind !== 'rule') throw new Error('expected a rule control');
    expect(ceiling.control.key).toBe('WIDTH_CEILING');
    expect(ceiling.control.presets.map((p) => p.value)).toEqual([0.3, 0.5, 0.75]);
    expect(ceiling.summary({ rules: { ...DEFAULT_CC_RULES } })).toBe('cap $0.50');
  });

  it('open-interest quick selects are 100, 200, 300, 500', () => {
    const oi = getCcCriterion('oi').control;
    if (oi.kind !== 'rule') throw new Error('expected a rule control');
    expect(oi.presets.map((p) => p.value)).toEqual([100, 200, 300, 500]);
  });

  it('cards group the criteria in the order the modal renders them, with the receipt-only line left out', () => {
    expect(CC_CARD_ORDER).toEqual(['search', 'advisory', 'always']);
    expect(ccCriteriaForCard('search').map((c) => c.id)).toEqual(['dte', 'delta', 'width', 'widthCeiling']);
    expect(ccCriteriaForCard('advisory').map((c) => c.id)).toEqual(['oi']);
    expect(ccCriteriaForCard('always').map((c) => c.id)).toEqual(['minStrike', 'quoteValidity', 'earnings', 'capacity']);
  });
});

describe('receipts are built from the registry', () => {
  it('groups the search range, always-applied limits, advisory, and capacity', () => {
    const groups = byKey(buildCcReceipt(values()));
    expect(groups.search.items).toEqual(['21–45 DTE', 'Δ 0.20–0.35', 'width ≤ 10% of mid (min $0.05)', 'cap $0.50']);
    expect(groups.search.label).toContain('rescan to change');
    expect(groups.always.items).toEqual(['strike ≥ stock price (and cost basis when known)', 'two-sided quotes', 'expires before earnings']);
    expect(groups.advisory.items).toEqual(['OI 100']);
    expect(groups.adjustable.items).toEqual(['POP · OTM · IVR · Call OI chips · sort']);
    expect(groups.capacity.items).toEqual(['3 positions selected · up to 7 contracts']);
  });

  it('marks which groups need a rescan to change', () => {
    const groups = byKey(buildCcReceipt(values()));
    expect(groups.search.rescan).toBe(true);
    expect(groups.always.rescan).toBe(true);
    expect(groups.advisory.rescan).toBe(true);
    expect(groups.adjustable.rescan).toBe(false);
    expect(groups.capacity.rescan).toBe(false);
  });

  it('reflects the configured rules', () => {
    const groups = byKey(buildCcReceipt(values({ rules: { ...DEFAULT_CC_RULES, DTE_MIN: 14, DTE_MAX: 21, WIDTH_PCT_MAX: 5, WIDTH_CEILING: 0.3, OI_MIN: 500 } })));
    expect(groups.search.items).toEqual(['14–21 DTE', 'Δ 0.20–0.35', 'width ≤ 5% of mid (min $0.05)', 'cap $0.30']);
    expect(groups.advisory.items).toEqual(['OI 500']);
  });

  it('leaves the capacity line out when the positions are not known (a stored receipt, or holdings still loading)', () => {
    expect(byKey(buildCcReceipt(values({ positionsSelected: null }))).capacity).toBeUndefined();
    expect(byKey(buildCcReceipt({ rules: { ...DEFAULT_CC_RULES } })).capacity).toBeUndefined();
  });

  it('describes capacity with and without a contract total, and pluralizes', () => {
    expect(byKey(buildCcReceipt(values({ positionsSelected: 1, contractsAvailable: 1 }))).capacity.items).toEqual(['1 position selected · up to 1 contract']);
    expect(byKey(buildCcReceipt(values({ contractsAvailable: null }))).capacity.items).toEqual(['3 positions selected']);
  });

  it('carries the counts through to the receipt', () => {
    expect(buildCcReceipt(values(), { symbolsWithCandidate: 2, symbolsWithNone: 1 }).counts).toEqual({ symbolsWithCandidate: 2, symbolsWithNone: 1 });
    expect(buildCcReceipt(values()).counts).toBeNull();
  });
});

describe('summarizeCcResults counts symbols, because a CC scan returns one best call per symbol', () => {
  it('counts symbols with a candidate and symbols with none', () => {
    expect(summarizeCcResults([{ qualified: true }, { qualified: false }, { qualified: true }])).toEqual({ symbolsWithCandidate: 2, symbolsWithNone: 1 });
    expect(summarizeCcResults([])).toEqual({ symbolsWithCandidate: 0, symbolsWithNone: 0 });
  });
});

describe('ccFieldErrors keeps the validation the modal always enforced, now beside each field', () => {
  it('the defaults have no errors', () => {
    expect(ccFieldErrors({ ...DEFAULT_CC_RULES })).toEqual({});
  });

  it.each([
    ['DTE_MAX', { DTE_MIN: 45, DTE_MAX: 45 }],
    ['DTE_MIN', { DTE_MIN: -1 }],
    ['DELTA_MAX', { DELTA_MIN: 0.4, DELTA_MAX: 0.3 }],
    ['DELTA_MAX', { DELTA_MAX: 1.2 }],
    ['DELTA_MIN', { DELTA_MIN: -0.1 }],
    ['OI_MIN', { OI_MIN: -1 }],
    ['WIDTH_PCT_MAX', { WIDTH_PCT_MAX: -0.01 }],
    ['WIDTH_CEILING', { WIDTH_CEILING: -0.01 }],
    ['WIDTH_CEILING', { WIDTH_CEILING: 0 }],
    ['WIDTH_CEILING', { WIDTH_CEILING: 0.004 }],
  ])('flags %s for %j', (field, patch) => {
    expect(ccFieldErrors({ ...DEFAULT_CC_RULES, ...patch })[field]).toBeTruthy();
  });

  it('the ceiling message for a negative value, and a ceiling below the $0.05 floor is valid', () => {
    expect(ccFieldErrors({ ...DEFAULT_CC_RULES, WIDTH_CEILING: -0.01 }).WIDTH_CEILING).toBe('Width ceiling must be 0 or more.');
    expect(ccFieldErrors({ ...DEFAULT_CC_RULES, WIDTH_CEILING: 0.03 })).toEqual({});
  });

  it('flags a non-numeric value on its own field', () => {
    expect(ccFieldErrors({ ...DEFAULT_CC_RULES, DTE_MIN: Number.NaN }).DTE_MIN).toBe('Enter a number.');
  });
});
