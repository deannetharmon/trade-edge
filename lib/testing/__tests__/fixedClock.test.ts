// lib/testing/__tests__/fixedClock.test.ts
//
// CI-FLAKY-0002 -- the pinned-clock helper itself: pins only Date (never timers), restores real
// time afterward, and isoDateFromNow reads from whatever clock (real or pinned) is active.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoDateFromNow, pinClock, unpinClock } from '../fixedClock';

describe('pinClock / unpinClock', () => {
  afterEach(() => unpinClock());

  it('pins Date.now() and new Date() to the given instant', () => {
    pinClock('2026-06-15T23:30:00Z');
    expect(new Date().toISOString()).toBe('2026-06-15T23:30:00.000Z');
    expect(Date.now()).toBe(new Date('2026-06-15T23:30:00Z').getTime());
  });

  it('does not fake timers -- setTimeout still fires with real delay semantics', async () => {
    pinClock('2026-06-15T23:30:00Z');
    let ran = false;
    await new Promise<void>((resolve) => {
      setTimeout(() => { ran = true; resolve(); }, 0);
    });
    expect(ran).toBe(true);
  });

  it('unpinClock restores the real clock', () => {
    const before = Date.now();
    pinClock('2026-06-15T23:30:00Z');
    expect(Date.now()).not.toBe(before);
    unpinClock();
    expect(Math.abs(Date.now() - before)).toBeLessThan(5000);
  });
});

describe('isoDateFromNow', () => {
  afterEach(() => unpinClock());

  it('reads from the pinned clock when one is active', () => {
    pinClock('2026-06-15T06:00:00Z');
    expect(isoDateFromNow(0)).toBe('2026-06-15');
    expect(isoDateFromNow(1)).toBe('2026-06-16');
    expect(isoDateFromNow(30)).toBe('2026-07-15');
  });

  it('crosses a month boundary correctly', () => {
    pinClock('2026-06-30T06:00:00Z');
    expect(isoDateFromNow(1)).toBe('2026-07-01');
  });
});
