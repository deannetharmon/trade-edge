// features/portfolio/positions-workspace/useStickyTop.ts
'use client';

import { useEffect, useState } from 'react';
import { readStickyTop } from './stickyScroll';

/** Pixels from the top of the window to the bottom of the page's sticky bars; re-read after layout and on resize. */
export function useStickyTop(): number {
  const [top, setTop] = useState<number>(() => readStickyTop());
  useEffect(() => {
    const update = () => setTop(previous => { const next = readStickyTop(); return next === previous ? previous : next; });
    update();
    const frame = window.requestAnimationFrame(update); // the app header publishes its height after it mounts
    window.addEventListener('resize', update);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', update); };
  }, []);
  return top;
}
