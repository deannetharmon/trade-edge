// lib/market/marketMapMath.ts
//
// MARKET-MAP-0001: the pure rules behind the Market Map: % change, color bucket, and what an option position on a stock means for how
// that stock's move today affects you. Direction is derived from the position's legs, never assumed.

export type ColorBucket = 'dn4' | 'dn3' | 'dn2' | 'dn1' | 'flat' | 'up1' | 'up2' | 'up3' | 'up4' | 'none';

/** Percent change from the previous close; null when either price is missing or the previous close is not positive. */
export function pctChange(last: number | null | undefined, prevClose: number | null | undefined): number | null {
  if (last == null || prevClose == null || !Number.isFinite(last) || !Number.isFinite(prevClose) || prevClose <= 0) return null;
  return (last / prevClose - 1) * 100;
}

/** Same scale as the approved mock: dn4 is -3% or worse, up4 is +3% or better. */
export function colorBucket(pct: number | null): ColorBucket {
  if (pct == null || !Number.isFinite(pct)) return 'none';
  if (pct <= -3) return 'dn4';
  if (pct <= -2) return 'dn3';
  if (pct <= -1) return 'dn2';
  if (pct < 0) return 'dn1';
  if (pct === 0) return 'flat';
  if (pct < 1) return 'up1';
  if (pct < 2) return 'up2';
  if (pct < 3) return 'up3';
  return 'up4';
}

// ---- Positions ----

export interface OptionLeg {
  kind: 'put' | 'call';
  side: 'long' | 'short';
  strike: number;
  quantity: number;
  /** Long legs: dollars paid for these contracts (average open price x quantity x multiplier); null when the broker did not say. */
  cost?: number | null;
}

export interface UnderlyingHolding {
  /** Option legs plus the share count (signed; shares count as bullish). */
  legs: OptionLeg[];
  shares: number;
  /** Dollars paid for the shares (average open price x shares); null when the broker did not say. */
  shareCost?: number | null;
}

/** OCC option symbol (root padded to 6) -> type and strike, or null. "NVDL  261120P00028000" -> put, 28. */
export function parseOcc(symbol: string): { root: string; kind: 'put' | 'call'; strike: number } | null {
  const m = /^(.{1,6}?)\s*(\d{6})([CP])(\d{8})$/.exec(symbol.trim().length ? symbol : '');
  if (!m) return null;
  return { root: m[1].trim(), kind: m[3] === 'P' ? 'put' : 'call', strike: Number(m[4]) / 1000 };
}

export type Exposure = 'bullish' | 'bearish' | 'neutral';

/** Net direction: short puts and long calls and shares gain when the stock rises; long puts and short calls gain when it falls. */
export function netExposure(h: UnderlyingHolding): Exposure {
  let score = h.shares > 0 ? 1 : 0;
  for (const leg of h.legs) {
    const bullish = (leg.kind === 'put' && leg.side === 'short') || (leg.kind === 'call' && leg.side === 'long');
    score += (bullish ? 1 : -1) * leg.quantity;
  }
  return score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral';
}

/** A move this size, in the direction that hurts the position, outlines the tile red. Smaller wiggles do not. */
export const AGAINST_MOVE_PCT = 2;

export function movingAgainst(exposure: Exposure, pct: number | null): boolean {
  if (pct == null || !Number.isFinite(pct)) return false;
  if (exposure === 'bullish') return pct <= -AGAINST_MOVE_PCT;
  if (exposure === 'bearish') return pct >= AGAINST_MOVE_PCT;
  return false;
}

