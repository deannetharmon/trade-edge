import type { LeveragedProductCatalogSnapshot } from './catalog';

/**
 * Small deterministic bootstrap fixture for Gate 1 tests and integration.
 * Values are transcribed from issuer-published Direxion product data.
 * This is intentionally not claimed to be a complete Direxion catalog.
 */
export const DIREXION_GATE1_BOOTSTRAP: LeveragedProductCatalogSnapshot = {
  catalogVersion: 'direxion-gate1-2026-10-01',
  generatedAt: '2026-10-01T00:00:00.000Z',
  entries: [
    {
      symbol: 'NVDU',
      issuer: 'Direxion',
      classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      sourceId: 'direxion-single-stock-etfs',
      sourceUpdatedAt: '2026-09-24',
    },
    {
      symbol: 'NVDD',
      issuer: 'Direxion',
      classification: 'INVERSE_ETF_ETP',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: -1,
      resetFrequency: 'DAILY',
      sourceId: 'direxion-single-stock-etfs',
      sourceUpdatedAt: '2026-09-24',
    },
    {
      symbol: 'MSFU',
      issuer: 'Direxion',
      classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlyingSymbol: 'MSFT',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      sourceId: 'direxion-single-stock-etfs',
      sourceUpdatedAt: '2026-09-24',
    },
    {
      symbol: 'MSFD',
      issuer: 'Direxion',
      classification: 'INVERSE_ETF_ETP',
      economicUnderlyingSymbol: 'MSFT',
      signedLeverageMultiplier: -1,
      resetFrequency: 'DAILY',
      sourceId: 'direxion-single-stock-etfs',
      sourceUpdatedAt: '2026-09-24',
    },
  ],
};
