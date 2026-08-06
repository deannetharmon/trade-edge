import { describe, expect, it } from 'vitest';
import { classifyPositionStopLoss, getRecommendation, mapBrokerStopStatus, derivePositionQuoteQuality, buildStopBreachObservations, resolveOcoStopOrderId, collectRawOrders, mapGtcOrder } from '../acquisition';
import type { Position, PositionLeg, GtcOrder, PositionSnapshot } from '../types';
import { buildOriginalCreditDefaultPolicy, buildCurrentValueAnchoredPolicy } from '@/lib/portfolio/stopLossPolicy';

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
    stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null,
    quoteWidthEvidence: null,
    stockPrice: 110,
    buffer: 13.6,
    theta: 0.5,
    gamma: -0.02,
    earningsDate: null,
    ...overrides,
  };
}

describe('classifyPositionStopLoss (wiring)', () => {
  const positionInput = { legs: [leg(), leg({ direction: 'Long', symbol: 'MU   260918P00090000' })], creditReceived: 1260, quantity: 5 };

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
  it('resolves an externally created stop with no TradeEdge metadata to an UNKNOWN-basis display policy', () => {
    const order = gtcOrder({ id: 'ord-3', stopPrice: '5.00' });
    const result = classifyPositionStopLoss(positionInput, [order], null);
    expect(result.policy?.anchorBasis).toBe('UNKNOWN');
    expect(result.policy?.source).toBe('UNKNOWN');
  });

  it('does not misattribute a recorded policy whose brokerOrderId no longer matches the live order', () => {
    const stalePolicy = buildOriginalCreditDefaultPolicy(2.52, { brokerOrderId: 'old-order-id' });
    const order = gtcOrder({ id: 'new-order-id', stopPrice: '3.15' });
    const result = classifyPositionStopLoss(positionInput, [order], stalePolicy);
    expect(result.classification).not.toBe('ALIGNED');
    expect(result.policy?.brokerOrderId).not.toBe('old-order-id');
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
  const positionInput = { legs: [leg(), leg({ direction: 'Long', symbol: 'MU   260918P00090000' })], creditReceived: 1260, quantity: 5 };

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
      stopLossPolicy: policy,
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
      stopLossPolicy: policy,
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
      stopLossPolicy: policy,
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
      stopLossPolicy: policy,
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
      stopLossPolicy: policy,
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
