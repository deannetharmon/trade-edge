// features/trade-map/TradeGraph.tsx
//
// OPTMAP-0001 S2b: profit/loss curve for the Trade Map. Solid line = the
// selected date, dashed line = expiration day. Green above zero, red below.
// Vertical markers: current stock price and breakevens (at expiry).
// Display only; all numbers come from lib/trademap.

'use client';

import { formatModeValue, modeValue, type DisplayMode, type ModeBasis } from '@/lib/trademap/displayModes';
import type { CurvePoint } from '@/lib/trademap/graphModel';

const W = 720;
const H = 300;
const PAD = { l: 64, r: 12, t: 12, b: 26 };

interface Props {
  selected: CurvePoint[];
  expiry: CurvePoint[];
  mode: DisplayMode;
  basis: ModeBasis;
  spot: number;
  breakevens: number[];
  mutedColor: string;
}

export default function TradeGraph({ selected, expiry, mode, basis, spot, breakevens, mutedColor }: Props) {
  const sel = selected.map(p => ({ x: p.price, y: modeValue(mode, p.cell, basis) }));
  const exp = expiry.map(p => ({ x: p.price, y: modeValue(mode, p.cell, basis) }));
  const ys: number[] = [0];
  for (const p of sel.concat(exp)) if (p.y != null) ys.push(p.y);
  if (sel.some(p => p.y == null)) return <div className="text-xs text-rose-400 p-3">This view is not defined for the selected trade.</div>;

  const xMin = sel[0].x;
  const xMax = sel[sel.length - 1].x;
  const yMin = Math.min.apply(null, ys);
  const yMax = Math.max.apply(null, ys);
  const ySpan = yMax - yMin || 1;
  const sx = (x: number) => PAD.l + ((x - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + ((yMax - y) / ySpan) * (H - PAD.t - PAD.b);
  const zeroY = sy(0);
  const line = (pts: Array<{ x: number; y: number | null }>) => pts.filter(p => p.y != null).map(p => `${sx(p.x).toFixed(1)},${sy(p.y as number).toFixed(1)}`).join(' ');
  const ticks = [yMin, yMin + ySpan / 2, yMax];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => xMin + f * (xMax - xMin));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Profit and loss curve">
      <defs>
        <clipPath id="tm-above"><rect x={0} y={0} width={W} height={Math.max(0, zeroY)} /></clipPath>
        <clipPath id="tm-below"><rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} /></clipPath>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke={mutedColor} strokeOpacity={0.15} />
          <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end" fontSize={10} fill={mutedColor}>{formatModeValue(mode, t)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={sx(t)} y={H - 8} textAnchor="middle" fontSize={10} fill={mutedColor}>${t.toFixed(t >= 100 ? 0 : 2)}</text>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke={mutedColor} strokeOpacity={0.6} />
      {spot >= xMin && spot <= xMax && <line x1={sx(spot)} x2={sx(spot)} y1={PAD.t} y2={H - PAD.b} stroke={mutedColor} strokeDasharray="2 3" />}
      {breakevens.filter(b => b >= xMin && b <= xMax).map(b => (
        <g key={b}>
          <line x1={sx(b)} x2={sx(b)} y1={PAD.t} y2={H - PAD.b} stroke="#f59e0b" strokeOpacity={0.8} />
          <text x={sx(b) + 3} y={PAD.t + 10} fontSize={10} fill="#f59e0b">BE ${b.toFixed(2)}</text>
        </g>
      ))}
      {[exp, sel].map((pts, k) => (
        <g key={k} opacity={k === 0 ? 0.55 : 1}>
          <polyline points={line(pts)} fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray={k === 0 ? '5 4' : undefined} clipPath="url(#tm-above)" />
          <polyline points={line(pts)} fill="none" stroke="#f43f5e" strokeWidth={2} strokeDasharray={k === 0 ? '5 4' : undefined} clipPath="url(#tm-below)" />
        </g>
      ))}
    </svg>
  );
}
