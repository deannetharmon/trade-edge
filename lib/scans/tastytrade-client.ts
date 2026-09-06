// lib/scans/tastytrade-client.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import { BASE, CLIENT_ID, LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY } from './constants';
import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';
// TE-0007C fix-forward: covered-call capacity must be fetched the same way
// every other TastyTrade call in this file is -- browser-side, with the
// bearer token from getAccessToken() -- not through a Next.js server route.
// TastyTrade blocks Vercel's server IPs (see this file's other functions and
// lib/wheel/chainSearch.ts), and the original app/api/covered-call-capacity
// route used a *different*, cookie-based auth mechanism (lib/tokenStore.ts)
// that isn't populated by this app's actual login flow. That route has been
// deleted; buildCoveredCallCapacityReport (pure, no I/O) is reused here.
import { buildCoveredCallCapacityReport, type CoveredCallCapacityReport } from './covered-call-capacity';
import { daysUntil } from './scan-utils';
import type { RulesType } from './constants';
import { requireActiveBrokerAccount, resolveActiveBrokerAccount, type BrokerAccountResolutionStatus } from '@/lib/tastytrade/accountSelection';

export const classificationCache = new Map<string, 'index' | 'etf' | 'stock'>();


export async function ttFetch(path: string, token: string): Promise<any> {
  void token; // Broker credentials and reads stay server-side to avoid browser CORS failures.
  const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (res.status === 401) {
    sessionStorage.removeItem('tt_access_token');
    try {
      localStorage.removeItem(LS_ACCESS_TOKEN);
      localStorage.removeItem(LS_ACCESS_TOKEN_EXPIRY);
    } catch {}

    throw new Error('Session expired');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}


export async function getAccessToken(): Promise<string> {
  // 1. Check sessionStorage first (fastest, in-memory)
  const sessionCached = sessionStorage.getItem('tt_access_token');
  if (sessionCached) return sessionCached;

  // 2. Check localStorage cache — survives rebuilds/page reloads
  // Access tokens are valid for ~24h; we cache for 23h to be safe
  try {
    const lsCached = localStorage.getItem(LS_ACCESS_TOKEN);
    const expiry = localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY);
    if (lsCached && expiry && Date.now() < parseInt(expiry)) {
      sessionStorage.setItem('tt_access_token', lsCached);
      return lsCached;
    }
  } catch {}

  // 3. Use refresh token to get a new access token
  let token: string;
  try {
    token = await refreshBrowserAccessToken();
  } catch {
    sessionStorage.removeItem('tt_access_token');
    try { localStorage.removeItem(LS_ACCESS_TOKEN); localStorage.removeItem(LS_ACCESS_TOKEN_EXPIRY); } catch {}
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  // Store in both sessionStorage and localStorage
  sessionStorage.setItem('tt_access_token', token);
  try {
    localStorage.setItem(LS_ACCESS_TOKEN, token);
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() + 23 * 60 * 60 * 1000));
  } catch {}

  return token;
}


export async function classifyUnderlying(symbol: string, token: string): Promise<'index' | 'etf' | 'stock'> {
  const s = symbol.toUpperCase();
  const cached = classificationCache.get(s);
  if (cached) return cached;

  let result: 'index' | 'etf' | 'stock';
  try {
    const data = await ttFetch(`/instruments/equities/${s}`, token);
    const item = data?.data;
    if (item?.['is-index']) result = 'index';
    else if (item?.['is-etf']) result = 'etf';
    else result = 'stock';
  } catch {
    // Not found as an equity at all — true cash-settled indexes (SPX, VIX,
    // NDX, RUT) have no equity record, so absence of a record means index.
    result = 'index';
  }
  classificationCache.set(s, result);
  return result;
}


