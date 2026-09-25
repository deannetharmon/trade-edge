// components/RsiStrip.tsx
//
// RSI-TURN-0001: the RSI line, a plain-words caption and a state label for a quick-chart popup.
// INFORMATION ONLY: neutral colors, no pass or fail, never an input to scoring or qualification.

'use client';

import { classifyRsiTurn, describeRsiTurn, RSI_STATE_LABEL, RSI_TURN_PARAMS } from '@/lib/indicators/rsiTurn';
import type { THEMES, Theme } from '@/lib/theme';

const BARS_SHOWN = 30;
const WIDTH = 256;
const HEIGHT = 64;
const PAD = 4;

export function RsiStrip({ closes, th }: { closes: number[] | null; th: typeof THEMES[Theme] }) {
  const result = closes ? classifyRsiTurn(closes) : null;
  if (!result) {
    return <p role="status" className={`text-[9px] ${th.textFaint}`} data-testid="rsi-strip-unavailable">RSI n/a</p>;
  }
  const shown = result.series.slice(-BARS_SHOWN);
  const x = (i: number) => PAD + (i * (WIDTH - 2 * PAD)) / Math.max(1, shown.length - 1);
  const y = (value: number) => HEIGHT - PAD - ((Math.min(90, Math.max(10, value)) - 10) / 80) * (HEIGHT - 2 * PAD);
  const points = shown.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const wantHigh = result.state === 'TURNING_DOWN' || result.state === 'OVERBOUGHT_NO_TURN';
  const extremeIndex = result.extreme == null ? -1 : shown.length - 1 - (result.extremeBarsAgo ?? 0);
  const label = result.state === 'INSUFFICIENT' ? null : RSI_STATE_LABEL[result.state];
  const tone = result.state === 'TURNING_UP' ? 'text-teal-300 border-teal-700' : result.state === 'TURNING_DOWN' ? 'text-amber-300 border-amber-700' : `${th.textFaint} border-slate-700`;
  return (
    <div data-testid="rsi-strip" data-state={result.state}>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-[10px] font-bold tracking-widest ${th.textFaint}`}>RSI(14)</span>
        <span className={`rounded-full border px-2 text-[9px] ${tone}`}>{label}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={`RSI for the last ${shown.length} daily bars with lines at ${RSI_TURN_PARAMS.low} and ${RSI_TURN_PARAMS.high}`}>
        {[RSI_TURN_PARAMS.low, RSI_TURN_PARAMS.high].map(line => (
          <g key={line}>
            <line x1={0} x2={WIDTH} y1={y(line)} y2={y(line)} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" />
            <text x={WIDTH - 2} y={y(line) - 2} textAnchor="end" fontSize={8} fill="#94a3b8">{line}</text>
          </g>
        ))}
        <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth={1.6} />
        {extremeIndex >= 0 && <circle cx={x(extremeIndex)} cy={y(shown[extremeIndex])} r={3} fill={wantHigh ? '#f5b942' : '#2dd4bf'} />}
        <circle cx={x(shown.length - 1)} cy={y(shown[shown.length - 1])} r={3} fill="#e2e8f0" />
      </svg>
      <p className={`mt-1 text-[10px] ${th.textFaint}`} data-testid="rsi-caption">{describeRsiTurn(result)}</p>
      <p className={`text-[9px] ${th.textFaint}`}>Daily bars; the latest may be live. An entry timing hint, not a signal.</p>
    </div>
  );
}
