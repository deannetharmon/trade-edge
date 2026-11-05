// lib/scans/__tests__/ccRsiChip.test.ts
// CC-WHEEL-0001 S3 -- Ready / Recovery / Wait on fixed fixtures; exactly at the cutoff; unavailable fails closed.
import { describe, it, expect } from 'vitest';
import { ccRsiChip, sanitizeCcRsiCutoff, DEFAULT_CC_RSI_CUTOFF } from '../ccRsiChip';

describe('ccRsiChip', () => {
  it('Wait below the cutoff', () => {
    expect(ccRsiChip({ rsi: 35, price: 90, costBasis: 80 }).state).toBe('wait');
  });
  it('exactly at the cutoff is not Wait', () => {
    expect(ccRsiChip({ rsi: 50, price: 90, costBasis: 80 }).state).toBe('ready');
  });
  it('Ready above the cutoff with the price above basis', () => {
    expect(ccRsiChip({ rsi: 62, price: 90, costBasis: 80 }).state).toBe('ready');
  });
  it('Recovery when RSI is fine but the price is under the cost basis', () => {
    expect(ccRsiChip({ rsi: 55, price: 62, costBasis: 82 }).state).toBe('recovery');
  });
  it('Wait wins over Recovery when RSI is low', () => {
    expect(ccRsiChip({ rsi: 35, price: 62, costBasis: 82 }).state).toBe('wait');
  });
  it('unknown RSI fails closed to Wait', () => {
    expect(ccRsiChip({ rsi: null, price: 90, costBasis: 80 }).state).toBe('wait');
    expect(ccRsiChip({ rsi: NaN, price: 90, costBasis: 80 }).state).toBe('wait');
  });
  it('unknown basis cannot be Recovery', () => {
    expect(ccRsiChip({ rsi: 60, price: 62, costBasis: null }).state).toBe('ready');
  });
  it('a custom cutoff applies', () => {
    expect(ccRsiChip({ rsi: 45, price: 90, costBasis: 80, cutoff: 40 }).state).toBe('ready');
    expect(ccRsiChip({ rsi: 45, price: 90, costBasis: 80, cutoff: 60 }).state).toBe('wait');
  });
});

describe('sanitizeCcRsiCutoff', () => {
  it('defaults to 50 and rejects invalid values', () => {
    expect(DEFAULT_CC_RSI_CUTOFF).toBe(50);
    for (const bad of [undefined, null, '', 'abc', 0, 100, -5, NaN, 150]) expect(sanitizeCcRsiCutoff(bad)).toBe(50);
    expect(sanitizeCcRsiCutoff('45')).toBe(45);
    expect(sanitizeCcRsiCutoff(60)).toBe(60);
  });
});
