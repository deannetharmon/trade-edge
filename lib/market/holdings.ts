// lib/market/holdings.ts
//
// MARKET-MAP-0001: turns the broker's raw positions into "what do I hold on each stock tile". Option legs are read from the OCC symbol
// plus the position's Long/Short direction; shares count as bullish. A leveraged fund is tied to the stock it tracks (NVDL -> NVDA)
// so your NVDL put shows on the NVDA tile.

import { parseOcc, type UnderlyingHolding } from './marketMapMath';

/** Fund underlying -> the stock tile it shows on. */
export const LINKED_UNDERLYINGS: Record<string, string> = { NVDL: 'NVDA' };

export interface TileHolding extends UnderlyingHolding {
  /** The fund or symbol the position is actually in, when it differs from the tile ("NVDL"). */
  via: string | null;
}

const fromBrokerTicker = (symbol: string): string => (symbol === 'BRK/B' ? 'BRK-B' : symbol);

export function buildHoldings(rawPositions: any[] | null | undefined): Map<string, TileHolding> {
  const out = new Map<string, TileHolding>();
  const touch = (underlying: string): TileHolding => {
    const raw = fromBrokerTicker(underlying.trim().toUpperCase());
    const tile = LINKED_UNDERLYINGS[raw] ?? raw;
    let h = out.get(tile);
    if (!h) { h = { legs: [], shares: 0, via: tile !== raw ? raw : null }; out.set(tile, h); }
    return h;
  };
  for (const p of rawPositions ?? []) {
    const qty = Math.abs(Number(p?.quantity ?? 0));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const short = String(p?.['quantity-direction'] ?? '').toLowerCase() === 'short';
    const type = String(p?.['instrument-type'] ?? '');
    const underlying = String(p?.['underlying-symbol'] ?? p?.symbol ?? '');
    if (!underlying) continue;
    if (type === 'Equity Option') {
      const occ = parseOcc(String(p?.symbol ?? ''));
      if (!occ) continue;
      touch(underlying).legs.push({ kind: occ.kind, side: short ? 'short' : 'long', strike: occ.strike, quantity: qty });
    } else if (type === 'Equity' && !short) {
      touch(underlying).shares += qty;
    }
  }
  return out;
}
