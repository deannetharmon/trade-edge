// lib/scans/__tests__/cspViewPresets.test.ts

import { describe, it, expect } from 'vitest';
import { CSP_VIEW_PRESETS, DEFAULT_CSP_VIEW_PRESET, detectCspPreset, cspViewFromPreset } from '../cspView';
import { DEFAULT_CSP_RULES } from '../constants';

// PRESETS-0001 (Ian, approved by Dean): the three CSP view presets.
describe('CSP view presets', () => {
  const by = (k: string) => CSP_VIEW_PRESETS.find(p => p.key === k)!;
  it('Conservative: lower delta, less event risk, deeper liquidity', () => {
    expect(by('conservative')).toMatchObject({ deltaMin: 0.10, deltaMax: 0.20, ivrMin: 30, ivrMax: 60, oiMin: 1000 });
  });
  it('Balanced equals the scan defaults', () => {
    expect(by('balanced')).toMatchObject({ deltaMin: DEFAULT_CSP_RULES.DELTA_MIN, deltaMax: DEFAULT_CSP_RULES.DELTA_MAX, ivrMin: DEFAULT_CSP_RULES.IVR_MIN, oiMin: DEFAULT_CSP_RULES.OI_MIN });
    expect(DEFAULT_CSP_VIEW_PRESET).toBe('balanced');
  });
  it('More opportunities is unchanged', () => {
    expect(by('opportunity')).toMatchObject({ deltaMin: 0.12, deltaMax: 0.30, ivrMin: 20, ivrMax: 75, oiMin: 250 });
  });
  it('each preset round-trips through detectCspPreset', () => {
    for (const p of CSP_VIEW_PRESETS) expect(detectCspPreset(cspViewFromPreset(p.key, 30, 45))).toBe(p.key);
  });
});
