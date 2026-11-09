import { describe, expect, it } from 'vitest';
import { ccBriefReason, ccFloorExplanation } from '../ccBrief';

const base = { capacityBlocked: false, oversubscribed: false, floorMissing: false, deltaMin: 0.2, deltaMax: 0.35, nearest: null, floor: null, price: 100 };

describe('ccBriefReason', () => {
  it('names the delta range and the nearest valid call', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 } })).toBe('No call in Δ0.20–0.35 · nearest Δ0.17 at $29');
  });
  it('adds the floor only when the stock is under it', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 }, floor: 55, price: 30 })).toBe('No call in Δ0.20–0.35 · nearest Δ0.17 at $29 · floor $55');
    expect(ccBriefReason({ ...base, floor: 90, price: 100 })).toBe('No call in Δ0.20–0.35');
  });
  it('explains a basis floor above the price with the numbers (TQQQ: $78.75 floor, $57.35 price)', () => {
    expect(ccFloorExplanation({ floor: 78.75, price: 57.35, allowBelowBasis: false })).toBe(
      'Your floor is your cost basis, $78.75, 37% above the price, $57.35. Calls below it are hidden unless you allow them for this stock.',
    );
  });
  it('stays silent when the floor is not what blocks: opted in, floor at the price, or unknown numbers', () => {
    expect(ccFloorExplanation({ floor: 78.75, price: 57.35, allowBelowBasis: true })).toBeNull();
    expect(ccFloorExplanation({ floor: 57.35, price: 57.35, allowBelowBasis: false })).toBeNull();
    expect(ccFloorExplanation({ floor: null, price: 57.35, allowBelowBasis: false })).toBeNull();
    expect(ccFloorExplanation({ floor: 78.75, price: null, allowBelowBasis: false })).toBeNull();
    expect(ccFloorExplanation({ floor: 78.75, price: 0, allowBelowBasis: false })).toBeNull();
  });
  it('says the plain thing for capacity and unknown basis', () => {
    expect(ccBriefReason({ ...base, capacityBlocked: true })).toBe('Shares already covered');
    expect(ccBriefReason({ ...base, capacityBlocked: true, oversubscribed: true })).toBe('Short calls already cover your shares');
    expect(ccBriefReason({ ...base, floorMissing: true })).toBe('Cost basis unknown');
  });
});
