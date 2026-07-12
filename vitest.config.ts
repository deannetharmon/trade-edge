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
      'features/**/__tests__/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default'],
  },
});
