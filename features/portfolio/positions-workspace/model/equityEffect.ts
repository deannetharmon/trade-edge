// features/portfolio/positions-workspace/model/equityEffect.ts

// VALUE-SIGNED-0001: display helpers for the signed equity effect of option
// positions. Display only; P/L, stops and recommendations are unaffected.

import type { Position } from '@/lib/portfolio-data/types';

export type EquityEffectTotal = { total: number; included: number; excluded: number };

export function signedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  const rounded = Math.round(value);
  const body = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(rounded));
  if (rounded === 0) return body;
  return (rounded < 0 ? '−' : '+') + body;
}

export function sumEquityEffect(positions: Position[], which: 'mid' | 'close'): EquityEffectTotal {
  let total = 0; let included = 0; let excluded = 0;
  for (const p of positions) {
    const v = which === 'mid' ? p.equityEffectMid : p.equityEffectClose;
    if (v == null || !Number.isFinite(v)) { excluded += 1; continue; }
    total += v; included += 1;
  }
  return { total, included, excluded };
}

export function equityEffectSortValue(p: Position): number | null {
  return p.equityEffectClose ?? p.equityEffectMid ?? null;
}
