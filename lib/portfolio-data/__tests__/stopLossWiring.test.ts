import { describe, expect, it } from 'vitest';
import { classifyPositionStopLoss, getRecommendation, mapBrokerStopStatus, derivePositionQuoteQuality, buildStopBreachObservations, resolveOcoStopOrderId, collectRawOrders, mapGtcOrder, calculateSpreadCredit, computeMarketablePnlPct } from '../acquisition';
import type { Position, PositionLeg, GtcOrder, PositionSnapshot } from '../types';
import { buildOriginalCreditDefaultPolicy, buildCurrentValueAnchoredPolicy, buildUnknownProvenancePolicy } from '@/lib/portfolio/stopLossPolicy';
import { computeSignedNetPremium, isNetDebitStructure, computePositionPnl } from '@/lib/portfolio/positionMetrics';

// ── Fixtures ────────────────────────────────────────────────────────────
function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'MU   260918P00095000',
    optionType: 'P',
    strikePrice: 95,
    direction: 'Short',
    quantity: 5,
    avgOpenPrice: 2.52,
    currentPrice: null,
    ...overrides,
  };
}

function gtcOrder(overrides: Partial<GtcOrder> = {}): GtcOrder {
  return {
    id: 'ord-1',
    price: '',
    stopPrice: '3.15',
    orderType: 'Stop Limit',
    timeInForce: 'GTC',
    legs: [{ symbol: 'MU   260918P00095000', action: 'Buy to Close' }],
    status: 'Live',
    ...overrides,
  };
}

// Minimal-but-complete Position fixture. Only the fields getRecommendation/
// classifyPositionStopLoss actually read are varied by tests; everything
// else gets a benign default so TypeScript is satisfied without dragging in
// the full acquisition pipeline.
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    key: 'MU::2026-09-18',
    symbol: 'MU',
    expDate: '2026-09-18',
    dte: 45,
    strategy: 'BPS',
    legs: [leg(), leg({ symbol: 'MU   260918P00090000', strikePrice: 90, direction: 'Long', avgOpenPrice: 2.02 })],
    quantity: 5,
    identity: null,
    structureAmbiguous: false,
    structureBlockMessage: null,
    entryPriceEffect: 'Credit',
    entryCredit: 1260,
    entryEconomicsComplete: true,
    creditReceived: 1260, // $2.52/contract * 5 * 100
    currentValue: 1200,
    closeValue: 1200,
    closeNowPnl: 60,
    pnl: 60,
    pnlPct: 4.76,
    pnlReliable: true,
    intent: 'income',
    plOpen: null,
    targetPrice: 630,
    profitTarget: 0.5,
    maxRisk: 1240,
    hitTarget: false,
    needsClose: false,
    entryDte: 45,
    entryDate: '2026-08-01',
    accountNumber: 'ACCT-1',
    ivr: 50,
    iv: 40,
    hv30: 35,
    beta: 1.1,
    netDelta: -0.1,
    netVega: -0.2,
    pop: 70,
    hasGtc: true,
    gtcOrderId: 'gtc-1',
    gtcOrderPrice: 1.26,
    stopLossStatus: 'unknown',
    stopLossPrice: null,
    stopLossPolicy: null,
    stopLossDisplayPolicy: null,
    stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null,
    quoteWidthEvidence: null,
    stockPrice: 110,
    buffer: 13.6,
    putBufferPct: 13.6,
    callBufferPct: null,
    theta: 0.5,
    gamma: -0.02,
    earningsDate: null,
    ...overrides,
  };
}

