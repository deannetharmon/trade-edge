import { describe, expect, it } from 'vitest';
import { ccBriefReason, ccFloorExplanation } from '../ccBrief';

const base = { capacityBlocked: false, oversubscribed: false, floorMissing: false, deltaMin: 0.2, deltaMax: 0.35, nearest: null, floor: null, price: 100 };

describe('ccBriefReason', () => {
  it('names the delta range and the nearest valid call', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 } })).toBe('No call with POP 65–80% · nearest POP 83% at $29');
  });
  it('names the price gap when calls sit in the POP range but none can be filled', () => {
    expect(ccBriefReason({ ...base, widePopInRange: 4 })).toBe('4 calls have POP 65–80%, but the price gap is too big on every one');
    expect(ccBriefReason({ ...base, widePopInRange: 1 })).toBe('1 call has POP 65–80%, but the price gap is too big on it');
  });
  it('does not repeat the floor (the cost line says it)', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 }, floor: 55, price: 30 })).toBe('No call with POP 65–80% · nearest POP 83% at $29');
    expect(ccBriefReason({ ...base, floor: 90, price: 100 })).toBe('No call with POP 65–80%');
  });
  it('explains a basis floor above the price with the numbers (TQQQ: $78.75 floor, $57.35 price)', () => {
    expect(ccFloorExplanation({ floor: 78.75, price: 57.35 })).toBe(
      'Your floor is your cost basis, $78.75, 37% above the price, $57.35. No call is offered below it.',
    );
  });
  it('stays silent when the floor is not what blocks: floor at the price, or unknown numbers', () => {
    expect(ccFloorExplanation({ floor: 57.35, price: 57.35 })).toBeNull();
    expect(ccFloorExplanation({ floor: null, price: 57.35 })).toBeNull();
    expect(ccFloorExplanation({ floor: 78.75, price: null })).toBeNull();
    expect(ccFloorExplanation({ floor: 78.75, price: 0 })).toBeNull();
  });
  it('says the plain thing for capacity and unknown basis', () => {
    expect(ccBriefReason({ ...base, capacityBlocked: true })).toBe('Shares already covered');
    expect(ccBriefReason({ ...base, capacityBlocked: true, oversubscribed: true })).toBe('Short calls already cover your shares');
    expect(ccBriefReason({ ...base, floorMissing: true })).toBe('Cost basis unknown');
  });
});
