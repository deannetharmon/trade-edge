// lib/portfolio/__tests__/complexEnvelope.test.ts
//
// GTC-STALE-COMPLEX-0001: a leftover TastyTrade envelope must not make a plain working close look like a bracket,
// and any doubt must keep it a bracket (fail closed).

import { describe, expect, it } from 'vitest';
import { fetchGtcOrders } from '@/lib/portfolio-data/acquisition';
import { envelopeIsLiveBracket, isDeadOrderStatus, staleEnvelopeVerdict } from '../complexEnvelope';

const SYM = 'TQQQ  261204P00044000';
const profit = (o: Record<string, unknown> = {}) => ({
  id: 'T1', 'order-type': 'Limit', status: 'Live', 'time-in-force': 'GTC', price: '1.06', 'price-effect': 'Debit',
  legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }], ...o,
});
const stop = (o: Record<string, unknown> = {}) => ({
  id: 'S1', 'order-type': 'Stop', status: 'Live', 'time-in-force': 'GTC', 'stop-trigger': '4.24',
  legs: [{ symbol: SYM, quantity: 1, action: 'Buy to Close' }], ...o,
});
const envelope = (orders: unknown[], extra: Record<string, unknown> = {}) => ({ id: '8688606', type: 'OCO', orders, ...extra });
const known = (o: Record<string, unknown> = {}) => ({ orderId: 'S9', status: 'Live', orderType: 'Stop', legs: [{ symbol: SYM }], ...o });

describe('isDeadOrderStatus', () => {
  it.each(['Cancelled', 'Filled', 'Expired', 'Rejected', 'Removed', 'Partially Removed'])('%s is dead', s => expect(isDeadOrderStatus(s)).toBe(true));
  it.each(['Live', 'Received', 'Routed', 'In Flight', 'Contingent', 'Cancel Requested', 'Replace Requested', '', null, undefined])('%s is treated as alive (fail closed)', s => expect(isDeadOrderStatus(s)).toBe(false));
});

describe('envelopeIsLiveBracket', () => {
  it('a profit leg with a live stop is a bracket', () => expect(envelopeIsLiveBracket(envelope([profit(), stop()]))).toBe(true));
  it('a profit leg whose stop was cancelled is NOT a bracket (the TQQQ case)', () => expect(envelopeIsLiveBracket(envelope([profit(), stop({ status: 'Cancelled' })]))).toBe(false));
  it('an unknown or missing sibling status keeps it a bracket', () => expect(envelopeIsLiveBracket(envelope([profit(), stop({ status: undefined })]))).toBe(true));
  it('a trigger order that can still work counts as a second live order', () => expect(envelopeIsLiveBracket(envelope([profit()], { 'trigger-order': stop({ id: 'X', status: 'Contingent' }) }))).toBe(true));
  it('an envelope with no readable orders stays a bracket', () => { expect(envelopeIsLiveBracket({ id: '1' })).toBe(true); expect(envelopeIsLiveBracket(null)).toBe(true); });
});

describe('staleEnvelopeVerdict', () => {
  const base = { targetOrderId: 'T1', positionSymbols: [SYM], knownOrders: [] as ReturnType<typeof known>[] };
  const dead = envelope([profit(), stop({ status: 'Cancelled' })]);

  it('treats the order as plain only on positive proof', () => expect(staleEnvelopeVerdict({ ...base, liveEnvelope: dead })).toEqual({ ok: true }));
  it('refuses when the live re-read failed', () => expect(staleEnvelopeVerdict({ ...base, liveEnvelope: null })).toMatchObject({ ok: false }));
  it('refuses when a sibling can still work', () => expect(staleEnvelopeVerdict({ ...base, liveEnvelope: envelope([profit(), stop()]) })).toMatchObject({ ok: false }));
  it('refuses when the sibling status is unknown', () => expect(staleEnvelopeVerdict({ ...base, liveEnvelope: envelope([profit(), stop({ status: undefined })]) })).toMatchObject({ ok: false }));
  it('refuses when the target is not in the envelope', () => expect(staleEnvelopeVerdict({ ...base, targetOrderId: 'ZZ', liveEnvelope: dead })).toMatchObject({ ok: false }));
  it('refuses when the target itself is no longer working', () => expect(staleEnvelopeVerdict({ ...base, liveEnvelope: envelope([profit({ status: 'Filled' }), stop({ status: 'Cancelled' })]) })).toMatchObject({ ok: false }));
  it('refuses when there is no target id', () => expect(staleEnvelopeVerdict({ ...base, targetOrderId: null, liveEnvelope: dead })).toMatchObject({ ok: false }));
  it('refuses when a standalone stop is still working on the same contract', () => {
    expect(staleEnvelopeVerdict({ ...base, liveEnvelope: dead, knownOrders: [known()] })).toMatchObject({ ok: false });
  });
  it('ignores a dead standalone stop, a stop on another contract and the target itself', () => {
    expect(staleEnvelopeVerdict({
      ...base, liveEnvelope: dead,
      knownOrders: [known({ status: 'Cancelled' }), known({ orderId: 'S8', legs: [{ symbol: 'GGLL  261120P00075000' }] }), known({ orderId: 'T1', orderType: 'Stop Limit' })],
    })).toEqual({ ok: true });
  });
  it('matches symbols regardless of OCC padding', () => {
    expect(staleEnvelopeVerdict({ ...base, liveEnvelope: dead, positionSymbols: ['TQQQ 261204P00044000'], knownOrders: [known({ legs: [{ symbol: 'TQQQ  261204P00044000' }] })] })).toMatchObject({ ok: false });
  });
});

describe('fetchGtcOrders: complex id only for a live bracket', () => {
  const live = (o: Record<string, unknown> = {}) => profit({ 'account-number': 'A', ...o });
  const run = (rawComplexOrders: any[]) => fetchGtcOrders('A', 'tok', { rawLiveOrders: [live()], rawComplexOrders });

  it('a live OCO keeps its complex id on the profit leg', async () => {
    const orders = await run([envelope([profit(), stop()])]);
    expect(orders.find(o => o.id === 'T1')?.complexOrderId).toBe('8688606');
  });
  it('a leftover envelope (stop cancelled) gives the profit leg no complex id', async () => {
    const orders = await run([envelope([profit(), stop({ status: 'Cancelled' })])]);
    expect(orders.find(o => o.id === 'T1')?.complexOrderId).toBeUndefined();
  });
  it('an envelope with an unknown sibling status still counts as a bracket', async () => {
    const orders = await run([envelope([profit(), stop({ status: undefined })])]);
    expect(orders.find(o => o.id === 'T1')?.complexOrderId).toBe('8688606');
  });
});
