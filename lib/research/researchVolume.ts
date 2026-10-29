// lib/research/researchVolume.ts

// RESEARCH-VOL-0001: volume bars under the Research price chart. INFORMATION ONLY: never an input to scoring or qualification.
// Bars line up with the price chart's x positions (`i / (n - 1) * width`), so a hover reads the same bar in every panel.
// Pure helpers; no fetching here.

import type { ResearchPoint } from '@/lib/research/yahooChart';

export interface VolumeBar { x: number; width: number; y: number; height: number; up: boolean }

/** True when at least two points carry a volume, the least a bar chart needs. */
export function hasVolume(points: readonly ResearchPoint[]): boolean {
  return points.filter(p => typeof p.v === 'number').length >= 2;
}

/**
 * One bar per point that has a volume, scaled to the largest volume in view with a zero baseline. A bar is "up" when its
 * close is at or above the previous close (the first bar counts as up). A point with no volume is skipped, not drawn as zero.
 */
export function volumeBars(points: readonly ResearchPoint[], width: number, height: number, pad = 2): VolumeBar[] {
  const n = points.length;
  if (n < 2) return [];
  const max = Math.max(0, ...points.map(p => (typeof p.v === 'number' ? p.v : 0)));
  if (max <= 0) return [];
  const barWidth = Math.max(1, (width / (n - 1)) * 0.7);
  const usable = height - pad * 2;
  const bars: VolumeBar[] = [];
  points.forEach((p, i) => {
    if (typeof p.v !== 'number') return;
    const h = (p.v / max) * usable;
    const centre = (i / (n - 1)) * width;
    bars.push({
      x: Math.min(width - barWidth, Math.max(0, centre - barWidth / 2)),
      width: barWidth,
      y: height - pad - h,
      height: Math.max(h, p.v > 0 ? 1 : 0),
      up: i === 0 || p.c >= points[i - 1].c,
    });
  });
  return bars;
}
