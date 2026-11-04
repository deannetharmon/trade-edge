// lib/scans/__tests__/ccResearch.test.ts
// CC-RESEARCH-0001 -- entry price precedence and hypothetical capacity for research scans.
import { describe, it, expect } from 'vitest';
import { resolveResearchEntry, buildResearchCapacity, researchEntryLabel } from '../ccResearch';

describe('resolveResearchEntry', () => {
  const position = { basis: 82, source: 'broker' as const };
  it('a price typed for the scan wins over everything', () => {
    expect(resolveResearchEntry({ typedForScan: 80, position, stockPrice: 62.85 })).toEqual({ entry: 80, source: 'typed-for-scan' });
  });
  it('then your own position, labeled by where the basis came from', () => {
    expect(resolveResearchEntry({ position, stockPrice: 62.85 })).toEqual({ entry: 82, source: 'position-broker' });
    expect(resolveResearchEntry({ position: { basis: 76.5, source: 'typed' }, stockPrice: 62.85 })).toEqual({ entry: 76.5, source: 'position-typed' });
  });
  it('then the current price, labeled assumed', () => {
    expect(resolveResearchEntry({ stockPrice: 62.85 })).toEqual({ entry: 62.85, source: 'price-assumed' });
    expect(resolveResearchEntry({ position: { basis: null, source: null }, stockPrice: 62.85 })).toEqual({ entry: 62.85, source: 'price-assumed' });
  });
  it('ignores invalid typed prices and bases', () => {
    for (const bad of [0, -1, Number.NaN, null, undefined]) {
      expect(resolveResearchEntry({ typedForScan: bad as number | null | undefined, stockPrice: 50 }).source).toBe('price-assumed');
      expect(resolveResearchEntry({ position: { basis: bad as number | null, source: 'broker' }, stockPrice: 50 }).source).toBe('price-assumed');
    }
  });
  it('with nothing usable there is no entry', () => {
    expect(resolveResearchEntry({ stockPrice: null })).toEqual({ entry: null, source: null });
  });
});

describe('buildResearchCapacity', () => {
  it('uses one hypothetical contract when you hold no shares', () => {
    const c = buildResearchCapacity(null, 62.85);
    expect(c.availableCoveredContracts).toBe(1);
    expect(c.costBasis).toBe(62.85);
    expect(c.costBasisComplete).toBe(true);
  });
  it('uses the contracts your shares cover, ignoring existing calls', () => {
    expect(buildResearchCapacity(300, 82).availableCoveredContracts).toBe(3);
    expect(buildResearchCapacity(250, 82).availableCoveredContracts).toBe(2);
    expect(buildResearchCapacity(50, 82).availableCoveredContracts).toBe(1);
  });
  it('with no entry the basis stays unknown, so the strike floor fails closed', () => {
    const c = buildResearchCapacity(100, null);
    expect(c.costBasis).toBeNull();
    expect(c.costBasisComplete).toBe(false);
  });
});

describe('researchEntryLabel', () => {
  it('names each source, and the assumed one says it is not a real cost basis', () => {
    expect(researchEntryLabel('price-assumed')).toMatch(/assumed/);
    expect(researchEntryLabel('position-broker')).toMatch(/your position/);
    expect(researchEntryLabel(null)).toMatch(/no entry price/);
  });
});
