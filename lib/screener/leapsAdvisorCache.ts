// lib/screener/leapsAdvisorCache.ts
//
// LEAPS-ADVISOR-0001B -- IndexedDB persistence for the LEAPS Advisor's
// recommendation + chat state, scoped to a specific result set via
// resultSetHash. Self-contained reader/writer targeting the same
// 'hunter-db'/'kv' IndexedDB store scanSessionCache.ts and LEAPS'
// persistLeapsSession already use -- same reasoning as those modules'
// own header comments: app -> features -> lib dependency direction
// (ADR-0004) means this can't import page.tsx-local helpers.

const IDB_DB_NAME = 'hunter-db';
const IDB_STORE_NAME = 'kv';
export const LEAPS_ADVISOR_CACHE_KEY = 'leapsAdvisorSession_v1';

export interface LeapsAdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface LeapsAdvisorGatedOut {
  symbol: string;
  reason: string;
}

export interface LeapsAdvisorRecommendation {
  symbol: string;
  occSymbol: string;
  reasoning: string;
}

export interface LeapsAdvisorSession {
  // Fingerprint of BOTH the candidate set and the active filter values --
  // a filter change that narrows/widens the visible set is a different
  // result set even if the underlying scan didn't change (Quinn).
  resultSetHash: string;
  disclosure: string;
  gatedOut: LeapsAdvisorGatedOut[];
  recommendation: LeapsAdvisorRecommendation[] | null;
  sizingNote: string | null;
  messages: LeapsAdvisorMessage[];
  cachedAt: number;
}

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
    console.error('leapsAdvisorCache: idbSet failed (non-blocking):', e);
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idbOpen();
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.error('leapsAdvisorCache: idbGet failed (non-blocking):', e);
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
    console.error('leapsAdvisorCache: idbDel failed (non-blocking):', e);
  }
}

function isValidLeapsAdvisorSession(value: unknown): value is LeapsAdvisorSession {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.resultSetHash === 'string'
    && typeof v.disclosure === 'string'
    && Array.isArray(v.gatedOut)
    && (v.recommendation === null || Array.isArray(v.recommendation))
    && (v.sizingNote === null || typeof v.sizingNote === 'string')
    && Array.isArray(v.messages)
    && typeof v.cachedAt === 'number';
}

/** Stable hash of the candidate set (occSymbols) + active filter values.
 * A filter change alone invalidates a cached session even if the
 * underlying scan didn't change. Not cryptographic -- a simple string
 * digest is enough since this only needs to detect "did the input
 * change," not resist tampering. */
export function computeLeapsAdvisorResultSetHash(
  candidates: Array<{ occSymbol: string | null }>,
  filters: { deltaMin: number; deltaMax: number; dteMin: number; dteMax: number; oiMin: number; extrinsicPctMax: number },
): string {
  const symbolPart = candidates.map(c => c.occSymbol ?? '').sort().join(',');
  const filterPart = JSON.stringify(filters);
  const raw = `${symbolPart}::${filterPart}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export async function persistLeapsAdvisorSession(session: Omit<LeapsAdvisorSession, 'cachedAt'>): Promise<void> {
  await idbSet(LEAPS_ADVISOR_CACHE_KEY, { ...session, cachedAt: Date.now() });
}

export async function restoreLeapsAdvisorSession(): Promise<LeapsAdvisorSession | null> {
  const raw = await idbGet<unknown>(LEAPS_ADVISOR_CACHE_KEY);
  if (raw == null) return null;
  if (!isValidLeapsAdvisorSession(raw)) {
    console.warn('restoreLeapsAdvisorSession: cached session failed validation, clearing.');
    await idbDel(LEAPS_ADVISOR_CACHE_KEY);
    return null;
  }
  return raw;
}

export async function clearLeapsAdvisorSession(): Promise<void> {
  await idbDel(LEAPS_ADVISOR_CACHE_KEY);
}
