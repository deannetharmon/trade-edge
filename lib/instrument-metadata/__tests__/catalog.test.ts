import { createCatalogResolver } from '../catalog';
import { DIREXION_GATE1_BOOTSTRAP } from '../direxionBootstrap';

describe('leveraged product catalog', () => {
  it('resolves issuer-validated daily bull metadata', async () => {
    const resolve = createCatalogResolver(DIREXION_GATE1_BOOTSTRAP);
    await expect(resolve('nvdu')).resolves.toMatchObject({
      symbol: 'NVDU',
      classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      confidence: 'COMPLETE',
    });
  });

  it('preserves inverse sign from issuer target', async () => {
    const resolve = createCatalogResolver(DIREXION_GATE1_BOOTSTRAP);
    await expect(resolve('NVDD')).resolves.toMatchObject({
      signedLeverageMultiplier: -1,
      confidence: 'COMPLETE',
    });
  });

  it('returns null instead of guessing an uncovered ticker', async () => {
    const resolve = createCatalogResolver(DIREXION_GATE1_BOOTSTRAP);
    await expect(resolve('NOTREAL')).resolves.toBeNull();
  });
});
