import { describe, expect, it } from 'vitest';
import {
  deriveMarketableQuoteFreshness,
  MARKETABLE_QUOTE_MAX_AGE_MS,
} from '@/lib/portfolio-data/acquisition';

const NOW = new Date('2026-08-10T18:00:00.000Z');

describe('PI-0014C broker quote freshness', () => {
  it('fails closed when a real broker timestamp is absent or invalid', () => {
    expect(deriveMarketableQuoteFreshness(null, NOW)).toBe('UNKNOWN');
    expect(deriveMarketableQuoteFreshness('not-a-date', NOW)).toBe('UNKNOWN');
  });

  it('accepts a broker timestamp inside the bounded freshness window', () => {
    const captured = new Date(NOW.getTime() - MARKETABLE_QUOTE_MAX_AGE_MS).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('FRESH');
  });

  it('rejects a stale broker timestamp', () => {
    const captured = new Date(NOW.getTime() - MARKETABLE_QUOTE_MAX_AGE_MS - 1).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('STALE');
  });

  it('does not treat a materially future timestamp as fresh', () => {
    const captured = new Date(NOW.getTime() + 5_000).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('UNKNOWN');
  });
});
