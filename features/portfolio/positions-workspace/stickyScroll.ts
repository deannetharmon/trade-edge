// features/portfolio/positions-workspace/stickyScroll.ts
//
// STICKY-HEADERS-0001 / TABLE-FOCUS-0001 (Dean, 2026-10-16). The Position Analysis table scrolls the page like any other content
// until you click a cell. A click puts the table in "focus": it becomes a box sized to end at the bottom of the window, its header row
// stays frozen, and the wheel moves its rows without moving the page. You leave focus by scrolling up from the first row (the wheel
// goes back to the page), pressing Esc, or clicking outside the table. Helpers:
//   * readStickyTop: how far from the top of the window the page's own sticky bars (app header plus the Portfolio sub-tab row) reach,
//     so the focused table can sit just below them.
//   * installFocusWheel: the wheel rule while the table is in focus.

const FALLBACK_HEADER_PX = 85;
const FALLBACK_SUBTABS_PX = 40;

export function readStickyTop(): number {
  if (typeof document === 'undefined') return FALLBACK_HEADER_PX + FALLBACK_SUBTABS_PX;
  const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-h'));
  const header = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_HEADER_PX;
  const sub = document.querySelector('[data-portfolio-subtabs]');
  const subHeight = sub ? sub.getBoundingClientRect().height : 0;
  return Math.round(header + (subHeight > 0 ? subHeight : FALLBACK_SUBTABS_PX));
}

/** Wheel rule while the table is in focus. Up at the first row: leave focus and let the page scroll. Down at the last row: stay put (never drag the page away). */
export function installFocusWheel(el: HTMLElement, release: () => void): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.defaultPrevented) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways: the table's own horizontal scroll
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const dy = e.deltaY * unit;
    if (dy === 0) return;
    if (dy < 0 && el.scrollTop <= 0) {
      release();
      window.scrollBy(0, dy);
      e.preventDefault();
      return;
    }
    if (dy > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1) e.preventDefault();
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
