import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('shared application header (APP-HEADER-0001)', () => {
  const routes = [
    'app/page.tsx',
    'app/portfolio/page.tsx',
    'app/screener/page.tsx',
    'app/engine/page.tsx',
    'app/rinse-repeat/page.tsx',
    'app/trade-log/page.tsx',
    'app/performance/page.tsx',
    'app/wheel/page.tsx',
    'app/pmcc-history/page.tsx',
    'app/paper-trading/page.tsx',
    'app/wheel-simulator/page.tsx',
    'app/help/page.tsx',
    'app/profile/page.tsx',
  ];

  it('every tab page renders the one shared header, and none keeps a private copy or slot', () => {
    for (const route of routes) {
      const source = read(route);
      expect(source, route).toContain('<AppHeader');
      // The slot lives once in AppHeader, never again in a page.
      expect(source, route).not.toContain('data-global-header-context');
      expect(source, route).not.toContain('<AppNav');
    }
  });

  it('the shared header owns the single header slot for the mode and account chips', () => {
    const source = read('components/nav/AppHeader.tsx');
    expect(source.match(/data-global-header-context/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/<PortfolioModeIndicator\b/);
    expect(source).not.toMatch(/<ActiveBrokerAccountIndicator\b/);
  });

  it('the legacy long-book page keeps its portal slot (not a tab page)', () => {
    expect(read('app/long-book/page.tsx')).toContain('data-global-header-context');
  });

  it('mounts one portalized control group and one independent PAPER safety overlay', () => {
    const source = read('components/header/GlobalHeaderContextControls.tsx');
    expect(source.match(/<PortfolioModeIndicator\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<ActiveBrokerAccountIndicator\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<PortfolioModeSafetyOverlay\b/g) ?? []).toHaveLength(1);
  });
});
