// features/portfolio/positions-workspace/stickyScroll.ts
//
// STICKY-HEADERS-0001 (Dean, 2026-10-16): the Portfolio positions list had no frozen header, and the Position Analysis table lost its
// header when the wheel ran past the table's last row (the scroll then carried the whole page up). Two helpers:
//   * readStickyTop: how far from the top of the window the page's own sticky bars (app header plus the Portfolio sub-tab row) reach,
//     so a table header can freeze just below them.
//   * installWheelHandoff: keeps the wheel useful on a table that scrolls inside its own box. Until the table's top has reached the
//     bars, the wheel moves the PAGE (so the whole box comes into view); after that it moves the table's rows, and running off the
//     last row no longer drags the page away (the CSS overscroll-behavior on the box does that part). At the first row, scrolling up
//     hands the wheel back to the page.

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

export function installWheelHandoff(el: HTMLElement, getTop: () => number): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.defaultPrevented) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways: the table's own horizontal scroll
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const dy = e.deltaY * unit;
    if (dy === 0) return;
    const pin = getTop();
    const top = el.getBoundingClientRect().top;
    if (dy > 0 && top > pin + 1) {
      window.scrollBy(0, Math.min(dy, top - pin));
      e.preventDefault();
      return;
    }
    if (dy < 0 && el.scrollTop <= 0) {
      window.scrollBy(0, dy);
      e.preventDefault();
    }
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
