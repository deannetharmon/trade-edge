// lib/market/__tests__/marketMapLink.test.ts
// MARKET-LINK-0002: every market link is a well-formed https Yahoo Finance quote address with a unique id.
import { describe, expect, it } from 'vitest';
import { MARKET_LINKS } from '../marketMapLink';

describe('MARKET_LINKS', () => {
  it('lists the eight pages Dean named, S&P 500 first', () => {
    expect(MARKET_LINKS.map(l => l.label)).toEqual(['S&P 500', 'Dow 30', 'Nasdaq', 'Russell 2000', '10-year yield', 'VIX', 'Gold', 'Bitcoin']);
  });
  it('each link is an https Yahoo Finance quote page, and ids are unique', () => {
    for (const l of MARKET_LINKS) {
      const u = new URL(l.url);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe('finance.yahoo.com');
      expect(u.pathname.startsWith('/quote/')).toBe(true);
    }
    expect(new Set(MARKET_LINKS.map(l => l.id)).size).toBe(MARKET_LINKS.length);
  });
});
