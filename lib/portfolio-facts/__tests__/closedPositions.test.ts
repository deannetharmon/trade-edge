import { describe, it, expect } from 'vitest';
import { updateClosedTracker, type ClosedTracker } from '../closedPositions';

describe('updateClosedTracker', () => {
  it('does not report anything on first sight', () => {
    const r = updateClosedTracker({}, [{ key: 'A', pnl: 10 }]);
    expect(r.closed).toEqual([]);
    expect(r.tracker.A).toEqual({ lastSeenPnl: 10, missing: 0 });
  });
  it('waits for two consecutive misses before reporting a close, with last seen P/L', () => {
    let t: ClosedTracker = updateClosedTracker({}, [{ key: 'A', pnl: 42 }]).tracker;
    const first = updateClosedTracker(t, []);
    expect(first.closed).toEqual([]);
    const second = updateClosedTracker(first.tracker, []);
    expect(second.closed).toEqual([{ positionKey: 'A', lastSeenPnl: 42 }]);
    expect(second.tracker.A).toBeUndefined();
  });
  it('a one-refresh blip resets the miss count', () => {
    let t = updateClosedTracker({}, [{ key: 'A', pnl: 1 }]).tracker;
    t = updateClosedTracker(t, []).tracker;
    t = updateClosedTracker(t, [{ key: 'A', pnl: 2 }]).tracker;
    expect(t.A).toEqual({ lastSeenPnl: 2, missing: 0 });
    expect(updateClosedTracker(t, []).closed).toEqual([]);
  });
  it('keeps the last known P/L when the live P/L is null', () => {
    let t = updateClosedTracker({}, [{ key: 'A', pnl: 5 }]).tracker;
    t = updateClosedTracker(t, [{ key: 'A', pnl: null }]).tracker;
    expect(t.A.lastSeenPnl).toBe(5);
  });
});
