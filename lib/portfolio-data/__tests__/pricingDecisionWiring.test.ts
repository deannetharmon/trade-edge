import { describe, expect, it } from 'vitest';
import {
  deriveMarketableQuoteFreshness,
  derivePositionQuoteCapturedAt,
  extractBrokerQuoteTimestamp,
  MARKETABLE_QUOTE_MAX_AGE_MS,
} from '@/lib/portfolio-data/acquisition';

const NOW = new Date('2026-08-10T18:00:00.000Z');

describe('PI-0014C broker quote freshness', () => {
  it('propagates realistic Tastytrade market-data timestamps and uses the oldest leg', () => {
    const shortLegPayload = {
      symbol: 'MU  260904P00800000', bid: '31.00', ask: '38.00', mark: '34.50',
      'updated-at': '2026-08-10T17:59:45.000Z',
    };
    const longLegPayload = {
      symbol: 'MU  260904P00790000', bid: '24.00', ask: '29.00', mark: '26.50',
      'received-at': '2026-08-10T17:59:40.000Z',
    };
    const timestamps = {
      MU260904P00800000: extractBrokerQuoteTimestamp(shortLegPayload),
      MU260904P00790000: extractBrokerQuoteTimestamp(longLegPayload),
    };

    expect(timestamps).toEqual({
      MU260904P00800000: '2026-08-10T17:59:45.000Z',
      MU260904P00790000: '2026-08-10T17:59:40.000Z',
    });
    expect(derivePositionQuoteCapturedAt(
      [{ symbol: 'MU  260904P00800000' }, { symbol: 'MU  260904P00790000' }],
      timestamps as Record<string, string>,
    )).toBe('2026-08-10T17:59:40.000Z');
  });

  it('fails position timestamp propagation closed when any leg lacks broker provenance', () => {
    expect(derivePositionQuoteCapturedAt(
      [{ symbol: 'MU  260904P00800000' }, { symbol: 'MU  260904P00790000' }],
      { MU260904P00800000: '2026-08-10T17:59:45.000Z' },
    )).toBeNull();
    expect(derivePositionQuoteCapturedAt([], {})).toBeNull();
  });
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
