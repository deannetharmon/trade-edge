// lib/screener/__tests__/rsiEntryRegistry.test.ts

// RSI-ENTRY-0001 slice A2a: the entry timing criterion in the CSP and CC registries, the receipt line and pass count,
// and the optional stored-snapshot field (older sessions stay valid and read as Off).

import { describe, expect, it } from 'vitest';
import { DEFAULT_CC_RULES, DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import { buildCspRuleSnapshot, isValidCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { defaultRsiEntrySettings } from '@/lib/indicators/rsiEntrySettings';
import { CSP_CRITERIA, buildCspReceipt, summarizeCspResults, valuesFromSnapshot, type CspConfigValues } from '../scanConfig/cspRegistry';
import { CC_CRITERIA, buildCcReceipt, summarizeCcResults } from '../scanConfig/ccRegistry';

const cspValues = (over: Partial<CspConfigValues> = {}): CspConfigValues => ({
  mode: 'rank', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none',
  affordableOnly: false, capitalLimit: null, ...over,
});
const on = (strategy: 'CSP' | 'CC', over = {}) => ({ ...defaultRsiEntrySettings(strategy), on: true, ...over });
const advisory = (groups: Array<{ key: string; items: string[] }>) => groups.find((g) => g.key === 'advisory')!.items;
const rsiLine = (items: string[]) => items.find((i) => i.startsWith('RSI timing'));

describe('the criterion', () => {
  it('is a preference (rank lifecycle), adjustable, needs a rescan, in its own card', () => {
    for (const registry of [CSP_CRITERIA, CC_CRITERIA]) {
      const c = registry.find((x) => x.id === 'rsiTiming')!;
      expect(c).toMatchObject({ lifecycle: 'rank', fixed: false, rescan: true, card: 'timing', summaryGroup: 'advisory' });
      expect(c.control).toEqual({ kind: 'rsi-entry' });
      expect(c.label).toBe('Entry timing (RSI)');
    }
  });
  it('the hint says Wait stays tradeable and no usable RSI counts as Wait', () => {
    for (const registry of [CSP_CRITERIA, CC_CRITERIA]) {
      const hint = registry.find((x) => x.id === 'rsiTiming')!.hint;
      expect(hint).toContain('Wait');
      expect(hint).toContain('can still be traded');
      expect(hint).toContain('No usable RSI counts as Wait');
    }
  });
});

describe('CSP receipt', () => {
  it('always states Off, including for a stored session that has no RSI setting', () => {
    expect(rsiLine(advisory(buildCspReceipt(cspValues()).groups))).toBe('RSI timing: Off');
    expect(rsiLine(advisory(buildCspReceipt(cspValues({ rsi: defaultRsiEntrySettings('CSP') })).groups))).toBe('RSI timing: Off');
  });
  it('states On with the dip level, and the pass count once results exist', () => {
    const values = cspValues({ rsi: on('CSP') });
    expect(rsiLine(advisory(buildCspReceipt(values).groups))).toBe('RSI timing: On · dip at or below 40');
    const counts = { qualified: 24, targetedNearMisses: 0, disqualified: 3, symbolsIvrUnavailable: 0, rsi: { pass: 6, total: 24 } };
    expect(rsiLine(advisory(buildCspReceipt(values, counts).groups))).toBe('RSI timing: On · dip at or below 40 · 6 of 24 pass');
  });
  it('is present in every mode', () => {
    for (const mode of ['rank', 'targeted', 'filter'] as const) {
      expect(rsiLine(advisory(buildCspReceipt(cspValues({ mode })).groups))).toBe('RSI timing: Off');
    }
  });
  it('rebuilds from a stored snapshot, and an older snapshot without the field reads as Off', () => {
    const withRsi = buildCspRuleSnapshot({ ...DEFAULT_CSP_RULES }, { rsiEntry: on('CSP', { level: 30 }) });
    expect(rsiLine(advisory(buildCspReceipt(valuesFromSnapshot(withRsi)).groups))).toBe('RSI timing: On · dip at or below 30');
    const older = buildCspRuleSnapshot({ ...DEFAULT_CSP_RULES });
    expect('rsiEntry' in older).toBe(false);
    expect(rsiLine(advisory(buildCspReceipt(valuesFromSnapshot(older)).groups))).toBe('RSI timing: Off');
  });
});

describe('CC receipt', () => {
  const ccValues = (rsi?: ReturnType<typeof on>) => ({ rules: { ...DEFAULT_CC_RULES }, rsi });
  it('states Off by default and On with the peak level and pass count', () => {
    expect(rsiLine(advisory(buildCcReceipt(ccValues()).groups))).toBe('RSI timing: Off');
    const counts = { symbolsWithCandidate: 3, symbolsWithNone: 1, rsi: { pass: 1, total: 3 } };
    expect(rsiLine(advisory(buildCcReceipt(ccValues(on('CC')), counts).groups))).toBe('RSI timing: On · peak at or above 60 · 1 of 3 pass');
  });
});

describe('pass counts', () => {
  it('CSP counts only qualified candidates that carry a verdict, and omits the count when none do', () => {
    const base = { symbol: 'AAPL', ivr: 40, bestCandidate: null };
    const results = [
      { ...base, qualified: true, rsiEntry: { verdict: 'PASS' } },
      { ...base, qualified: true, rsiEntry: { verdict: 'WAIT' } },
      { ...base, qualified: true, rsiEntry: { verdict: 'UNAVAILABLE' } },
      { ...base, qualified: false, rsiEntry: { verdict: 'PASS' } },
      { ...base, qualified: true },
    ];
    expect(summarizeCspResults(results).rsi).toEqual({ pass: 1, total: 3 });
    expect(summarizeCspResults([{ ...base, qualified: true }]).rsi).toBeUndefined();
    expect('rsi' in summarizeCspResults([])).toBe(false);
  });
  it('CC counts the same way', () => {
    const results = [
      { qualified: true, rsiEntry: { verdict: 'PASS' } },
      { qualified: true, rsiEntry: { verdict: 'WAIT' } },
      { qualified: false },
    ];
    expect(summarizeCcResults(results)).toEqual({ symbolsWithCandidate: 2, symbolsWithNone: 1, rsi: { pass: 1, total: 2 } });
    expect(summarizeCcResults([{ qualified: true }]).rsi).toBeUndefined();
  });
});

describe('stored snapshot', () => {
  const base = () => buildCspRuleSnapshot({ ...DEFAULT_CSP_RULES }, { source: 'user' });
  it('stays valid without the field (older sessions) and with a complete one', () => {
    expect(isValidCspRuleSnapshot(base())).toBe(true);
    expect(isValidCspRuleSnapshot({ ...base(), rsiEntry: on('CSP') })).toBe(true);
  });
  it('rejects a malformed RSI field', () => {
    for (const bad of [null, 5, 'on', {}, { on: true }, { ...on('CSP'), level: NaN }]) {
      expect(isValidCspRuleSnapshot({ ...base(), rsiEntry: bad })).toBe(false);
    }
  });
  it('the builder stores a copy, not the caller\'s object', () => {
    const setting = on('CSP');
    const snap = buildCspRuleSnapshot({ ...DEFAULT_CSP_RULES }, { rsiEntry: setting });
    setting.level = 10;
    expect(snap.rsiEntry!.level).toBe(40);
  });
});
