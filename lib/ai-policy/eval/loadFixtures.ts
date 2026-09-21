// lib/ai-policy/eval/loadFixtures.ts
//
// Loads the evaluation fixtures from lib/ai-policy/eval/fixtures/<route>/*.json. Reads the file system, so it is kept
// apart from the pure harness. Used by tests and by future reviewer tooling.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fixtureProblems } from './harness';
import type { EvalFixture } from './harness';

export const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures');

export interface LoadedFixtures {
  fixtures: EvalFixture[];
  problems: string[];
}

export function loadFixtureDir(root: string = FIXTURE_ROOT): LoadedFixtures {
  const fixtures: EvalFixture[] = [];
  const problems: string[] = [];
  if (!existsSync(root)) return { fixtures, problems: [`${root} does not exist`] };
  for (const routeDir of readdirSync(root).sort()) {
    const dir = path.join(root, routeDir);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const label = `${routeDir}/${file}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      } catch {
        problems.push(`${label}: not valid JSON`);
        continue;
      }
      const issues = fixtureProblems(parsed);
      const fixture = parsed as EvalFixture;
      if (issues.length === 0 && (fixture.route !== routeDir || fixture.id !== `${routeDir}/${file.replace(/\.json$/, '')}`)) issues.push('id/route must match the directory and file name');
      if (issues.length > 0) problems.push(...issues.map((i) => `${label}: ${i}`));
      else fixtures.push(fixture);
    }
  }
  return { fixtures, problems };
}