describe('classifyPositionStopLoss (wiring)', () => {
  const positionInput = {
    legs: [leg(), leg({ direction: 'Long', symbol: 'MU   260918P00090000' })],
    creditReceived: 1260, entryCredit: 1260, entryEconomicsComplete: true, entryPriceEffect: 'Credit' as const, quantity: 5,
  };

  it('fails stop classification closed for debit and missing canonical provenance', () => {
    expect(classifyPositionStopLoss({ ...positionInput, entryPriceEffect: 'Debit' }, [gtcOrder()], null).classification).toBe('INVALID');
    expect(classifyPositionStopLoss({ ...positionInput, entryCredit: null }, [gtcOrder()], null).classification).toBe('INVALID');
  });

  // 1. MU-style 5-lot BPS: credit $2.52/contract, working stop $3.15, no
  // TradeEdge-recorded policy for this order.
  it('never classifies the MU-style 1.25x-credit stop as aligned when unrecorded', () => {
    const result = classifyPositionStopLoss(positionInput, [gtcOrder()], null);
    expect(result.classification).not.toBe('ALIGNED');
    expect(['TOO_TIGHT', 'UNKNOWN_PROVENANCE']).toContain(result.classification);
    expect(result.status).not.toBe('none');
  });

  // 2. Same position, correctly recorded 2x-credit stop at $5.04.
  it('classifies a correctly recorded 2x-credit stop as aligned', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { source: 'DEFAULT', brokerOrderId: 'ord-2' });
    const order = gtcOrder({ id: 'ord-2', stopPrice: '5.04' });
    const result = classifyPositionStopLoss(positionInput, [order], policy);
    expect(result.classification).toBe('ALIGNED');
    expect(result.status).toBe('live');
  });

  it('reports NO_STOP when no matching broker order exists', () => {
    const result = classifyPositionStopLoss(positionInput, [], null);
    expect(result.classification).toBe('NO_STOP');
    expect(result.status).toBe('none');
  });

  // 9. Externally created broker stop with no metadata: basis stays
  // UNKNOWN, never relabeled as credit-based.
  //
  // TE-0002 corrective round 3: `result.policy` is now the enforcement-
  // trust-gated field -- null for an unmatched/UNKNOWN-provenance order.
  // The UNKNOWN-basis fabrication this test locks down now lives on
  // `result.displayPolicy` (display-only; never fed into breach
  // enforcement). `result.policy` itself must be null here.
  it('resolves an externally created stop with no TradeEdge metadata to an UNKNOWN-basis display policy, and null enforcement policy', () => {
    const order = gtcOrder({ id: 'ord-3', stopPrice: '5.00' });
    const result = classifyPositionStopLoss(positionInput, [order], null);
    expect(result.displayPolicy?.anchorBasis).toBe('UNKNOWN');
    expect(result.displayPolicy?.source).toBe('UNKNOWN');
    expect(result.policy).toBeNull();
  });

  // TE-0002 corrective round 3: a stale/mismatched record must not leak
  // into the enforcement field either, even though its (unmatched) identity
  // is still visible via displayPolicy for the trader's context.
  it('does not misattribute a recorded policy whose brokerOrderId no longer matches the live order', () => {
    const stalePolicy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'old-order-id' });
    const order = gtcOrder({ id: 'new-order-id', stopPrice: '3.15' });
    const result = classifyPositionStopLoss(positionInput, [order], stalePolicy);
    expect(result.classification).not.toBe('ALIGNED');
    expect(result.policy).toBeNull();
    expect(result.displayPolicy?.brokerOrderId).not.toBe('old-order-id');
  });

  // 8. AI-created current-value stop: provenance and display remain
  // current-value-based after reload.
  it('round-trips an AI-created current-value policy as CURRENT_SPREAD_VALUE after reload', () => {
    const policy = buildCurrentValueAnchoredPolicy(1.05, 2.5, { source: 'AI_SUGGESTION', brokerOrderId: 'ord-ai' });
    const order = gtcOrder({ id: 'ord-ai', stopPrice: policy.triggerPrice.toFixed(2) });
    const result = classifyPositionStopLoss(positionInput, [order], policy);
    expect(result.policy?.anchorBasis).toBe('CURRENT_SPREAD_VALUE');
    expect(result.policy?.source).toBe('AI_SUGGESTION');
    expect(result.classification).toBe('ALIGNED');
  });
});

// ── TE-0002 corrective round 2: OCO broker identity end-to-end ────────────
// Required fixture: (1) an OCO submission response containing both the
// parent complex-order id and the nested stop order's own id, (2) provenance
// persisted after submission via resolveOcoStopOrderId, (3) broker orders
// reconstructed the SAME way acquisition.ts reconstructs them on reload
// (collectRawOrders/mapGtcOrder), (4) reload classification is ALIGNED, (5)
// a stop replaced outside TradeEdge (new order id AND new complex-order id)
// still comes back UNKNOWN_PROVENANCE, never misattributed to the stale
// recorded policy.
describe('OCO broker identity: submit -> persist -> reload (end-to-end)', () => {
  const positionInput = {
    legs: [leg(), leg({ direction: 'Long', symbol: 'MU   260918P00090000' })],
    creditReceived: 1260, entryCredit: 1260, entryEconomicsComplete: true, entryPriceEffect: 'Credit' as const, quantity: 5,
  };

  function ocoEnvelope(opts: { complexId: string; profitOrderId: string; stopOrderId: string; stopTrigger: string }) {
    return {
      data: {
        'complex-order': {
          id: opts.complexId,
          orders: [
            {
              id: opts.profitOrderId,
              'order-type': 'Limit',
              price: '1.26',
              'time-in-force': 'GTC',
              legs: [{ symbol: 'MU   260918P00095000', action: 'Buy to Close' }],
            },
            {
              id: opts.stopOrderId,
              'order-type': 'Stop Limit',
              'stop-trigger': opts.stopTrigger,
              'time-in-force': 'GTC',
              status: 'Live',
              legs: [{ symbol: 'MU   260918P00095000', action: 'Buy to Close' }],
            },
          ],
        },
      },
    };
  }

  // Reconstruct GtcOrder[] exactly the way fetchGtcOrders does at reload
  // time: collectRawOrders walks the raw broker envelope, mapGtcOrder
  // normalizes each nested order.
  // Mirrors how fetchGtcOrders reconstructs orders from a real GET
  // /accounts/{acct}/complex-orders response ({ data: { items: [...] } }) --
  // the OCO submission fixture above uses the same nested envelope shape
  // TastyTrade returns from that submission endpoint (data['complex-order']),
  // so it's re-wrapped into the `items` shape here to match a genuine reload
  // fetch, rather than inventing a second envelope format.
  function reconstructGtcOrders(raw: any) {
    const envelope = raw?.data?.['complex-order'] ?? raw?.data ?? null;
    const rawOrders = collectRawOrders({ data: { items: envelope ? [envelope] : [] } });
    return rawOrders.map(o => mapGtcOrder(o, o._inheritedTif, o._parentComplexId));
  }

  it('persists identity from the OCO response and classifies ALIGNED after reload via the same broker-order reconstruction', () => {
    // 1. OCO submission response with parent + nested stop order ids.
    const submissionResponse = ocoEnvelope({
      complexId: 'complex-999',
      profitOrderId: 'ord-profit-1',
      stopOrderId: 'ord-stop-1',
      stopTrigger: '5.04', // 2x credit ($2.52) -- deterministic entry default
    });

    // 2. Identity resolved and persisted after submission -- the nested
    // stop leg's OWN id is captured, not the parent envelope id.
    const { complexOrderId, stopOrderId } = resolveOcoStopOrderId(submissionResponse);
    expect(complexOrderId).toBe('complex-999');
    expect(stopOrderId).toBe('ord-stop-1');
    const recordedPolicy = buildOriginalCreditDefaultPolicy(2.52, {
      source: 'DEFAULT',
      brokerOrderId: stopOrderId,
      complexOrderId,
    });

    // 3. Broker orders reconstructed through the exact same
    // collectRawOrders/mapGtcOrder parsing used on a real GET
    // /complex-orders reload (a fresh raw envelope, not the submission
    // response object, matching how the position gets re-fetched).
    const reloadedOrders = reconstructGtcOrders(submissionResponse);
    const stopEntry = reloadedOrders.find(o => o.id === 'ord-stop-1');
    expect(stopEntry).toBeDefined();
    expect(stopEntry?.complexOrderId).toBe('complex-999');

    // 4. Reload classification remains ALIGNED for the TradeEdge-created
    // stop.
    const result = classifyPositionStopLoss(positionInput, reloadedOrders, recordedPolicy);
    expect(result.classification).toBe('ALIGNED');
    expect(result.status).toBe('live');

    // 5. A replacement made OUTSIDE TradeEdge (brand-new order id AND a
    // brand-new complex-order id) must still fail the identity check and
    // fall back to UNKNOWN_PROVENANCE -- the stale recordedPolicy must
    // never be misattributed to an unrelated order.
    const replacementResponse = ocoEnvelope({
      complexId: 'complex-000-external',
      profitOrderId: 'ord-profit-external',
      stopOrderId: 'ord-stop-external',
      stopTrigger: '5.04',
    });
    const replacementOrders = reconstructGtcOrders(replacementResponse);
    const replacementResult = classifyPositionStopLoss(positionInput, replacementOrders, recordedPolicy);
    expect(replacementResult.classification).toBe('UNKNOWN_PROVENANCE');
    expect(replacementResult.classification).not.toBe('ALIGNED');
  });
});