export async function getMarketMetrics(symbols: string[], token: string) {
  const data = await ttFetch(`/market-metrics?symbols=${symbols.join(',')}`, token);

  return (data.data?.items || []).map((item: any) => {
    // Build per-expiration IVx lookup map from option-expiration-implied-volatilities
    const expirationIvxMap: Record<string, number> = {};
    for (const e of item['option-expiration-implied-volatilities'] ?? []) {
      if (e['expiration-date'] && e['implied-volatility'] != null) {
        const raw = parseFloat(e['implied-volatility']);
        expirationIvxMap[e['expiration-date']] = raw <= 1 ? raw * 100 : raw;
      }
    }

    return {
      symbol: item.symbol,
      ivRank: item['implied-volatility-index-rank'] != null
        ? parseFloat(item['implied-volatility-index-rank']) * 100
        : null,
      ivx: item['implied-volatility-index'] != null
        ? parseFloat(item['implied-volatility-index']) * 100
        : null,
      ivx30: item['implied-volatility-30-day'] != null
        ? parseFloat(item['implied-volatility-30-day'])
        : null,
      ivHv30Diff: item['iv-hv-30-day-difference'] != null
        ? parseFloat(item['iv-hv-30-day-difference'])
        : null,
      liquidityRating: item['liquidity-rating'] ?? null,
      earningsExpectedDate: item['earnings']?.['expected-report-date'] || null,
      hv30: item['historical-volatility-30-day'] != null
        ? parseFloat(item['historical-volatility-30-day'])
        : null,
      expirationIvxMap,
    };
  });
}


export async function getQuote(symbol: string, token: string): Promise<number | null> {
  // Cash-settled indexes (SPX, NDX, RUT, VIX, XSP) have no equity instrument
  // record — they trade on TastyTrade's market-data endpoint under the
  // `index=` parameter, not `equity=`. Quoting them as an equity silently
  // returns no items, which previously made every index symbol's spot price
  // resolve to null and drop out of every downstream POP/OTM calculation.
  const classification = await classifyUnderlying(symbol, token).catch(() => 'stock' as const);
  const queryParam = classification === 'index' ? 'index' : 'equity';
  try {
    const data = await ttFetch(`/market-data/by-type?${queryParam}=${encodeURIComponent(symbol)}`, token);
    const item = data.data?.items?.[0]; if (!item) return null;
    const last = item.last != null ? parseFloat(item.last) : null;
    const bid = item.bid != null ? parseFloat(item.bid) : null;
    const ask = item.ask != null ? parseFloat(item.ask) : null;
    return last ?? (bid && ask ? (bid + ask) / 2 : null);
  } catch { return null; }
}

export interface ExecutableOptionQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  updatedAt: string | null;
  ageSeconds: number | null;
}

function quoteTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  return null;
}

/** Re-reads the exact option instruments at order time. Never fall back to
 * scan-time values: callers must reject missing, crossed, or stale quotes. */
export async function getExecutableOptionQuotes(symbols: string[], token: string): Promise<ExecutableOptionQuote[]> {
  if (symbols.length === 0) return [];
  const query = symbols.map(symbol => `equity-option=${encodeURIComponent(symbol)}`).join('&');
  const data = await ttFetch(`/market-data/by-type?${query}`, token);
  const bySymbol = new Map<string, any>((data?.data?.items ?? []).map((item: any): [string, any] => [String(item.symbol), item]));
  return symbols.map(symbol => {
    const item = bySymbol.get(symbol);
    const bid = item?.bid != null ? Number(item.bid) : null;
    const ask = item?.ask != null ? Number(item.ask) : null;
    const updatedAt = quoteTimestamp(item?.['updated-at'] ?? item?.['summary-date']);
    const ageSeconds = updatedAt == null ? null : Math.max(0, (Date.now() - Date.parse(updatedAt)) / 1000);
    return { symbol, bid: Number.isFinite(bid) ? bid : null, ask: Number.isFinite(ask) ? ask : null, updatedAt, ageSeconds };
  });
}


