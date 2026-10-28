// features/portfolio/positions-workspace/__tests__/attention.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { attentionOf } from '../model/attention';

const put = { symbol: 'x', optionType: 'P', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 1 } as unknown as PositionLeg;
const pos = (o: Partial<Position>) => ({ key: 'k', symbol: 'AAA', strategy: 'PUT', legs: [put], intent: 'income', quantity: 1, dte: 24, stockPrice: 45, entryPriceEffect: 'Credit', recommendation: { kind: 'roll-soon' }, ...o }) as unknown as Position;

describe('ATTENTION-WHEEL-0001', () => {
  it('an income put with a non-hold verdict needs attention', () => {
    expect(attentionOf(pos({}))).toEqual({ needsAttention: true, assignmentNear: false });
  });
  it('an ITM Wheel put reads Assignment near, not Needs attention', () => {
    expect(attentionOf(pos({ intent: 'wheel' }))).toEqual({ needsAttention: false, assignmentNear: true });
    expect(attentionOf(pos({ intent: 'acquisition' })).needsAttention).toBe(false);
  });
  it('an OTM Wheel put is just Monitoring', () => {
    expect(attentionOf(pos({ intent: 'wheel', stockPrice: 60 }))).toEqual({ needsAttention: false, assignmentNear: false });
  });
  it('a hard flag still needs attention on a Wheel put', () => {
    expect(attentionOf(pos({ intent: 'wheel', needsClose: true } as Partial<Position>)).needsAttention).toBe(true);
  });
});
