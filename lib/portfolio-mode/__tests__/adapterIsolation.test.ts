// lib/portfolio-mode/__tests__/adapterIsolation.test.ts
//
// PT-0002A section "Data Isolation Requirements" / Implementation
// Directive's "Isolation" test requirements: proves, by scanning the actual
// source of the LIVE and PAPER adapters, that neither can reach the other's
// data source. Mirrors the existing, established pattern in
// lib/paper-trading/__tests__/liveIsolation.test.ts (source-scanning is a
// regression guard -- if a future change ever adds a forbidden import, this
// test fails immediately rather than relying on code review alone).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const LIVE_ADAPTER_FILE = join(REPO_ROOT, 'lib', 'portfolio-mode', 'liveAdapter.ts');
const PAPER_ADAPTER_FILE = join(REPO_ROOT, 'lib', 'portfolio-mode', 'paperAdapter.ts');

describe('PAPER adapter never reaches a LIVE acquisition or broker path', () => {
  const content = readFileSync(PAPER_ADAPTER_FILE, 'utf-8');

  const forbiddenImportPatterns = [
    /from ['"]@\/lib\/tastytrade['"]/, // lib/tastytrade.ts (placeOrder + order builders)
    /from ['"]@\/lib\/tastytrade\/client['"]/, // lib/tastytrade/client.ts (ttFetch/getAccessToken)
    /from ['"]@\/lib\/portfolio-data\/acquisition['"]/, // loadPositions/loadAccountBalances
    /from ['"]@\/components\/portfolio-data\/PortfolioDataProvider['"]/, // the LIVE context hook
  ];

  it.each(forbiddenImportPatterns.map((p) => [p.toString(), p]))('does not import %s', (_label, pattern) => {
    expect(pattern.test(content)).toBe(false);
  });

  const forbiddenReferencePatterns = [
    /\bloadPositions\s*\(/,
    /\bloadAccountBalances\s*\(/,
    /\bttFetch\s*\(/,
    /\bgetAccessToken\s*\(/,
    /\bplaceOrder\s*\(/,
    /\busePortfolioData\s*\(/,
  ];

  it.each(forbiddenReferencePatterns.map((p) => [p.toString(), p]))('does not reference %s', (_label, pattern) => {
    expect(pattern.test(content)).toBe(false);
  });

  it('reaches paper data only through the PT-0001 API route', () => {
    expect(content.includes("fetch('/api/paper-trading/account')")).toBe(true);
  });
});

describe('LIVE adapter never reaches the PAPER ledger', () => {
  const content = readFileSync(LIVE_ADAPTER_FILE, 'utf-8');

  const forbiddenImportPatterns = [
    /from ['"]@\/lib\/paper-trading/, // any lib/paper-trading module
    /from ['"]@\/app\/api\/paper-trading/,
  ];

  it.each(forbiddenImportPatterns.map((p) => [p.toString(), p]))('does not import %s', (_label, pattern) => {
    expect(pattern.test(content)).toBe(false);
  });

  const forbiddenReferencePatterns = [/\bgetPaperTradingLedger\s*\(/, /\bopenPaperPosition\s*\(/, /\bclosePaperPosition\s*\(/, /paper-trading\/account/];

  it.each(forbiddenReferencePatterns.map((p) => [p.toString(), p]))('does not reference %s', (_label, pattern) => {
    expect(pattern.test(content)).toBe(false);
  });

  it('reaches live data only through the existing canonical usePortfolioData() hook', () => {
    expect(content.includes("from '@/components/portfolio-data/PortfolioDataProvider'")).toBe(true);
    expect(content.includes('usePortfolioData()')).toBe(true);
  });
});
