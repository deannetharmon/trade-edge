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
}

export interface UnderlyingHolding {
  /** Option legs plus the share count (signed; shares count as bullish). */
  legs: OptionLeg[];
  shares: number;
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
