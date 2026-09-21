// lib/leaps-position-intelligence/sinceOpen.ts
//
// LEAPS-SINCE-0001 -- the "since you opened" tiles for a held LEAPS: where the stock, the LEAPS's delta, and IVR have gone since the
// position's entry baseline was recorded (the app's existing position-entry-snapshot store), plus extrinsic lost when the baseline is
// a true at-open baseline. Pure and rule-based; whatever cannot be computed is left out, never estimated.
//
// Honesty rule: the entry baseline is captured the first time the app sees a position. When that is within a day of the broker's real
// open date the tiles are labelled "Since you opened"; otherwise "Since first tracked <date>", and extrinsic lost is omitted (the
// stock price and greeks at the real open are unknown, so it would be a wrong number).
//
// Colours are what the move means for a LONG call: stock up and delta up are good; stock down, delta down and IVR down are amber
// (less stock-like, or volatility that no longer favours the holder); extrinsic lost is neutral because it is expected.

import { money, pct, type DashboardTile, type DashboardTone } from '@/lib/leaps-analysis/dashboard';

export const SINCE_OPEN_POLICY = {
  /** A stock move smaller than this % counts as unchanged. */
  flatStockPct: 0.05,
  /** A delta change smaller than this counts as unchanged. */
  flatDelta: 0.005,
  /** An IVR change smaller than this many points counts as unchanged. */
  flatIvrPts: 0.5,
  /** The baseline is "at open" when it was captured within this many days of the broker's open date. */
  atOpenMaxGapDays: 1,
} as const;

export interface SinceOpenInput {
  strike: number;
  now: { stockPrice: number | null; delta: number | null; ivr: number | null; markPerShare: number | null };
  entry: {
    /** ISO time the baseline was recorded (or the order was placed, for an order record). */
    capturedAt: string | null;
    /** Where the baseline came from: the first-seen position baseline (default), or a true record made when the order was placed. */
    capturedFrom?: 'baseline' | 'order';
    /** Broker open date, YYYY-MM-DD. */
    entryDate: string | null;
    stockPrice: number | null;
    /** Delta per share at capture (position delta ÷ contracts). */
    deltaPerShare: number | null;
    ivr: number | null;
    /** Premium per share paid (broker average open price). */
    entryPricePerShare: number | null;
  };
}

