// lib/leaps-position-intelligence/__tests__/longValueTile.test.ts

import { describe, expect, it } from 'vitest';
import { longValueTile } from '../incomeCard';

const base = { strike: 60, dte: 300, quantity: 1, entryDebitPerShare: 20, markPerShare: 11, delta: 0.6, stockPrice: 67 };

describe('longValueTile: the LEAPS value is what closing now would bring in', () => {
  it('uses the close value (bid side) when there is one', () => {
    const t = longValueTile({ ...base, closeValue: 1050 });
    expect(t.label).toBe('Close value');
    expect(t.value).toBe('$1,050');
  });
  it('falls back to the mark, labelled as the mark, when there is no bid', () => {
    for (const closeValue of [null, undefined, 0]) {
      const t = longValueTile({ ...base, closeValue });
      expect(t.label).toBe('Value (mark)');
      expect(t.value).toBe('$1,100');
    }
  });
});
