// lib/discovery/normalized/__tests__/noInvestmentLogic.test.ts

// LEAPS-QV-0001 Gate 2 -- the data layer produces METRICS only. Thresholds, scoring, lifecycle classification and
// Gate 3 state names must not appear in it (they arrive with the QV-v1.0 strategy). Replaces, for this directory,
// the metric-name vocabulary guard in isolation.test.ts, which keeps covering the framework core.

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '..');
const files = readdirSync(DIR).filter((name) => /\.ts$/.test(name));

describe('normalized data layer carries no investment logic', () => {
  it('finds its source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('has no threshold, scoring, qualification or Gate 3 state vocabulary in code or strings', () => {
    const forbidden = /\b(threshold|thresholds|qualif\w*|score|scores|scoring|WATCH|SETUP|ACTIONABLE|DECLINING|OVERSOLD|OVERBOUGHT|STABILIZING|RECOVERING|DETERIORATING|IMPROVING|BUY|SELL)\b/;
    const offenders: string[] = [];
    files.forEach((name) => {
      readFileSync(join(DIR, name), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0 || trimmed.indexOf('/*') === 0) return;
          if (forbidden.test(line)) offenders.push(`${name}:${index + 1}: ${trimmed}`);
        });
    });
    expect(offenders).toEqual([]);
  });

  it('never imports from outside lib/discovery (covered globally by isolation.test.ts; restated for this layer)', () => {
    files.forEach((name) => {
      const source = readFileSync(join(DIR, name), 'utf8');
      const specifiers = Array.from(source.matchAll(/from\s+'([^']+)'/g)).map((m) => m[1]);
      specifiers.forEach((s) => expect(s.charAt(0), `${name}: ${s}`).toBe('.'));
    });
  });
});