export async function getChain(symbol: string, token: string, RULES: RulesType, dteWindow?: { min: number; max: number }): Promise<{ expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean; classification: 'index' | 'etf' | 'stock' }> {
  // dteWindow overrides the rule-set DTE gate when provided (rank mode passes a fixed wide window).
  const gateMin = dteWindow ? dteWindow.min : ((Number.isFinite(RULES.DTE_MIN) ? RULES.DTE_MIN : 0) - 5);
  const gateMax = dteWindow ? dteWindow.max : ((Number.isFinite(RULES.DTE_MAX) ? RULES.DTE_MAX : 60) + 5);
  const [loDte, hiDte] = gateMin <= gateMax ? [gateMin, gateMax] : [gateMax, gateMin];
  const nested = await ttFetch(`/option-chains/${symbol}/nested`, token);
  const classification = await classifyUnderlying(symbol, token);
  const isEtfOrIndex = classification === 'index' || classification === 'etf';
  const expirations: string[] = [], chains: Record<string, any[]> = {}, allOCCSymbols: string[] = [];
  const symbolMeta: Record<string, { expDate: string; strike: number; optionType: string }> = {};
  for (const expGroup of nested?.data?.items?.[0]?.expirations ?? []) {
    const expDate: string = expGroup['expiration-date']; if (!expDate) continue;
    const dte = daysUntil(expDate); if (dte < loDte || dte > hiDte) continue;

    // IVX_DISCOVERY: log the full expiration group object to find IVx field name
    if (process.env.NODE_ENV !== 'production') {
      console.log('IVX_DISCOVERY expGroup keys:', Object.keys(expGroup));
      console.log('IVX_DISCOVERY expGroup (no strikes):', JSON.stringify({ ...expGroup, strikes: `[${expGroup.strikes?.length ?? 0} strikes hidden]` }, null, 2));
    }

    for (const strike of expGroup.strikes ?? []) {
      const strikePrice = parseFloat(strike['strike-price'] ?? '0');
      const callSym: string = strike['call'], putSym: string = strike['put'];
      if (callSym) { allOCCSymbols.push(callSym); symbolMeta[callSym] = { expDate, strike: strikePrice, optionType: 'C' }; }
      if (putSym) { allOCCSymbols.push(putSym); symbolMeta[putSym] = { expDate, strike: strikePrice, optionType: 'P' }; }
    }
  }
  if (allOCCSymbols.length === 0) return { expirations, chains, isEtfOrIndex, classification };
  for (let i = 0; i < allOCCSymbols.length; i += 100) {
    const chunk = allOCCSymbols.slice(i, i + 100);
    const qs = chunk.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    let greeksData: any;
    try { greeksData = await ttFetch(`/market-data/by-type?${qs}`, token); } catch { continue; }
    for (const item of greeksData?.data?.items ?? []) {
      if (symbol.toUpperCase() === 'MRVL') {        
        console.log('MRVL option market-data raw item:', item);
        console.log('MRVL option market-data raw keys:', Object.keys(item));
        console.log('MRVL option market-data raw JSON:', JSON.stringify(item, null, 2));
      }

  const meta = symbolMeta[item.symbol]; if (!meta) continue;
  const bid = parseFloat(item.bid ?? '0'), ask = parseFloat(item.ask ?? '0');
      const delta = item.delta != null ? parseFloat(item.delta) : null;
      const oi = parseInt(item['open-interest'] ?? '0', 10);
      const rawIv =
        item.volatility ??
        item['implied-volatility'] ??
        item['mark-volatility'] ??
        item['implied-volatility-index'] ??
        item.iv ??
        null;
      const parsedIv = rawIv != null ? parseFloat(rawIv) : null;
      const iv = parsedIv == null || Number.isNaN(parsedIv)
        ? null
        : parsedIv <= 1
          ? parsedIv * 100
          : parsedIv;
      if (!expirations.includes(meta.expDate)) expirations.push(meta.expDate);
      if (!chains[meta.expDate]) chains[meta.expDate] = [];
      chains[meta.expDate].push({
      strikePrice: meta.strike,
      expirationDate: meta.expDate,
      optionType: meta.optionType,
      delta,
      openInterest: oi,
      bid,
      ask,
      mid: (bid + ask) / 2,
      occSymbol: item.symbol,
      iv,
      quoteUpdatedAt: item['updated-at'] ?? item['summary-date'] ?? null,
      fetchedAt: Date.now(),
    });
    }
  }
  expirations.sort(); return { expirations, chains, isEtfOrIndex, classification };
}


