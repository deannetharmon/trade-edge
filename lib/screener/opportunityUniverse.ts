// path: lib/screener/opportunityUniverse.ts
//
// TE-0007 — Unified Screener Launcher.
//
// One canonical "Opportunity Universe" ticker list answers "which companies
// am I willing to evaluate." Strategy launcher buttons (Find Spreads, Find
// CSPs, Find Covered Calls, Find PMCCs) all read the SAME normalized array
// produced by deriving it from the primary ticker list.
//
// Persistence authority (TE-0007 corrective pass — required correction 2):
// `tickers` (the WatchlistTicker[]-shaped primary Screener list, persisted
// via /api/watchlist and mirrored to localStorage['hunter-watchlist']) is
// the ONE authoritative source of truth. `LS_OPPORTUNITY_UNIVERSE` is not
// an independent authority and production code never reads it back to
// reconstruct UI state — it is a derived, write-only mirror of
// `tickers.filter(active).map(symbol)`, persisted purely so the canonical
// array is inspectable/testable independent of the richer ticker shape,
// and so the migration-gate check ("has migration already run") has
// somewhere durable to look. The Opportunity Universe rendered in the UI
// and read by every strategy button is always computed fresh from
// `tickers`, never from this mirror.
//
// Migration (see migratePrimaryTickers): before this ticket, ticker state
// was split three ways — the general/primary Screener list, a free-form
// comma-separated CSP list (`hunter-tickers-csp`), and a free-form
// comma-separated PMCC list (`hunter-tickers-pmcc`). There is exactly ONE
// canonical migration algorithm (migratePrimaryTickers below); production
// (app/screener/page.tsx) and this module's tests both exercise that same
// function — there is no separate, differently-behaved migration path.

import { normalizeTickerToken } from '@/lib/scans/scan-utils';

/** New canonical key — the derived, write-only mirror described above. */
export const LS_OPPORTUNITY_UNIVERSE = 'hunter-opportunity-universe';

/** Legacy keys, documented here so the exact migration inputs are traceable
 *  from one place. Left readable during a compatibility period; no longer
 *  written to once migration has run. The legacy primary list
 *  (`hunter-watchlist`) itself is NOT read directly by this module —
 *  production passes its already-loaded, already-hydrated `tickers` state
 *  into migratePrimaryTickers() instead of re-reading a possibly-stale
 *  localStorage snapshot. */
export const LS_LEGACY_PRIMARY_WATCHLIST = 'hunter-watchlist';
export const LS_LEGACY_CSP_TICKERS = 'hunter-tickers-csp';
export const LS_LEGACY_PMCC_TICKERS = 'hunter-tickers-pmcc';

/**
 * Normalize a list of raw ticker strings into the canonical Opportunity
 * Universe shape: uppercase, trimmed, deduplicated, invalid/empty entries
 * rejected, deterministic input order preserved (first occurrence wins).
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

/** Parses a legacy free-form comma/whitespace-separated ticker string
 *  (the shape `hunter-tickers-csp` / `hunter-tickers-pmcc` were stored in)
 *  into raw candidate tokens. */
export function parseLegacyCommaList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/).filter(Boolean);
}

export interface MigratableTicker {
  symbol: string;
  active: boolean;
}

/**
 * THE single canonical migration algorithm — pure, synchronous, fully
 * tested. Production (app/screener/page.tsx) calls this exact function;
 * there is no separate/parallel merge-and-reactivate logic anywhere else.
 *
 * Folds legacy CSP/PMCC ticker-list symbols into the existing primary
 * ticker list:
 *  - a legacy symbol not already present is appended (via `makeNew`) and
 *    marked active.
 *  - a legacy symbol already present is REACTIVATED if it was inactive —
 *    its presence in a legacy CSP/PMCC list proves it was previously
 *    selected for scanning, so "already exists in the primary list" is
 *    not by itself a reason to leave it inactive and exclude it from the
 *    migrated universe (this is the exact defect required correction 1
 *    fixes: NKE active + MU inactive in the primary list, MU also in the
 *    legacy CSP list, must migrate to NKE active + MU active, not silently
 *    drop MU from the universe because it was "already present").
 *  - a legacy symbol already present and already active is left untouched.
 *  - no ticker is ever removed.
 *  - existing tickers keep their original array order; newly-added legacy
 *    symbols are appended afterward in normalizeUniverse's deterministic
 *    order.
 *  - idempotent: calling this again with the same inputs (including
 *    against its own prior output) makes no further changes.
 */
export function migratePrimaryTickers<T extends MigratableTicker>(
  existing: T[],
  legacy: { csp: string[]; pmcc: string[] },
  makeNew: (symbol: string) => T
): T[] {
  const legacySymbols = normalizeUniverse([...legacy.csp, ...legacy.pmcc]);
  const indexBySymbol = new Map(existing.map((t, i) => [t.symbol, i]));
  const result = existing.slice();
  for (const symbol of legacySymbols) {
    const idx = indexBySymbol.get(symbol);
    if (idx === undefined) {
      indexBySymbol.set(symbol, result.length);
      result.push(makeNew(symbol));
    } else if (!result[idx].active) {
      result[idx] = { ...result[idx], active: true };
    }
  }
  return result;
}

/** True if migration has already produced (and persisted) a canonical
 *  universe — the gate production uses to decide whether to run
 *  migratePrimaryTickers() at all. */
export function hasCanonicalUniverse(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(LS_OPPORTUNITY_UNIVERSE) != null;
  } catch {
    return false;
  }
}

/** Writes the derived, write-only mirror. Never read back by production
 *  UI code — see the persistence-authority note at the top of this file. */
export function saveOpportunityUniverse(universe: string[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(LS_OPPORTUNITY_UNIVERSE, JSON.stringify(normalizeUniverse(universe))); } catch {}
}
