// lib/screener/scanConfig/presets.ts
//
// Preset matching for the shared pill and input contract:
//   - a pill updates its matching field;
//   - typed input that matches a preset exactly selects that preset;
//   - any other valid value selects Custom.
// Pure functions, no React, so every transition is testable.

import type { RangePreset, ScalarPreset } from './types';

/** Open-interest quick selects, shared by every strategy's OI control. */
export const OI_PRESET_VALUES: readonly number[] = [100, 200, 300, 500];

const EPSILON = 1e-9;

export function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a === b || Math.abs(a - b) < EPSILON;
}

/** The preset a scalar value exactly matches, or null when the value is Custom. */
export function matchScalarPreset(value: number | null | undefined, presets: readonly ScalarPreset[]): ScalarPreset | null {
  return presets.find((preset) => sameNumber(preset.value, value ?? null)) ?? null;
}

/** The preset a min/max pair exactly matches, or null when the pair is Custom. */
export function matchRangePreset(min: number, max: number, presets: readonly RangePreset[]): RangePreset | null {
  return presets.find((preset) => sameNumber(preset.min, min) && sameNumber(preset.max, max)) ?? null;
}

export type PresetSelection<T> = { kind: 'preset'; preset: T } | { kind: 'custom' };

export function selectScalar(value: number | null | undefined, presets: readonly ScalarPreset[]): PresetSelection<ScalarPreset> {
  const preset = matchScalarPreset(value, presets);
  return preset ? { kind: 'preset', preset } : { kind: 'custom' };
}

export function selectRange(min: number, max: number, presets: readonly RangePreset[]): PresetSelection<RangePreset> {
  const preset = matchRangePreset(min, max, presets);
  return preset ? { kind: 'preset', preset } : { kind: 'custom' };
}

export function oiPresets(): ScalarPreset[] {
  return OI_PRESET_VALUES.map((value) => ({ label: String(value), value }));
}
