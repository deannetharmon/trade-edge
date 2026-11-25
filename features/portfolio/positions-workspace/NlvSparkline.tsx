// features/portfolio/positions-workspace/NlvSparkline.tsx

// SPARKLINES-0001A (Dean, 2026-11-24; Diane's v3 mock): the Portfolio Value line with a value axis (high and low), a date axis
// (first day to last day) and a dashed prior-close line. HEIGHT RULE: it never makes the tile taller. The box is flex-1 with
// min-h-0 and everything inside is absolutely positioned, so it adds nothing to the row height; it only fills the empty
// space under the text, and hides itself when that space is under MIN_H.

'use client';

import { useEffect, useRef, useState } from 'react';
import { daysBetween, fmtCompact, fmtShortDate, type NlvSpark } from '@/lib/portfolio-data/nlvSparkline';

const W = 220;
const H = 44;
const PAD = 3;
const MIN_H = 40;

export function NlvSparkline({ spark, note }: { spark: NlvSpark | null; note?: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setFits((entries[0]?.contentRect.height ?? 0) >= MIN_H));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = spark?.points ?? [];
  const enough = points.length >= 2;
  const change = spark?.change ?? null;
  const color = change == null || Math.round(change) === 0 ? 'text-white/50' : change > 0 ? 'text-emerald-400' : 'text-red-400';

  let body: React.ReactNode = null;
  if (fits && enough && spark) {
    const values = points.map(p => p.netLiquidatingValue);
    const all = spark.priorClose != null ? [...values, spark.priorClose] : values;
    let mn = Math.min(...all);
    let mx = Math.max(...all);
    if (mx === mn) { mn -= 1; mx += 1; }
    const first = points[0].date;
    const last = points[points.length - 1].date;
    const span = Math.max(1, daysBetween(first, last));
    const xs = points.map(p => (daysBetween(first, p.date) / span) * W);
    const y = (v: number) => PAD + (1 - (v - mn) / (mx - mn)) * (H - 2 * PAD);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${y(p.netLiquidatingValue).toFixed(1)}`).join(' ');
    const slot = W / Math.max(1, points.length - 1);
    body = (
      <div className="absolute inset-0 grid grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-1.5 gap-y-0.5">
        <div className="flex flex-col justify-between text-right text-[10px] leading-none text-white/50">
          <span>{fmtCompact(mx)}</span>
          <span>{fmtCompact(mn)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`h-full w-full min-h-0 ${color}`} role="img" aria-label={`Portfolio value, ${fmtShortDate(first)} to ${fmtShortDate(last)}`}>
          {spark.priorClose != null && (
            <line x1="0" x2={W} y1={y(spark.priorClose)} y2={y(spark.priorClose)} stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" data-testid="nlv-prior-close" />
          )}
          <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="currentColor" opacity="0.1" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" data-testid="nlv-line" />
          {points.map((p, i) => (
            <rect key={p.date} x={xs[i] - slot / 2} y="0" width={slot} height={H} fill="transparent">
              <title>{`${fmtShortDate(p.date)} · $${Math.round(p.netLiquidatingValue).toLocaleString('en-US')}`}</title>
            </rect>
          ))}
        </svg>
        <span />
        <div className="flex justify-between text-[10px] leading-none text-white/50">
          <span>{fmtShortDate(first)}</span>
          <span>{fmtShortDate(last)}</span>
        </div>
      </div>
    );
  } else if (fits && !enough) {
    body = (
      <div className="absolute inset-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-white/40" aria-hidden="true" data-testid="nlv-placeholder">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        {note && <span className="absolute bottom-0 left-0 max-w-full truncate text-[10px] leading-none text-white/40" data-testid="nlv-note">{note.slice(0, 90)}</span>}
      </div>
    );
  }

  return <div ref={boxRef} data-testid="nlv-spark" className="relative mt-2 min-h-0 flex-1">{body}</div>;
}
