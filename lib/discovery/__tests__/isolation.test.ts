// lib/discovery/__tests__/isolation.test.ts

// LEAPS-QV-0001 Gate 1 -- guards the architectural promises of the foundation:
//  * it depends on nothing else in the repo (so it cannot change Find LEAPS behaviour),
//  * nothing else in the repo depends on it yet (the existing finder is untouched),
//  * it is deterministic and I/O free (no clock, randomness, network or environment access).

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const DISCOVERY = resolve(ROOT, 'lib', 'discovery');
const SKIP_DIRS = ['node_modules', '.next', '.git', 'coverage'];

function walk(dir: string, out: string[] = []): string[] {
  readdirSync(dir).forEach((name) => {
    if (SKIP_DIRS.indexOf(name) >= 0) return;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  });
  return out;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    specifiers.push(match[1] || match[2] || match[3]);
    match = pattern.exec(source);
  }
  return specifiers;
}

const sourceFiles = walk(DISCOVERY).filter((file) => file.indexOf('__tests__') < 0);

describe('discovery framework isolation', () => {
  it('finds the framework source files', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('imports only from inside lib/discovery (no app, no other lib module, no package)', () => {
    const offenders: string[] = [];
    sourceFiles.forEach((file) => {
      importSpecifiers(readFileSync(file, 'utf8')).forEach((specifier) => {
        const local = specifier.charAt(0) === '.';
        if (!local) {
          offenders.push(`${relative(ROOT, file)} imports package/alias "${specifier}"`);
          return;
        }
        const target = resolve(join(file, '..'), specifier);
        if (target !== DISCOVERY && target.indexOf(`${DISCOVERY}/`) !== 0) {
          offenders.push(`${relative(ROOT, file)} imports outside the module: "${specifier}"`);
        }
      });
    });
    expect(offenders).toEqual([]);
  });

  it('is not imported by any code outside lib/discovery and lib/fundamentals (existing Find LEAPS is unchanged)', () => {
    // Gate 2b deviation (reported): lib/fundamentals/ is the I/O layer (SEC client, loader, handler) and is the ONLY
    // place allowed to import lib/discovery. Everything else -- the screener, Find LEAPS, every other route -- still may not.
    const FUNDAMENTALS = resolve(ROOT, 'lib', 'fundamentals');
    const offenders: string[] = [];
    walk(ROOT)
      .filter((file) => file.indexOf(`${DISCOVERY}/`) !== 0 && file.indexOf(`${FUNDAMENTALS}/`) !== 0)
      .forEach((file) => {
        importSpecifiers(readFileSync(file, 'utf8')).forEach((specifier) => {
          if (/(^|\/)lib\/discovery(\/|$)/.test(specifier)) offenders.push(`${relative(ROOT, file)} -> ${specifier}`);
        });
      });
    expect(offenders).toEqual([]);
  });

  it('never reads the clock, randomness, network or environment', () => {
    const forbidden = [/Date\.now\(/, /new Date\(/, /Math\.random\(/, /\bfetch\(/, /process\.env/, /localStorage/, /\bXMLHttpRequest\b/];
    const offenders: string[] = [];
    sourceFiles.forEach((file) => {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0) return;
          forbidden.forEach((pattern) => {
            if (pattern.test(line)) offenders.push(`${relative(ROOT, file)}:${index + 1} matches ${pattern}`);
          });
        });
    });
    expect(offenders).toEqual([]);
  });

  it('contains no Quality Value thresholds or scoring in the framework core', () => {
    // Gate 2 deviation (reported): lib/discovery/normalized/ is the DATA layer and legitimately names metrics
    // (rsi, roic, delta, ...). The vocabulary guard keeps covering every framework-core file; the data layer is
    // guarded by its own test (normalized/__tests__/noInvestmentLogic.test.ts) against thresholds and scoring.
    // Gate 3 deviation (reported): lib/discovery/qv/ IS the versioned QV-v1.0 strategy layer and necessarily names RSI,
    // ROIC, percentile, ... It is the one place that may; qv/__tests__/policyCentralization.test.ts guards that thresholds
    // live only in qv/policy.ts.
    // Gate 4 deviation (reported): lib/discovery/leaps/ is the versioned QV LEAPS layer and necessarily names option
    // greeks (delta, theta, vega) as provider fields; its limits live only in leaps/acquisitionPolicy.ts (fingerprint-pinned).
    const offenders: string[] = [];
    sourceFiles.filter((file) => file.indexOf(`${DISCOVERY}/normalized/`) !== 0 && file.indexOf(`${DISCOVERY}/qv/`) !== 0 && file.indexOf(`${DISCOVERY}/leaps/`) !== 0).forEach((file) => {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0) return;
          if (/\b(rsi|roic|peg|ebitda|percentile|delta|theta|vega)\b/i.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}: ${trimmed}`);
          }
        });
    });
    expect(offenders).toEqual([]);
  });
});
