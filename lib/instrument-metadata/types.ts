export type InstrumentClassification =
  | 'COMMON_STOCK'
  | 'STANDARD_ETF'
  | 'LEVERAGED_ETF_ETP'
  | 'INVERSE_ETF_ETP'
  | 'LEVERAGED_INVERSE_ETF_ETP'
  | 'LEVERAGED_SINGLE_STOCK_ETF_ETP'
  | 'OTHER_LEVERAGED_PRODUCT'
  | 'UNKNOWN';

export type ResetFrequency =
  | 'DAILY'
  | 'MONTHLY'
  | 'OTHER'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN';

export type NormalizationConfidence = 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';

export interface InstrumentMetadataProvenance {
  provider: string;
  sourceId?: string;
  asOf: string;
  sourceUpdatedAt?: string;
}

export interface InstrumentMetadata {
  symbol: string;
  classification: InstrumentClassification;
  economicUnderlyingSymbol?: string;
  benchmark?: string;
  signedLeverageMultiplier?: number;
  resetFrequency: ResetFrequency;
  confidence: NormalizationConfidence;
  confidenceReasons: string[];
  provenance: InstrumentMetadataProvenance;
}

export interface InstrumentMetadataResolver {
  resolve(symbol: string): Promise<InstrumentMetadata>;
}
