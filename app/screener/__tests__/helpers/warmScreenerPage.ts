// app/screener/__tests__/helpers/warmScreenerPage.ts
//
// CI-FLAKY-0001 follow-up: one shared cold-start warm-up for test files that
// render the 12.6k-line ScreenerPage. The first render plus first scan pays
// one-time JIT/lazy-init cost that is 2-3x a warm run's, all inside the first
// test's 1000ms findBy/waitFor budgets; under full-suite CPU contention that
// exceeds the budget while later (warm) tests pass. Absorb it once, up front,
// in a beforeAll with its own generous timeout. No test timeout is raised.
//
// Usage (the caller supplies the mocks and the flow its first test uses):
//   beforeAll(() => warmScreenerPage(async () => { ...set mocks, render, drive... }), WARM_HOOK_TIMEOUT_MS);
//
// The helper only owns the environment hygiene around that flow: a clean
// localStorage, a network-disabled fetch stub, and a guaranteed cleanup
// (unmount, unstub, clear) even when the flow throws, so no warm-up state
// leaks into the real tests.

import { cleanup } from '@testing-library/react';
import { vi } from 'vitest';

/** Timeout for the beforeAll hook that runs the warm-up. */
export const WARM_HOOK_TIMEOUT_MS = 30_000;
/** Timeout for the readiness wait at the end of a warm-up flow (findBy/waitFor). */
export const WARM_FLOW_TIMEOUT_MS = 15_000;

export async function warmScreenerPage(drive: () => Promise<void>): Promise<void> {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in test')));
  try {
    await drive();
  } finally {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  }
}
