// lib/portfolio/__tests__/pendingOrderReplacementSubmission.test.ts
//
// ES-0002: broker-boundary integration tests. These exercise
// `submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe` (the
// exact functions `app/portfolio/page.tsx`'s `replacePendingOrder` now wraps
// its literal `ttPost` call inside) AND `runPendingOrderReplacementWorkflow`
// (the extracted cancel/replace/restore orchestration), all using vi.fn()
// mocks in place of `ttDelete`/`ttPost`. The goal is to PROVE reachability
// (or non-reachability), not just assert a helper returned a boolean.

import { describe, expect, it, vi } from 'vitest';
import type { PendingOrderEvidence, ActualReplacementOrderEvidence } from '../pendingOrderReplacementSafety';
import {
  submitPendingOrderReplacementIfSafe,
  submitPendingOrderRestoreIfSafe,
  runPendingOrderReplacementWorkflow,
} from '../pendingOrderReplacementSubmission';

function evidence(overrides: Partial<PendingOrderEvidence> = {}): PendingOrderEvidence {
  return {
    id: 'CPLX-1',
    accountNumber: '5WI51392',
    symbol: 'AAPL',
    legs: [
      { symbol: 'AAPL240816P00200000', action: 'Sell to Open', quantity: 2 },
      { symbol: 'AAPL240816P00195000', action: 'Buy to Open', quantity: 2 },
    ],
    priceEffect: 'Credit',
    limitPrice: 0.60,
    orderType: 'Limit',
    timeInForce: 'GTC',
    ...overrides,
  };
}

function actualOrderFromEvidence(ev: PendingOrderEvidence, limitPricePoints: number, priceEffect: 'Credit' | 'Debit' = 'Credit'): ActualReplacementOrderEvidence {
  return {
    legs: ev.legs.map(l => ({ symbol: l.symbol, action: l.action, quantity: l.quantity })),
    limitPricePoints,
    priceEffect,
  };
}

// ---------------------------------------------------------------------------
// 7/9. Invalid replacement / restore: broker mock never called
// ---------------------------------------------------------------------------

describe('submitPendingOrderReplacementIfSafe -- invalid input', () => {
  it('does not call the broker for a 100x mismatched actual payload', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.30, actualOrder: actualOrderFromEvidence(ev, 30) },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker for an invalid requested price (NaN, zero, negative)', async () => {
    for (const bad of [NaN, 0, -1]) {
      const ev = evidence();
      const brokerMock = vi.fn();
      const result = await submitPendingOrderReplacementIfSafe(
        { evidence: ev, requestedLimitPricePoints: bad, actualOrder: actualOrderFromEvidence(ev, bad) },
        brokerMock
      );
      expect(result.submitted).toBe(false);
      expect(brokerMock).not.toHaveBeenCalled();
    }
  });

  it('does not call the broker when the payload was mutated after plan construction (leg symbol changed)', async () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [{ ...actual.legs[0], symbol: 'MUTATED' }, actual.legs[1]];
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });
});

