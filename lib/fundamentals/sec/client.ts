// lib/fundamentals/sec/client.ts

// LEAPS-QV-0001 Gate 2b -- SEC EDGAR client (data.sec.gov). Free, no API key. SEC fair-access rules: a User-Agent that
// names the requester with a contact email is mandatory, and the limit is 10 requests/second per IP. This client:
//  * refuses to make any request without SEC_USER_AGENT (no default, no guessing),
//  * spaces request starts >= 170 ms apart (~6/s, well under the limit),
//  * caches compact facts / ticker directory / submissions in memory with a TTL, dedupes concurrent identical requests,
//    and negative-caches "not found" answers,
//  * surfaces every failure as a typed SecProviderError (never an empty success),
//  * keeps counters for observability.
// Cache and rate limiter are PER SERVER INSTANCE (Vercel serverless instances do not share memory); the per-instance
// spacing therefore bounds each instance, not the fleet. A shared (Redis) cache is a documented follow-up.

import { compactCompanyFacts } from '@/lib/discovery/normalized/sec/facts';
import type { CompactFacts, SecSubmissionsInfo } from '@/lib/discovery/normalized/sec/types';

export const SEC_DATA_HOST = 'https://data.sec.gov';
export const SEC_WWW_HOST = 'https://www.sec.gov';
export const MIN_REQUEST_SPACING_MS = 170;
export const REQUEST_TIMEOUT_MS = 20_000;
export const FACTS_TTL_MS = 6 * 60 * 60 * 1000;
export const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
export const SUBMISSIONS_TTL_MS = 24 * 60 * 60 * 1000;
export const NEGATIVE_TTL_MS = 60 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 200;

export type SecProviderErrorCode = 'USER_AGENT_MISSING' | 'HTTP_ERROR' | 'NETWORK' | 'TIMEOUT' | 'PAYLOAD_INVALID';

export class SecProviderError extends Error {
  readonly code: SecProviderErrorCode;
  readonly status: number | null;
  constructor(code: SecProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'SecProviderError';
    this.code = code;
    this.status = status;
  }
}

export type CompanyFactsOutcome =
  | { readonly kind: 'FACTS'; readonly compact: CompactFacts }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'NOT_US_GAAP' };

export interface SecClientStats {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  negativeHits: number;
  inflightJoins: number;
  spacingWaits: number;
  errors: Readonly<Record<string, number>>;
}

export interface SecClient {
  /** Zero-padded 10-digit CIK for a ticker, or null when SEC does not list it (or lists it ambiguously). */
  lookupCik(ticker: string): Promise<string | null>;
  getCompanyFacts(cik: string): Promise<CompanyFactsOutcome>;
  /** null when the submissions payload is unavailable (404); other failures throw. */
  getSubmissions(cik: string): Promise<SecSubmissionsInfo | null>;
  stats(): SecClientStats;
}

