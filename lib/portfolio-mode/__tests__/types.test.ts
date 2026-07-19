// lib/portfolio-mode/__tests__/types.test.ts
//
// PT-0002A: mode-domain validation. Covers the design doc's "Mode domain"
// test requirement -- accepts LIVE/PAPER only, rejects malformed values.

import { describe, expect, it } from 'vitest';
import { isPortfolioMode, PORTFOLIO_MODES } from '../types';

describe('isPortfolioMode', () => {
  it('accepts LIVE', () => {
    expect(isPortfolioMode('LIVE')).toBe(true);
  });

  it('accepts PAPER', () => {
    expect(isPortfolioMode('PAPER')).toBe(true);
  });

  it.each([
    'live',
    'Live',
    'paper',
    'Paper',
    'PAPER ',
    ' LIVE',
    '',
    'DEMO',
    'live_trading',
    null,
    undefined,
    0,
    1,
    true,
    false,
    {},
    [],
    ['LIVE'],
  ])('rejects malformed value %p', (value) => {
    expect(isPortfolioMode(value)).toBe(false);
  });

  it('PORTFOLIO_MODES contains exactly LIVE and PAPER', () => {
    expect(PORTFOLIO_MODES).toEqual(['LIVE', 'PAPER']);
  });
});
