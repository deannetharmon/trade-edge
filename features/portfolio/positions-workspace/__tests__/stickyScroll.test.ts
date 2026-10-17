// features/portfolio/positions-workspace/__tests__/stickyScroll.test.ts
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusWheel, readStickyTop } from '../stickyScroll';

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

describe('installFocusWheel', () => {
  let box: HTMLDivElement;
  let cleanup: () => void;
  const release = vi.fn();
  const scrollBy = vi.fn();
  const metrics = (scrollTop: number) => {
    Object.defineProperty(box, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
  };
  const wheel = (init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
    box.dispatchEvent(e);
    return e;
  };
  beforeEach(() => {
    release.mockReset();
    scrollBy.mockReset();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    box = document.createElement('div');
    document.body.appendChild(box);
    cleanup = installFocusWheel(box, release);
  });
  afterEach(() => { cleanup(); box.remove(); });

  it('scrolling up from the first row leaves focus and hands the wheel to the page', () => {
    metrics(0);
    const e = wheel({ deltaY: -80 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, -80);
    expect(e.defaultPrevented).toBe(true);
  });

  it('mid-table the wheel just scrolls the rows (the page stays put, focus stays on)', () => {
    metrics(300);
    expect(wheel({ deltaY: -80 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: 80 }).defaultPrevented).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('running off the last row does not drag the page away', () => {
    metrics(600); // 600 + 400 = 1000: at the last row
    const e = wheel({ deltaY: 120 });
    expect(e.defaultPrevented).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('leaves sideways scrolling and pinch-zoom alone', () => {
    metrics(0);
    expect(wheel({ deltaX: 90, deltaY: -10 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: -50, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('stops listening after cleanup', () => {
    cleanup();
    metrics(0);
    wheel({ deltaY: -80 });
    expect(release).not.toHaveBeenCalled();
  });
});
