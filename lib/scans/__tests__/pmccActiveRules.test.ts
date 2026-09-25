// lib/scans/__tests__/pmccActiveRules.test.ts

import { describe, expect, it } from 'vitest';
import { formatPmccActiveRules, pmccScanEntryMode } from '../pmccActiveRules';

const full = {
  criteria: {
    dte: { shortMin: 21, shortMax: 45, longMin: 180, longMax: 730 },
    shortOiMin: 100,
    quotePolicy: { qualifyingSpreadPctMax: 10, shortWidthCeiling: 0.5 },
  },
};
const text = (r: ReturnType<typeof formatPmccActiveRules>) => JSON.stringify(r);

describe('formatPmccActiveRules', () => {
  it('full snapshot: items in order with approved wording', () => {
    const r = formatPmccActiveRules(full, 'new-pmcc')!;
    expect(r.heading).toBe('Active PMCC rules · new LEAP + short call');
    expect(r.items.map(i => `${i.label} ${i.value}`)).toEqual([
      'Short DTE 21–45',
      'Max spread 10% of mid (min $0.05)',
      'Width ceiling $0.50',
      'Short OI ≥ 100',
      'Earnings Short calls expiring on or after the report are removed',
    ]);
    expect(r.caption).toBe('Short call rules only. LEAP rules are not shown.');
    expect(text(r)).not.toMatch(/Δ|delta/i);
  });

  it('held heading', () => {
    expect(formatPmccActiveRules(full, 'covered-short-call-against-held-leaps')!.heading).toBe('Active PMCC rules · Held LEAP');
  });

  it('partial snapshot omits missing items (older snapshot without a ceiling)', () => {
    const r = formatPmccActiveRules({ criteria: { dte: { shortMin: 30, shortMax: 45 }, quotePolicy: { qualifyingSpreadPctMax: 10 } } })!;
    expect(r.items.map(i => i.label)).toEqual(['Short DTE', 'Max spread', 'Earnings']);
  });

  it('empty criteria keeps only the static earnings rule; no snapshot renders nothing', () => {
    expect(formatPmccActiveRules({})!.items.map(i => i.label)).toEqual(['Earnings']);
    expect(formatPmccActiveRules({ criteria: null })!.items.map(i => i.label)).toEqual(['Earnings']);
    expect(formatPmccActiveRules(null)).toBeNull();
    expect(formatPmccActiveRules(undefined)).toBeNull();
  });

  it('non-finite or wrong-typed values are omitted and never render NaN/null/undefined', () => {
    const r = formatPmccActiveRules({
      criteria: {
        dte: { shortMin: NaN, shortMax: 45 },
        shortOiMin: Infinity,
        quotePolicy: { qualifyingSpreadPctMax: null, shortWidthCeiling: '0.5' },
      },
    })!;
    expect(r.items.map(i => i.label)).toEqual(['Earnings']);
    expect(text(r)).not.toMatch(/NaN|null|undefined|Infinity/);
  });

  it('formats a custom ceiling and spread without float noise', () => {
    const r = formatPmccActiveRules({ criteria: { quotePolicy: { qualifyingSpreadPctMax: 7.5, shortWidthCeiling: 0.75 } } })!;
    expect(r.items[0].value).toBe('7.5% of mid (min $0.05)');
    expect(r.items[1].value).toBe('$0.75');
  });

  it('reads only the snapshot: later changes to live controls do not change the line', () => {
    const live = { maxSpreadPct: 10, widthCeiling: 0.5 };
    const snapshot = { criteria: { quotePolicy: { qualifyingSpreadPctMax: live.maxSpreadPct, shortWidthCeiling: live.widthCeiling } } };
    const before = text(formatPmccActiveRules(snapshot));
    live.maxSpreadPct = 3;
    live.widthCeiling = 0.1;
    expect(text(formatPmccActiveRules(snapshot))).toBe(before);
  });
});

describe('pmccScanEntryMode', () => {
  it('held when any result is held or when there are no results; new only when explicit', () => {
    expect(pmccScanEntryMode([])).toBe('covered-short-call-against-held-leaps');
    expect(pmccScanEntryMode(null)).toBe('covered-short-call-against-held-leaps');
    expect(pmccScanEntryMode([{ pmccPair: { entryMode: 'new-pmcc' } }])).toBe('new-pmcc');
    expect(pmccScanEntryMode([{ pmccPair: { entryMode: 'new-pmcc' } }, { pmccPair: { entryMode: 'covered-short-call-against-held-leaps' } }])).toBe('covered-short-call-against-held-leaps');
  });
});
