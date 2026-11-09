import { describe, it, expect } from 'vitest';
import { decideCcRsiGuard } from '../ccRsiGuard';

describe('decideCcRsiGuard', () => {
  it('stops below the cutoff', () => {
    const d = decideCcRsiGuard({ symbol: 'TQQQ', rsi: 42, cutoff: 50 });
    expect(d.stop).toBe(true);
    if (d.stop) { expect(d.kind).toBe('below'); expect(d.title).toBe('Stop. Look at TQQQ first.'); expect(d.body).toContain('above 50'); }
  });
  it('passes at the cutoff and above', () => {
    expect(decideCcRsiGuard({ symbol: 'X', rsi: 50, cutoff: 50 }).stop).toBe(false);
    expect(decideCcRsiGuard({ symbol: 'X', rsi: 71, cutoff: 50 }).stop).toBe(false);
  });
  it('stops when RSI cannot be read', () => {
    for (const rsi of [null, undefined, NaN]) {
      const d = decideCcRsiGuard({ symbol: 'X', rsi, cutoff: 50 });
      expect(d.stop && d.kind).toBe('unreadable');
    }
  });
  it('uses the saved cutoff and falls back to 50 when invalid', () => {
    expect(decideCcRsiGuard({ symbol: 'X', rsi: 55, cutoff: 60 }).stop).toBe(true);
    expect(decideCcRsiGuard({ symbol: 'X', rsi: 45, cutoff: 0 }).stop).toBe(true);
    expect(decideCcRsiGuard({ symbol: 'X', rsi: 55 }).stop).toBe(false);
  });
});
