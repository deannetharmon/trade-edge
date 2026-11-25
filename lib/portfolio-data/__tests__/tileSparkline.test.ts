import { describe, expect, it } from 'vitest';
import { buildDeployedSpark, buildTileSpark, DEPLOYED_KEY, toNlvSpark } from '../tileSparkline';

const TODAY = '2026-11-24'; // Tuesday
const r = (date: string, pnl: number) => ({ date, pnl });

describe('buildTileSpark', () => {
  it('sums open positions per day and adds the live point; change is latest minus prior', () => {
    const store = { A: [r('2026-11-20', 100), r('2026-11-23', 150)], B: [r('2026-11-20', -40), r('2026-11-23', -10)] };
    const s = buildTileSpark(store, [{ key: 'A', pnl: 170 }, { key: 'B', pnl: 0 }], TODAY, 170);
    expect(s.points.map(p => p.value)).toEqual([60, 140, 170]);
    expect(s.priorValue).toBe(140);
    expect(s.change).toBe(30);
  });
  it('a position opened later adds nothing before its first record', () => {
    const store = { A: [r('2026-11-20', 100), r('2026-11-23', 120)], B: [r('2026-11-23', 5)] };
    const s = buildTileSpark(store, [{ key: 'A', pnl: 1 }, { key: 'B', pnl: 1 }], TODAY, null);
    expect(s.points.map(p => p.value)).toEqual([100, 125]);
  });
  it('skips a day an open position has no record (gap), and weekend records', () => {
    const store = { A: [r('2026-11-19', 1), r('2026-11-20', 2), r('2026-11-21', 9), r('2026-11-23', 4)], B: [r('2026-11-19', 1), r('2026-11-23', 1)] };
    const s = buildTileSpark(store, [{ key: 'A', pnl: 0 }, { key: 'B', pnl: 0 }], TODAY, null);
    expect(s.points.map(p => p.date)).toEqual(['2026-11-19', '2026-11-23']);
  });
  it('first reading of a day wins', () => {
    const s = buildTileSpark({ A: [r('2026-11-23', 10), r('2026-11-23', 99), r('2026-11-20', 5)] }, [{ key: 'A', pnl: 0 }], TODAY, 20);
    expect(s.points.map(p => p.value)).toEqual([5, 10, 20]);
  });
  it('stale prior (weeks old): no change, no baseline', () => {
    const s = buildTileSpark({ A: [r('2026-10-06', 5), r('2026-10-07', 6)] }, [{ key: 'A', pnl: 0 }], TODAY, 8);
    expect(s.change).toBeNull();
    expect(s.priorValue).toBeNull();
  });
  it('a tile with one position that has no earlier record waits: no partial line ending in a cliff', () => {
    const s = buildTileSpark({ A: [r('2026-11-20', 1), r('2026-11-23', 2)] }, [{ key: 'A', pnl: 5 }, { key: 'EQUITY:SOXL', pnl: -19000 }], TODAY, -18995);
    expect(s.points).toHaveLength(0);
    expect(s.change).toBeNull();
  });
  it('no history at all: nothing to draw', () => {
    const s = buildTileSpark({}, [{ key: 'EQUITY:SOXL', pnl: 3 }], TODAY, 3);
    expect(s.points).toHaveLength(0);
    expect(s.change).toBeNull();
  });
  it('unpriced tile has no live point', () => {
    const s = buildTileSpark({ A: [r('2026-11-20', 1), r('2026-11-23', 2)] }, [{ key: 'A', pnl: null }], TODAY, null);
    expect(s.points.map(p => p.date)).toEqual(['2026-11-20', '2026-11-23']);
  });
});

describe('buildDeployedSpark', () => {
  it('reads currentValue under the deployed key', () => {
    const store = { [DEPLOYED_KEY]: [{ date: '2026-11-23', currentValue: 20000 }] };
    const s = buildDeployedSpark(store, TODAY, 21000);
    expect(s.points.map(p => p.value)).toEqual([20000, 21000]);
    expect(toNlvSpark(s).change).toBe(1000);
  });
});