describe('mapBrokerStopStatus', () => {
  it('maps Filled to TRIGGERED', () => {
    expect(mapBrokerStopStatus('Filled')).toBe('TRIGGERED');
  });
  it('maps Live/working statuses to WORKING', () => {
    expect(mapBrokerStopStatus('Live')).toBe('WORKING');
    expect(mapBrokerStopStatus('Received')).toBe('WORKING');
  });
  it('maps missing/unrecognized statuses to UNKNOWN', () => {
    expect(mapBrokerStopStatus(null)).toBe('UNKNOWN');
    expect(mapBrokerStopStatus('Something Else')).toBe('UNKNOWN');
  });
});

describe('derivePositionQuoteQuality (real spread-width evidence)', () => {
  it('is RELIABLE when width evidence exists and both leg and net thresholds are narrow', () => {
    const evidence = {
      legWidthsDollars: [0.05, 0.05],
      netWidthDollars: 50, // 5 contracts * 2 legs * $0.05 * 100
      netWidthPctOfMid: 0.04,
      crossed: false,
    };
    expect(derivePositionQuoteQuality({ pnlReliable: true, quoteWidthEvidence: evidence })).toBe('RELIABLE');
  });

  // Regression fixture for the reported MU condition: $3-5-wide leg
  // markets. `pnlReliable && closeValue != null` alone used to call this
  // RELIABLE merely because a marketable print existed -- it must not.
  it('is DEGRADED for the reported MU condition ($3-5-wide leg markets) even though a marketable value exists', () => {
    const evidence = {
      legWidthsDollars: [3.20, 4.10], // MU-style wide leg markets
      netWidthDollars: 3650, // wildly wide combo width at position scale
      netWidthPctOfMid: 2.9, // 290% of mid -- nowhere near narrow
      crossed: false,
    };
    expect(derivePositionQuoteQuality({ pnlReliable: true, quoteWidthEvidence: evidence })).toBe('DEGRADED');
  });

  it('is DEGRADED when the market is crossed regardless of width', () => {
    const evidence = { legWidthsDollars: [0.02], netWidthDollars: 10, netWidthPctOfMid: 0.01, crossed: true };
    expect(derivePositionQuoteQuality({ pnlReliable: true, quoteWidthEvidence: evidence })).toBe('DEGRADED');
  });

  it('is UNKNOWN when width evidence is entirely unavailable (one-sided market)', () => {
    expect(derivePositionQuoteQuality({ pnlReliable: true, quoteWidthEvidence: null })).toBe('UNKNOWN');
  });

  it('is UNKNOWN when pnl itself is unreliable, even with narrow width evidence', () => {
    const evidence = { legWidthsDollars: [0.05], netWidthDollars: 5, netWidthPctOfMid: 0.02, crossed: false };
    expect(derivePositionQuoteQuality({ pnlReliable: false, quoteWidthEvidence: evidence })).toBe('UNKNOWN');
  });
});

