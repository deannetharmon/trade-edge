// lib/ai-policy/__tests__/importBoundary.test.ts
//
// AI-POLICY-0001A acceptance 2: import-boundary tests in BOTH directions, so AI can neither reach deterministic
// scan/portfolio/order code nor be reached from it.
//   (a) files in lib/ai-policy (other than builders/) import nothing from the forbidden deterministic modules;
//   (b) no file in the deterministic modules imports @/lib/ai-policy.
// builders/ (added in 0001B+) may import read-only resolvers only: any imported name matching
// submit|order|place|cancel|write|save is rejected.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const THIS_FILE = path.resolve(__filename);

const FORBIDDEN_FROM_AI = [
  'lib/scans', 'lib/screener', 'lib/order-lifecycle', 'lib/portfolio-snapshot', 'lib/tastytrade',
  'lib/leaps-analysis/serverTradeReview', 'lib/autopilot', 'lib/paper-trading',
];
const DETERMINISTIC_DIRS = [
  'lib/scans', 'lib/portfolio-snapshot', 'lib/order-lifecycle', 'lib/decision-engine', 'lib/autopilot', 'lib/screener', 'lib/portfolio', 'lib/paper-trading',
];
const DETERMINISTIC_FILES = ['lib/screener.ts'];
const AI_POLICY = 'lib/ai-policy';
const WRITE_LIKE = /submit|order|place|cancel|write|save/i;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function extractImports(source: string): string[] {
  const text = stripComments(source);
  const out: string[] = [];
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g]) {
    for (const m of Array.from(text.matchAll(re))) out.push(m[1]);
  }
  return out;
}

/** Names brought in by `import { a, b as c } from '...'` and default/namespace imports, per module. */
export function importedNames(source: string): Array<{ module: string; names: string[] }> {
  const out: Array<{ module: string; names: string[] }> = [];
  for (const m of Array.from(stripComments(source).matchAll(/import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g))) {
    const names = m[1].replace(/[{}*]/g, ' ').replace(/\bas\b/g, ' ').replace(/\btype\b/g, ' ').split(/[\s,]+/).filter(Boolean);
    out.push({ module: m[2], names });
  }
  return out;
}

/** Repo-relative path without extension for an import specifier, or null for a package import. */
export function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2).replace(/\.(?:tsx?|jsx?)$/, '');
  if (specifier.startsWith('.')) {
    return path.relative(ROOT, path.resolve(path.dirname(fromFile), specifier)).split(path.sep).join('/').replace(/\.(?:tsx?|jsx?)$/, '');
  }
  return null;
}

const under = (resolved: string, prefix: string): boolean => resolved === prefix || resolved.startsWith(`${prefix}/`);

export function forbiddenImportsFromAi(source: string, fromFile: string): string[] {
  return extractImports(source).filter((s) => {
    const r = resolveSpecifier(s, fromFile);
    return r != null && FORBIDDEN_FROM_AI.some((p) => under(r, p));
  });
}

export function aiImportsInDeterministicCode(source: string, fromFile: string): string[] {
  return extractImports(source).filter((s) => {
    const r = resolveSpecifier(s, fromFile);
    return r != null && under(r, AI_POLICY);
  });
}

