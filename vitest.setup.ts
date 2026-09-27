// vitest.setup.ts
//
// PI-0004A: adds jest-dom's DOM-specific matchers (toBeInTheDocument, etc.)
// for component tests, and ensures each test's rendered DOM is unmounted
// before the next test runs (otherwise leftover nodes from a previous test
// can make later getByText/getByRole queries match more than one element).
// Only affects files using jsdom -- see vitest.config.ts's
// environmentMatchGlobs.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

// CI-FLAKY-0002 -- when FAKE_NOW is set (the evening CI guard pass), pin the clock for every test in
// this run to that instant, so a date-boundary flake that depends on the real time of day (see
// lib/testing/fixedClock.ts) is caught regardless of which file it's in. Unset in normal runs: this
// changes nothing about local `npm test` or the primary CI pass.
if (process.env.FAKE_NOW) {
  const { pinClock } = await import('./lib/testing/fixedClock');
  pinClock(process.env.FAKE_NOW);
}


// jsdom does not implement ResizeObserver. Stub it so components that use
// it (e.g. ACTIONS-ROW-RESPONSIVE-0001's width-driven label shortening)
// don't crash test renders. Callback is never invoked -- tests exercising
// the narrow/wide behavior itself should call it directly or mock further.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
