import { describe, expect, it } from 'vitest';
import { createBrokerBackedInstrumentMetadataResolver } from '../brokerBackedResolver';
import type { BrokerEquityClassifier, InstrumentMetadata } from '..';

function broker(kind: 'stock' | 'etf' | 'index' | 'unsupported' | 'unavailable'): BrokerEquityClassifier {
  return {
    async classify(symbol) {
      return { symbol, kind, provider: 'tastytrade', asOf: '2026-10-01T12:00:00.000Z' };
    },
  };
}

describe('broker-backed instrument metadata resolver', () => {
  it('resolves a broker-confirmed non-ETF equity as an ordinary stock', async () => {
    const resolver = createBrokerBackedInstrumentMetadataResolver({ broker: broker('stock') });
    await expect(resolver.resolve(' nvda ')).resolves.toMatchObject({
      symbol: 'NVDA',
      classification: 'COMMON_STOCK',
      economicUnderlyingSymbol: 'NVDA',
      confidence: 'COMPLETE',
    });
  });

  it('does not assume a broker-confirmed ETF is unleveraged', async () => {
    const resolver = createBrokerBackedInstrumentMetadataResolver({ broker: broker('etf') });
    await expect(resolver.resolve('NVDU')).resolves.toMatchObject({
      symbol: 'NVDU',
      classification: 'UNKNOWN',
      confidence: 'PARTIAL',
      resetFrequency: 'UNKNOWN',
    });
  });

  it('uses validated leveraged-product metadata when supplied', async () => {
    const validated: InstrumentMetadata = {
      symbol: 'NVDU',
      classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      confidence: 'COMPLETE',
      confidenceReasons: ['Validated product metadata fixture.'],
      provenance: { provider: 'validated-fixture', asOf: '2026-10-01T12:00:00.000Z' },
    };
    const resolver = createBrokerBackedInstrumentMetadataResolver({
      broker: broker('etf'),
      resolveLeveragedProduct: async () => validated,
    });
    await expect(resolver.resolve('NVDU')).resolves.toEqual(validated);
  });

  it.each(['index', 'unsupported', 'unavailable'] as const)(
    'fails closed for %s when Gate 1 cannot authoritatively normalize it',
    async kind => {
      const resolver = createBrokerBackedInstrumentMetadataResolver({ broker: broker(kind) });
      await expect(resolver.resolve('X')).resolves.toMatchObject({
        classification: 'UNKNOWN',
        confidence: 'INCOMPLETE',
      });
    },
  );
});
