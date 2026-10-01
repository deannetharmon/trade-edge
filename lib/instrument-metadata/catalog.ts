import type { InstrumentMetadata } from './types';

export interface LeveragedProductCatalogEntry {
  symbol: string;
  issuer: string;
  classification: Extract<
    InstrumentMetadata['classification'],
    | 'LEVERAGED_ETF_ETP'
    | 'INVERSE_ETF_ETP'
    | 'LEVERAGED_INVERSE_ETF_ETP'
    | 'LEVERAGED_SINGLE_STOCK_ETF_ETP'
    | 'OTHER_LEVERAGED_PRODUCT'
  >;
  economicUnderlyingSymbol?: string;
  benchmark?: string;
  signedLeverageMultiplier: number;
  resetFrequency: Exclude<InstrumentMetadata['resetFrequency'], 'UNKNOWN'>;
  sourceId: string;
  sourceUpdatedAt?: string;
}

export interface LeveragedProductCatalogSnapshot {
  catalogVersion: string;
  generatedAt: string;
  entries: LeveragedProductCatalogEntry[];
}

export function createCatalogResolver(snapshot: LeveragedProductCatalogSnapshot) {
  const bySymbol = new Map(snapshot.entries.map(entry => [entry.symbol.toUpperCase(), entry]));

  return async (rawSymbol: string): Promise<InstrumentMetadata | null> => {
    const symbol = rawSymbol.trim().toUpperCase();
    const entry = bySymbol.get(symbol);
    if (!entry) return null;

    const hasUnderlying = Boolean(entry.economicUnderlyingSymbol || entry.benchmark);
    const validMultiplier = Number.isFinite(entry.signedLeverageMultiplier) && entry.signedLeverageMultiplier !== 0;
    const complete = hasUnderlying && validMultiplier;

    return {
      symbol,
      classification: entry.classification,
      economicUnderlyingSymbol: entry.economicUnderlyingSymbol,
      benchmark: entry.benchmark,
      signedLeverageMultiplier: entry.signedLeverageMultiplier,
      resetFrequency: entry.resetFrequency,
      confidence: complete ? 'COMPLETE' : 'INCOMPLETE',
      confidenceReasons: complete
        ? [`Validated issuer catalog entry (${entry.issuer}); catalog ${snapshot.catalogVersion}.`]
        : ['Issuer catalog entry is missing critical normalization fields.'],
      provenance: {
        provider: entry.issuer,
        sourceId: entry.sourceId,
        asOf: snapshot.generatedAt,
        sourceUpdatedAt: entry.sourceUpdatedAt,
      },
    };
  };
}
