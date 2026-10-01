import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/scans/tastytrade-client', () => ({
  classifyUnderlying: vi.fn(async (symbol: string) => {
    if (symbol === 'NVDA') return 'stock';
    if (symbol === 'NVDU' || symbol === 'SPY') return 'etf';
    return 'unsupported';
  }),
}));

import { createTastytradeInstrumentMetadataResolver } from '../tastytradeResolver';

describe('Tastytrade instrument metadata integration', () => {
  it('resolves an ordinary stock from the existing broker classifier', async () => {
    const resolver = createTastytradeInstrumentMetadataResolver('token');
    await expect(resolver.resolve('NVDA')).resolves.toMatchObject({
      classification: 'COMMON_STOCK',
      confidence: 'COMPLETE',
    });
  });

  it('combines broker ETF status with issuer catalog leverage economics', async () => {
    const resolver = createTastytradeInstrumentMetadataResolver('token');
    await expect(resolver.resolve('NVDU')).resolves.toMatchObject({
      classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      confidence: 'COMPLETE',
    });
  });

  it('keeps an uncovered broker ETF partial rather than calling it standard', async () => {
    const resolver = createTastytradeInstrumentMetadataResolver('token');
    await expect(resolver.resolve('SPY')).resolves.toMatchObject({
      classification: 'STANDARD_ETF',
      confidence: 'PARTIAL',
    });
  });
});
