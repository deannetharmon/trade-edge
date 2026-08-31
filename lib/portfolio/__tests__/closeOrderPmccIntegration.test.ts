import { describe, expect, it, vi } from 'vitest';
import {
  analyzePositionStructure,
  buildCanonicalCloseIdentity,
  type CanonicalCloseIdentity,
  type LiveCloseOrderSafetyInput,
  type RawEconomicLeg,
} from '../closeOrderSafety';
import { submitCloseOrderIfSafe } from '../closeOrderSubmission';

function buildLongCallIdentity(quantity = 3): CanonicalCloseIdentity {
  const leg: RawEconomicLeg = {
    symbol: 'NVDA  280121C00120000',
    optionType: 'C',
    strikePrice: 120,
    direction: 'Long',
    quantity,
    avgOpenPrice: 75,
  };
  const analysis = analyzePositionStructure([leg]);
  if (analysis.status !== 'RESOLVED') throw new Error('fixture did not resolve');
  const built = buildCanonicalCloseIdentity(analysis.structures[0], 'long-1', 'NVDA', '2028-01-21');
  if (!built.ok) throw new Error(built.message);
  return built.identity;
}

function gateInput(identity: CanonicalCloseIdentity, requestedQuantity = 1): LiveCloseOrderSafetyInput {
  const closePrice = 92;
  return {
    identity,
    requestedQuantity,
    closeableQuantity: identity.quantity,
    pricingIntent: 'CUSTOM',
    requestedClosePriceEffect: 'Credit',
    closePricePointsPerUnit: closePrice,
    quote: { netBid: 91.5, netAsk: 92.5, netMid: 92, fetchedAtMs: Date.now() },
    actualOrder: {
      legs: identity.legs.map(leg => ({ symbol: leg.symbol, quantity: requestedQuantity, direction: leg.direction })),
      limitPricePointsPerUnit: closePrice,
      priceEffect: 'Credit',
    },
    displayedExpectedPnlDollars: (closePrice - identity.entryPricePointsPerUnit) * requestedQuantity * identity.contractMultiplier,
  };
}

describe('canonical close submission PMCC integration', () => {
  it('blocks broker transmission when PMCC submission-time revalidation fails after normal close safety passes', async () => {
    const identity = buildLongCallIdentity();
    const broker = vi.fn(async () => ({ id: 'must-not-submit' }));
    const pmccRevalidator = vi.fn(async () => ({
      required: true,
      safe: false,
      reason: 'Active PMCC short-call coverage would be lost.',
      coverage: null,
      campaignId: 'campaign-1',
    }));

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      gateInput(identity, 2),
      broker,
      { pmccRevalidator },
    );

    expect(result.submitted).toBe(false);
    expect(pmccRevalidator).toHaveBeenCalledOnce();
    expect(pmccRevalidator).toHaveBeenCalledWith({
      identity,
      currentLongQuantity: 3,
      proposedLongQuantityAfterAction: 1,
    });
    expect(broker).not.toHaveBeenCalled();
  });

  it('reaches the broker exactly once when canonical close safety and PMCC coverage both pass', async () => {
    const identity = buildLongCallIdentity();
    const broker = vi.fn(async () => ({ id: 'order-1' }));
    const pmccRevalidator = vi.fn(async () => ({
      required: true,
      safe: true,
      reason: null,
      coverage: null,
      campaignId: 'campaign-1',
    }));

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      gateInput(identity, 1),
      broker,
      { pmccRevalidator },
    );

    expect(result.submitted).toBe(true);
    expect(pmccRevalidator).toHaveBeenCalledOnce();
    expect(broker).toHaveBeenCalledOnce();
  });
});
