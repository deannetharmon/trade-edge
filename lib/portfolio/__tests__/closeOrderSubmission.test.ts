// lib/portfolio/__tests__/closeOrderSubmission.test.ts
//
// ES-0001 (Product Owner corrective round 2): broker-boundary integration
// tests. These tests exercise `submitCloseOrderIfSafe` -- the exact function
// both real submission call sites in app/portfolio/page.tsx
// (BatchConfirmModal's `submitAll`, SetStopLossButton's `submit`) now wrap
// their literal `ttPost`/`ttPostComplex` call inside, as the callback
// argument -- with a mock broker function standing in for those calls. The
// goal is to PROVE, not just assert by inspection, that a safety failure can
// never reach a live order submission function, AND that the broker mock
// receives the exact points-denominated price/effect the plan computed (no
// 100x unit defect).
//
// Fixture note: all option symbols/strikes below are synthetic and do not
// reproduce any real account's positions or transaction data.

import { describe, expect, it, vi } from 'vitest';
import {
  analyzePositionStructure,
  buildCanonicalCloseIdentity,
  structureAnalysisToBlockingIssue,
  type RawEconomicLeg,
  type CanonicalCloseIdentity,
  type OrderLegPayload,
  type LiveCloseOrderSafetyInput,
} from '../closeOrderSafety';
import {
  guardAgainstAmbiguousStructure,
  submitCloseOrderIfSafe,
  type AmbiguityGuardInput,
} from '../closeOrderSubmission';

function leg(overrides: Partial<RawEconomicLeg>): RawEconomicLeg {
  return {
    symbol: 'AAPL240816P00200000',
    optionType: 'P',
    strikePrice: 200,
    direction: 'Short',
    quantity: 1,
    avgOpenPrice: 1.0,
    ...overrides,
  };
}

/** A resolvable 2-contract bull put spread: short $200 @1.05 / long $195
 *  @0.45 -- entry is a $0.60/contract CREDIT (LITERAL points value). */
function buildValidCreditIdentity(quantity = 2): CanonicalCloseIdentity {
  const legs = [
    leg({ symbol: 'S', strikePrice: 200, direction: 'Short', quantity, avgOpenPrice: 1.05 }),
    leg({ symbol: 'L', strikePrice: 195, direction: 'Long', quantity, avgOpenPrice: 0.45 }),
  ];
  const analysis = analyzePositionStructure(legs);
  if (analysis.status !== 'RESOLVED') throw new Error('fixture setup failed: expected RESOLVED');
  const idResult = buildCanonicalCloseIdentity(analysis.structures[0], 'AAPL::2024-08-16', 'AAPL', '2024-08-16');
  if (!idResult.ok) throw new Error('fixture setup failed: ' + idResult.message);
  return idResult.identity;
}

/** The confirmed danger case: two independent same-quantity bull put spreads
 *  in one symbol+expiration bucket -- 2 shorts + 2 longs, all qty=2. */
function buildAmbiguousLegs(): RawEconomicLeg[] {
  return [
    leg({ symbol: 'S1', strikePrice: 200, direction: 'Short', quantity: 2 }),
    leg({ symbol: 'L1', strikePrice: 195, direction: 'Long', quantity: 2 }),
    leg({ symbol: 'S2', strikePrice: 190, direction: 'Short', quantity: 2 }),
    leg({ symbol: 'L2', strikePrice: 185, direction: 'Long', quantity: 2 }),
  ];
}

function actualOrderFor(identity: CanonicalCloseIdentity, requestedQuantity: number, limitPricePointsPerUnit: number, priceEffect: 'Credit' | 'Debit' = 'Debit') {
  return {
    legs: identity.legs.map(l => ({ symbol: l.symbol, quantity: requestedQuantity, direction: l.direction })) as OrderLegPayload[],
    limitPricePointsPerUnit,
    priceEffect,
  };
}

/** A fully valid live gate input for a 2-contract, $0.60-credit position
 *  closing at 0.30 points (Debit) -- $30/contract profit, $60 total. */