describe('submitPendingOrderRestoreIfSafe -- invalid input', () => {
  it('does not call the broker when the original price is unavailable', async () => {
    const ev = evidence({ limitPrice: null });
    const brokerMock = vi.fn();
    const result = await submitPendingOrderRestoreIfSafe(
      { evidence: ev, actualOrder: actualOrderFromEvidence(ev, 0.30) },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker for a mutated restore payload (quantity changed)', async () => {
    const ev = evidence({ limitPrice: 0.60 });
    const actual = actualOrderFromEvidence(ev, 0.60);
    actual.legs = [{ ...actual.legs[0], quantity: 99 }, actual.legs[1]];
    const brokerMock = vi.fn();
    const result = await submitPendingOrderRestoreIfSafe({ evidence: ev, actualOrder: actual }, brokerMock);
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8/10. Valid replacement / restore: broker mock called exactly once with
// the exact validated payload
// ---------------------------------------------------------------------------

describe('submitPendingOrderReplacementIfSafe -- valid input', () => {
  it('calls the broker exactly once with the exact validated payload', async () => {
    const ev = evidence();
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-1' } } });
    const actualOrder = actualOrderFromEvidence(ev, 0.35);
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder },
      async (safetyCheck) => brokerMock(safetyCheck.plan)
    );
    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
    expect(brokerMock).toHaveBeenCalledWith(expect.objectContaining({ limitPricePoints: 0.35, priceEffect: 'Credit' }));
  });
});

describe('submitPendingOrderRestoreIfSafe -- valid input', () => {
  it('calls the broker exactly once, receiving the original validated price and exact original legs/effect', async () => {
    const ev = evidence({ limitPrice: 0.60, priceEffect: 'Credit' });
    const brokerMock = vi.fn().mockResolvedValue({ data: { order: { id: 'OK-RESTORE' } } });
    const result = await submitPendingOrderRestoreIfSafe(
      { evidence: ev, actualOrder: actualOrderFromEvidence(ev, 0.60) },
      async (safetyCheck) => brokerMock(safetyCheck.plan)
    );
    expect(result.submitted).toBe(true);
    expect(brokerMock).toHaveBeenCalledTimes(1);
    expect(brokerMock).toHaveBeenCalledWith(expect.objectContaining({
      limitPricePoints: 0.60,
      priceEffect: 'Credit',
      legPayload: ev.legs.map(l => ({ symbol: l.symbol, action: l.action, quantity: l.quantity })),
    }));
  });
});

// ---------------------------------------------------------------------------
// 11/12. Exact 100x mismatch and mutated-payload cases: broker mock not called
// (restated at the wrapper level, distinct from the pure-gate tests, matching
// ES-0001's convention of proving the SAME defect can't reach the broker via
// this wrapper specifically)
// ---------------------------------------------------------------------------

describe('submitPendingOrderReplacementIfSafe -- exact 100x mismatch reaches this boundary too', () => {
  it('never calls the broker when the actual payload price is 100x the validated plan', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.30, actualOrder: actualOrderFromEvidence(ev, 30) },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
    }
  });
});

// ---------------------------------------------------------------------------
// CORRECTIVE ROUND: invalid actual-payload price / price-effect must never
// reach the broker. Proves reachability with a real vi.fn() mock -- not a
// helper's boolean return -- for every scenario the Product Owner flagged.
// ---------------------------------------------------------------------------

describe('submitPendingOrderReplacementIfSafe -- invalid actual payload (corrective round)', () => {
  it('does not call the broker for a missing payload price (undefined)', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).limitPricePoints = undefined;
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
    }
  });

  it('does not call the broker for a malformed payload price (parseFloat-of-garbage NaN, simulating a non-numeric price string)', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    // Simulates what `parseFloat('not-a-price')` produces at the real
    // page.tsx adapter boundary.
    const actual = actualOrderFromEvidence(ev, parseFloat('not-a-price'));
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
    }
  });

  it('does not call the broker for a NaN payload price', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actualOrderFromEvidence(ev, NaN) },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker for an Infinity payload price', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actualOrderFromEvidence(ev, Infinity) },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
  });

  it('does not call the broker for a missing payload price effect on a CREDIT plan', async () => {
    const ev = evidence({ priceEffect: 'Credit' });
    const brokerMock = vi.fn();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = undefined;
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
    }
  });

  it('does not call the broker for a missing payload price effect on a DEBIT plan -- the exact defect a "default to Debit" adapter would have hidden', async () => {
    // This is the dangerous case: if a caller-side adapter ever defaulted a
    // missing actual price effect to 'Debit', a Debit-plan submission with
    // NO price effect in the payload would incorrectly equal the plan and
    // reach the broker. Proves the gate rejects the missing value itself.
    const ev = evidence({ priceEffect: 'Debit' });
    const brokerMock = vi.fn();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = undefined;
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
      expect(result.safetyCheck.issues.map(i => i.ruleId)).not.toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH');
    }
  });

  it('does not call the broker for an invalid (garbage, wrong-case) payload price effect', async () => {
    const ev = evidence({ priceEffect: 'Credit' });
    const brokerMock = vi.fn();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = 'CREDIT'; // wrong case -- must be exactly 'Credit'
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual },
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
    }
  });

  it('does not call the broker when the payload price differs from the plan by EXACTLY one cent', async () => {
    const ev = evidence();
    const brokerMock = vi.fn();
    const result = await submitPendingOrderReplacementIfSafe(
      { evidence: ev, requestedLimitPricePoints: 0.30, actualOrder: actualOrderFromEvidence(ev, 0.31) }, // exactly 1 cent off
      brokerMock
    );
    expect(result.submitted).toBe(false);
    expect(brokerMock).not.toHaveBeenCalled();
    if (!result.submitted) {
      expect(result.safetyCheck.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
    }
  });
});

