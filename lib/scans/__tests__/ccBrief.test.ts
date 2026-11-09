import { describe, expect, it } from 'vitest';
import { ccBriefReason } from '../ccBrief';

const base = { capacityBlocked: false, oversubscribed: false, floorMissing: false, deltaMin: 0.2, deltaMax: 0.35, nearest: null, floor: null, price: 100 };

describe('ccBriefReason', () => {
  it('names the delta range and the nearest valid call', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 } })).toBe('No call in Δ0.20–0.35 · nearest Δ0.17 at $29');
  });
  it('adds the floor only when the stock is under it', () => {
    expect(ccBriefReason({ ...base, nearest: { strike: 29, delta: 0.17 }, floor: 55, price: 30 })).toBe('No call in Δ0.20–0.35 · nearest Δ0.17 at $29 · floor $55');
    expect(ccBriefReason({ ...base, floor: 90, price: 100 })).toBe('No call in Δ0.20–0.35');
  });
  it('says the plain thing for capacity and unknown basis', () => {
    expect(ccBriefReason({ ...base, capacityBlocked: true })).toBe('Shares already covered');
    expect(ccBriefReason({ ...base, capacityBlocked: true, oversubscribed: true })).toBe('Short calls already cover your shares');
    expect(ccBriefReason({ ...base, floorMissing: true })).toBe('Cost basis unknown');
  });
});