export interface SinceOpen {
  basis: 'opened' | 'first-tracked' | 'none'; label: string; tiles: DashboardTile[];
  /** Extrinsic value lost per share since the open (positive = lost); null unless the baseline is a true at-open baseline with usable prices. */
  extrinsicLostPerShare: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86_400_000;
const tile = (id: string, label: string, value: string, tone: DashboardTone, parts: DashboardTile['parts']): DashboardTile => ({ id, label, value, tone, parts });
const arrow = (change: number) => (change > 0 ? '▲' : '▼');

/** True when a baseline recorded at `capturedAt` is within the at-open tolerance of the broker's open date. */
export function isBaselineAtOpen(capturedAt: string | null, entryDate: string | null): boolean {
  const capturedDate = capturedAt && ISO_DATE.test(capturedAt.slice(0, 10)) ? capturedAt.slice(0, 10) : null;
  if (!capturedDate || !entryDate || !ISO_DATE.test(entryDate)) return false;
  const entryDay = Date.parse(entryDate);
  return Number.isFinite(entryDay) && Math.abs(Date.parse(capturedDate) - entryDay) / dayMs <= SINCE_OPEN_POLICY.atOpenMaxGapDays;
}

export function buildSinceOpen(input: SinceOpenInput): SinceOpen {
  const { entry, now, strike } = input;
  const capturedDate = entry.capturedAt && ISO_DATE.test(entry.capturedAt.slice(0, 10)) ? entry.capturedAt.slice(0, 10) : null;
  if (!capturedDate) return { basis: 'none', label: '', tiles: [], extrinsicLostPerShare: null };

  const basis: SinceOpen['basis'] = isBaselineAtOpen(entry.capturedAt, entry.entryDate) ? 'opened' : 'first-tracked';
  const label = basis === 'opened' ? 'Since you opened' : entry.capturedFrom === 'order' ? `Since you placed the order ${capturedDate}` : `Since first tracked ${capturedDate}`;
  const tiles: DashboardTile[] = [];
  const flat = (text: string) => [{ text, tone: 'neutral' as const }];
  let extrinsicLostPerShare: number | null = null;

  if (entry.stockPrice != null && entry.stockPrice > 0 && now.stockPrice != null && now.stockPrice > 0) {
    const change = now.stockPrice - entry.stockPrice;
    const changePct = (change / entry.stockPrice) * 100;
    const isFlat = Math.abs(changePct) < SINCE_OPEN_POLICY.flatStockPct;
    const tone: DashboardTone = isFlat ? 'neutral' : change > 0 ? 'good' : 'watch';
    tiles.push(tile('stock', 'Stock', money(now.stockPrice), tone,
      isFlat ? flat(`unchanged from ${money(entry.stockPrice)}`)
        : [{ text: `${arrow(change)} ${change > 0 ? '+' : '-'}${money(Math.round(Math.abs(change) * 100) / 100)} (${change > 0 ? '+' : '-'}${pct(Math.abs(changePct))})`, tone }, { text: `from ${money(entry.stockPrice)}`, tone: 'neutral' }]));
  }

  if (entry.deltaPerShare != null && now.delta != null) {
    const change = now.delta - entry.deltaPerShare;
    const isFlat = Math.abs(change) < SINCE_OPEN_POLICY.flatDelta;
    const tone: DashboardTone = isFlat ? 'neutral' : change > 0 ? 'good' : 'watch';
    tiles.push(tile('delta', 'Delta', now.delta.toFixed(2), tone,
      isFlat ? flat(`unchanged from ${entry.deltaPerShare.toFixed(2)}`)
        : [{ text: `${arrow(change)} ${Math.abs(change).toFixed(2)}`, tone }, { text: `from ${entry.deltaPerShare.toFixed(2)}`, tone: 'neutral' }]));
  }

  if (entry.ivr != null && now.ivr != null) {
    const change = now.ivr - entry.ivr;
    const isFlat = Math.abs(change) < SINCE_OPEN_POLICY.flatIvrPts;
    const tone: DashboardTone = isFlat ? 'neutral' : change > 0 ? 'good' : 'watch';
    tiles.push(tile('ivr', 'IVR', `${now.ivr.toFixed(0)}%`, tone,
      isFlat ? flat(`unchanged from ${entry.ivr.toFixed(0)}%`)
        : [{ text: `${arrow(change)} ${Math.abs(change).toFixed(0)} pts`, tone }, { text: `from ${entry.ivr.toFixed(0)}%`, tone: 'neutral' }]));
  }

  // Extrinsic lost needs the stock price and greeks at the real open, so it is shown only for a true at-open baseline.
  if (basis === 'opened' && entry.stockPrice != null && now.stockPrice != null && entry.entryPricePerShare != null && now.markPerShare != null) {
    const entryExtrinsic = entry.entryPricePerShare - Math.max(entry.stockPrice - strike, 0);
    const nowExtrinsic = now.markPerShare - Math.max(now.stockPrice - strike, 0);
    if (entryExtrinsic >= 0 && nowExtrinsic >= 0) {
      const lost = entryExtrinsic - nowExtrinsic;
      extrinsicLostPerShare = lost;
      const rounded = Math.round(Math.abs(lost) * 100) / 100;
      tiles.push(tile('extrinsic', 'Extrinsic', money(Math.round(nowExtrinsic * 100) / 100), 'neutral',
        rounded < 0.01 ? flat('unchanged') : [{ text: `${lost > 0 ? '▼' : '▲'} ${money(rounded)} ${lost > 0 ? 'lost' : 'gained'}`, tone: 'neutral' }, { text: `from ${money(Math.round(entryExtrinsic * 100) / 100)}`, tone: 'neutral' }]));
    }
  }

  return { basis, label, tiles, extrinsicLostPerShare };
}
