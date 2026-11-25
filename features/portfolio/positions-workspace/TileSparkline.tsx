// features/portfolio/positions-workspace/TileSparkline.tsx

// SPARKLINES-0001B/C: the small 30-day line to the right of a tile's P/L number. HEIGHT RULE: everything is absolutely positioned
// inside a box that only fills the leftover width of the number's own row, so it can never make the tile taller. It hides itself
// when the box is narrower than MIN_W. A dashed horizontal line marks the prior day; "30d" names the span; hover shows date and value.

'use client';

import { useEffect, useRef, useState } from 'react';
import { daysBetween, fmtShortDate } from '@/lib/portfolio-data/nlvSparkline';
import type { SeriesSpark } from '@/lib/portfolio-data/tileSparkline';

const W = 100;
const H = 24;
const MIN_W = 40;

export function TileSparkline({ spark }: { spark: SeriesSpark | null }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setFits((entries[0]?.contentRect.width ?? 0) >= MIN_W));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = spark?.points ?? [];
  const enough = points.length >= 2 && spark != null;
  const change = spark?.change ?? null;
  const color = change == null || Math.round(change) === 0 ? 'text-white/50' : change > 0 ? 'text-emerald-400' : 'text-red-400';
  let body: React.ReactNode = null;
  if (fits && enough && spark) {
    const values = points.map(p => p.value);
    const all = spark.priorValue != null ? [...values, spark.priorValue] : values;
    let mn = Math.min(...all);
    let mx = Math.max(...all);
    if (mx === mn) { mn -= 1; mx += 1; }
    const first = points[0].date;
    const last = points[points.length - 1].date;
    const span = Math.max(1, daysBetween(first, last));
    const xs = points.map(p => (daysBetween(first, p.date) / span) * W);
    const y = (v: number) => 2 + (1 - (v - mn) / (mx - mn)) * (H - 4);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const slot = W / Math.max(1, points.length - 1);
    body = (
      <>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`absolute inset-0 h-full w-full ${color}`} role="img" aria-label={`30 days, ${fmtShortDate(first)} to ${fmtShortDate(last)}`}>
          {spark.priorValue != null && <line x1="0" x2={W} y1={y(spark.priorValue)} y2={y(spark.priorValue)} stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" data-testid="tile-prior-line" />}
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" data-testid="tile-line" />
          {points.map((p, i) => (
            <rect key={p.date} x={xs[i] - slot / 2} y="0" width={slot} height={H} fill="transparent">
              <title>{`${fmtShortDate(p.date)} · ${p.value < 0 ? '-' : ''}$${Math.abs(Math.round(p.value)).toLocaleString('en-US')}`}</title>
            </rect>
          ))}
        </svg>
        <span className="pointer-events-none absolute right-0 top-0 text-[9px] leading-none text-white/40">30d</span>
      </>
    );
  } else if (fits) {
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-white/40" role="img" aria-label="Collecting history" data-testid="tile-placeholder">
        <title>Collecting history</title>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  return <span ref={boxRef} data-testid="tile-spark" className="relative ml-2 block min-w-0 flex-1">{body}</span>;
}
