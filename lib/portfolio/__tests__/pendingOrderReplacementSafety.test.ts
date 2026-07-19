// lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts
//
// ES-0002: regression tests for the pending-order replacement/restore plan
// builders and the hard-blocking safety gate. Closes ES-0001 Closeout
// Technical Debt TD-1 -- `replacePendingOrder`'s cancel/resubmit path
// previously had NO tick validation, NO leg-identity check, and NO
// display/payload cross-check. Every price/quantity assertion below uses a
// LITERAL expected number (never re-derived with the formula under test),
// matching the house style set by ES-0001's closeOrderSafety.test.ts.

import { describe, expect, it } from 'vitest';
import {
  buildPendingOrderReplacementPlan,
  buildPendingOrderRestorePlan,
  runPendingOrderReplacementSafetyGate,
  runPendingOrderRestoreSafetyGate,
  type PendingOrderEvidence,
  type ActualReplacementOrderEvidence,
} from '../pendingOrderReplacementSafety';

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
// 1. Valid replacement plan preserves exact legs/quantities/actions/effect
// ---------------------------------------------------------------------------

describe('buildPendingOrderReplacementPlan -- valid input', () => {
  it('preserves exact legs, quantities, actions, and price effect, and carries the literal requested price (0.35)', () => {
    const result = buildPendingOrderReplacementPlan(evidence(), 0.35);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.pendingOrderId).toBe('CPLX-1');
    expect(result.plan.accountNumber).toBe('5WI51392');
    expect(result.plan.priceEffect).toBe('Credit');
    expect(result.plan.intent).toBe('REPLACEMENT');
    // LITERAL -- 0.35, never 35, never 0.0035, no contract multiplier of any kind.
    expect(result.plan.limitPricePoints).toBe(0.35);
    expect(result.plan.legPayload).toEqual([
      { symbol: 'AAPL240816P00200000', action: 'Sell to Open', quantity: 2 },
      { symbol: 'AAPL240816P00195000', action: 'Buy to Open', quantity: 2 },
    ]);
  });

  it('never scales, floors, or multiplies the requested price -- 0.35 in, 0.35 out, exactly', () => {
    for (const price of [0.01, 0.30, 0.35, 1.05, 12.5]) {
      const result = buildPendingOrderReplacementPlan(evidence(), price);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.plan.limitPricePoints).toBe(price);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Rejects invalid price / quantity / identity / legs
// ---------------------------------------------------------------------------

describe('buildPendingOrderReplacementPlan -- hard blocks', () => {
  it('blocks REPLACEMENT_LIMIT_PRICE_INVALID for NaN, Infinity, zero, and negative price', () => {
    for (const bad of [NaN, Infinity, 0, -0.5]) {
      const result = buildPendingOrderReplacementPlan(evidence(), bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.ruleId).toBe('REPLACEMENT_LIMIT_PRICE_INVALID');
    }
  });

  it('blocks REPLACEMENT_LIMIT_TICK_INVALID for an unsupported fractional (sub-penny) tick', () => {
    const result = buildPendingOrderReplacementPlan(evidence(), 0.333);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('REPLACEMENT_LIMIT_TICK_INVALID');
  });

  it('blocks REPLACEMENT_LEGS_MISSING when the order has no legs', () => {
    const result = buildPendingOrderReplacementPlan(evidence({ legs: [] }), 0.30);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('REPLACEMENT_LEGS_MISSING');
  });

  it('blocks REPLACEMENT_QUANTITY_INVALID for a zero or fractional leg quantity', () => {
    for (const bad of [0, 1.5, -2]) {
      const result = buildPendingOrderReplacementPlan(
        evidence({ legs: [{ symbol: 'S', action: 'Sell to Open', quantity: bad }] }),
        0.30
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.ruleId).toBe('REPLACEMENT_QUANTITY_INVALID');
    }
  });

  it('blocks PENDING_ORDER_ID_MISSING when the order id is empty', () => {
    const result = buildPendingOrderReplacementPlan(evidence({ id: '' }), 0.30);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('PENDING_ORDER_ID_MISSING');
  });

  it('blocks ACCOUNT_NUMBER_MISSING when the account number is empty', () => {
    const result = buildPendingOrderReplacementPlan(evidence({ accountNumber: '' }), 0.30);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('ACCOUNT_NUMBER_MISSING');
  });

  it('blocks REPLACEMENT_PRICE_EFFECT_INVALID when the original price effect is missing or garbage -- never defaults to Credit', () => {
    for (const bad of [null, '', 'BOGUS']) {
      const result = buildPendingOrderReplacementPlan(evidence({ priceEffect: bad as any }), 0.30);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.ruleId).toBe('REPLACEMENT_PRICE_EFFECT_INVALID');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Restore planning
// ---------------------------------------------------------------------------

describe('buildPendingOrderRestorePlan', () => {
  it('uses the literal original price (0.60) when valid, never a caller-supplied replacement price', () => {
    const result = buildPendingOrderRestorePlan(evidence({ limitPrice: 0.60 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.limitPricePoints).toBe(0.60);
    expect(result.plan.intent).toBe('RESTORE');
    expect(result.plan.legPayload).toEqual([
      { symbol: 'AAPL240816P00200000', action: 'Sell to Open', quantity: 2 },
      { symbol: 'AAPL240816P00195000', action: 'Buy to Open', quantity: 2 },
    ]);
  });

  it('blocks RESTORE_PRICE_UNAVAILABLE when the original price is null -- does not fall back to any other value', () => {
    const result = buildPendingOrderRestorePlan(evidence({ limitPrice: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('RESTORE_PRICE_UNAVAILABLE');
  });

  it('blocks RESTORE_PRICE_UNAVAILABLE when the original price is zero, negative, or non-finite', () => {
    for (const bad of [0, -1, NaN]) {
      const result = buildPendingOrderRestorePlan(evidence({ limitPrice: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.ruleId).toBe('RESTORE_PRICE_UNAVAILABLE');
    }
  });

  it('blocks RESTORE_PLAN_INVALID when the evidence is otherwise unusable (e.g. no legs) even though the original price is valid', () => {
    const result = buildPendingOrderRestorePlan(evidence({ legs: [], limitPrice: 0.60 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ruleId).toBe('RESTORE_PLAN_INVALID');
  });
});

// ---------------------------------------------------------------------------
// 4. Payload cross-check hard-blocks (the actual object about to reach ttPost)
// ---------------------------------------------------------------------------

describe('runPendingOrderReplacementSafetyGate -- actual-payload cross-check', () => {
  it('passes and returns the plan for a fully valid, matching submission', () => {
    const ev = evidence();
    const result = runPendingOrderReplacementSafetyGate({
      evidence: ev,
      requestedLimitPricePoints: 0.35,
      actualOrder: actualOrderFromEvidence(ev, 0.35),
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.limitPricePoints).toBe(0.35);
  });

  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH on the exact 100x price defect (validated 0.30, payload 30)', () => {
    const ev = evidence();
    const result = runPendingOrderReplacementSafetyGate({
      evidence: ev,
      requestedLimitPricePoints: 0.30,
      actualOrder: actualOrderFromEvidence(ev, 30),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
  });

  it('blocks REPLACEMENT_LEG_IDENTITY_MISMATCH when an OCC symbol changed', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [{ ...actual.legs[0], symbol: 'AAPL240816P00210000' }, actual.legs[1]];
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_LEG_IDENTITY_MISMATCH');
  });

  it('blocks REPLACEMENT_LEG_ACTION_MISMATCH when a leg action changed', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [{ ...actual.legs[0], action: 'Buy to Open' }, actual.legs[1]];
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_LEG_ACTION_MISMATCH');
  });

  it('blocks REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH when a leg quantity changed', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [{ ...actual.legs[0], quantity: 3 }, actual.legs[1]];
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH');
  });

  it('blocks REPLACEMENT_LEG_IDENTITY_MISMATCH when a leg is missing from the payload', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [actual.legs[0]];
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_LEG_IDENTITY_MISMATCH');
  });

  it('blocks REPLACEMENT_LEG_IDENTITY_MISMATCH when the payload has an extra leg', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [...actual.legs, { symbol: 'EXTRA-LEG', action: 'Sell to Open', quantity: 2 }];
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_LEG_IDENTITY_MISMATCH');
  });

  it('blocks REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH when the payload price effect differs from the plan', () => {
    const ev = evidence(); // Credit
    const actual = actualOrderFromEvidence(ev, 0.35, 'Debit');
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH');
  });

  it('leg comparison is order-independent: a payload with legs in reversed order still passes', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    actual.legs = [actual.legs[1], actual.legs[0]]; // reversed, semantically equivalent
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Restore gate reuses the same boundary
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. CORRECTIVE ROUND: invalid actual-payload price / price-effect must be
// hard-blocked explicitly, not silently passed by a NaN-tolerant comparison
// or a defaulted price-effect.
// ---------------------------------------------------------------------------

describe('runPendingOrderReplacementSafetyGate -- invalid actual-payload price (corrective round)', () => {
  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID for a NaN actual price -- does NOT silently pass via Math.abs(NaN) tolerance', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, NaN);
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
    expect(result.issues.map(i => i.ruleId)).not.toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
  });

  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID for an Infinity actual price', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, Infinity);
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
  });

  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID for a zero or negative actual price', () => {
    for (const bad of [0, -0.35]) {
      const ev = evidence();
      const actual = actualOrderFromEvidence(ev, bad);
      const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
      expect(result.ok).toBe(false);
      expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
    }
  });

  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID for a sub-penny (non-cent-denominated) actual price', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.353);
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID');
  });

  it('blocks REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH for a payload exactly ONE CENT off the plan -- a 0.01 tolerance would NOT have caught this', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.36); // plan is 0.35 -- exactly 1 cent off
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
  });

  it('passes when the actual price exactly matches the plan to the cent (0.35 === 0.35)', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(true);
  });
});

describe('runPendingOrderReplacementSafetyGate -- invalid actual-payload price effect (corrective round)', () => {
  it('blocks REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID (not a false MISMATCH pass) for a missing price effect on a CREDIT plan', () => {
    const ev = evidence({ priceEffect: 'Credit' });
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = undefined;
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
  });

  it('blocks REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID for a missing price effect on a DEBIT plan -- the exact defect a "default to Debit" adapter would have hidden', () => {
    // This is the dangerous case: if a caller-side adapter ever defaulted a
    // missing actual price effect to 'Debit', a Debit-plan submission with
    // NO price effect in the payload would incorrectly equal the plan and
    // pass. This test proves the gate rejects the missing value itself,
    // independent of what the plan's own effect happens to be.
    const legs = [
      { symbol: 'CS', action: 'Sell to Open', quantity: 1 },
      { symbol: 'CL', action: 'Buy to Open', quantity: 1 },
    ];
    const ev = evidence({ priceEffect: 'Debit', legs });
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = undefined;
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
    expect(result.issues.map(i => i.ruleId)).not.toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH');
  });

  it('blocks REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID for a null price effect', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = null;
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
  });

  it('blocks REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID for a garbage (non-Credit/Debit) price effect string', () => {
    const ev = evidence();
    const actual = actualOrderFromEvidence(ev, 0.35);
    (actual as any).priceEffect = 'CREDIT'; // wrong case -- must be exactly 'Credit'
    const result = runPendingOrderReplacementSafetyGate({ evidence: ev, requestedLimitPricePoints: 0.35, actualOrder: actual });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID');
  });
});

describe('runPendingOrderRestoreSafetyGate', () => {
  it('passes for a valid restore at the original literal price (0.60)', () => {
    const ev = evidence({ limitPrice: 0.60 });
    const result = runPendingOrderRestoreSafetyGate({ evidence: ev, actualOrder: actualOrderFromEvidence(ev, 0.60) });
    expect(result.ok).toBe(true);
    expect(result.plan?.limitPricePoints).toBe(0.60);
  });

  it('blocks RESTORE_PRICE_UNAVAILABLE when the original price is unavailable, and does not substitute the actual-payload price to compensate', () => {
    const ev = evidence({ limitPrice: null });
    const result = runPendingOrderRestoreSafetyGate({ evidence: ev, actualOrder: actualOrderFromEvidence(ev, 0.30) });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('RESTORE_PRICE_UNAVAILABLE');
  });

  it('blocks the exact 100x defect for a restore submission too (validated 0.60, payload 60)', () => {
    const ev = evidence({ limitPrice: 0.60 });
    const result = runPendingOrderRestoreSafetyGate({ evidence: ev, actualOrder: actualOrderFromEvidence(ev, 60) });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.ruleId)).toContain('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH');
  });
});
