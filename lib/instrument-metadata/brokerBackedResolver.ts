import type {
  BrokerEquityClassification,
  BrokerEquityClassifier,
  InstrumentMetadata,
  InstrumentMetadataResolver,
} from './types';

export interface BrokerBackedInstrumentMetadataResolverOptions {
  broker: BrokerEquityClassifier;
  resolveLeveragedProduct?: (symbol: string) => Promise<InstrumentMetadata | null>;
  now?: () => Date;
}

/**
 * Resolves the broker's coarse stock/ETF/index fact first, then delegates
 * leveraged/inverse ETF economics to a validated product-metadata source.
 *
 * The broker's is-etf flag is not evidence that an ETF is unleveraged.
 * Therefore an ETF without validated product metadata is deliberately
 * PARTIAL/non-authoritative for LEV-0001 cross-instrument normalization.
 */
export function createBrokerBackedInstrumentMetadataResolver(
  options: BrokerBackedInstrumentMetadataResolverOptions,
): InstrumentMetadataResolver {
  const now = options.now ?? (() => new Date());

  return {
    async resolve(rawSymbol: string): Promise<InstrumentMetadata> {
      const symbol = rawSymbol.trim().toUpperCase();
      const broker = await options.broker.classify(symbol);
      const asOf = broker.asOf || now().toISOString();

      if (broker.kind === 'stock') {
        return {
          symbol,
          classification: 'COMMON_STOCK',
          economicUnderlyingSymbol: symbol,
          resetFrequency: 'NOT_APPLICABLE',
          confidence: 'COMPLETE',
          confidenceReasons: ['Broker identifies the instrument as a non-ETF equity.'],
          provenance: { provider: broker.provider, asOf },
        };
      }

      if (broker.kind === 'etf') {
        const leveraged = await options.resolveLeveragedProduct?.(symbol);
        if (leveraged) return leveraged;

        return {
          symbol,
          classification: 'STANDARD_ETF',
          economicUnderlyingSymbol: symbol,
          resetFrequency: 'UNKNOWN',
          confidence: 'PARTIAL',
          confidenceReasons: [
            'Broker confirms ETF status, but no validated product metadata source established whether the ETF is standard, leveraged, or inverse.',
          ],
          provenance: { provider: broker.provider, asOf },
        };
      }

      return {
        symbol,
        classification: 'UNKNOWN',
        resetFrequency: 'UNKNOWN',
        confidence: 'INCOMPLETE',
        confidenceReasons: [
          broker.kind === 'index'
            ? 'Cash-settled index classification is outside the Gate 1 equity-product normalization scope.'
            : broker.kind === 'unsupported'
              ? 'Broker does not support this symbol as an equity instrument.'
              : 'Broker classification is unavailable; instrument type must not be guessed.',
        ],
        provenance: { provider: broker.provider, asOf },
      };
    },
  };
}