// ---------------------------------------------------------------------------
// 13-17. Workflow-level orchestration tests (runPendingOrderReplacementWorkflow)
// ---------------------------------------------------------------------------

describe('runPendingOrderReplacementWorkflow -- orchestration ordering', () => {
  it('(13) rejects a known-invalid newPrice BEFORE cancellation -- cancel mock and post mock are both never called', async () => {
    const ev = evidence();
    const cancelExistingOrder = vi.fn().mockResolvedValue(undefined);
    const postOrder = vi.fn();
    const result = await runPendingOrderReplacementWorkflow(ev, -5, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('REJECTED_BEFORE_CANCEL');
    expect(cancelExistingOrder).not.toHaveBeenCalled();
    expect(postOrder).not.toHaveBeenCalled();
  });

  it('(14) for valid input, cancellation happens before the replacement post', async () => {
    const ev = evidence();
    const callOrder: string[] = [];
    const cancelExistingOrder = vi.fn().mockImplementation(async () => { callOrder.push('cancel'); });
    const postOrder = vi.fn().mockImplementation(async () => { callOrder.push('post'); return { id: 'OK' }; });
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('REPLACED');
    expect(callOrder).toEqual(['cancel', 'post']);
    expect(cancelExistingOrder).toHaveBeenCalledTimes(1);
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it('(15) when the replacement post fails after a successful cancel, restore is attempted only through the safety boundary (original price, exact legs)', async () => {
    const ev = evidence({ limitPrice: 0.60 });
    const cancelExistingOrder = vi.fn().mockResolvedValue(undefined);
    const postOrder = vi.fn()
      .mockRejectedValueOnce(new Error('broker rejected replacement'))
      .mockResolvedValueOnce({ id: 'OK-RESTORE' });
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('RESTORED');
    expect(postOrder).toHaveBeenCalledTimes(2);
    // Second (restore) call must have used the ORIGINAL price (0.60), never
    // the failed replacement's requested price (0.35).
    expect(postOrder.mock.calls[1][0]).toEqual({ price: 0.60 });
  });

  it('(15b) restore is blocked (not submitted with an invented price) when the original price is unavailable', async () => {
    const ev = evidence({ limitPrice: null });
    const cancelExistingOrder = vi.fn().mockResolvedValue(undefined);
    const postOrder = vi.fn().mockRejectedValue(new Error('broker rejected replacement'));
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('RESTORE_BLOCKED');
    // Only the one (failed) replacement post -- no invented-price restore post.
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it('(16) when the replacement post succeeds, restore is never attempted', async () => {
    const ev = evidence();
    const cancelExistingOrder = vi.fn().mockResolvedValue(undefined);
    const postOrder = vi.fn().mockResolvedValue({ id: 'OK' });
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('REPLACED');
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it('(17) when cancellation fails, neither the replacement nor the restore post is attempted', async () => {
    const ev = evidence();
    const cancelExistingOrder = vi.fn().mockRejectedValue(new Error('cancel rejected by broker'));
    const postOrder = vi.fn();
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('CANCEL_FAILED');
    expect(postOrder).not.toHaveBeenCalled();
  });

  it('restore itself failing is reported distinctly (RESTORE_FAILED), still only ever via the guarded boundary', async () => {
    const ev = evidence({ limitPrice: 0.60 });
    const cancelExistingOrder = vi.fn().mockResolvedValue(undefined);
    const postOrder = vi.fn()
      .mockRejectedValueOnce(new Error('broker rejected replacement'))
      .mockRejectedValueOnce(new Error('broker rejected restore too'));
    const result = await runPendingOrderReplacementWorkflow(ev, 0.35, {
      cancelExistingOrder,
      buildOrderBody: (price) => ({ price }),
      toActualOrder: (body: any) => actualOrderFromEvidence(ev, body.price),
      postOrder,
    });
    expect(result.kind).toBe('RESTORE_FAILED');
    expect(postOrder).toHaveBeenCalledTimes(2);
  });
});
