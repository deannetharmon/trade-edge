// lib/scans/__tests__/cspRuleSnapshot.test.ts
// CSP-WORKFLOW-0001 core-correction (BLOCKER-06) — pure tests for the
// canonical CSP rule-snapshot builder and structural validator.

import { describe, expect, it } from 'vitest';
import { buildCspRuleSnapshot, isValidCspRuleSnapshot } from '../cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '../constants';

describe('buildCspRuleSnapshot', () => {
  it('maps every field of DEFAULT_CSP_RULES into the snapshot, faithfully', () => {
    const snapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES, { now: new Date('2026-08-01T00:00:00.000Z') });
    expect(snapshot).toEqual({
      mode: 'filter',
      preset: 'balanced',
      ivrMin: DEFAULT_CSP_RULES.IVR_MIN,
      ivrMax: DEFAULT_CSP_RULES.IVR_MAX,
      deltaMin: DEFAULT_CSP_RULES.DELTA_MIN,
      deltaMax: DEFAULT_CSP_RULES.DELTA_MAX,
      dteMin: DEFAULT_CSP_RULES.DTE_MIN,
      dteMax: DEFAULT_CSP_RULES.DTE_MAX,
      oiMin: DEFAULT_CSP_RULES.OI_MIN,
      bidAskMax: DEFAULT_CSP_RULES.BID_ASK_MAX,
      popMin: null,
      otmMin: null,
      rocMin: null,
      rankPrimary: 'score',
      rankSecondary: 'none',
      earningsPolicy: 'disqualify-within-expiration',
      capturedAt: '2026-08-01T00:00:00.000Z',
      source: 'default',
    });
  });

  it('defaults source to "default" and capturedAt to the current time when not supplied', () => {
    const before = Date.now();
    const snapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES);
    const after = Date.now();
    expect(snapshot.source).toBe('default');
    const capturedMs = new Date(snapshot.capturedAt).getTime();
    expect(capturedMs).toBeGreaterThanOrEqual(before);
    expect(capturedMs).toBeLessThanOrEqual(after);
  });

  it('supports source "user", reserved for the future CSP configuration modal', () => {
    const snapshot = buildCspRuleSnapshot(DEFAULT_CSP_RULES, { source: 'user' });
    expect(snapshot.source).toBe('user');
  });
});

describe('isValidCspRuleSnapshot', () => {
  const valid = buildCspRuleSnapshot(DEFAULT_CSP_RULES);

  it('accepts a snapshot built by buildCspRuleSnapshot', () => {
    expect(isValidCspRuleSnapshot(valid)).toBe(true);
  });

  it('rejects null/undefined/non-object values', () => {
    expect(isValidCspRuleSnapshot(null)).toBe(false);
    expect(isValidCspRuleSnapshot(undefined)).toBe(false);
    expect(isValidCspRuleSnapshot('not an object')).toBe(false);
    expect(isValidCspRuleSnapshot(42)).toBe(false);
  });

  it('rejects a snapshot missing any single required numeric field', () => {
    const fields = ['ivrMin', 'ivrMax', 'deltaMin', 'deltaMax', 'dteMin', 'dteMax', 'oiMin', 'bidAskMax'];
    for (const field of fields) {
      const { [field]: _omit, ...withoutField } = valid as any;
      expect(isValidCspRuleSnapshot(withoutField)).toBe(false);
    }
  });

  it('rejects a snapshot with a non-numeric field (e.g. tampered to a string)', () => {
    expect(isValidCspRuleSnapshot({ ...valid, ivrMin: 'thirty' })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, oiMin: NaN })).toBe(false);
  });

  it('rejects a missing or empty capturedAt', () => {
    const { capturedAt: _omit, ...withoutCapturedAt } = valid as any;
    expect(isValidCspRuleSnapshot(withoutCapturedAt)).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, capturedAt: '' })).toBe(false);
  });

  it('rejects a source outside "default"/"user"', () => {
    expect(isValidCspRuleSnapshot({ ...valid, source: 'admin' })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, source: undefined })).toBe(false);
  });

  it.each([
    ['inverted IVR', { ivrMin: 70, ivrMax: 30 }],
    ['IVR outside percentage bounds', { ivrMin: -1 }],
    ['inverted delta', { deltaMin: 0.3, deltaMax: 0.2 }],
    ['delta outside unit bounds', { deltaMax: 1.01 }],
    ['negative DTE', { dteMin: -1 }],
    ['inverted DTE', { dteMin: 45, dteMax: 30 }],
    ['negative OI', { oiMin: -1 }],
    ['negative bid/ask maximum', { bidAskMax: -0.01 }],
  ])('rejects semantically invalid rule ranges: %s', (_label, fields) => {
    expect(isValidCspRuleSnapshot({ ...valid, ...fields })).toBe(false);
  });

  it('requires at least one bounded narrowing threshold in Targeted mode', () => {
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'targeted' })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'targeted', popMin: 70 })).toBe(true);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'targeted', popMin: 101 })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'targeted', otmMin: -1 })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'targeted', rocMin: -1 })).toBe(false);
  });

  it('rejects Targeted-only thresholds outside Targeted mode', () => {
    expect(isValidCspRuleSnapshot({ ...valid, popMin: 70 })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'rank', rankSecondary: 'rocPct', otmMin: 5 })).toBe(false);
  });

  it('rejects score as its own secondary sort and any secondary sort outside Rank mode', () => {
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'rank', rankSecondary: 'score' })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, rankSecondary: 'rocPct' })).toBe(false);
    expect(isValidCspRuleSnapshot({ ...valid, mode: 'rank', rankSecondary: 'rocPct' })).toBe(true);
  });
});