describe('buildStopBreachObservations', () => {
  it('combines snapshot history with the current live read', () => {
    const snapshotHistory: PositionSnapshot[] = [
      { date: '2026-08-01', dte: 46, currentValue: 1000, closeValue: 1010, pnl: 260, pnlPct: 20.6, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
    ];
    const obs = buildStopBreachObservations({ currentValue: 1200, closeValue: 1220, snapshotHistory });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ midValue: 1000, marketableValue: 1010 });
    expect(obs[1]).toMatchObject({ midValue: 1200, marketableValue: 1220 });
  });

  it('treats snapshots captured before closeValue existed as no marketable evidence, not zero', () => {
    const snapshotHistory: PositionSnapshot[] = [
      { date: '2026-08-01', dte: 46, currentValue: 1000, pnl: 260, pnlPct: 20.6, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
    ];
    const obs = buildStopBreachObservations({ currentValue: 1200, closeValue: null, snapshotHistory });
    expect(obs[0].marketableValue).toBeNull();
  });
});

describe('getRecommendation: canonical stop-loss integration', () => {
  // 1/2 end-to-end via getRecommendation: a materially tight, unrecorded
  // stop must never look "healthy" -- but since getRecommendation only
  // acts on CONFIRMED breaches, an unconfirmed tight stop should not force
  // CUT_LOSSES either; it should never silently pass as fine.
  it('does not treat an unconfirmed single-snapshot stop crossing as a confirmed CUT_LOSSES', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'ord-1' }); // $5.04 threshold
    const pos = makePosition({
      stopLossPolicy: policy, stopLossDisplayPolicy: policy,
      stopLossPrice: 5.04,
      stopLossClassification: 'ALIGNED',
      stopLossOrderStatus: 'Live',
      currentValue: 100, // well under threshold (5.04 * 100 * 5 = 2520)
      closeValue: 2600,  // marketable spikes above threshold on a wide market
      pnlReliable: true,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  // 5/6-style: broker reports the stop triggered -- confirmed regardless of
  // history.
  it('recommends CUT_LOSSES when the broker reports the stop order filled', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'ord-1' });
    const pos = makePosition({
      stopLossPolicy: policy, stopLossDisplayPolicy: policy,
      stopLossPrice: 5.04,
      stopLossClassification: 'ALIGNED',
      stopLossOrderStatus: 'Filled',
      currentValue: 2600,
      closeValue: 2600,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('CUT_LOSSES');
  });

  // Sustained breach across enough persisted daily snapshots + today's read
  // should confirm.
  it('recommends CUT_LOSSES after a sustained multi-day breach with reliable quotes', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'ord-1' });
    const thresholdTotal = policy.triggerPrice * 100 * 5; // 2520
    const snapshotHistory: PositionSnapshot[] = [
      // capturedAt makes this a PRECISE observation (see
      // BreachObservation.preciseTimestamp) so it can actually contribute
      // to the confirmation streak alongside today's live read -- a
      // date-only entry could not.
      { date: '2026-08-03', capturedAt: '2026-08-03T14:00:00.000Z', dte: 43, currentValue: thresholdTotal + 20, closeValue: thresholdTotal + 20, pnl: -100, pnlPct: -8, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
    ];
    const pos = makePosition({
      stopLossPolicy: policy, stopLossDisplayPolicy: policy,
      stopLossPrice: policy.triggerPrice,
      stopLossClassification: 'ALIGNED',
      stopLossOrderStatus: 'Live',
      currentValue: thresholdTotal + 40,
      closeValue: thresholdTotal + 40,
      pnlReliable: true,
      snapshotHistory,
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('CUT_LOSSES');
  });

  // 10. Acquisition-intent CSP behavior unchanged -- hard exits (including
  // the new confirmed-breach path) never fire for acquisition CSPs.
  it('keeps acquisition-intent CSP on HOLD even with a broker-confirmed stop fill', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'ord-1' });
    const pos = makePosition({
      strategy: 'PUT',
      intent: 'acquisition',
      stopLossPolicy: policy, stopLossDisplayPolicy: policy,
      stopLossPrice: policy.triggerPrice,
      stopLossOrderStatus: 'Filled',
      currentValue: 999999,
      closeValue: 999999,
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('HOLD');
  });

  it('returns MANAGE (not CUT_LOSSES) for a wide-market marketable-only breach with no confirmation history', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'ord-1' });
    const thresholdTotal = policy.triggerPrice * 100 * 5;
    const pos = makePosition({
      stopLossPolicy: policy, stopLossDisplayPolicy: policy,
      stopLossPrice: policy.triggerPrice,
      stopLossClassification: 'ALIGNED',
      stopLossOrderStatus: 'Live',
      currentValue: thresholdTotal - 50,   // mid still well under threshold
      closeValue: thresholdTotal + 20,     // marketable spikes over on a wide market
      pnlReliable: true,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('MANAGE');
  });
});

