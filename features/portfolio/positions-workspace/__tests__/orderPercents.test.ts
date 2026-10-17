// features/portfolio/positions-workspace/__tests__/orderPercents.test.ts

import { describe, expect, it } from 'vitest';
import { profitTargetOrderPct, stopOrderPct } from '../model/orderPercents';

const base = {
  entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 682, quantity: 1,
  gtcOrderId: null as string | null, gtcOrderPrice: null as number | null, stopAssessment: null,
} as never;
const withStop = (trigger: number | null, matched: string | null = 'ORD-1') => ({ ...(base as object), stopAssessment: { matchedOrderId: matched, derivedAssessment: { actualTrigger: trigger } } }) as never;

describe('ORDER-PCT-0001', () => {
  it('profit target: a $6.82 credit bought back at $3.41 is 50%', () => {
    expect(profitTargetOrderPct({ ...(base as object), gtcOrderId: 'G1', gtcOrderPrice: 3.41 } as never)).toBe(50);
  });
  it('profit target: none without a working order, or when the figures cannot support one', () => {
    expect(profitTargetOrderPct(base)).toBeNull();
    expect(profitTargetOrderPct({ ...(base as object), gtcOrderId: 'G1', gtcOrderPrice: null } as never)).toBeNull();
    expect(profitTargetOrderPct({ ...(base as object), gtcOrderId: 'G1', gtcOrderPrice: 9 } as never)).toBeNull(); // above the credit
    expect(profitTargetOrderPct({ ...(base as object), entryPriceEffect: 'Debit', gtcOrderId: 'G1', gtcOrderPrice: 1 } as never)).toBeNull();
    expect(profitTargetOrderPct({ ...(base as object), entryEconomicsComplete: false, gtcOrderId: 'G1', gtcOrderPrice: 1 } as never)).toBeNull();
  });
  it('profit target: uses the per-share credit across several contracts', () => {
    expect(profitTargetOrderPct({ ...(base as object), entryCredit: 1364, quantity: 2, gtcOrderId: 'G1', gtcOrderPrice: 3.41 } as never)).toBe(50);
  });
  it('stop: a trigger at twice the credit is 200%', () => {
    expect(stopOrderPct(withStop(13.64))).toBe(200);
  });
  it('stop: nothing when no stop is matched, or the trigger is unknown', () => {
    expect(stopOrderPct(base)).toBeNull();
    expect(stopOrderPct(withStop(13.64, null))).toBeNull();
    expect(stopOrderPct(withStop(null))).toBeNull();
    expect(stopOrderPct({ ...(withStop(13.64) as object), entryPriceEffect: 'Debit' } as never)).toBeNull();
  });
});
