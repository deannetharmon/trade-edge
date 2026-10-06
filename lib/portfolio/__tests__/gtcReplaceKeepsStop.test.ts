// lib/portfolio/__tests__/gtcReplaceKeepsStop.test.ts

import { describe, expect, it, vi } from 'vitest';
import type { StopAssessment, StopLossPolicy, StopOrderEvidence } from '@/lib/portfolio/stopLossPolicy';
import {
  bracketCloseTimeInForce, buildExactOcoBody, buildExactStopBody, cancelExistingGtcForReplacement, keptStopPolicy, liveStopRefusal,
  PAIRED_LEG_REFUSAL_PREFIX, resolvePairedLeg, restoreOriginalGtcIfNeeded, stopCoverageRefusal, submitAfterBrokerDryRun,
  type ReconstructablePairedLeg,
} from '../existingGtcReplacement';

const SYM = 'GGLL  261016P00096000';
const stopEvidence = (o: Partial<StopOrderEvidence> = {}): StopOrderEvidence => ({
  accountNumber: 'A', orderId: 'S1', complexOrderId: '8688606', sourceEndpoint: '/complex-orders', status: 'Live',
  orderType: 'Stop', timeInForce: 'GTC', priceEffect: null, triggerPrice: 3.5, limitPrice: null,
  legs: [{ symbol: SYM, action: 'Buy to Close', quantity: 1, ratio: 1 }], ...o,
});
const assessment = (order: StopOrderEvidence, o: Partial<StopAssessment> = {}) => ({
  evidenceComplete: true, matchedOrderId: order.orderId, rawEvidence: { orders: [order] }, ...o,
} as unknown as StopAssessment);
const closeLegs = [{ 'instrument-type': 'Equity Option', symbol: SYM, quantity: 1, action: 'Buy to Close' }];
const target = (tif: string) => ({ 'order-type': 'Limit', 'time-in-force': tif, price: '1.40', 'price-effect': 'Debit', legs: closeLegs });
const stopMarket: ReconstructablePairedLeg = {
  orderId: 'S1', orderType: 'Stop', timeInForce: 'GTC', triggerPrice: 3.5, limitPrice: null, priceEffect: null,
  legs: [{ symbol: SYM, action: 'Buy to Close', quantity: 1, ratio: 1 }],
};
const liveBracket = (stop: Record<string, unknown> = {}) => ({
  id: '8688606', type: 'OCO',
  orders: [
    { id: 'T1', 'order-type': 'Limit', status: 'Live', price: '1.40', legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }] },
    { id: 'S1', 'order-type': 'Stop', status: 'Live', 'stop-trigger': '3.50', legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }], ...stop },
  ],
});