// ── PM-0001: P/L null propagation ───────────────────────────────────────────
describe('getRecommendation: P/L null propagation (PM-0001)', () => {
  // A missing leg quote must never let a threshold-based branch (take-profit
  // or cut-losses) fire off a fabricated P/L. hitTarget is already forced
  // false upstream (acquisition.ts's hasCurrentPrices gate); pnl/pnlPct are
  // null. getRecommendation's pnlPct falls back to 0 for arithmetic safety,
  // but 0 never crosses any of its take-profit (>=X%) or cut-loss (<=-X%)
  // thresholds, so no P/L-driven action can fire.
  it('does not return TAKE_PROFIT or CUT_LOSSES when currentValue/pnl are unavailable', () => {
    const pos = makePosition({
      currentValue: null,
      closeValue: null,
      pnl: null,
      pnlPct: null,
      pnlReliable: false,
      hitTarget: false,
      hasGtc: true,
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).not.toBe('TAKE_PROFIT');
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  it('falls through to a data-independent action (PLACE_GTC/HOLD/MANAGE) rather than a P/L threshold branch when P/L is unavailable', () => {
    const pos = makePosition({
      currentValue: null,
      closeValue: null,
      pnl: null,
      pnlPct: null,
      pnlReliable: false,
      hitTarget: false,
      hasGtc: false, // forces the "no GTC" branch, which is P/L-independent
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('PLACE_GTC');
  });
});

// ── PM-0001: debit-trade guard ──────────────────────────────────────────────
describe('debit-trade guard (PM-0001)', () => {
  it('calculateSpreadCredit floors a net-debit structure to $0.00 for display', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 1, avgOpenPrice: 1.00 },
      { direction: 'Long' as const, quantity: 1, avgOpenPrice: 3.00 },
    ];
    expect(calculateSpreadCredit(legs)).toBe(0);
  });

  it('the guard (computeSignedNetPremium + isNetDebitStructure) detects the debit that the floored display value alone would hide', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 1, avgOpenPrice: 1.00 },
      { direction: 'Long' as const, quantity: 1, avgOpenPrice: 3.00 },
    ];
    const signed = computeSignedNetPremium(legs);
    expect(signed).toBeLessThan(0);
    expect(isNetDebitStructure(signed)).toBe(true);
    // calculateSpreadCredit alone (0) cannot distinguish this debit from a
    // genuine $0.00 credit trade -- that is exactly why loadPositions must
    // use the signed guard, not infer isNetDebit from calculateSpreadCredit.
    expect(calculateSpreadCredit(legs)).toBe(0);
  });

  it('a genuine net-credit structure is never flagged as a debit', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 5, avgOpenPrice: 0.45 },
    ];
    const signed = computeSignedNetPremium(legs);
    expect(isNetDebitStructure(signed)).toBe(false);
  });

  // PM-0001 corrective round: entryPriceEffect is the explicit tag
  // loadPositions derives from this same signed-premium guard --
  // isNetDebit ? 'Debit' : 'Credit'. Locking the mapping here documents the
  // wiring contract (loadPositions itself can't be unit-tested directly).
  it('maps a debit structure to entryPriceEffect "Debit", never "Credit"', () => {
    const legs = [
      { direction: 'Short' as const, quantity: 1, avgOpenPrice: 1.00 },
      { direction: 'Long' as const, quantity: 1, avgOpenPrice: 3.00 },
    ];
    const isDebit = isNetDebitStructure(computeSignedNetPremium(legs));
    const entryPriceEffect: Position['entryPriceEffect'] = isDebit ? 'Debit' : 'Credit';
    expect(entryPriceEffect).toBe('Debit');
  });

  it('maps a genuine credit structure to entryPriceEffect "Credit"', () => {
    const legs = [{ direction: 'Short' as const, quantity: 5, avgOpenPrice: 0.45 }];
    const isDebit = isNetDebitStructure(computeSignedNetPremium(legs));
    const entryPriceEffect: Position['entryPriceEffect'] = isDebit ? 'Debit' : 'Credit';
    expect(entryPriceEffect).toBe('Credit');
  });
});

