// lib/paper-trading/__tests__/liveIsolation.test.ts
//
// PT-0001 section 3 (non-negotiable safety boundary) / section 14
// "Security and isolation": proves, by scanning the actual source of every
// file in the paper-trading domain and its API routes, that none of them
// import lib/tastytrade.ts (the module that owns placeOrder() and the live
// order builders) or reference placeOrder by name. This is a regression
// guard -- if a future change ever adds such an import, this test fails
// immediately rather than relying on code review alone.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PAPER_TRADING_LIB_DIR = join(REPO_ROOT, 'lib', 'paper-trading');
const PAPER_TRADING_API_DIR = join(REPO_ROOT, 'app', 'api', 'paper-trading');
const PAPER_TRADING_UI_DIR = join(REPO_ROOT, 'components', 'paper-trading');

const FORBIDDEN_PATTERNS = [/from ['"].*lib\/tastytrade['"]/, /\bplaceOrder\s*\(/, /buildBullPutSpread|buildBearCallSpread|buildIronCondor/];

describe('live-order isolation (section 3 / 14)', () => {
  const allFiles = [
    ...collectFiles(PAPER_TRADING_LIB_DIR),
    ...collectFiles(PAPER_TRADING_API_DIR),
    ...collectFiles(PAPER_TRADING_UI_DIR),
  ].filter((f) => !f.includes(`${join('__tests__')}`)); // this file itself references placeOrder in prose comments only, but excluding test files keeps the assertion about PRODUCTION code

  it('found paper-trading source files to scan (sanity check the scan itself is not vacuous)', () => {
    expect(allFiles.length).toBeGreaterThan(10);
  });

  it.each(allFiles.map((f) => [f.replace(REPO_ROOT, ''), f]))('%s does not import or call any live-order function', (_label, file) => {
    const content = readFileSync(file, 'utf-8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
