// lib/wheel/chainSearch.ts
//
// Client-side chain search for Wheel candidates (CSP-hunting and CC-writing).
// TastyTrade blocks Vercel server IPs, so — same as app/screener/page.tsx and
// app/portfolio/page.tsx — this must run in the browser with a bearer token
// from sessionStorage/localStorage, never from a Next.js API route.
//
// Reuses the proven two-call pattern from app/screener/page.tsx's getChain():
// 1. GET /option-chains/{symbol}/nested -- chain structure (strikes, OCC symbols)
// 2. GET /market-data/by-type?equity-option=... (batched 100/call) -- live greeks
// The nested endpoint alone does not reliably return live delta; both calls
// are required. Do not simplify this to a single call.

const BASE = 'https://api.tastytrade.com';

export interface WheelChainLeg {
  strikePrice: number;
  expirationDate: string;
  optionType: 'P' | 'C';
  delta: number | null;
  openInterest: number;
  bid: number;
  ask: number;
  mid: number;
  occSymbol: string;
}

export interface WheelChainResult {
  expirations: string[];
  chains: Record<string, WheelChainLeg[]>; // keyed by expirationDate
}

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

async function ttFetchWheel(path: string, token: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Fetches the full chain (both puts and calls, all expirations within the
// optional DTE window) for a symbol, with live delta/bid/ask/OI populated.
// This is side-agnostic on purpose -- callers filter to 'P' or 'C' afterward
// depending on wheel stage (hunting-csp -> puts, own-writing-cc -> calls).
export async function fetchWheelChain(
  symbol: string,
  token: string,
  dteWindow?: { min: number; max: number },
): Promise<WheelChainResult> {
  const nested = await ttFetchWheel(`/option-chains/${symbol}/nested`, token);

  const expirations: string[] = [];
  const chains: Record<string, WheelChainLeg[]> = {};
  const allOccSymbols: string[] = [];
  const meta: Record<string, { expDate: string; strike: number; optionType: 'P' | 'C' }> = {};

  for (const expGroup of nested?.data?.items?.[0]?.expirations ?? []) {
    const expDate: string = expGroup['expiration-date'];
    if (!expDate) continue;

    if (dteWindow) {
      const dte = daysUntil(expDate);
      if (dte < dteWindow.min || dte > dteWindow.max) continue;
    }

    for (const strike of expGroup.strikes ?? []) {
      const strikePrice = parseFloat(strike['strike-price'] ?? '0');
      const callSym: string = strike['call'];
      const putSym: string = strike['put'];
      if (callSym) { allOccSymbols.push(callSym); meta[callSym] = { expDate, strike: strikePrice, optionType: 'C' }; }
      if (putSym) { allOccSymbols.push(putSym); meta[putSym] = { expDate, strike: strikePrice, optionType: 'P' }; }
    }

    expirations.push(expDate);
  }

  if (allOccSymbols.length === 0) return { expirations, chains };

  for (let i = 0; i < allOccSymbols.length; i += 100) {
    const chunk = allOccSymbols.slice(i, i + 100);
    const qs = chunk.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    let greeksData: any;
    try {
      greeksData = await ttFetchWheel(`/market-data/by-type?${qs}`, token);
    } catch {
      continue;
    }

    for (const item of greeksData?.data?.items ?? []) {
      const m = meta[item.symbol];
      if (!m) continue;

      const bid = parseFloat(item.bid ?? '0');
      const ask = parseFloat(item.ask ?? '0');
      const delta = item.delta != null ? parseFloat(item.delta) : null;
      const oi = parseInt(item['open-interest'] ?? '0', 10);

      if (!chains[m.expDate]) chains[m.expDate] = [];
      chains[m.expDate].push({
        strikePrice: m.strike,
        expirationDate: m.expDate,
        optionType: m.optionType,
        delta,
        openInterest: oi,
        bid,
        ask,
        mid: (bid + ask) / 2,
        occSymbol: item.symbol,
      });
    }
  }

  expirations.sort();
  return { expirations, chains };
}

// Fetches a live equity quote (last price, falling back to bid/ask midpoint).
// Simplified from screener's getQuote() to equities only -- Wheel candidates
// are stocks/ETFs, not cash-settled indexes like SPX, so the index/etf
// classification branch isn't needed here.
export async function getWheelQuote(symbol: string, token: string): Promise<number | null> {
  try {
    const data = await ttFetchWheel(`/market-data/by-type?equity=${encodeURIComponent(symbol)}`, token);
    const item = data?.data?.items?.[0];
    if (!item) return null;
    const last = item.last != null ? parseFloat(item.last) : null;
    const bid = item.bid != null ? parseFloat(item.bid) : null;
    const ask = item.ask != null ? parseFloat(item.ask) : null;
    return last ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  } catch {
    return null;
  }
}

export type WheelStage = 'hunting-csp' | 'own-writing-cc';

export interface WheelDeltaTarget {
  min: number;
  max: number;
}

export interface WheelDteTarget {
  min: number;
  max: number;
}

export interface WheelSelectedContract {
  expirationDate: string;
  dte: number;
  strikePrice: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  occSymbol: string;
}

// Searches a fetched chain for the contract on the correct side (puts for
// hunting-csp, calls for own-writing-cc) whose |delta| is closest to the
// center of the target delta range, among expirations inside the DTE window.
// Returns null if nothing in the chain satisfies both windows -- callers
// should show "No match" rather than falling back to a guess.
export function findBestWheelContract(
  chainResult: WheelChainResult,
  stage: WheelStage,
  deltaTarget: WheelDeltaTarget,
  dteTarget: WheelDteTarget,
): WheelSelectedContract | null {
  const wantedType: 'P' | 'C' = stage === 'hunting-csp' ? 'P' : 'C';
  const deltaCenter = (deltaTarget.min + deltaTarget.max) / 2;

  let best: WheelSelectedContract | null = null;
  let bestDistance = Infinity;

  for (const expDate of chainResult.expirations) {
    const dte = daysUntil(expDate);
    if (dte < dteTarget.min || dte > dteTarget.max) continue;

    const legs = chainResult.chains[expDate] ?? [];
    for (const leg of legs) {
      if (leg.optionType !== wantedType) continue;
      if (leg.delta == null) continue;

      const absDelta = Math.abs(leg.delta);
      if (absDelta < deltaTarget.min || absDelta > deltaTarget.max) continue;

      const distance = Math.abs(absDelta - deltaCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          expirationDate: expDate,
          dte,
          strikePrice: leg.strikePrice,
          delta: absDelta,
          bid: leg.bid,
          ask: leg.ask,
          mid: leg.mid,
          openInterest: leg.openInterest,
          occSymbol: leg.occSymbol,
        };
      }
    }
  }

  return best;
}
