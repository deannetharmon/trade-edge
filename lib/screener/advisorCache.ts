// lib/screener/advisorCache.ts
//
// ADVISOR-PARITY-0001 -- shared persistence for the PMCC and CC Advisor
// panels (LEAPS Advisor keeps its own separate leapsAdvisorCache.ts,
// built first and not migrated here to avoid touching a working feature).
// Same idb pattern, same 'hunter-db'/'kv' store, one key per strategy so
// a PMCC conversation and a CC conversation never collide or overwrite
// each other.

export type AdvisorStrategy = 'pmcc' | 'cc';

const IDB_DB_NAME = 'hunter-db';
const IDB_STORE_NAME = 'kv';

function cacheKey(strategy: AdvisorStrategy): string {
  return `advisorSession_v1_${strategy}`;
}

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface AdvisorGatedOut {
  symbol: string;
  reason: string;
}

export interface AdvisorRecommendation {
  symbol: string;
  identifier: string;
  reasoning: string;
}

export interface AdvisorSession {
  resultSetHash: string;
  disclosure: string;
  gatedOut: AdvisorGatedOut[];
  recommendation: AdvisorRecommendation[] | null;
  sizingNote: string | null;
  messages: AdvisorMessage[];
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
    console.error('advisorCache: idbSet failed (non-blocking):', e);
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
    console.error('advisorCache: idbGet failed (non-blocking):', e);
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
    console.error('advisorCache: idbDel failed (non-blocking):', e);
  }
}

function isValidAdvisorSession(value: unknown): value is AdvisorSession {
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

export function computeAdvisorResultSetHash(identifiers: string[], filters: Record<string, unknown>): string {
  const raw = `${identifiers.slice().sort().join(',')}::${JSON.stringify(filters)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export async function persistAdvisorSession(strategy: AdvisorStrategy, session: Omit<AdvisorSession, 'cachedAt'>): Promise<void> {
  await idbSet(cacheKey(strategy), { ...session, cachedAt: Date.now() });
}

export async function restoreAdvisorSession(strategy: AdvisorStrategy): Promise<AdvisorSession | null> {
  const raw = await idbGet<unknown>(cacheKey(strategy));
  if (raw == null) return null;
  if (!isValidAdvisorSession(raw)) {
    console.warn('restoreAdvisorSession: cached session failed validation, clearing.');
    await idbDel(cacheKey(strategy));
    return null;
  }
  return raw;
}

export async function clearAdvisorSession(strategy: AdvisorStrategy): Promise<void> {
  await idbDel(cacheKey(strategy));
}