describe('GTC-REPLACE-0001: paired leg resolution', () => {
  it('a stop-market resolves without a limit price (the GGLL case)', () => {
    const r = resolvePairedLeg(assessment(stopEvidence()), '8688606');
    expect(r).toMatchObject({ ok: true, leg: { orderType: 'Stop', triggerPrice: 3.5, limitPrice: null, priceEffect: null } });
  });

  it('a Stop Limit resolves with its limit and price effect (unchanged)', () => {
    const r = resolvePairedLeg(assessment(stopEvidence({ orderType: 'Stop Limit', limitPrice: 3.85, priceEffect: 'Debit' })), '8688606');
    expect(r).toMatchObject({ ok: true, leg: { orderType: 'Stop Limit', limitPrice: 3.85, priceEffect: 'Debit' } });
  });

  it.each([
    ['missing trigger', stopEvidence({ triggerPrice: null }), 'missing its trigger'],
    ['missing legs', stopEvidence({ legs: [] }), 'missing its legs'],
    ['multi-leg stop-market', stopEvidence({ legs: [{ symbol: SYM, action: 'Buy to Close', quantity: 1, ratio: 1 }, { symbol: 'GGLL  261016P00090000', action: 'Sell to Close', quantity: 1, ratio: 1 }] }), 'multi-leg stop-market'],
    ['unsupported type', stopEvidence({ orderType: 'Market' }), 'unsupported order type'],
    ['Stop Limit with no limit', stopEvidence({ orderType: 'Stop Limit', limitPrice: null, priceEffect: 'Debit' }), 'no limit price'],
    ['other bracket', stopEvidence({ complexOrderId: '999' }), 'not part of this bracket'],
  ])('refuses with a named reason: %s', (_name, ev, text) => {
    const r = resolvePairedLeg(assessment(ev), '8688606');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason.startsWith(PAIRED_LEG_REFUSAL_PREFIX)).toBe(true); expect(r.reason).toContain(text); }
  });

  it('the named reason reaches the trader and nothing is cancelled', async () => {
    const cancel = vi.fn();
    const r = resolvePairedLeg(assessment(stopEvidence({ triggerPrice: null })), '8688606');
    await expect(cancelExistingGtcForReplacement({
      hasGtc: true, confirmed: true, orderId: 'T1', complexOrderId: '8688606', originalPrice: 1.4,
      pairedLeg: null, pairedLegRefusal: r.ok ? null : r.reason,
    }, cancel)).rejects.toThrow('missing its trigger');
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('GTC-REPLACE-0001: exact rebuild', () => {
  it('stop-market is rebuilt as stop-market: no price, no price effect', () => {
    const body = buildExactStopBody(stopMarket, closeLegs);
    expect(body).toEqual({ 'order-type': 'Stop', 'time-in-force': 'GTC', 'stop-trigger': '3.50', legs: closeLegs });
    expect(body).not.toHaveProperty('price');
  });

  it('Stop Limit keeps its own limit (never re-derived)', () => {
    const body = buildExactStopBody({ ...stopMarket, orderType: 'Stop Limit', limitPrice: 3.85, priceEffect: 'Debit' }, closeLegs);
    expect(body).toMatchObject({ 'order-type': 'Stop Limit', 'stop-trigger': '3.50', price: '3.85', 'price-effect': 'Debit' });
  });

  it.each(['Day', 'GTC'])('replacement OCO: trader close (%s) + original stop exact', tif => {
    const oco = buildExactOcoBody(target(tif), stopMarket);
    expect(oco.type).toBe('OCO');
    expect(oco.orders[0]).toMatchObject({ 'order-type': 'Limit', 'time-in-force': tif, price: '1.40' });
    expect(oco.orders[1]).toEqual(buildExactStopBody(stopMarket, closeLegs));
  });

  it('stop quantity must equal close quantity', () => {
    expect(stopCoverageRefusal(stopMarket, closeLegs)).toBeNull();
    expect(stopCoverageRefusal({ ...stopMarket, legs: [{ ...stopMarket.legs[0], quantity: 2 }] }, closeLegs)).toContain('does not cover exactly');
  });
});

describe('GTC-REPLACE-0001: live re-read before cancel (Ian)', () => {
  it('unchanged and working: proceed', () => {
    expect(liveStopRefusal(liveBracket(), stopMarket)).toBeNull();
  });

  it('changed since load (trigger moved in TastyTrade): refuse', () => {
    expect(liveStopRefusal(liveBracket({ 'stop-trigger': '4.00' }), stopMarket)).toContain('changed in TastyTrade');
  });

  it.each(['Filled', 'Cancelled', 'Rejected'])('stop no longer working (%s): refuse, never rebuild it', status => {
    expect(liveStopRefusal(liveBracket({ status }), stopMarket)).toContain('no longer working');
  });

  it('stop missing from the live record: refuse', () => {
    expect(liveStopRefusal({ orders: [] }, stopMarket)).toContain('not found');
  });
});

describe('GTC-REPLACE-0001: dry run after cancel, restore on rejection', () => {
  it('dry-run rejected: nothing submitted, the original bracket is restored exactly', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const restore = vi.fn().mockResolvedValue('restored');
    const ctx = await cancelExistingGtcForReplacement({ hasGtc: true, confirmed: true, orderId: 'T1', complexOrderId: '8688606', originalPrice: 1.4, pairedLeg: stopMarket }, cancel);
    let replacementSubmitted = false;
    await expect(submitAfterBrokerDryRun(buildExactOcoBody(target('Day'), stopMarket), {
      dryRun: async () => ({ valid: false, errors: ['preflight failed'] }),
      submit: async b => { submit(b); replacementSubmitted = true; return 'x'; },
    })).rejects.toThrow('rejected the replacement in its dry run: preflight failed');
    expect(submit).not.toHaveBeenCalled();
    await restoreOriginalGtcIfNeeded({ ...ctx, replacementSubmitted }, restore);
    expect(restore).toHaveBeenCalledWith(1.4, stopMarket);
    const restoredOco = buildExactOcoBody(target('GTC'), restore.mock.calls[0][1]);
    expect(restoredOco.orders[1]['order-type']).toBe('Stop'); // type unchanged
  });

  it('dry-run accepted: submitted once', async () => {
    const submit = vi.fn().mockResolvedValue('OCO-2');
    await expect(submitAfterBrokerDryRun({}, { dryRun: async () => ({ valid: true, errors: [] }), submit })).resolves.toBe('OCO-2');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('submit failure after cancel: restore runs (replacement not submitted)', async () => {
    const restore = vi.fn().mockResolvedValue('ok');
    await expect(submitAfterBrokerDryRun({}, { dryRun: async () => ({ valid: true, errors: [] }), submit: async () => { throw new Error('broker 500'); } })).rejects.toThrow('broker 500');
    await restoreOriginalGtcIfNeeded({ cancelled: true, replacementSubmitted: false, originalPrice: 1.4, pairedLeg: stopMarket }, restore);
    expect(restore).toHaveBeenCalledWith(1.4, stopMarket);
  });
});

describe('GTC-REPLACE-0001: kept stop identity', () => {
  it('the recorded policy is re-pointed at the new stop ids; no policy stays unrecorded', () => {
    const policy = { triggerPrice: 3.5, brokerOrderId: 'S1', complexOrderId: '8688606' } as StopLossPolicy;
    expect(keptStopPolicy(policy, { complexOrderId: '9000', stopOrderId: 'S9' })).toMatchObject({ triggerPrice: 3.5, brokerOrderId: 'S9', complexOrderId: '9000' });
    expect(keptStopPolicy(null, { complexOrderId: '9000', stopOrderId: 'S9' })).toBeNull();
  });
});

describe('GTC-REPLACE-0001: Day close inside a bracket (Ian)', () => {
  it('a Day close replacing a bracket goes in as GTC, and the trader is told', () => {
    expect(bracketCloseTimeInForce('Day')).toEqual({ timeInForce: 'GTC', promotedFromDay: true });
    expect(bracketCloseTimeInForce('GTC')).toEqual({ timeInForce: 'GTC', promotedFromDay: false });
    const oco = buildExactOcoBody(target(bracketCloseTimeInForce('Day').timeInForce), stopMarket);
    expect(oco.orders[0]['time-in-force']).toBe('GTC');
    expect(oco.orders[1]['time-in-force']).toBe('GTC');
  });
});
