// lib/market/fitText.ts
//
// MARKET-MAP-0003: sizes the text on a tile so it always fits inside it. Works in the map's own 1000-unit-wide layout space (1 unit =
// 0.1% of the map's width). Text widths use a deliberately wide estimate (bold capitals are wider than average), so a size that passes
// here fits in the browser. When even the smallest readable size does not fit, that text is dropped, never allowed to spill.

/** Estimated width of one bold glyph, as a multiple of the font size (W and M are the widest letters in a ticker). */
const CHAR_W = 0.7;
/** Estimated line height as a multiple of the font size. */
const LINE_H = 1.18;
/** Share of the tile the text may use on each side. */
const FILL = 0.88;
export const MAX_TICKER_SIZE = 38;
export const MIN_TEXT_SIZE = 8;
const PCT_RATIO = 0.62;
const LABEL_RATIO = 0.5;

export interface FitInput { w: number; h: number; ticker: string; pct: string; label?: string | null }
export interface FitResult {
  /** Font sizes in layout units; null = that text does not fit and is left off. */
  ticker: number | null;
  pct: number | null;
  label: number | null;
}

const widthFit = (len: number, w: number) => (len > 0 ? (w * FILL) / (CHAR_W * len) : Infinity);

export function fitTileText({ w, h, ticker, pct, label }: FitInput): FitResult {
  const none: FitResult = { ticker: null, pct: null, label: null };
  if (!(w > 0) || !(h > 0)) return none;
  const byWidth = Math.min(MAX_TICKER_SIZE, widthFit(ticker.length, w));
  const heightBudget = h * FILL;

  // Try the fullest layout first (ticker, %, label), then drop the label, then the %.
  const layouts: Array<{ pct: boolean; label: boolean }> = [];
  if (label) layouts.push({ pct: true, label: true });
  layouts.push({ pct: true, label: false }, { pct: false, label: false });
  for (const l of layouts) {
    const lines = LINE_H * (1 + (l.pct ? PCT_RATIO : 0) + (l.label ? LABEL_RATIO * 1.15 : 0));
    let t = Math.min(byWidth, heightBudget / lines);
    if (l.pct) t = Math.min(t, (widthFit(pct.length, w) / PCT_RATIO));
    if (l.label && label) t = Math.min(t, widthFit(label.length, w) / LABEL_RATIO);
    const pctSize = t * PCT_RATIO;
    const labelSize = t * LABEL_RATIO;
    if (t < MIN_TEXT_SIZE) continue;
    if (l.pct && pctSize < MIN_TEXT_SIZE) continue;
    if (l.label && labelSize < MIN_TEXT_SIZE) continue;
    return { ticker: t, pct: l.pct ? pctSize : null, label: l.label ? labelSize : null };
  }
  return none;
}

/** Size of the star / warning marker for a tile, or null when the tile is too small for one. */
export function markerSize(w: number, h: number): number | null {
  const side = Math.min(w, h);
  if (side < 16) return null;
  return Math.max(8, Math.min(18, side * 0.28));
}
