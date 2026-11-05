// lib/exit-walk/__tests__/workingClose.test.ts
//
// EXIT-WALK-CANCEL-0001: the walk may cancel a PLAIN working GTC close and nothing else; every doubt cancels nothing.

import { describe, expect, it, vi } from 'vitest';
import type { StopAssessment, StopOrderEvidence } from '@/lib/portfolio/stopLossPolicy';
import type { Position } from '@/lib/portfolio-data/types';
import { buildRestoreCloseOrder, checkExitWalkEligibility } from '../closeOrder';
import { cancelWorkingCloseForWalk, LIVE_BRACKET_WALK_REFUSAL } from '../workingClose';

const SYM = 'TQQQ  261204P00044000';
const profit = (o: Record<string, unknown> = {}) => ({ id: 'T1', 'order-type': 'Limit', status: 'Live', price: '1.06', legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }], ...o });
const stop = (o: Record<string, unknown> = {}) => ({ id: 'S1', 'order-type': 'Stop', status: 'Live', 'stop-trigger': '4.24', legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }], ...o });
const envelope = (orders: unknown[]) => ({ id: '8688606', type: 'OCO', orders });
const stopEvidence = (o: Partial<StopOrderEvidence> = {}): StopOrderEvidence => ({
  accountNumber: 'A', orderId: 'S1', complexOrderId: '8688606', sourceEndpoint: '/complex-orders', status: 'Live',
  orderType: 'Stop', timeInForce: 'GTC', priceEffect: null, triggerPrice: 4.24, limitPrice: null,
  legs: [{ symbol: SYM, action: 'Buy to Close', quantity: 1, ratio: 1 }], ...o,
});
const assessment = (order: StopOrderEvidence) => ({ evidenceComplete: true, matchedOrderId: order.orderId, rawEvidence: { orders: [order] } }) as unknown as StopAssessment;

const input = (o: Record<string, unknown> = {}) => ({ orderId: 'T1', complexOrderId: null as string | null, originalPrice: 1.06, stopAssessment: null as StopAssessment | null, legSymbols: [SYM], ...o });
const deps = (live: unknown = null, cancel = vi.fn().mockResolvedValue({})) => ({ readComplexOrder: vi.fn().mockResolvedValue(live), cancel });