// ── Account cash balance (TE-0007A — CSP capital check) ─────────────────────
// Deliberately reads pure cash, not margin/derivative buying power — DR-0001
// requires CSP to never recommend margin by default. Mirrors the balance
// fields app/engine/page.tsx already reads from the same endpoint, but picks
// the cash-only fields (cash-available-to-withdraw / cash-balance) rather
// than engine's obp (option/derivative buying power).
// ── Covered-call capacity (TE-0007C) — client-side, same auth pattern as
// getAvailableCash below. Fetches raw (unfiltered) positions + working
// orders and delegates all math to the pure covered-call-capacity module.
export async function getCoveredCallCapacityReport(token: string): Promise<CoveredCallCapacityReport> {
  try {
    const accountNumber = await requireActiveBrokerAccount(token, ttFetch, { forceValidation: true });
    if (!accountNumber) return { status: 'unavailable', bySymbol: {}, warnings: [] };

    let rawPositions: any[] | null = null;
    try {
      const positionsData = await ttFetch(`/accounts/${accountNumber}/positions`, token);
      rawPositions = positionsData?.data?.items ?? [];
    } catch {
      rawPositions = null;
    }

    let rawOrders: any[] | null = null;
    try {
      const ordersData = await ttFetch(`/accounts/${accountNumber}/orders/live`, token);
      rawOrders = ordersData?.data?.items ?? [];
    } catch {
      rawOrders = null;
    }

    return buildCoveredCallCapacityReport(rawPositions, rawOrders);
  } catch {
    return { status: 'unavailable', bySymbol: {}, warnings: [] };
  }
}


/** @deprecated CSP-WORKFLOW-0001 core-correction (BLOCKER-02) — reads only
 * a single cash figure from an unvalidated `accounts[0]`, with no retained
 * account identifier and no option-buying-power figure, so it cannot
 * distinguish "verified $0 available" from "never actually checked" and
 * cannot support the approved min(optionBuyingPower, cashBalance) capital
 * model. Superseded by `getCspCapitalContext()` below for all CSP
 * production callers. Kept only for any test/caller not yet migrated. */
export async function getAvailableCash(token: string): Promise<number | null> {
  try {
    const accountNumber = await requireActiveBrokerAccount(token, ttFetch, { forceValidation: true });
    if (!accountNumber) return null;

    const balanceData = await ttFetch(`/accounts/${accountNumber}/balances`, token);
    const balData = balanceData?.data ?? {};

    const cash = parseFloat(
      balData['cash-available-to-withdraw']
      ?? balData['cash-balance']
      ?? 'NaN'
    );
    return Number.isFinite(cash) ? cash : null;
  } catch {
    return null;
  }
}


// CSP capital always belongs to the validated app-level active account.
// A sole account is selected automatically; multi-account users choose once
// through the global account control and that persisted choice is validated
// against every fresh account-list response.
export interface CspCapitalContext {
  accountSelected: boolean;
  accountId: string | null;
  optionBuyingPower: number | null;
  cashBalance: number | null;
  accountResolutionStatus?: BrokerAccountResolutionStatus | 'balance_unavailable';
}

const UNRESOLVED_CSP_CAPITAL: CspCapitalContext = {
  accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null,
};

export async function getCspCapitalContext(token: string): Promise<CspCapitalContext> {
  const resolution = await resolveActiveBrokerAccount(token, ttFetch);
  if (resolution.status !== 'ready' || !resolution.accountId) {
    return { ...UNRESOLVED_CSP_CAPITAL, accountResolutionStatus: resolution.status };
  }
  const accountNumber = resolution.accountId;

  try {
    const balanceData = await ttFetch(`/accounts/${accountNumber}/balances`, token);
    const balData = balanceData?.data ?? {};

    const bp = parseFloat(
      balData['derivative-buying-power']
      ?? balData['option-buying-power']
      ?? 'NaN'
    );
    const cash = parseFloat(
      balData['cash-available-to-withdraw']
      ?? balData['cash-balance']
      ?? 'NaN'
    );

    return {
      accountSelected: true,
      accountId: accountNumber,
      optionBuyingPower: Number.isFinite(bp) ? bp : null,
      cashBalance: Number.isFinite(cash) ? cash : null,
      accountResolutionStatus: 'ready',
    };
  } catch {
    return {
      accountSelected: true,
      accountId: accountNumber,
      optionBuyingPower: null,
      cashBalance: null,
      accountResolutionStatus: 'balance_unavailable',
    };
  }
}
