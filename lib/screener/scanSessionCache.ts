// lib/screener/scanSessionCache.ts
//
// SCREENER-RESULTS-0001 — IndexedDB persistence for the canonical
// ScreenerScanSession, shared by app/screener/page.tsx (the five scan
// functions that run synchronously inside that file) and
// features/screener/hooks/useRankedScan.ts (Ranked mode, which completes
// asynchronously via a background task and cannot import from page.tsx).
//
// Deliberately a self-contained IndexedDB reader/writer rather than
// importing page.tsx's existing idbGet/idbSet/idbDel — those are
// page.tsx-local (not exported) and importing FROM a page file INTO a
// feature/lib module would invert this codebase's established
// "app -> features -> lib" dependency direction (ADR-0004). This module
// targets the exact same IndexedDB database/object-store name page.tsx's
// helpers use ('hunter-db' / 'kv'), so both sides read and write the same
// underlying store — only the session's own key
// ('screenerActiveSession_v1') is shared/reserved by this module.
import {
  validateSessionData,
  type ScreenerScanSession,
} from './scanSession';

const IDB_DB_NAME = 'hunter-db';
const IDB_STORE_NAME = 'kv';
export const SCAN_SESSION_CACHE_KEY = 'screenerActiveSession_v1';

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.error('scanSessionCache: idbSet failed (non-blocking):', e);
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idbOpen();
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.error('scanSessionCache: idbGet failed (non-blocking):', e);
    return null;
  }
}

async function idbDel(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.error('scanSessionCache: idbDel failed (non-blocking):', e);
  }
}

// Persists a session as cache-provenance data. Only ever meaningful for a
// 'complete' session — a 'running', 'error', or 'stopped' session is never
// worth restoring, so callers should not call this for those statuses (and
// this function is a deliberate no-op if they do, rather than persisting
// something a restore would have to reject anyway). Explicitly rewrites
// cacheProvenance/cachedAt at the moment of writing so a later restore is
// honestly marked 'idb-cache', never mistaken for a live scan that merely
// ran instantly.
export async function persistScanSession(session: ScreenerScanSession): Promise<void> {
  if (session.status !== 'complete') return;
  const cached: ScreenerScanSession = { ...session, cacheProvenance: 'idb-cache', cachedAt: Date.now() };
  await idbSet(SCAN_SESSION_CACHE_KEY, cached);
}

// Restores a session from cache, validating it with the canonical
// validateSessionData() before trusting a single field of it. An invalid or
// unknown-schema entry is cleared (never silently kept around to fail the
// same way again next load) and restoration reports null.
export async function restoreScanSession(): Promise<ScreenerScanSession | null> {
  const raw = await idbGet<unknown>(SCAN_SESSION_CACHE_KEY);
  if (raw == null) return null;
  const result = validateSessionData(raw);
  if (!result.valid) {
    console.warn('restoreScanSession: cached session failed validation, clearing.', result.errors);
    await idbDel(SCAN_SESSION_CACHE_KEY);
    return null;
  }
  return result.session;
}

export async function clearScanSessionCache(): Promise<void> {
  await idbDel(SCAN_SESSION_CACHE_KEY);
}

// LEAPS-0003: LEAPS gets its own persistence, not the ScreenerScanSession
// model above. That model is built around symbol-level qualify/disqualify
// semantics with precise exclusion-reason attribution and capacity checks
// (see createScanSession's STRATEGY_ALLOWED_MODES gate and CC's capacity-
// aware scope construction in page.tsx) -- a materially different problem
// than "cache an array of long-call candidates and the active filters".
// Retrofitting LEAPS into that shared model to get persistence would mean
// either fabricating exclusion reasons/capacity semantics that don't apply
// here, or loosening validateSessionData()'s schema for everyone else.
// This achieves the same real, user-visible goal (results survive a
// refresh) with a separate, equally-real cache key instead -- same
// idbSet/idbGet helpers, same store, no shared-state risk to the other
// four strategies.
export const LEAPS_CACHE_KEY = 'screenerLeapsSession_v1';

export interface LeapsCachedSession {
  results: unknown[];
  filters: { deltaMin: number; deltaMax: number; dteMin: number; oiMin: number; extrinsicPctMax: number };
  cachedAt: number;
}

function isValidLeapsCachedSession(value: unknown): value is LeapsCachedSession {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.results) && typeof v.filters === 'object' && v.filters != null && typeof v.cachedAt === 'number';
}

export async function persistLeapsSession(session: Omit<LeapsCachedSession, 'cachedAt'>): Promise<void> {
  await idbSet(LEAPS_CACHE_KEY, { ...session, cachedAt: Date.now() });
}

export async function restoreLeapsSession(): Promise<LeapsCachedSession | null> {
  const raw = await idbGet<unknown>(LEAPS_CACHE_KEY);
  if (raw == null) return null;
  if (!isValidLeapsCachedSession(raw)) {
    console.warn('restoreLeapsSession: cached session failed validation, clearing.');
    await idbDel(LEAPS_CACHE_KEY);
    return null;
  }
  return raw;
}

export async function clearLeapsSessionCache(): Promise<void> {
  await idbDel(LEAPS_CACHE_KEY);
}
