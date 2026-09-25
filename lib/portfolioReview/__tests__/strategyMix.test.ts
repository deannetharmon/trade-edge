// lib/portfolioReview/__tests__/strategyMix.test.ts

import { describe, expect, it } from 'vitest';
import { countByStrategy, formatStrategyMix } from '../strategyMix';

describe('portfolio strategy mix', () => {
  it('counts every distinct strategy, so the counts add up to the number of positions', () => {
    const strategies = ['BPS', 'CSP', 'CSP', 'CC', 'PMCC', 'LEAP', 'IC', 'BCS', 'CSP', 'STOCK'];
    const rows = countByStrategy(strategies);
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(strategies.length);
    expect(rows[0]).toEqual({ strategy: 'CSP', count: 3 });
    expect(rows.map(r => r.strategy).sort()).toEqual(['BCS', 'BPS', 'CC', 'CSP', 'IC', 'LEAP', 'PMCC', 'STOCK']);
  });

  it('shows cash-secured puts and covered calls by name instead of lumping them into "Other"', () => {
    const mix = formatStrategyMix(['CSP', 'CSP', 'CC', 'BPS']);
    expect(mix).toBe('CSP: 2 | BPS: 1 | CC: 1');
    expect(mix).not.toContain('Other');
  });

  it('a missing or blank strategy is counted as UNKNOWN, never dropped', () => {
    expect(countByStrategy([undefined, null, '', '  ', 'BPS'])).toEqual([{ strategy: 'UNKNOWN', count: 4 }, { strategy: 'BPS', count: 1 }]);
  });

  it('an empty book reads None', () => {
    expect(formatStrategyMix([])).toBe('None');
  });

  it('ties are ordered by name so the prompt is stable', () => {
    expect(formatStrategyMix(['IC', 'BCS', 'BPS'])).toBe('BCS: 1 | BPS: 1 | IC: 1');
  });
});
