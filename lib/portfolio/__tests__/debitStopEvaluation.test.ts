import { describe, expect, it } from 'vitest';
import { buildDebitStopPolicy } from '../stopLossPolicy';
import { evaluateDebitStop } from '../debitStopEvaluation';
import type { GtcOrder } from '@/lib/portfolio-data/types';

const NOW = new Date('2026-09-07T16:00:00.000Z');
const OCC = 'AAPL  270117C00200000';

function position(overrides: Record<string, unknown> = {}) {
  return {
    accountNumber: 'ABC123', quantity: 1, structureAmbiguous: false,
    entryPriceEffect: 'Debit' as const, entryEconomicsComplete: true, entryCredit: 1000,
    legs: [{ symbol: OCC, optionType: 'C' as const, strikePrice: 200, direction: 'Long' as const, quantity: 1, avgOpenPrice: 10, currentPrice: 9 }],
    identity: { structureType: 'NAKED', contractMultiplier: 100 },
    ...overrides,
  } as any;
}

function order(overrides: Partial<GtcOrder> = {}): GtcOrder {
  return {
    id: 'stop-1', complexOrderId: null, accountNumber: 'ABC123', sourceEndpoint: '/orders/live',
    price: '7.50', stopPrice: '8.00', orderType: 'Stop Limit', timeInForce: 'GTC', status: 'Live', priceEffect: 'Credit',
    legs: [{ symbol: OCC, action: 'Sell to Close', quantity: 1, ratio: 1 }],
    ...overrides,
  };
}

const complete = { liveOrdersAvailable: true, complexOrdersAvailable: true };
const quote = { executableBid: 9, ask: 9.20, quoteTime: '2026-09-07T15:59:00.000Z', now: NOW };

function run(overrides: Partial<Parameters<typeof evaluateDebitStop>[0]> = {}) {
  return evaluateDebitStop({ position: position(), orders: [], completeness: complete, quote, enabled: true, policy: null, ...overrides });
}

describe('observation-only debit stop evaluation', () => {
  it.each(['C', 'P'] as const)('classifies a supported long debit %s with complete feeds and no stop as NO_STOP', optionType => {
    const p = position({ legs: [{ ...position().legs[0], optionType, symbol: optionType === 'C' ? OCC : 'AAPL  270117P00200000' }] });
    expect(run({ position: p }).classification).toBe('NO_STOP');
  });

  it('keeps unsupported debit structures neutral', () => {
    expect(run({ position: position({ identity: { structureType: 'VERTICAL', contractMultiplier: 100 }, legs: [position().legs[0], position().legs[0]] }) }).classification).toBe('UNSUPPORTED');
  });

  it('uses NOT_EVALUATED for failed or partial feeds', () => {
    expect(run({ completeness: { liveOrdersAvailable: false, complexOrdersAvailable: true } }).classification).toBe('NOT_EVALUATED');
  });

  it('recognizes an exact valid STC/Credit stop as external provenance', () => {
    const result = run({ orders: [order()] });
    expect(result.classification).toBe('UNKNOWN_PROVENANCE');
    expect(result.matchedOrderId).toBe('stop-1');
  });

  it.each([
    ['account', { accountNumber: 'OTHER' }],
    ['action', { legs: [{ symbol: OCC, action: 'Buy to Close', quantity: 1, ratio: 1 }] }],
    ['quantity', { legs: [{ symbol: OCC, action: 'Sell to Close', quantity: 2, ratio: 1 }] }],
    ['ratio', { legs: [{ symbol: OCC, action: 'Sell to Close', quantity: 1, ratio: 2 }] }],
    ['price effect', { priceEffect: 'Debit' }],
    ['active status', { status: 'Unknown' }],
  ])('classifies wrong %s as INVALID', (_label, change) => {
    expect(run({ orders: [order(change as Partial<GtcOrder>)] }).classification).toBe('INVALID');
  });

  it('classifies an identity-linked wrong OCC candidate as INVALID', () => {
    const policy = buildDebitStopPolicy({ originalDebitPerContract: 10, maximumLossPct: .2, createdAt: NOW.toISOString(), brokerOrderId: 'stop-1' });
    expect(run({ orders: [order({ legs: [{ symbol: 'MSFT  270117C00200000', action: 'Sell to Close', quantity: 1, ratio: 1 }] })], policy }).classification).toBe('INVALID');
  });

  it('does not choose between ambiguous matches', () => {
    const result = run({ orders: [order(), order({ id: 'stop-2' })] });
    expect(result.classification).toBe('NOT_EVALUATED');
    expect(result.ambiguousOrderIds).toEqual(['stop-1', 'stop-2']);
  });

  it.each([
    ['nonpositive trigger', { stopPrice: '0' }],
    ['missing stop-limit limit', { price: '' }],
    ['limit above trigger', { price: '8.10' }],
  ])('rejects %s', (_label, change) => {
    expect(run({ orders: [order(change as Partial<GtcOrder>)] }).classification).toBe('INVALID');
  });

  it.each([
    ['missing', { executableBid: null, ask: 9.2, quoteTime: quote.quoteTime }],
    ['stale', { executableBid: 9, ask: 9.2, quoteTime: '2026-09-07T15:57:00.000Z' }],
    ['crossed', { executableBid: 9.3, ask: 9.2, quoteTime: quote.quoteTime }],
    ['one-sided', { executableBid: 9, ask: null, quoteTime: quote.quoteTime }],
  ])('returns NOT_EVALUATED for %s quote evidence', (_label, q) => {
    expect(run({ orders: [order()], quote: { ...q, now: NOW } }).classification).toBe('NOT_EVALUATED');
  });

  it('rejects a trigger at or above the executable bid', () => {
    expect(run({ orders: [order({ stopPrice: '9.00', price: '8.90' })] }).classification).toBe('INVALID');
  });

  it.each([
    ['ALIGNED', '8.00'], ['TOO_TIGHT', '8.90'], ['TOO_LOOSE', '7.00'],
  ] as const)('classifies a linked debit policy as %s', (expected, stopPrice) => {
    const policy = buildDebitStopPolicy({ originalDebitPerContract: 10, maximumLossPct: .2, createdAt: NOW.toISOString(), brokerOrderId: 'stop-1' });
    expect(run({ orders: [order({ stopPrice, price: String(Math.min(Number(stopPrice), 7.5)) })], policy }).classification).toBe(expected);
  });

  it('is UNSUPPORTED when the rollout flag is disabled', () => {
    expect(run({ enabled: false }).classification).toBe('UNSUPPORTED');
  });
});
