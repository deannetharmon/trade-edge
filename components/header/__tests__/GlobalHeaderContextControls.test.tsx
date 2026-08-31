import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('global header context slots', () => {
  it('places the shared context controls in the normal header flow on primary routes', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const routes = [
      'app/page.tsx',
      'app/portfolio/page.tsx',
      'app/screener/page.tsx',
      'app/engine/page.tsx',
      'app/long-book/page.tsx',
      'app/rinse-repeat/page.tsx',
      'app/trade-log/page.tsx',
      'app/performance/page.tsx',
    ];

    for (const route of routes) {
      const source = fs.readFileSync(path.join(repoRoot, route), 'utf8');
      expect(source, route).toContain('data-global-header-context');
    }
  });

  it('mounts one portalized control group and one independent PAPER safety overlay', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const source = fs.readFileSync(path.join(repoRoot, 'components/header/GlobalHeaderContextControls.tsx'), 'utf8');
    expect(source.match(/<PortfolioModeIndicator\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<ActiveBrokerAccountIndicator\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<PortfolioModeSafetyOverlay\b/g) ?? []).toHaveLength(1);
  });
});