export function writeLikeBuilderImports(source: string): string[] {
  return importedNames(source).flatMap(({ module, names }) => [...(WRITE_LIKE.test(module.split('/').pop() ?? '') ? [module] : []), ...names.filter((n) => WRITE_LIKE.test(n))]);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.next') return [];
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(?:ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe('scanner self-tests (the boundary tests are not vacuous)', () => {
  const file = path.join(ROOT, 'lib/ai-policy/example.ts');
  it('flags a forbidden import from inside lib/ai-policy, alias or relative, static or dynamic', () => {
    expect(forbiddenImportsFromAi("import { x } from '@/lib/scans/run';", file)).toEqual(['@/lib/scans/run']);
    expect(forbiddenImportsFromAi("import { x } from '../scans/run';", file)).toEqual(['../scans/run']); // lib/ai-policy/../scans is lib/scans
    expect(forbiddenImportsFromAi("import { x } from '../../lib/order-lifecycle';", file)).toEqual(['../../lib/order-lifecycle']);
    expect(forbiddenImportsFromAi("const m = await import('@/lib/tastytrade/token');", file)).toEqual(['@/lib/tastytrade/token']);
    expect(forbiddenImportsFromAi("const m = require('@/lib/leaps-analysis/serverTradeReview');", file)).toEqual(['@/lib/leaps-analysis/serverTradeReview']);
    expect(forbiddenImportsFromAi("import { x } from '@/lib/leaps-analysis/analysisService';", file)).toEqual([]);
    expect(forbiddenImportsFromAi("import { getRedis } from '@/lib/jobs/redis';", file)).toEqual([]);
    expect(forbiddenImportsFromAi("// import { x } from '@/lib/scans/run';", file)).toEqual([]);
  });

  it('flags an import of lib/ai-policy from deterministic code', () => {
    const scanFile = path.join(ROOT, 'lib/scans/example.ts');
    expect(aiImportsInDeterministicCode("import { runAiRoute } from '@/lib/ai-policy';", scanFile)).toEqual(['@/lib/ai-policy']);
    expect(aiImportsInDeterministicCode("import { x } from '../ai-policy/gateway';", scanFile)).toEqual(['../ai-policy/gateway']);
    expect(aiImportsInDeterministicCode("import { x } from '@/lib/ai-policy-other';", scanFile)).toEqual([]);
    expect(aiImportsInDeterministicCode("import { x } from '@/lib/ai/models';", scanFile)).toEqual([]);
  });

  it('flags write-like names in builder imports', () => {
    expect(writeLikeBuilderImports("import { submitOrder } from '@/lib/order-lifecycle/x';")).toContain('submitOrder');
    expect(writeLikeBuilderImports("import { getQuote, saveSnapshot as s } from '@/lib/x';")).toContain('saveSnapshot');
    expect(writeLikeBuilderImports("import { placeThing } from '@/lib/x';")).toContain('placeThing');
    expect(writeLikeBuilderImports("import cancelAll from '@/lib/x';")).toContain('cancelAll');
    expect(writeLikeBuilderImports("import { writeFile } from 'fs';")).toContain('writeFile');
    expect(writeLikeBuilderImports("import { getQuote, resolveLeapsContractEvidence } from '@/lib/x';")).toEqual([]);
  });
});

describe('(a) lib/ai-policy imports nothing from deterministic scan/portfolio/order modules', () => {
  const files = walk(path.join(ROOT, AI_POLICY)).filter((f) => path.resolve(f) !== THIS_FILE && !f.includes(`${path.sep}builders${path.sep}`));

  it('scans a meaningful set of files', () => expect(files.length).toBeGreaterThan(20));

  it.each(files.map((f) => [path.relative(ROOT, f), f]))('%s', (_name, file) => {
    expect(forbiddenImportsFromAi(readFileSync(file, 'utf8'), file)).toEqual([]);
  });
});

describe('builders/ may import read-only resolvers only', () => {
  const files = walk(path.join(ROOT, AI_POLICY, 'builders'));
  it('no builder imports a name matching submit|order|place|cancel|write|save', () => {
    for (const file of files) expect(writeLikeBuilderImports(readFileSync(file, 'utf8'))).toEqual([]);
  });
  it('no builder imports order, scan-write, or autopilot modules', () => {
    for (const file of files) {
      const bad = extractImports(readFileSync(file, 'utf8')).filter((s) => {
        const r = resolveSpecifier(s, file);
        return r != null && ['lib/order-lifecycle', 'lib/autopilot', 'lib/paper-trading'].some((p) => under(r, p));
      });
      expect(bad).toEqual([]);
    }
  });
});

describe('(b) deterministic code never imports @/lib/ai-policy', () => {
  for (const dir of DETERMINISTIC_DIRS) {
    it(`${dir} exists and has no AI policy import`, () => {
      expect(existsSync(path.join(ROOT, dir))).toBe(true);
      const files = walk(path.join(ROOT, dir));
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.filter((f) => aiImportsInDeterministicCode(readFileSync(f, 'utf8'), f).length > 0).map((f) => path.relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  }
  for (const file of DETERMINISTIC_FILES) {
    it(`${file} has no AI policy import`, () => {
      const full = path.join(ROOT, file);
      expect(existsSync(full)).toBe(true);
      expect(aiImportsInDeterministicCode(readFileSync(full, 'utf8'), full)).toEqual([]);
    });
  }
});
