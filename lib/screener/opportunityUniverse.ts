// path: lib/screener/opportunityUniverse.ts
//
// TE-0007 — Unified Screener Launcher.
//
// One canonical "Opportunity Universe" ticker list answers "which companies
// am I willing to evaluate." Strategy launcher buttons (Find Spreads, Find
// CSPs, Find Covered Calls, Find PMCCs) all read the SAME normalized array
// produced here. This module is deliberately pure and framework-free (no
// React, no localStorage access in the exported normalize/migrate
// functions) so it can be unit tested deterministically; the small
// load/save wrapper functions at the bottom are the only pieces that touch
// `localStorage`, and they're thin enough not to need their own tests
// beyond the ones that exercise them directly against jsdom's localStorage.
//
// Migration (see migrateOpportunityUniverse): before this ticket, ticker
// state was split three ways —
//   - the general/primary Screener list (`hunter-watchlist`, richer
//     WatchlistTicker[] shape, used by BPS/BCS/IC/Targeted/Rank scans)
//   - a free-form comma-separated CSP list (`hunter-tickers-csp`)
//   - a free-form comma-separated PMCC list (`hunter-tickers-pmcc`)
// The canonical universe is the ordered, deduplicated union of all three,
// computed once (the first time the new canonical key is read and doesn't
// exist yet) so no previously-saved ticker is silently discarded. After
// that first migration, the canonical key is authoritative and the legacy
// keys are no longer written to (only left readable for a compatibility
// period).

import { normalizeTickerToken } from '@/lib/scans/scan-utils';

/** New canonical key. Read by loadOrMigrateOpportunityUniverse(), written
 *  by saveOpportunityUniverse(). This is the ONE new localStorage key the
 *  ticket calls for. */
export const LS_OPPORTUNITY_UNIVERSE = 'hunter-opportunity-universe';

/** Legacy keys, documented here so the exact migration inputs are traceable
 *  from one place. Left readable during a compatibility period; no longer
 *  written to once the canonical key exists. */
export const LS_LEGACY_PRIMARY_WATCHLIST = 'hunter-watchlist';
export const LS_LEGACY_CSP_TICKERS = 'hunter-tickers-csp';
export const LS_LEGACY_PMCC_TICKERS = 'hunter-tickers-pmcc';

/**
 * Normalize a list of raw ticker strings into the canonical Opportunity
 * Universe shape: uppercase, trimmed, deduplicated, invalid/empty entries
 * rejected, deterministic input order preserved (first occurrence wins).
 *
 * Reuses the same per-token validation (normalizeTickerToken) as the
 * existing ticker-entry boxes so the universe accepts exactly the same
 * shapes (BRK-B, BF-B, one-character tickers like C/F/T/X/V, etc.) that
 * already work elsewhere in the Screener.
 */
export function normalizeUniverse(symbols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    if (typeof raw !== 'string') continue;
    const token = normalizeTickerToken(raw);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Deterministic migration: ordered unique union of (1) existing primary
 * Screener tickers, (2) existing CSP tickers, (3) existing PMCC tickers —
 * in that exact order, so ties in de-duplication consistently keep the
 * primary list's ordering first. Pure — no I/O.
 */
export function migrateOpportunityUniverse(legacy: {
  primary: string[];
  csp: string[];
  pmcc: string[];
}): string[] {
  return normalizeUniverse([...legacy.primary, ...legacy.csp, ...legacy.pmcc]);
}

/** Parses a legacy free-form comma/whitespace-separated ticker string
 *  (the shape `hunter-tickers-csp` / `hunter-tickers-pmcc` were stored in)
 *  into raw candidate tokens for normalizeUniverse(). */
export function parseLegacyCommaList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/).filter(Boolean);
}

/** Extracts raw symbol candidates from a legacy `hunter-watchlist` JSON
 *  payload, tolerant of both the current WatchlistTicker[] shape and a
 *  plain string[] (defensive — in case of an even older cached shape). */
export function extractLegacyPrimarySymbols(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t: unknown) => {
        if (typeof t === 'string') return t;
        if (t && typeof t === 'object' && 'symbol' in t) {
          const s = (t as { symbol: unknown }).symbol;
          return typeof s === 'string' ? s : null;
        }
        return null;
      })
      .filter((s): s is string => Boolean(s));
  } catch {
    return [];
  }
}

/**
 * Loads the canonical Opportunity Universe, running the legacy migration
 * exactly once: only when LS_OPPORTUNITY_UNIVERSE does not already exist.
 * Once it exists, it is authoritative and this function never re-derives
 * it from the legacy keys again (repeated calls are idempotent).
 */
export function loadOrMigrateOpportunityUniverse(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string[] {
  try {
    const existing = storage.getItem(LS_OPPORTUNITY_UNIVERSE);
    if (existing != null) {
      const parsed = JSON.parse(existing);
      return normalizeUniverse(Array.isArray(parsed) ? parsed : []);
    }
  } catch {
    // fall through to migration
  }

  const primary = extractLegacyPrimarySymbols(safeGet(storage, LS_LEGACY_PRIMARY_WATCHLIST));
  const csp = parseLegacyCommaList(safeGet(storage, LS_LEGACY_CSP_TICKERS));
  const pmcc = parseLegacyCommaList(safeGet(storage, LS_LEGACY_PMCC_TICKERS));
  const migrated = migrateOpportunityUniverse({ primary, csp, pmcc });

  try { storage.setItem(LS_OPPORTUNITY_UNIVERSE, JSON.stringify(migrated)); } catch {}
  return migrated;
}

export function saveOpportunityUniverse(universe: string[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(LS_OPPORTUNITY_UNIVERSE, JSON.stringify(normalizeUniverse(universe))); } catch {}
}

function safeGet(storage: Pick<Storage, 'getItem'>, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
