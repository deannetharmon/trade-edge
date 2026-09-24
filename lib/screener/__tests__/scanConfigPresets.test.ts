// SCREENER-CONFIG-0001A -- the shared pill and input contract: a pill updates its field,
// typed input that matches a preset exactly selects that preset, anything else is Custom.

import { describe, it, expect } from 'vitest';
import {
  OI_PRESET_VALUES, matchRangePreset, matchScalarPreset, oiPresets, sameNumber, selectRange, selectScalar,
} from '@/lib/screener/scanConfig/presets';
import type { RangePreset, ScalarPreset } from '@/lib/screener/scanConfig/types';

const POP: ScalarPreset[] = [{ label: 'Any', value: null }, { label: '65%', value: 65 }, { label: '70%', value: 70 }];
const DELTA: RangePreset[] = [{ label: 'Δ .12–.20', min: 0.12, max: 0.2 }, { label: 'Δ .15–.25', min: 0.15, max: 0.25 }];

describe('scalar presets', () => {
  it('an exact typed value selects its preset', () => {
    expect(matchScalarPreset(70, POP)?.label).toBe('70%');
    expect(selectScalar(65, POP)).toEqual({ kind: 'preset', preset: POP[1] });
  });

  it('any other valid value is Custom', () => {
    expect(matchScalarPreset(72, POP)).toBeNull();
    expect(selectScalar(72, POP)).toEqual({ kind: 'custom' });
  });

  it('the off state is a preset of its own: null selects Any, never Custom', () => {
    expect(matchScalarPreset(null, POP)?.label).toBe('Any');
    expect(matchScalarPreset(undefined, POP)?.label).toBe('Any');
    expect(matchScalarPreset(0, POP)).toBeNull();
  });

  it('a preset with no off state treats a missing value as Custom', () => {
    expect(matchScalarPreset(null, oiPresets())).toBeNull();
  });
});

describe('range presets', () => {
  it('a min and max that both match select the preset', () => {
    expect(matchRangePreset(0.15, 0.25, DELTA)?.label).toBe('Δ .15–.25');
  });

  it('matches through float noise from typed decimals', () => {
    expect(matchRangePreset(0.1 + 0.05, 0.2 + 0.05, DELTA)?.label).toBe('Δ .15–.25');
    expect(sameNumber(0.30000000000000004, 0.3)).toBe(true);
  });

  it('one end off is Custom, even when the other end matches', () => {
    expect(matchRangePreset(0.15, 0.3, DELTA)).toBeNull();
    expect(selectRange(0.13, 0.25, DELTA)).toEqual({ kind: 'custom' });
  });
});

describe('open-interest presets', () => {
  it('are 100, 200, 300, and 500 everywhere', () => {
    expect(OI_PRESET_VALUES).toEqual([100, 200, 300, 500]);
    expect(oiPresets().map((p) => p.value)).toEqual([100, 200, 300, 500]);
    expect(oiPresets().map((p) => p.label)).toEqual(['100', '200', '300', '500']);
  });
});
