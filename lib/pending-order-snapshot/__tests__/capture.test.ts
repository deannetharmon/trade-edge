import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldCapture, capturePendingOrderSnapshots } from '../capture';
import type { PendingOrder } from '@/lib/portfolio-data/types';

function order(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: 'order-1', accountNumber: 'ACC1', symbol: 'MRVL', strategy: 'BPS',
    legs: [], expDate: '2028-06-16', limitPrice: 1.85, priceEffect: 'Credit',
    status: 'Working', createdAt: new Date().toISOString(), orderType: 'Limit', timeInForce: 'GTC',
    quoteQuality: 'RELIABLE', currentExecutablePrice: 1.40,
    ...overrides,
  } as PendingOrder;
}

describe('shouldCapture', () => {
  it('always captures the first observation, with no prior snapshot', () => {
    expect(shouldCapture(undefined, 1.40)).toBe(true);
  });

  it('does not capture a move below the tick floor since the last recorded point', () => {
    const last = { capturedAt: new Date().toISOString(), currentReference: 1.40 };
    expect(shouldCapture(last, 1.45)).toBe(false); // moved $0.05, below the $0.10 floor
  });

  it('captures a move that clears the tick floor since the last recorded point', () => {
    const last = { capturedAt: new Date().toISOString(), currentReference: 1.40 };
    expect(shouldCapture(last, 1.55)).toBe(true); // moved $0.15
  });

  it('is direction-agnostic -- a move away also counts', () => {
    const last = { capturedAt: new Date().toISOString(), currentReference: 1.40 };
    expect(shouldCapture(last, 1.20)).toBe(true); // moved $0.20 away
  });
});

describe('capturePendingOrderSnapshots', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });

  it('writes a snapshot for a still-pending order with a reliable quote and no prior history', async () => {
    await capturePendingOrderSnapshots([order()], [], {});
    expect(fetch).toHaveBeenCalledWith('/api/pending-order-snapshots', expect.objectContaining({ method: 'POST' }));
  });

  it('does not write when the quote is unreliable', async () => {
    await capturePendingOrderSnapshots([order({ quoteQuality: 'UNAVAILABLE' })], [], {});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not write when the move since the last snapshot is below threshold', async () => {
    const store = { 'order-1': [{ capturedAt: new Date().toISOString(), currentReference: 1.38 }] };
    await capturePendingOrderSnapshots([order({ currentExecutablePrice: 1.40 })], [], store);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cleans up history for an order that is no longer pending', async () => {
    const store = { 'order-1': [{ capturedAt: new Date().toISOString(), currentReference: 1.40 }] };
    await capturePendingOrderSnapshots([], [order()], store);
    expect(fetch).toHaveBeenCalledWith(
      '/api/pending-order-snapshots?pendingOrderId=order-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('does not attempt cleanup for an order with no history to clean up', async () => {
    await capturePendingOrderSnapshots([], [order()], {});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never throws when the network call fails -- capture is non-blocking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(capturePendingOrderSnapshots([order()], [], {})).resolves.toBeUndefined();
  });
});
