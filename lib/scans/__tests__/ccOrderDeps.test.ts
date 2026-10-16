// lib/scans/__tests__/ccOrderDeps.test.ts

import { describe, expect, it } from 'vitest';
import { brokerErrorText } from '../ccOrderDeps';

describe('brokerErrorText', () => {
  it('joins the headline and nested details without repeating', () => {
    const data = { error: { message: 'Order rejected', errors: [{ message: 'Not enough shares' }, { message: 'Order rejected' }] } };
    expect(brokerErrorText(data, 'x')).toBe('Order rejected — Not enough shares');
  });
  it('falls back to code, then to the fallback text', () => {
    expect(brokerErrorText({ errors: [{ code: 'bad_price' }] }, 'x')).toBe('bad_price');
    expect(brokerErrorText({}, 'Dry run failed (500)')).toBe('Dry run failed (500)');
    expect(brokerErrorText(null, 'fb')).toBe('fb');
  });
});
