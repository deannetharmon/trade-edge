// components/portfolio-data/__tests__/usePortfolioAutoRefresh.test.tsx

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_REFRESH_TICK_MS, useAutoRefreshPause, usePortfolioAutoRefresh } from '../usePortfolioAutoRefresh';
import { isAutoRefreshPaused, resetAutoRefreshPausesForTest } from '@/lib/portfolio-data/autoRefreshPause';

const MIN = 60 * 1000;
const MIDDAY = Date.parse('2026-10-05T16:00:00Z'); // Monday 12:00 New York, market open
const SUNDAY = Date.parse('2026-10-04T16:00:00Z');

let clock = MIDDAY;
let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function mount(lastRefreshMs: number, loading = false) {
  const refresh = vi.fn(() => Promise.resolve());
  const hook = renderHook(props => usePortfolioAutoRefresh(props), {
    initialProps: { refresh, lastRefresh: new Date(lastRefreshMs), loading, now: () => clock },
  });
  return { refresh, hook };
}

async function tick(ms = AUTO_REFRESH_TICK_MS) {
  clock += ms;
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('usePortfolioAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock = MIDDAY;
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    resetAutoRefreshPausesForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes once the 2-minute interval has passed during market hours', async () => {
    const { refresh } = mount(MIDDAY - 1 * MIN);
    await tick();
    expect(refresh).not.toHaveBeenCalled(); // 1:15 since last refresh
    await tick(MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while the tab is hidden, and catches up when it becomes visible', async () => {
    const { refresh } = mount(MIDDAY - 10 * MIN);
    visibility = 'hidden';
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { setVisibility('visible'); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('pauses while an order dialog holds a pause, and resumes after it closes', async () => {
    const { refresh } = mount(MIDDAY - 10 * MIN);
    const dialog = renderHook(({ open }) => useAutoRefreshPause(open), { initialProps: { open: true } });
    expect(isAutoRefreshPaused()).toBe(true);
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    dialog.rerender({ open: false });
    expect(isAutoRefreshPaused()).toBe(false);
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('releases the pause when the dialog unmounts', () => {
    const dialog = renderHook(() => useAutoRefreshPause(true));
    expect(isAutoRefreshPaused()).toBe(true);
    dialog.unmount();
    expect(isAutoRefreshPaused()).toBe(false);
  });

  it('does not start a refresh while one is already loading', async () => {
    const { refresh } = mount(MIDDAY - 10 * MIN, true);
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not stack a second refresh while its own refresh is still running', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    renderHook(() => usePortfolioAutoRefresh({ refresh, lastRefresh: new Date(MIDDAY - 10 * MIN), loading: false, now: () => clock }));
    await tick();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

  it('on a weekend does not refresh data already newer than Friday\'s close', async () => {
    clock = SUNDAY;
    const { refresh } = mount(SUNDAY - 30 * MIN);
    await tick();
    await tick(10 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops checking after unmount', async () => {
    const { refresh, hook } = mount(MIDDAY - 10 * MIN);
    hook.unmount();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });
});
