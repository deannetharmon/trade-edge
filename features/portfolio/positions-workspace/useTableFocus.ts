// features/portfolio/positions-workspace/useTableFocus.ts
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { installFocusWheel, readStickyTop } from './stickyScroll';

const CONTROL = 'button,a,select,input,textarea,summary,label';

/**
 * TABLE-FOCUS-0001: a table that scrolls with the page until a cell is clicked.
 * Click a cell (mouse or pen; controls inside cells and touch are ignored): the table enters focus, the page moves so the table sits
 * under the page bars, and the wheel scrolls only its rows. Scroll up from the first row, press Esc, or click outside to leave.
 */
export function useTableFocus(getTop: () => number = readStickyTop) {
  const [active, setActive] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const boxRef = useCallback((node: HTMLDivElement | null) => { box.current = node; }, []);
  const release = useCallback(() => setActive(false), []);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(CONTROL)) return;
    setActive(true);
  }, []);

  // Entering focus: bring the table's top up under the page bars so the most rows are visible.
  useLayoutEffect(() => {
    const el = box.current;
    if (!active || !el) return;
    const delta = el.getBoundingClientRect().top - getTop();
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }, [active, getTop]);

  useEffect(() => {
    const el = box.current;
    if (!active || !el) return;
    const removeWheel = installFocusWheel(el, release);
    const onPointerDown = (event: PointerEvent) => { if (!el.contains(event.target as Node)) release(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') release(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      removeWheel();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, release]);

  return { active, boxRef, onPointerDownCapture, release };
}