/** Short label for a tile: "Short 27P", "Long 140P", "Put spread", "Iron condor", "Shares", or a leg count. */
export function holdingLabel(h: UnderlyingHolding): string {
  const legs = h.legs;
  const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (legs.length === 0) return h.shares > 0 ? 'Shares' : '';
  const suffix = h.shares > 0 ? ' + shares' : '';
  if (legs.length === 1) {
    const l = legs[0];
    return `${l.side === 'short' ? 'Short' : 'Long'} ${money(l.strike)}${l.kind === 'put' ? 'P' : 'C'}${suffix}`;
  }
  const kinds = new Set(legs.map(l => l.kind));
  const hasLong = legs.some(l => l.side === 'long');
  const hasShort = legs.some(l => l.side === 'short');
  if (legs.length === 4 && kinds.size === 2 && hasLong && hasShort) return `Iron condor${suffix}`;
  if (kinds.size === 1 && hasLong && hasShort) return `${legs[0].kind === 'put' ? 'Put' : 'Call'} spread${suffix}`;
  return `${legs.length} option legs${suffix}`;
}

/**
 * MARKET-MAP-0004: capital the holding ties up, in dollars, used to size tiles in the "My positions" view. Approximate and gross of
 * credits received:
 *   - a short option matched with a long one of the same kind is a spread: its width x 100 x contracts
 *   - an unmatched short put: strike x 100 x contracts (the cash that secures it)
 *   - an unmatched short call: nothing extra when shares cover it, else strike x 100 x contracts
 *   - an unmatched long option: what was paid for it
 *   - shares: what was paid for them
 */
export function capitalTiedUp(h: UnderlyingHolding): number {
  let total = h.shareCost != null && Number.isFinite(h.shareCost) ? Math.max(0, h.shareCost) : 0;
  let sharesToCover = h.shares;
  for (const kind of ['put', 'call'] as const) {
    const shorts = h.legs.filter(l => l.kind === kind && l.side === 'short').map(l => ({ ...l, left: l.quantity }));
    const longs = h.legs.filter(l => l.kind === kind && l.side === 'long').map(l => ({ ...l, left: l.quantity }));
    // Pair each short with the nearest long on the protective side: a put spread's long strike is lower, a call spread's is higher.
    shorts.sort((a, b) => (kind === 'put' ? b.strike - a.strike : a.strike - b.strike));
    for (const s of shorts) {
      const candidates = longs
        .filter(l => l.left > 0 && (kind === 'put' ? l.strike < s.strike : l.strike > s.strike))
        .sort((a, b) => (kind === 'put' ? b.strike - a.strike : a.strike - b.strike));
      for (const l of candidates) {
        if (s.left <= 0) break;
        const q = Math.min(s.left, l.left);
        total += Math.abs(s.strike - l.strike) * 100 * q;
        s.left -= q; l.left -= q;
      }
      if (s.left > 0) {
        if (kind === 'call') {
          const covered = Math.min(s.left, Math.floor(sharesToCover / 100));
          sharesToCover -= covered * 100;
          s.left -= covered;
        }
        total += s.strike * 100 * s.left;
      }
    }
    for (const l of longs) {
      if (l.left <= 0) continue;
      const paid = l.cost != null && Number.isFinite(l.cost) ? Math.max(0, l.cost) : 0;
      total += paid * (l.left / l.quantity);
    }
  }
  return Math.round(total);
}

/** Share of the portfolio (net liquidation) a dollar amount represents, in percent; null when net liquidation is unknown or not positive. */
export function portfolioPct(capital: number, netLiq: number | null | undefined): number | null {
  if (netLiq == null || !Number.isFinite(netLiq) || netLiq <= 0 || !Number.isFinite(capital)) return null;
  return (capital / netLiq) * 100;
}

/** "62%", "3.1%", "<0.1%"; empty when the share is unknown. */
export function formatPortfolioPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '';
  if (p > 0 && p < 0.05) return '<0.1%';
  return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

/** Account value not tied up by any position (net liquidation minus committed capital); 0 when unknown or over-committed. */
export function uncommittedCapital(committed: number, netLiq: number | null | undefined): number {
  if (netLiq == null || !Number.isFinite(netLiq) || netLiq <= 0) return 0;
  return Math.max(0, netLiq - committed);
}

/** "$2.8k", "$17.1k", "$950". */
export function compactMoney(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}
