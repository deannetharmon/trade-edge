// lib/scans/__tests__/cspIntentView.test.ts

import { describe, it, expect } from 'vitest';
import { applyIntentToView } from '../cspIntent';
import { cspViewFromPreset } from '../cspView';

describe('INTENT-VIEW-0001 applyIntentToView', () => {
  const base = cspViewFromPreset('balanced', 7, 60);
  it('premium keeps the preset, including the 70 IVR cap', () => {
    expect(applyIntentToView(base, 'premium', false)).toBe(base);
    expect(base.ivrMax).toBe(70);
  });
  it('wheel swaps in its delta band and lifts the IVR cap', () => {
    const v = applyIntentToView(base, 'wheel', false);
    expect([v.deltaMin, v.deltaMax, v.ivrMax]).toEqual([0.30, 0.55, 100]);
    expect(v.oiMin).toBe(base.oiMin);
  });
  it('the All preset and a hand-edited view are left alone', () => {
    const all = cspViewFromPreset('all', 7, 60);
    expect(applyIntentToView(all, 'wheel', false)).toBe(all);
    expect(applyIntentToView(base, 'wheel', true)).toBe(base);
  });
});
