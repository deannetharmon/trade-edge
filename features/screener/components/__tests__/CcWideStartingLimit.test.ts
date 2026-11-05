// features/screener/components/__tests__/CcWideStartingLimit.test.ts

import { describe, it, expect } from 'vitest';
import { ccStartingLimit } from '../CcTradeModal';

describe('ccStartingLimit', () => {
  it('starts at the mid on a tight spread', () => {
    expect(ccStartingLimit({ midPerShare: 0.38, bidPerShare: 0.36, wide: false })).toBe(0.38);
  });
  it('starts at the bid on a wide spread', () => {
    expect(ccStartingLimit({ midPerShare: 0.17, bidPerShare: 0.02, wide: true })).toBe(0.02);
  });
  it('falls back to the mid when a wide call has no usable bid', () => {
    expect(ccStartingLimit({ midPerShare: 0.17, bidPerShare: 0, wide: true })).toBe(0.17);
    expect(ccStartingLimit({ midPerShare: 0.17, wide: true })).toBe(0.17);
  });
});
