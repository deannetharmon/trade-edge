// lib/scans/scan-utils.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import { ESTIMATED_EARNINGS_CYCLE_DAYS } from './constants';

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}


export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const erfApprox =
    sign *
    (1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absX * absX)));

  return 0.5 * (1 + erfApprox);
}


export function calcSpreadPop(
  strategy: 'BPS' | 'BCS',
  price: number | null,
  shortStrike: number,
  credit: number,
  dte: number,
  ivPct: number | null | undefined
): number | null {
  if (price == null || price <= 0 || ivPct == null || ivPct <= 0 || dte <= 0) return null;

  const sigma = ivPct / 100;
  const t = dte / 365;

  const breakEven =
    strategy === 'BPS'
      ? shortStrike - credit
      : shortStrike + credit;

  const d2 =
    (Math.log(price / breakEven) - 0.5 * sigma * sigma * t) /
    (sigma * Math.sqrt(t));

  return strategy === 'BPS'
    ? normalCdf(d2) * 100
    : (1 - normalCdf(d2)) * 100;
}


export function normalizeIv(value: any): number | null {
  if (value == null) return null;

  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return null;

  // Tastytrade often returns IV as decimal, e.g. 1.046 = 104.6%
  // Sometimes it may already be percent, e.g. 104.6
  if (n <= 5) return n * 100;

  return n;
}


export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date}T12:00:00`) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


export function estimateNextEarningsDate(lastEarningsDate: string): Date {
  const d = new Date(`${lastEarningsDate}T12:00:00`);
  d.setDate(d.getDate() + ESTIMATED_EARNINGS_CYCLE_DAYS);
  return d;
}


export function normalizeTickerToken(raw: string): string | null {
  const token = raw.trim().toUpperCase().replace(/[–—]/g, '-').replace(/\.$/, '');
  if (!token) return null;

  // Yahoo-style class-share normalization.
  const normalized = token.replace('.', '-');
  if (normalized === 'BRK-B' || normalized === 'BRK/B') return 'BRK-B';
  if (normalized === 'BF-B' || normalized === 'BF/B') return 'BF-B';

  // Allow valid US ticker shapes, including one-character tickers:
  // C, F, T, X, V, etc.
  if (!/^[A-Z]{1,5}(-[A-Z])?$/.test(normalized)) return null;

  return normalized;
}


export function getWidthSteps(maxWidth: number, price: number | null): number[] {
  // Always start at $5 so high-priced ETFs/indexes can find narrow spreads with viable credit ratios.
  // Step size scales with price to keep iteration count reasonable.
  // e.g. SPY $739: steps $5, $10, $15... up to maxWidth
  //      SPX $7412: steps $25, $50... up to maxWidth (price>=2000 uses $25 steps)
  const stepSize = price == null ? 5 : price >= 2000 ? 25 : price >= 500 ? 5 : price >= 200 ? 5 : 5;
  const steps: number[] = [];
  for (let w = stepSize; w <= maxWidth; w += stepSize) steps.push(w);
  return steps;
}


export function getBidAskMax(price: number | null): number {
  if (price == null) return 1.50;
  if (price >= 500) return 3.00;
  if (price >= 200) return 1.50;
  if (price >= 100) return 0.50;
  return 0.10;
}