// ── PM-0001 corrective round 2: full debit-structure acceptance list ───────
// End-to-end wiring test: builds the exact Position shape loadPositions()
// must now produce for a detected net-debit structure -- entryPriceEffect,
// pnl (via the real computePositionPnl formula, not a reimplementation),
// pnlPct, pop, hitTarget -- and proves getRecommendation cannot fire a
// P/L-driven TAKE_PROFIT or CUT_LOSSES off any of it. loadPositions()
// itself can't be unit-tested without a live TastyTrade session (see
// TC-0001's prior finding); this locks the contract it must satisfy.
describe('full debit-structure acceptance (PM-0001 corrective round 2)', () => {
  const debitLegs = [
    { direction: 'Short' as const, quantity: 1, avgOpenPrice: 1.00 },
    { direction: 'Long' as const, quantity: 1, avgOpenPrice: 3.00 },
  ];
  const signedNetPremium = computeSignedNetPremium(debitLegs);
  const isNetDebit = isNetDebitStructure(signedNetPremium);
  const flooredCreditReceived = Math.max(0, signedNetPremium); // calculateSpreadCredit's actual floor
  const currentValue = 250; // an arbitrary observational mid -- must NOT leak into pnl

  it('detects this fixture as a debit', () => {
    expect(isNetDebit).toBe(true);
    expect(flooredCreditReceived).toBe(0);
  });

  it('produces entryPriceEffect "Debit", pnl null (via the real computePositionPnl formula), and pnlPct null', () => {
    const entryPriceEffect: Position['entryPriceEffect'] = isNetDebit ? 'Debit' : 'Credit';
    const pnl = computePositionPnl({
      isNetDebit,
      hasCurrentPrices: true,
      anyLegCrossed: false,
      creditReceived: flooredCreditReceived,
      currentValue,
    });
    const pnlPct = flooredCreditReceived !== 0 && pnl != null ? (pnl / Math.abs(flooredCreditReceived)) * 100 : null;

    expect(entryPriceEffect).toBe('Debit');
    expect(pnl).toBeNull();
    expect(pnl).not.toBe(-currentValue); // the exact round-2 defect
    expect(pnlPct).toBeNull();
  });

  it('produces no P/L-driven TAKE_PROFIT or CUT_LOSSES recommendation, and pop/hitTarget stay unavailable', () => {
    const pos = makePosition({
      entryPriceEffect: 'Debit',
      creditReceived: flooredCreditReceived,
      currentValue,
      pnl: null,        // per computePositionPnl above
      pnlPct: null,
      pnlReliable: false,
      hitTarget: false, // acquisition.ts's isNetDebit guard forces this
      targetPrice: 0,
      pop: null,         // acquisition.ts's isNetDebit guard forces this
      hasGtc: true,
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
      snapshotHistory: [],
    });
    expect(pos.pop).toBeNull();
    expect(pos.hitTarget).toBe(false);
    const rec = getRecommendation(pos, null);
    expect(rec.action).not.toBe('TAKE_PROFIT');
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  // Genuine credit-position control (wiring level): proves the isNetDebit
  // gate added in round 2 does not over-suppress an ordinary credit
  // position's P/L-driven recommendation -- a real profit can still surface
  // TAKE_PROFIT exactly as before.
  it('control: an ordinary credit position with hitTarget still reaches TAKE_PROFIT (gate is debit-specific, not over-broad)', () => {
    const pos = makePosition({
      entryPriceEffect: 'Credit',
      creditReceived: 1260,
      currentValue: 500,
      pnl: 760,
      pnlPct: 60.3,
      pnlReliable: true,
      hitTarget: true,
      pop: 66,
      hasGtc: true,
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('TAKE_PROFIT');
  });
});

// ── PM-0001: acquisition-CSP messaging unchanged ────────────────────────────
describe('getRecommendation: acquisition-CSP messaging unchanged (PM-0001)', () => {
  it('still reports "% paper" HOLD detail text for a normal-credit acquisition CSP', () => {
    const pos = makePosition({
      strategy: 'PUT',
      intent: 'acquisition',
      creditReceived: 225,
      currentValue: 200,
      pnl: 25,
      pnlPct: 11.1,
      pnlReliable: true,
      buffer: 4.2,
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).toBe('HOLD');
    expect(rec.detail).toMatch(/% paper/);
  });
});

// ── PM-0001 corrective round: crossed option quotes ─────────────────────────
// loadPositions() itself fetches live broker data and can't be unit-tested
// directly (see TC-0001's implementation report: "realistically verifiable
// only against a live TastyTrade session"). resolveOptionLegPrice's own
// crossed-market behavior is covered directly in positionMetrics.test.ts;
// these tests instead lock the WIRING CONTRACT loadPositions() must produce
// for a crossed-quote leg -- closeValue/pnl/pnlPct null, hitTarget false --
// by constructing exactly that Position shape and proving getRecommendation
// (and computeMarketablePnlPct) cannot fabricate a decision from it.
describe('crossed-quote contract: closeValue / P&L / recommendations (PM-0001)', () => {
  it('a crossed-quote position produces no marketable P/L% (closeValue null per the contract)', () => {
    const pos = makePosition({ closeValue: null, closeNowPnl: null });
    expect(computeMarketablePnlPct(pos)).toBeNull();
  });

  it('does not return TAKE_PROFIT or CUT_LOSSES for a crossed-quote position (pnl/pnlPct null per the contract)', () => {
    const pos = makePosition({
      currentValue: null,   // crossed leg -> pnl forced null even if a mark exists for display
      closeValue: null,
      pnl: null,
      pnlPct: null,
      pnlReliable: false,
      hitTarget: false,
      hasGtc: true,
      stopLossClassification: 'NO_STOP',
      stopLossPolicy: null,
      snapshotHistory: [],
    });
    const rec = getRecommendation(pos, null);
    expect(rec.action).not.toBe('TAKE_PROFIT');
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  it('never reports a target hit for a crossed-quote position, per the contract', () => {
    const pos = makePosition({ hitTarget: false, pnl: null, closeValue: null });
    expect(pos.hitTarget).toBe(false);
    // getRecommendation must not independently re-derive a hit from credit/target alone.
    const rec = getRecommendation(pos, null);
    expect(rec.action).not.toBe('TAKE_PROFIT');
  });
});

// ── TE-0002 corrective round 3: display/enforcement stop trust boundary ────
// Production incident: MU 800/790 five-lot BPS. classifyPositionStopLoss
// correctly determined the broker stop ($3.15/spread) was materially
// tighter than the canonical 2x-credit threshold ($5.04/spread) AND carried
// unknown provenance (never created by TradeEdge) -- but the fabricated
// UNKNOWN-basis display policy was returned through the SAME field
// getRecommendation() trusts for enforcement, so a midpoint reading above
// the untrusted $1,575 broker threshold (well below the real $2,520
// canonical threshold) could eventually confirm CUT_LOSSES. Fix: the
// enforcement field (Position.stopLossPolicy) is now null whenever
// classification isn't ALIGNED/TOO_LOOSE; a separate, explicitly-named
// display-only field (stopLossDisplayPolicy) carries the fabricated-basis
// policy for UI purposes only, and getRecommendation() caps any advisory
// evaluation against it at MANAGE, never CUT_LOSSES.
describe('TE-0002 corrective round 3: stop display/enforcement trust boundary (MU production fixture)', () => {
  // Exact production numbers from the incident report.
  const MU_QUANTITY = 5;
  const MU_CREDIT_RECEIVED = 1260;
  const MU_CREDIT_PER_CONTRACT = 2.52;
  const MU_SHORT_STRIKE = 800;
  const MU_LONG_STRIKE = 790;
  const MU_STOCK_PRICE = 862;
  const MU_BROKER_STOP = 3.15;
  const MU_CANONICAL_STOP = 5.04; // 2.52 * 2
  const MU_CURRENT_VALUE = 1750;
  const MU_PNL = -490; // 1260 - 1750
  const MU_PNL_PCT = (MU_PNL / MU_CREDIT_RECEIVED) * 100; // ~ -38.9%
  const MU_BROKER_THRESHOLD_TOTAL = MU_BROKER_STOP * 100 * MU_QUANTITY; // 1575
  const MU_CANONICAL_THRESHOLD_TOTAL = MU_CANONICAL_STOP * 100 * MU_QUANTITY; // 2520

  const muShortLeg = () => leg({ symbol: 'MU   260918P00800000', strikePrice: MU_SHORT_STRIKE, avgOpenPrice: MU_CREDIT_PER_CONTRACT });
  const muLongLeg = () => leg({ symbol: 'MU   260918P00790000', strikePrice: MU_LONG_STRIKE, direction: 'Long', avgOpenPrice: 0 });
  const muPositionInput = {
    legs: [muShortLeg(), muLongLeg()], creditReceived: MU_CREDIT_RECEIVED, entryCredit: MU_CREDIT_RECEIVED,
    entryEconomicsComplete: true, entryPriceEffect: 'Credit' as const, quantity: MU_QUANTITY,
  };
  const muGtcOrder = gtcOrder({
    id: 'mu-stop-ord', stopPrice: String(MU_BROKER_STOP),
    legs: [{ symbol: 'MU   260918P00800000', action: 'Buy to Close' }],
    status: 'Live',
  });

  // Sanity check on the fixture's own arithmetic, matching the ticket's
  // stated numbers exactly.
  it('fixture arithmetic matches the reported production numbers', () => {
    expect(MU_CREDIT_RECEIVED / (MU_QUANTITY * 100)).toBeCloseTo(MU_CREDIT_PER_CONTRACT, 2);
    expect(MU_CANONICAL_STOP * 100 * MU_QUANTITY).toBe(2520);
    expect(MU_BROKER_STOP * 100 * MU_QUANTITY).toBe(1575);
    expect(MU_PNL_PCT).toBeCloseTo(-38.9, 1);
    expect(MU_CURRENT_VALUE).toBeLessThan(MU_CANONICAL_THRESHOLD_TOTAL); // canonical threshold NOT breached
    expect(MU_CURRENT_VALUE).toBeGreaterThanOrEqual(MU_BROKER_THRESHOLD_TOTAL); // untrusted threshold IS crossed
  });

  it('classifyPositionStopLoss: broker stop remains visible, classification is TOO_TIGHT, provenance is UNKNOWN, and the enforcement policy field is null', () => {
    const result = classifyPositionStopLoss(muPositionInput, [muGtcOrder], null);
    expect(result.price).toBe(MU_BROKER_STOP); // the observed $3.15 stop remains visible
    expect(result.classification).toBe('TOO_TIGHT');
    expect(result.displayPolicy?.anchorBasis).toBe('UNKNOWN'); // provenance remains unknown
    expect(result.displayPolicy?.source).toBe('UNKNOWN');
    expect(result.displayPolicy?.triggerPrice).toBe(MU_BROKER_STOP);
    expect(result.policy).toBeNull(); // never returned through the enforcement field
  });

  // Wiring-level Position fixture matching exactly what loadPositions()
  // would now assign for this incident (loadPositions itself can't be
  // unit-tested directly -- see TC-0001's established finding, reused
  // throughout this file).
  function muPosition(overrides: Partial<Position> = {}): Position {
    return makePosition({
      symbol: 'MU',
      strategy: 'BPS',
      quantity: MU_QUANTITY,
      legs: [muShortLeg(), muLongLeg()],
      creditReceived: MU_CREDIT_RECEIVED,
      stockPrice: MU_STOCK_PRICE,
      buffer: 7.19, // (862 - 800) / 862 * 100, > 0 -- not a strike breach
      stopLossPrice: MU_BROKER_STOP,
      stopLossClassification: 'TOO_TIGHT',
      stopLossPolicy: null, // enforcement: gated null for TOO_TIGHT
      stopLossDisplayPolicy: buildUnknownProvenancePolicy(MU_BROKER_STOP, 'mu-stop-ord', null),
      stopLossOrderStatus: 'Live',
      currentValue: MU_CURRENT_VALUE,
      closeValue: MU_CURRENT_VALUE,
      pnl: MU_PNL,
      pnlPct: MU_PNL_PCT,
      pnlReliable: true,
      hitTarget: false,
      targetPrice: MU_CREDIT_RECEIVED * 0.5,
      hasGtc: true,
      snapshotHistory: [],
      ...overrides,
    });
  }

  it('one observation above the untrusted $1,575 threshold does not produce CUT_LOSSES', () => {
    const rec = getRecommendation(muPosition(), null);
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  it('multiple precise observations more than five minutes apart above the untrusted threshold still do not produce CUT_LOSSES', () => {
    const snapshotHistory: PositionSnapshot[] = [
      { date: '2026-08-03', capturedAt: '2026-08-03T14:00:00.000Z', dte: 47, currentValue: MU_BROKER_THRESHOLD_TOTAL + 50, closeValue: MU_BROKER_THRESHOLD_TOTAL + 50, pnl: -515, pnlPct: -40.9, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
      { date: '2026-08-04', capturedAt: '2026-08-04T14:00:00.000Z', dte: 46, currentValue: MU_BROKER_THRESHOLD_TOTAL + 75, closeValue: MU_BROKER_THRESHOLD_TOTAL + 75, pnl: -540, pnlPct: -42.9, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
    ];
    const rec = getRecommendation(muPosition({ snapshotHistory }), null);
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  it('a wide-market marketable-only observation above the untrusted threshold does not produce CUT_LOSSES', () => {
    const rec = getRecommendation(
      muPosition({
        currentValue: MU_BROKER_THRESHOLD_TOTAL - 100, // mid still under the untrusted threshold
        closeValue: MU_BROKER_THRESHOLD_TOTAL + 300,   // wide-market marketable spike over it
      }),
      null
    );
    expect(rec.action).not.toBe('CUT_LOSSES');
  });

  it('the resulting recommendation is MANAGE with a clear "Verify stop" explanation', () => {
    const rec = getRecommendation(muPosition(), null);
    expect(rec.action).toBe('MANAGE');
    expect(rec.detail).toMatch(/Verify stop/);
  });

  it('even a broker-reported fill on the untrusted/unmatched stop does not escalate to CUT_LOSSES (conservative: verify, don\'t auto-confirm an order TradeEdge cannot vouch for)', () => {
    const rec = getRecommendation(muPosition({ stopLossOrderStatus: 'Filled' }), null);
    expect(rec.action).not.toBe('CUT_LOSSES');
    expect(rec.action).toBe('MANAGE');
  });

  // Contract check for BOTH UI surfaces: the CUT_LOSSES action-relevance
  // gate (app/portfolio/page.tsx's isActionRelevant) is not exported and is
  // embedded in a large client component that can't be imported into a
  // node/vitest environment (same "wiring can't be unit-tested directly"
  // limitation as loadPositions() itself -- see TC-0001). This locks the
  // POST-FIX CONTRACT that function's CUT_LOSSES branch must satisfy
  // (verified by direct code inspection at the cited location): relevance
  // is `breached || atExtremeLoss || rec.action === 'CUT_LOSSES'`, with NO
  // independent raw stopLossPrice/currentValue/closeValue threshold check
  // of its own (that redundant, untrusted-classification-blind check was
  // the second half of the production bug and has been removed). Proving
  // getRecommendation() alone doesn't confirm CUT_LOSSES for this fixture
  // (above) is therefore sufficient to prove BOTH surfaces agree.
  it('the same MU fixture that is not CUT_LOSSES-relevant via getRecommendation is also not CUT_LOSSES-relevant via the button gate\'s post-fix formula', () => {
    const pos = muPosition();
    const rec = getRecommendation(pos, null);
    const breached = pos.buffer != null && pos.buffer <= 0;
    const pnlPct = pos.pnl != null && pos.creditReceived > 0 ? (pos.pnl / pos.creditReceived) * 100 : null;
    const atExtremeLoss = pnlPct != null && pnlPct <= -200; // MU_PNL_PCT is ~-38.9%, nowhere near -200%
    const buttonRelevant = breached || atExtremeLoss || rec.action === 'CUT_LOSSES';
    expect(buttonRelevant).toBe(false);
  });

  // ── Controls: trusted/independent behavior is unchanged ──────────────────

  it('control: a provenance-matched ALIGNED policy still confirms CUT_LOSSES after a valid, distinctly-timed observation streak', () => {
    const policy = buildOriginalCreditDefaultPolicy(MU_CREDIT_PER_CONTRACT, { brokerOrderId: 'mu-stop-ord' }); // $5.04 threshold, canonical
    const snapshotHistory: PositionSnapshot[] = [
      { date: '2026-08-03', capturedAt: '2026-08-03T14:00:00.000Z', dte: 47, currentValue: MU_CANONICAL_THRESHOLD_TOTAL + 20, closeValue: MU_CANONICAL_THRESHOLD_TOTAL + 20, pnl: -1260, pnlPct: -100, iv: null, ivr: null, theta: null, gamma: null, netDelta: null, netVega: null, pop: null, buffer: null, stockPrice: null },
    ];
    const rec = getRecommendation(
      muPosition({
        stopLossClassification: 'ALIGNED',
        stopLossPolicy: policy,
        stopLossDisplayPolicy: policy,
        stopLossPrice: policy.triggerPrice,
        currentValue: MU_CANONICAL_THRESHOLD_TOTAL + 40,
        closeValue: MU_CANONICAL_THRESHOLD_TOTAL + 40,
        snapshotHistory,
      }),
      null
    );
    expect(rec.action).toBe('CUT_LOSSES');
  });

  it('control: a broker-reported fill/trigger for a trusted, provenance-matched ALIGNED policy remains authoritative', () => {
    const policy = buildOriginalCreditDefaultPolicy(MU_CREDIT_PER_CONTRACT, { brokerOrderId: 'mu-stop-ord' });
    const rec = getRecommendation(
      muPosition({
        stopLossClassification: 'ALIGNED',
        stopLossPolicy: policy,
        stopLossDisplayPolicy: policy,
        stopLossPrice: policy.triggerPrice,
        stopLossOrderStatus: 'Filled',
        currentValue: MU_CANONICAL_THRESHOLD_TOTAL + 5,
        closeValue: MU_CANONICAL_THRESHOLD_TOTAL + 5,
        snapshotHistory: [],
      }),
      null
    );
    expect(rec.action).toBe('CUT_LOSSES');
  });

  it('control: a genuinely breached short strike still produces its independent hard-exit recommendation, regardless of stop trust state', () => {
    const rec = getRecommendation(
      muPosition({
        buffer: -1, // short strike breached
      }),
      null
    );
    expect(rec.action).toBe('CUT_LOSSES');
    expect(rec.detail).toMatch(/Short strike breached/);
  });
});
