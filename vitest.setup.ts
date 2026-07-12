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
