// features/portfolio/positions-workspace/RsiSparkline.tsx

// STOCK-RSI-0001 slice B1 -- the last 30 completed sessions of daily RSI, with the 30 / cutoff / 70 reference lines and
// markers for the entry date (when it falls in the window) and now. Display only.

import type { StockRsiPoint } from '@/lib/portfolio/stockRsi';

const W = 240;
const H = 64;
const PAD = 4;

export const RSI_SPARK_SESSIONS = 30;

export function RsiSparkline({ points, cutoff, entryDate, symbol }: { points: StockRsiPoint[]; cutoff: number; entryDate: string | null; symbol: string }) {
  const window = points.slice(-RSI_SPARK_SESSIONS);
  if (window.length < 2) return null;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (window.length - 1);
  const y = (v: number) => PAD + ((100 - Math.max(0, Math.min(100, v))) * (H - 2 * PAD)) / 100;
  const path = window.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rsi).toFixed(1)}`).join(' ');
  let entryIndex = -1;
  if (entryDate && entryDate >= window[0].date && entryDate <= window[window.length - 1].date) {
    window.forEach((p, i) => { if (p.date <= entryDate) entryIndex = i; });
  }
  const last = window[window.length - 1];
  return (
    <svg data-testid={`rsi-sparkline-${symbol}`} role="img" aria-label={`${symbol} daily RSI, last ${window.length} sessions`} viewBox={`0 0 ${W} ${H}`} className="h-16 w-full max-w-[240px]">
      {[30, 70].map(level => <line key={level} x1={PAD} x2={W - PAD} y1={y(level)} y2={y(level)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 3" />)}
      <line x1={PAD} x2={W - PAD} y1={y(cutoff)} y2={y(cutoff)} stroke="currentColor" strokeOpacity="0.5" strokeDasharray="4 3" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {entryIndex >= 0 && <circle data-testid="rsi-entry-marker" cx={x(entryIndex)} cy={y(window[entryIndex].rsi)} r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      <circle cx={x(window.length - 1)} cy={y(last.rsi)} r="3" fill="currentColor" />
    </svg>
  );
}
