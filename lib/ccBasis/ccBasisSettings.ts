// lib/ccBasis/ccBasisSettings.ts
// CC-WHEEL-0001 S2a -- per-user typed cost basis and per-position "allow strikes below my basis" opt-in.
//
// Pure: validation and the overlay onto broker capacity. Storage is app/api/cc-basis/route.ts (Redis per user).
// Precedence for a covered call's cost basis: typed > broker (a proven adjusted basis joins in S5). The source is
// always carried so the screen can say which number it is using.

import type { CoveredCallCapacity } from '@/lib/scans/covered-call-capacity';

export type CcBasisSource = 'typed' | 'broker';

export interface CcBasisEntry {
  /** Per-share cost basis the trader typed ("your basis"); null means none typed. */
  basis: number | null;
  /** Trader accepts strikes below the basis for this position (a loss if called). Never implied. */
  allowBelowBasis: boolean;
}

export type CcBasisSettings = Record<string, CcBasisEntry>;

const MAX_ENTRIES = 200;
const MAX_SYMBOL_LENGTH = 12;
const MAX_BASIS = 1_000_000;

export function normalizeCcBasisSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return s.length > 0 && s.length <= MAX_SYMBOL_LENGTH && /^[A-Z0-9.\-/]+$/.test(s) ? s : null;
}

function sanitizeBasis(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_BASIS) return null;
  return Math.round(raw * 10000) / 10000;
}

/** Drops anything malformed. An entry with no typed basis and no opt-in is dropped (it says nothing). */
export function sanitizeCcBasisSettings(raw: unknown): CcBasisSettings {
  const out: CcBasisSettings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    const symbol = normalizeCcBasisSymbol(key);
    if (!symbol || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const basis = sanitizeBasis(v.basis);
    const allowBelowBasis = v.allowBelowBasis === true;
    if (basis === null && !allowBelowBasis) continue;
    out[symbol] = { basis, allowBelowBasis };
  }
  return out;
}

export interface ResolvedCcBasis {
  basis: number | null;
  source: CcBasisSource | null;
  allowBelowBasis: boolean;
}

/** The basis a covered call is judged against for one symbol, and where it came from. */
export function resolveCcBasis(settings: CcBasisSettings, symbol: string, capacity: CoveredCallCapacity | null): ResolvedCcBasis {
  const key = normalizeCcBasisSymbol(symbol);
  const entry = key ? settings[key] : undefined;
  const allowBelowBasis = entry?.allowBelowBasis === true;
  if (entry && entry.basis !== null) return { basis: entry.basis, source: 'typed', allowBelowBasis };
  const broker = capacity && capacity.costBasisComplete && capacity.costBasis !== null && capacity.costBasis > 0 ? capacity.costBasis : null;
  return { basis: broker, source: broker === null ? null : 'broker', allowBelowBasis };
}

/**
 * Capacity with the typed basis laid over the broker's. Share counts, existing and working calls are never touched.
 * With no typed basis the capacity is returned unchanged.
 */
export function applyTypedBasis(settings: CcBasisSettings, symbol: string, capacity: CoveredCallCapacity): CoveredCallCapacity {
  const resolved = resolveCcBasis(settings, symbol, capacity);
  if (resolved.source !== 'typed') return capacity;
  return { ...capacity, costBasis: resolved.basis, costBasisComplete: true };
}