export interface SecClientOptions {
  readonly userAgent: string | undefined;
  readonly fetchImpl?: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  readonly nowMs?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export function isValidUserAgent(ua: string | undefined): ua is string {
  // SEC asks for "Company/App name contact@email". Require a non-trivial string that contains an email address.
  return typeof ua === 'string' && ua.trim().length >= 8 && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(ua);
}

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

export function createSecClient(options: SecClientOptions): SecClient {
  const nowMs = options.nowMs || (() => Date.now());
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = options.fetchImpl || ((url, init) => fetch(url, { ...init, cache: 'no-store' }));
  const counters: SecClientStats = { requests: 0, cacheHits: 0, cacheMisses: 0, negativeHits: 0, inflightJoins: 0, spacingWaits: 0, errors: {} };
  const errors: Record<string, number> = counters.errors as Record<string, number>;

  const cache = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();
  let nextSlot = 0;

  function bumpError(code: string): void {
    errors[code] = (errors[code] || 0) + 1;
  }

  function cacheGet<T>(key: string): T | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= nowMs()) {
      cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  function cacheSet(key: string, value: unknown, ttl: number): void {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.delete(key);
    cache.set(key, { value, expiresAt: nowMs() + ttl });
  }

  async function paced(): Promise<void> {
    const now = nowMs();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + MIN_REQUEST_SPACING_MS;
    if (slot > now) {
      counters.spacingWaits += 1;
      await sleep(slot - now);
    }
  }

  /** Fetches JSON; returns null on 404; throws SecProviderError otherwise. */
  async function getJson(url: string): Promise<unknown | null> {
    if (!isValidUserAgent(options.userAgent)) {
      bumpError('USER_AGENT_MISSING');
      throw new SecProviderError('USER_AGENT_MISSING', 'SEC_USER_AGENT is not configured (name and contact email required by SEC fair-access policy)');
    }
    await paced();
    counters.requests += 1;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        bumpError('HTTP_ERROR');
        throw new SecProviderError('HTTP_ERROR', `SEC returned HTTP ${res.status}`, res.status);
      }
      try {
        return await res.json();
      } catch (_err) {
        bumpError('PAYLOAD_INVALID');
        throw new SecProviderError('PAYLOAD_INVALID', 'SEC response was not valid JSON');
      }
    } catch (err) {
      if (err instanceof SecProviderError) throw err;
      const aborted = !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
      bumpError(aborted ? 'TIMEOUT' : 'NETWORK');
      throw new SecProviderError(aborted ? 'TIMEOUT' : 'NETWORK', aborted ? 'SEC request timed out' : 'SEC request failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function cached<T>(key: string, ttl: (value: T) => number, load: () => Promise<T>): Promise<T> {
    const hit = cacheGet<T>(key);
    if (hit !== undefined) {
      counters.cacheHits += 1;
      return Promise.resolve(hit);
    }
    const pending = inflight.get(key);
    if (pending) {
      counters.inflightJoins += 1;
      return pending as Promise<T>;
    }
    counters.cacheMisses += 1;
    const promise = load()
      .then((value) => {
        cacheSet(key, value, ttl(value));
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  function loadDirectory(): Promise<ReadonlyMap<string, string | null>> {
    return cached<ReadonlyMap<string, string | null>>('directory', () => DIRECTORY_TTL_MS, async () => {
      const raw = await getJson(`${SEC_WWW_HOST}/files/company_tickers.json`);
      if (!raw || typeof raw !== 'object') {
        bumpError('PAYLOAD_INVALID');
        throw new SecProviderError('PAYLOAD_INVALID', 'SEC ticker directory unavailable or malformed');
      }
      const map = new Map<string, string | null>();
      Object.keys(raw as Record<string, unknown>).forEach((key) => {
        const row = (raw as Record<string, { cik_str?: unknown; ticker?: unknown }>)[key];
        if (!row || typeof row.ticker !== 'string' || (typeof row.cik_str !== 'number' && typeof row.cik_str !== 'string')) return;
        const ticker = row.ticker.toUpperCase();
        const cik = padCik(row.cik_str);
        const existing = map.get(ticker);
        // The same ticker under two different CIKs is ambiguous: fail closed (null), never pick one.
        map.set(ticker, existing === undefined || existing === cik ? cik : null);
      });
      if (map.size === 0) {
        bumpError('PAYLOAD_INVALID');
        throw new SecProviderError('PAYLOAD_INVALID', 'SEC ticker directory was empty');
      }
      return map;
    });
  }

  return {
    async lookupCik(ticker: string): Promise<string | null> {
      const directory = await loadDirectory();
      const cik = directory.get(ticker.toUpperCase());
      return cik === undefined ? null : cik;
    },

    getCompanyFacts(cik: string): Promise<CompanyFactsOutcome> {
      const padded = padCik(cik);
      const key = `facts:${padded}`;
      return cached<CompanyFactsOutcome>(
        key,
        (value) => (value.kind === 'FACTS' ? FACTS_TTL_MS : NEGATIVE_TTL_MS),
        async () => {
          const raw = await getJson(`${SEC_DATA_HOST}/api/xbrl/companyfacts/CIK${padded}.json`);
          if (raw === null) return { kind: 'NOT_FOUND' } as const;
          const compacted = compactCompanyFacts(raw, padded);
          if (!compacted.ok) {
            if (compacted.reason === 'NOT_US_GAAP_XBRL') return { kind: 'NOT_US_GAAP' } as const;
            bumpError('PAYLOAD_INVALID');
            throw new SecProviderError('PAYLOAD_INVALID', 'SEC companyfacts payload was malformed');
          }
          // Only the compact facts are retained; the multi-megabyte raw payload is dropped here.
          return { kind: 'FACTS', compact: compacted.compact } as const;
        },
      );
    },

    getSubmissions(cik: string): Promise<SecSubmissionsInfo | null> {
      const padded = padCik(cik);
      return cached<SecSubmissionsInfo | null>(`submissions:${padded}`, (value) => (value ? SUBMISSIONS_TTL_MS : NEGATIVE_TTL_MS), async () => {
        const raw = await getJson(`${SEC_DATA_HOST}/submissions/CIK${padded}.json`);
        if (raw === null) return null;
        if (typeof raw !== 'object') {
          bumpError('PAYLOAD_INVALID');
          throw new SecProviderError('PAYLOAD_INVALID', 'SEC submissions payload was malformed');
        }
        const body = raw as { sic?: unknown; sicDescription?: unknown };
        return {
          sic: typeof body.sic === 'string' || typeof body.sic === 'number' ? String(body.sic) : null,
          sicDescription: typeof body.sicDescription === 'string' ? body.sicDescription : null,
          fetchedAt: new Date(nowMs()).toISOString(),
        };
      });
    },

    stats(): SecClientStats {
      return { ...counters, errors: { ...errors } };
    },
  };
}

let shared: SecClient | null = null;

/** Process-wide client configured from SEC_USER_AGENT. */
export function getSecClient(): SecClient {
  if (!shared) shared = createSecClient({ userAgent: process.env.SEC_USER_AGENT });
  return shared;
}
