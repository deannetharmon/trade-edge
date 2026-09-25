// lib/tradeLog/__tests__/strategyOptions.test.ts

import { describe, expect, it } from 'vitest';
import { TRADE_STRATEGY_FILTER_OPTIONS, TRADE_STRATEGY_LABELS, TRADE_STRATEGY_ORDER } from '../strategyOptions';

describe('Trade Log strategy options', () => {
  it('offers every strategy a closed trade can have, once each, so no trade is unfilterable', () => {
    const modelled = Object.keys(TRADE_STRATEGY_LABELS).sort();
    expect(modelled).toEqual(['BCS', 'BPS', 'CSP', 'IC', 'OTHER', 'SHORT_CALL', 'SPREAD']);
    expect([...TRADE_STRATEGY_ORDER].sort()).toEqual(modelled);
    expect(TRADE_STRATEGY_FILTER_OPTIONS.map(o => o.value).sort()).toEqual(modelled);
    expect(new Set(TRADE_STRATEGY_FILTER_OPTIONS.map(o => o.value)).size).toBe(TRADE_STRATEGY_FILTER_OPTIONS.length);
  });

  it('cash-secured puts have their own option (they used to be missing)', () => {
    expect(TRADE_STRATEGY_FILTER_OPTIONS).toContainEqual({ value: 'CSP', label: 'CSP' });
  });

  it('every option has a readable label', () => {
    for (const option of TRADE_STRATEGY_FILTER_OPTIONS) expect(option.label.length).toBeGreaterThan(0);
  });
});