describe('cancelWorkingCloseForWalk', () => {
  it('cancels a simple working close through /orders and returns the price to put back', async () => {
    const d = deps();
    await expect(cancelWorkingCloseForWalk(input(), d)).resolves.toEqual({ originalPrice: 1.06 });
    expect(d.cancel).toHaveBeenCalledWith('T1');
    expect(d.readComplexOrder).not.toHaveBeenCalled();
  });

  it('cancels a leftover envelope\'s plain order after a live re-read proves no other order can work', async () => {
    const d = deps(envelope([profit(), stop({ status: 'Cancelled' })]));
    await expect(cancelWorkingCloseForWalk(input({ complexOrderId: '8688606', stopAssessment: assessment(stopEvidence({ status: 'Cancelled' })) }), d)).resolves.toEqual({ originalPrice: 1.06 });
    expect(d.readComplexOrder).toHaveBeenCalledWith('8688606');
    expect(d.cancel).toHaveBeenCalledWith('T1');
  });

  it('falls back to the leftover envelope\'s endpoint only if the plain cancel fails', async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error('belongs to a complex order')).mockResolvedValueOnce({});
    const d = deps(envelope([profit(), stop({ status: 'Cancelled' })]), cancel);
    await cancelWorkingCloseForWalk(input({ complexOrderId: '8688606' }), d);
    expect(cancel).toHaveBeenNthCalledWith(1, 'T1');
    expect(cancel).toHaveBeenNthCalledWith(2, 'T1', '8688606');
  });

  it('refuses a plain failure when no leftover envelope exists (no fallback)', async () => {
    const d = deps(null, vi.fn().mockRejectedValue(new Error('boom')));
    await expect(cancelWorkingCloseForWalk(input(), d)).rejects.toThrow('boom');
    expect(d.cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a live bracket whose stop TradeEdge can match, and cancels nothing', async () => {
    const d = deps(envelope([profit(), stop()]));
    await expect(cancelWorkingCloseForWalk(input({ complexOrderId: '8688606', stopAssessment: assessment(stopEvidence()) }), d)).rejects.toThrow(LIVE_BRACKET_WALK_REFUSAL);
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('refuses a live bracket TradeEdge cannot match either (the live re-read shows a working stop)', async () => {
    const d = deps(envelope([profit(), stop()]));
    await expect(cancelWorkingCloseForWalk(input({ complexOrderId: '8688606', stopAssessment: null }), d)).rejects.toThrow(LIVE_BRACKET_WALK_REFUSAL);
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('refuses when the live re-read fails', async () => {
    const d = { readComplexOrder: vi.fn().mockRejectedValue(new Error('network')), cancel: vi.fn() };
    await expect(cancelWorkingCloseForWalk(input({ complexOrderId: '8688606' }), d)).rejects.toThrow(LIVE_BRACKET_WALK_REFUSAL);
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it.each([[null], [0], [Number.NaN], [-1]])('refuses without a usable original price (%s), so it can always be put back', async price => {
    const d = deps();
    await expect(cancelWorkingCloseForWalk(input({ originalPrice: price }), d)).rejects.toThrow('could not be put back');
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('refuses without an order id', async () => {
    const d = deps();
    await expect(cancelWorkingCloseForWalk(input({ orderId: null }), d)).rejects.toThrow('Nothing was cancelled');
    expect(d.cancel).not.toHaveBeenCalled();
  });
});

describe('walk eligibility with a working close', () => {
  const clean = {
    structureAmbiguous: false, structureBlockMessage: undefined, identity: { quantity: 1 }, entryPriceEffect: 'Credit',
    hasGtc: true, legs: [{ symbol: SYM }], accountNumber: 'A',
  } as unknown as Pick<Position, 'structureAmbiguous' | 'structureBlockMessage' | 'identity' | 'entryPriceEffect' | 'hasGtc' | 'legs' | 'accountNumber'>;
  const NOW = Date.parse('2026-11-05T19:00:00Z'); // Thu 14:00 ET

  it('still refuses by default', () => expect(checkExitWalkEligibility(clean, [], NOW)).toMatchObject({ ok: false, reason: 'working_order' }));
  it('allows it, flagged, when the panel opts in', () => expect(checkExitWalkEligibility(clean, [], NOW, { allowWorkingClose: true })).toMatchObject({ ok: true, workingClose: true }));
  it('reports no working close when there is none', () => expect(checkExitWalkEligibility({ ...clean, hasGtc: false }, [], NOW, { allowWorkingClose: true })).toMatchObject({ ok: true, workingClose: false }));
  it('a pending entry order on the same contracts still refuses even when opted in', () => {
    const pending = [{ accountNumber: 'A', legs: [{ symbol: SYM }] }] as any;
    expect(checkExitWalkEligibility(clean, pending, NOW, { allowWorkingClose: true })).toMatchObject({ ok: false, reason: 'working_order' });
  });
});

describe('buildRestoreCloseOrder', () => {
  const pos = { symbol: 'TQQQ', legs: [{ symbol: SYM, direction: 'Short', quantity: 1 }] } as unknown as Pick<Position, 'symbol' | 'legs'>;
  it('puts back the same close as a GTC limit at the original price', () => {
    expect(buildRestoreCloseOrder(pos, 1.06, 'buy')).toEqual({
      'order-type': 'Limit', 'time-in-force': 'GTC', price: '1.06', 'price-effect': 'Debit',
      legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close', 'instrument-type': 'Equity Option' }],
    });
  });
  it('a debit-opened position puts back a credit sell', () => {
    const long = { symbol: 'MRNA', legs: [{ symbol: 'MRNA  261120P00140000', direction: 'Long', quantity: 2 }] } as unknown as Pick<Position, 'symbol' | 'legs'>;
    expect(buildRestoreCloseOrder(long, 8.5, 'sell')).toMatchObject({ 'time-in-force': 'GTC', price: '8.50', 'price-effect': 'Credit' });
  });
});
