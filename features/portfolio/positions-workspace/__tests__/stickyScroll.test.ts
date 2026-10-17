// features/portfolio/positions-workspace/__tests__/stickyScroll.test.ts
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWheelHandoff, readStickyTop } from '../stickyScroll';

describe('readStickyTop', () => {
  afterEach(() => { document.documentElement.style.removeProperty('--app-header-h'); document.body.innerHTML = ''; });
  it('adds the published app header height to the sub-tab row height', () => {
    document.documentElement.style.setProperty('--app-header-h', '90px');
    const bar = document.createElement('div');
    bar.setAttribute('data-portfolio-subtabs', '');
    bar.getBoundingClientRect = () => ({ height: 38 }) as DOMRect;
    document.body.appendChild(bar);
    expect(readStickyTop()).toBe(128);
  });
  it('falls back to sensible heights when nothing is published or found', () => {
    expect(readStickyTop()).toBe(125);
  });
});

describe('installWheelHandoff', () => {
  let box: HTMLDivElement;
  let cleanup: () => void;
  const scrollBy = vi.fn();
  const place = (top: number, scrollTop: number) => {
    box.getBoundingClientRect = () => ({ top }) as DOMRect;
    box.scrollTop = scrollTop;
  };
  const wheel = (init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
    box.dispatchEvent(e);
    return e;
  };
  beforeEach(() => {
    scrollBy.mockReset();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    box = document.createElement('div');
    document.body.appendChild(box);
    cleanup = installWheelHandoff(box, () => 120);
  });
  afterEach(() => { cleanup(); box.remove(); });

  it('scrolling down while the table sits below the page bars moves the page, only as far as the bars', () => {
    place(400, 0);
    const e = wheel({ deltaY: 100 });
    expect(scrollBy).toHaveBeenCalledWith(0, 100);
    expect(e.defaultPrevented).toBe(true);
    wheel({ deltaY: 900 });
    expect(scrollBy).toHaveBeenLastCalledWith(0, 280); // 400 - 120, not 900
  });

  it('once the table is under the bars, the wheel scrolls the rows and the page stays put', () => {
    place(120, 50);
    const e = wheel({ deltaY: 100 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('scrolling up at the first row hands the wheel back to the page; mid-table it does not', () => {
    place(120, 0);
    const up = wheel({ deltaY: -80 });
    expect(scrollBy).toHaveBeenCalledWith(0, -80);
    expect(up.defaultPrevented).toBe(true);
    scrollBy.mockReset();
    place(120, 300);
    const mid = wheel({ deltaY: -80 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(mid.defaultPrevented).toBe(false);
  });

  it('leaves sideways scrolling and pinch-zoom alone', () => {
    place(400, 0);
    expect(wheel({ deltaX: 90, deltaY: 10 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: 50, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('stops listening after cleanup', () => {
    cleanup();
    place(400, 0);
    wheel({ deltaY: 100 });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
