import { classifyUnderlying } from '@/lib/scans/tastytrade-client';
import {
  createBrokerBackedInstrumentMetadataResolver,
  createCatalogResolver,
  DIREXION_GATE1_BOOTSTRAP,
  type BrokerEquityClassifier,
  type InstrumentMetadataResolver,
} from '.';

export function createTastytradeInstrumentMetadataResolver(token: string): InstrumentMetadataResolver {
  const broker: BrokerEquityClassifier = {
    async classify(symbol) {
      const kind = await classifyUnderlying(symbol, token).catch(() => 'unsupported' as const);
      return {
        symbol: symbol.toUpperCase(),
        kind,
        provider: 'tastytrade',
        asOf: new Date().toISOString(),
      };
    },
  };

  return createBrokerBackedInstrumentMetadataResolver({
    broker,
    resolveLeveragedProduct: createCatalogResolver(DIREXION_GATE1_BOOTSTRAP),
  });
}
