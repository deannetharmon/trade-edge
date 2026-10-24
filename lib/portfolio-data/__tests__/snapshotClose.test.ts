// lib/portfolio-data/__tests__/snapshotClose.test.ts

import { describe, expect, it } from 'vitest';
import { applyClose, isAfterMarketCloseNy, type SnapshotClose } from '../snapshotClose';

const close = (v: number): SnapshotClose => ({ currentValue: v, netDelta: 0.5, stockPrice: 70, capturedAt: '2026-10-23T21:10:00Z' });
const snap = (date: string, v = 1000) => ({ date, currentValue: v, close: undefined as SnapshotClose | undefined });

describe('isAfterMarketCloseNy', () => {
  it('is false before 4:05 pm New York and true after, on a weekday', () => {
    expect(isAfterMarketCloseNy(Date.parse('2026-10-23T19:30:00Z'))).toBe(false); // 3:30 pm ET Friday
    expect(isAfterMarketCloseNy(Date.parse('2026-10-23T20:04:00Z'))).toBe(false); // 4:04 pm ET
    expect(isAfterMarketCloseNy(Date.parse('2026-10-23T20:05:00Z'))).toBe(true);  // 4:05 pm ET
    expect(isAfterMarketCloseNy(Date.parse('2026-10-24T01:00:00Z'))).toBe(true);  // 9 pm ET Friday
  });
  it('is false on a weekend', () => {
    expect(isAfterMarketCloseNy(Date.parse('2026-10-24T20:30:00Z'))).toBe(false); // Saturday
    expect(isAfterMarketCloseNy(Date.parse('2026-10-25T20:30:00Z'))).toBe(false); // Sunday
  });
});

describe('applyClose', () => {
  it('records the close beside the first reading and leaves the first reading as it was', () => {
    const { list, changed } = applyClose([snap('2026-10-22'), snap('2026-10-23', 1227.5)], snap('2026-10-23', 1227.5), close(1097.5));
    expect(changed).toBe(true);
    expect(list[1].currentValue).toBe(1227.5);
    expect(list[1].close?.currentValue).toBe(1097.5);
    expect(list[0].close).toBeUndefined();
  });
  it('the first post-close capture wins; a later reload changes nothing', () => {
    const first = applyClose([snap('2026-10-23')], snap('2026-10-23'), close(1097.5));
    const again = applyClose(first.list, snap('2026-10-23'), close(900));
    expect(again.changed).toBe(false);
    expect(again.list[0].close?.currentValue).toBe(1097.5);
  });
  it('a day with no snapshot yet gets one that carries the close', () => {
    const { list, changed } = applyClose([snap('2026-10-22')], snap('2026-10-23', 1100), close(1097.5));
    expect(changed).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[1].close?.currentValue).toBe(1097.5);
  });
});
