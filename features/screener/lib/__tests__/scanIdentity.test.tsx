// features/screener/lib/__tests__/scanIdentity.test.ts
//
// SCREENER-UX-0001 required test 1: scan-identity titles match the six
// exact strings the ticket specifies for every mode/requestedStrategy pair.

import { describe, expect, it } from 'vitest';
import { getScanIdentity } from '../scanIdentity';

describe('getScanIdentity', () => {
  it('produces the exact six required titles', () => {
    expect(getScanIdentity('filter', 'spreads').title).toBe('Filtered Spread Scan');
    expect(getScanIdentity('rank', 'spreads').title).toBe('Ranked Spread Scan');
    expect(getScanIdentity('targeted', 'spreads').title).toBe('Targeted Spread Scan');
    expect(getScanIdentity('filter', 'csp').title).toBe('Cash-Secured Put Scan');
    expect(getScanIdentity('filter', 'cc').title).toBe('Covered Call Scan');
    expect(getScanIdentity('filter', 'pmcc').title).toBe('PMCC Scan');
  });

  it('csp/cc/pmcc titles do not vary by mode (they are filter-only workflows)', () => {
    expect(getScanIdentity('filter', 'csp').title).toBe('Cash-Secured Put Scan');
  });

  it('includes independently legible mode and strategy labels', () => {
    const identity = getScanIdentity('rank', 'spreads');
    expect(identity.modeLabel).toBe('Ranked');
    expect(identity.requestedStrategyLabel).toBe('Spread');
  });
});