function validGateInput(identity: CanonicalCloseIdentity, overrides: Partial<LiveCloseOrderSafetyInput> = {}): LiveCloseOrderSafetyInput {
  const requestedQuantity = overrides.requestedQuantity ?? identity.quantity;
  return {
    identity,
    requestedQuantity,
    closeableQuantity: identity.quantity,
    pricingIntent: 'CUSTOM',
    requestedClosePriceEffect: 'Debit',
    closePricePointsPerUnit: 0.30,
    quote: { netBid: 0.25, netAsk: 0.35, netMid: 0.30, fetchedAtMs: Date.now() },
    actualOrder: actualOrderFor(identity, requestedQuantity, 0.30),
    displayedExpectedPnlDollars: (0.60 - 0.30) * requestedQuantity * 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Ambiguous structure: broker mock is NEVER called
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- ambiguous / unresolved structure', () => {
  it('does not call the broker when two independent same-quantity spreads are ambiguous (same symbol/expiration/quantity, different strikes)', async () => {
    const analysis = analyzePositionStructure(buildAmbiguousLegs());
    expect(analysis.status).toBe('AMBIGUOUS');
    const blockIssue = structureAnalysisToBlockingIssue(analysis);
    expect(blockIssue?.ruleId).toBe('AMBIGUOUS_POSITION_STRUCTURE');

    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'SHOULD-NEVER-BE-SUBMITTED' } } });

    const structureGuardInput: AmbiguityGuardInput = {
      identity: null, // no identity can be built -- structure never resolved
      structureAmbiguous: true,
      structureBlockMessage: blockIssue?.message ?? null,
    };
    // Deliberately pass a well-formed gateInput to prove the STRUCTURE guard
    // alone is sufficient to block -- it must never even reach the economic
    // gate or the broker call.
    const validIdentity = buildValidCreditIdentity();

    const result = await submitCloseOrderIfSafe(structureGuardInput, validGateInput(validIdentity), brokerMock);

    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.reason).toContain('AMBIGUOUS_POSITION_STRUCTURE');
    }
  });

  it('does not call the broker when identity is null (structure could not be resolved at all)', async () => {
    const brokerMock = vi.fn();
    const structureGuardInput: AmbiguityGuardInput = {
      identity: null,
      structureAmbiguous: false, // even if this flag were somehow false, null identity alone must block
      structureBlockMessage: null,
    };
    const validIdentity = buildValidCreditIdentity();
    const result = await submitCloseOrderIfSafe(structureGuardInput, validGateInput(validIdentity), brokerMock);
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Required-evidence enforcement: broker mock is NEVER called on omitted
//    or invalid quote/payload/display evidence
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- required live evidence', () => {
  it('does not call the broker when quote is explicitly null', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { quote: null }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker when quote is undefined (a caller bypassing the required type)', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const input = validGateInput(identity);
    (input as any).quote = undefined;
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      input,
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker when the actual order-leg payload symbols differ from the plan', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { actualOrder: { legs: [{ symbol: 'WRONG-SYMBOL', quantity: identity.quantity, direction: 'Short' }], limitPricePointsPerUnit: 0.30, priceEffect: 'Debit' } }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck?.issues.map(i => i.ruleId)).toContain('LEG_IDENTITY_MISMATCH');
    }
  });

  it('does not call the broker when the actual broker limit price (points) is 100x the plan\'s -- the exact unit defect this round fixes', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { actualOrder: actualOrderFor(identity, identity.quantity, 30) }), // 30 instead of 0.30
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck?.issues.map(i => i.ruleId)).toContain('PAYLOAD_LIMIT_PRICE_MISMATCH');
    }
  });

  it('does not call the broker when the actual broker price effect differs from the plan', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { actualOrder: actualOrderFor(identity, identity.quantity, 0.30, 'Credit') }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck?.issues.map(i => i.ruleId)).toContain('PAYLOAD_PRICE_EFFECT_MISMATCH');
    }
  });

  it('does not call the broker when the displayed expected P/L does not match the plan\'s computed P/L', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { displayedExpectedPnlDollars: 999999 }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck?.issues.map(i => i.ruleId)).toContain('DISPLAY_PAYLOAD_ECONOMICS_MISMATCH');
    }
  });

  it('does not call the broker when a broker-payload leg quantity does not scale 1:1 with the requested quantity', async () => {
    const identity = buildValidCreditIdentity(5);
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, {
        requestedQuantity: 5,
        closeableQuantity: 5,
        actualOrder: actualOrderFor(identity, 3, 0.30), // wrong: should be 5
      }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      const ruleIds = result.safetyCheck?.issues.map(i => i.ruleId) ?? [];
      expect(ruleIds.some(r => r === 'PAYLOAD_QUANTITY_MISMATCH' || r === 'LEG_RATIO_MISMATCH')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Quantity boundaries
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- quantity boundaries', () => {
  it('does not call the broker for an over-close request (requested > closeable)', async () => {
    const identity = buildValidCreditIdentity(2);
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { requestedQuantity: 5, closeableQuantity: 2, actualOrder: actualOrderFor(identity, 5, 0.30) }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck?.issues.map(i => i.ruleId)).toContain('REQUESTED_QTY_EXCEEDS_POSITION');
    }
  });

  it('submits exactly ONE canonical spread unit for a 1-contract partial close from a 5-contract position, with the broker receiving the exact scaled plan', async () => {
    const identity = buildValidCreditIdentity(5);
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-1' } } });
    const requestedQuantity = 1;

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, {
        requestedQuantity,
        closeableQuantity: 5,
        actualOrder: actualOrderFor(identity, requestedQuantity, 0.30),
        displayedExpectedPnlDollars: (0.60 - 0.30) * 1 * 100,
      }),
      async (safetyCheck) => {
        expect(safetyCheck.plan?.requestedQuantity).toBe(1);
        expect(safetyCheck.plan?.legPayload.every(l => l.quantity === 1)).toBe(true);
        return brokerMock(safetyCheck);
      }
    );

    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Quote evidence: missing / invalid / crossed always block; stale
//    requires explicit confirmation
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- quote evidence', () => {
  it('does not call the broker when the quote is one-sided or invalid (non-finite / negative)', async () => {
    const identity = buildValidCreditIdentity();
    for (const quote of [
      { netBid: null, netAsk: 0.35, netMid: null, fetchedAtMs: Date.now() },
      { netBid: -1, netAsk: 0.35, netMid: 0.1, fetchedAtMs: Date.now() },
      { netBid: Number.NaN, netAsk: 0.35, netMid: null, fetchedAtMs: Date.now() },
    ]) {
      const brokerMock = vi.fn();
      const result = await submitCloseOrderIfSafe(
        { identity, structureAmbiguous: false, structureBlockMessage: null },
        validGateInput(identity, { quote }),
        brokerMock
      );
      expect(result.submitted).toBe(false);
      expect(brokerMock).not.toHaveBeenCalled();
    }
  });

  it('does not call the broker when the quote is crossed (bid > ask)', async () => {
    const identity = buildValidCreditIdentity();
    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { quote: { netBid: 0.40, netAsk: 0.30, netMid: 0.35, fetchedAtMs: Date.now() } }),
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker for a stale quote without explicit confirmation, but DOES call it once staleQuoteConfirmed is true', async () => {
    const identity = buildValidCreditIdentity();
    const staleQuote = { netBid: 0.25, netAsk: 0.35, netMid: 0.30, fetchedAtMs: Date.now() - 10 * 60 * 1000 };

    const blockedBroker = vi.fn();
    const blockedResult = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { quote: staleQuote }),
      blockedBroker
    );
    expect(blockedResult.submitted).toBe(false);
    expect(blockedBroker).not.toHaveBeenCalled();

    const allowedBroker = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-STALE-CONFIRMED' } } });
    const allowedResult = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, { quote: staleQuote, staleQuoteConfirmed: true }),
      allowedBroker
    );
    expect(allowedResult.submitted).toBe(true);
    expect(allowedBroker).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Credit and debit break-even
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- credit break-even (debit-opened positions hard-blocked separately)', () => {
  it('a credit-opened position\'s break-even close realizes $0.00 EXACTLY (LITERAL) and reaches the broker mock with the 0.60-point limit, never 60', async () => {
    const identity = buildValidCreditIdentity(2);
    expect(identity.entryPriceEffect).toBe('Credit');
    expect(identity.entryPricePointsPerUnit).toBeCloseTo(0.60, 5);
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-CREDIT-BE' } } });

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, {
        pricingIntent: 'BREAK_EVEN',
        closePricePointsPerUnit: 0.60,
        requestedClosePriceEffect: 'Debit',
        quote: { netBid: 0.55, netAsk: 0.65, netMid: 0.60, fetchedAtMs: Date.now() },
        actualOrder: actualOrderFor(identity, identity.quantity, 0.60),
        displayedExpectedPnlDollars: 0,
      }),
      brokerMock
    );

    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
    expect(result.submitted && result.safetyCheck.plan!.closePricePointsPerUnit).toBeCloseTo(0.60, 5);
    expect(result.submitted && Math.abs(result.safetyCheck.plan!.expectedRealizedPnlDollars)).toBeLessThan(0.01);
  });

  it('submits an otherwise-valid debit-position Sell-to-Close break-even plan', async () => {
    const legs = [
      leg({ symbol: 'CS', optionType: 'C', strikePrice: 560, direction: 'Short', quantity: 3, avgOpenPrice: 0.60 }),
      leg({ symbol: 'CL', optionType: 'C', strikePrice: 555, direction: 'Long', quantity: 3, avgOpenPrice: 1.10 }),
    ];
    const analysis = analyzePositionStructure(legs);
    if (analysis.status !== 'RESOLVED') throw new Error('fixture error');
    const idResult = buildCanonicalCloseIdentity(analysis.structures[0], 'K', 'AAPL', '2024-09-20');
    if (!idResult.ok) throw new Error('fixture error');
    const identity = idResult.identity;
    expect(identity.entryPriceEffect).toBe('Debit');

    const brokerMock = vi.fn();
    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      {
        identity,
        requestedQuantity: 3,
        closeableQuantity: 3,
        pricingIntent: 'BREAK_EVEN',
        requestedClosePriceEffect: 'Credit',
        closePricePointsPerUnit: 0.50,
        quote: { netBid: 0.45, netAsk: 0.55, netMid: 0.50, fetchedAtMs: Date.now() },
        actualOrder: actualOrderFor(identity, 3, 0.50, 'Credit'),
        displayedExpectedPnlDollars: 0,
      },
      brokerMock
    );

    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledOnce();
    if (result.submitted) expect(result.safetyCheck.plan?.expectedRealizedPnlDollars).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// 6. Exact plan/broker-payload equality on a valid submission
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- valid submission reaches the broker with exact plan values', () => {
  it('the broker mock receives the exact OCC symbols, directions, quantities, price effect, and POINTS limit price the plan computed', async () => {
    const identity = buildValidCreditIdentity(4);
    const requestedQuantity = 4;
    const closePricePointsPerUnit = 0.35;

    let capturedPayload: unknown = null;
    const brokerMock = vi.fn(async (safetyCheck) => {
      capturedPayload = {
        legs: safetyCheck.plan!.legPayload,
        priceEffect: safetyCheck.plan!.requestedClosePriceEffect,
        limitPricePoints: safetyCheck.plan!.closePricePointsPerUnit,
      };
      return { data: { order: { id: 'OK-EXACT' } } };
    });

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, {
        requestedQuantity,
        closeableQuantity: 4,
        closePricePointsPerUnit,
        actualOrder: actualOrderFor(identity, requestedQuantity, closePricePointsPerUnit),
        displayedExpectedPnlDollars: (0.60 - closePricePointsPerUnit) * requestedQuantity * 100,
      }),
      brokerMock
    );

    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
    const payload = capturedPayload as { legs: OrderLegPayload[]; priceEffect: string; limitPricePoints: number };
    expect(payload.priceEffect).toBe('Debit');
    expect(payload.limitPricePoints).toBeCloseTo(0.35, 5); // POINTS, never 35
    expect(payload.legs).toEqual(
      identity.legs.map(l => ({ symbol: l.symbol, quantity: requestedQuantity, direction: l.direction }))
    );
  });

  it('an existing valid full-close path (e.g. Take Profit / Cut Losses) still reaches the broker exactly once with LITERAL correct P/L', async () => {
    const identity = buildValidCreditIdentity(2);
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-TAKE-PROFIT' } } });

    const result = await submitCloseOrderIfSafe(
      { identity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(identity, {
        pricingIntent: 'PROFIT_TARGET',
        closePricePointsPerUnit: 0.30, // profitable close well below entry credit
        actualOrder: actualOrderFor(identity, identity.quantity, 0.30),
        displayedExpectedPnlDollars: 60,
      }),
      brokerMock
    );

    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
    expect(result.submitted && result.safetyCheck.plan!.expectedRealizedPnlDollars).toBeCloseTo(60, 5);
  });
});

// ---------------------------------------------------------------------------
// 7. Roll closing legs remain distinct from opening-leg economics
// ---------------------------------------------------------------------------

describe('submitCloseOrderIfSafe -- roll closing-leg isolation', () => {
  it('the plan built for the CLOSING side of a roll (pricingIntent ROLL) contains only the original position\'s legs, never any new opening legs', async () => {
    const closingIdentity = buildValidCreditIdentity(2);
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-ROLL-CLOSE' } } });

    const result = await submitCloseOrderIfSafe(
      { identity: closingIdentity, structureAmbiguous: false, structureBlockMessage: null },
      validGateInput(closingIdentity, { pricingIntent: 'ROLL' }),
      brokerMock
    );

    expect(result.submitted).toBe(true);
    const plan = result.submitted ? result.safetyCheck.plan! : null;
    expect(plan?.legPayload).toHaveLength(closingIdentity.legs.length);
    expect(plan?.legPayload.map(l => l.symbol).sort()).toEqual(closingIdentity.legs.map(l => l.symbol).sort());
  });
});
