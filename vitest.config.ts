// vitest.config.ts

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    // PI-0004A: component tests (.test.tsx) run under jsdom; everything
    // else (the existing 206 .test.ts files) keeps the plain 'node'
    // environment unchanged, so this doesn't alter any existing test's
    // behavior.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    include: [
      'lib/**/__tests__/**/*.test.ts',
      // PT-0002A: lib/portfolio-mode/__tests__ has a few jsdom-dependent
      // .test.tsx files (localStorage/React-hook coverage) alongside its
      // plain .test.ts ones -- without this glob they would silently never
      // run under `npm test`, same trap OE-0001/PT-0001 hit before it for
      // components/ and app/ (see the comments below).
      'lib/**/__tests__/**/*.test.tsx',
      'features/**/__tests__/**/*.test.tsx',
      // OE-0001 correction: components/opportunity-engine/__tests__ is the
      // first test under components/ -- without this glob its component
      // test would silently never run under `npm test`.
      'components/**/__tests__/**/*.test.tsx',
      // PT-0001: components/paper-trading/__tests__ has plain .test.ts
      // (not .tsx) render-free unit tests alongside its .test.tsx ones.
      'components/**/__tests__/**/*.test.ts',
      // PT-0001: app/api/paper-trading/__tests__ is the first test under
      // app/ -- without this glob its route-level security tests (auth
      // rejection, caller-supplied user id ignored) would silently never
      // run under `npm test`.
      'app/**/__tests__/**/*.test.ts',
      // WA-0002: app/portfolio/__tests__ is the first component-level (.tsx)
      // test under app/ -- without this glob it would silently never run
      // under `npm test`, the same trap this file's other comments describe
      // for components/ and lib/.
      'app/**/__tests__/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default'],
  },
});
