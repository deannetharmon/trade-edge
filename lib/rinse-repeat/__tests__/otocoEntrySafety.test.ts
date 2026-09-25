import { describe, expect, it, vi } from 'vitest';
import { buildRinseRepeatOtocoIfSafe, submitRinseRepeatOtocoIfSafe, type RinseRepeatOtocoInput } from '../otocoEntrySafety';

function validInput(overrides: Partial<RinseRepeatOtocoInput> = {}): RinseRepeatOtocoInput {
  return {
    quantity: 2,
    entryCreditPoints: 1.2,
    profitTargetDebitPoints: 0.6,
    stopTriggerDebitPoints: 2.4,
    openingLegs: [
      { symbol: 'SPY   260117P00600000', quantity: 2, action: 'Sell to Open', 'instrument-type': 'Equity Option' },
      { symbol: 'SPY   260117P00595000', quantity: 2, action: 'Buy to Open', 'instrument-type': 'Equity Option' },
    ],
    ...overrides,
  };
}

describe('Rinse & Repeat OTOCO entry safety', () => {
  it('builds one exact opening and inverse-closing OTOCO payload', () => {
    const result = buildRinseRepeatOtocoIfSafe(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body['trigger-order'].price).toBe('1.20');
    expect(result.body.orders[0].price).toBe('0.60');
    expect(result.body.orders[1]['stop-trigger']).toBe('2.40');
    expect(result.body.orders[0].legs.map(leg => leg.action)).toEqual(['Buy to Close', 'Sell to Close']);
  });

  it.each([
    ['a non-cent entry price', { entryCreditPoints: 1.234 }],
    ['a profit target at the entry credit', { profitTargetDebitPoints: 1.2 }],
    ['a stop trigger at the entry credit', { stopTriggerDebitPoints: 1.2 }],
    ['a mismatched leg quantity', { openingLegs: [{ symbol: 'S', quantity: 1, action: 'Sell to Open', 'instrument-type': 'Equity Option' }, { symbol: 'L', quantity: 2, action: 'Buy to Open', 'instrument-type': 'Equity Option' }] }],
    ['a duplicate leg symbol', { openingLegs: [{ symbol: 'S', quantity: 2, action: 'Sell to Open', 'instrument-type': 'Equity Option' }, { symbol: 'S', quantity: 2, action: 'Buy to Open', 'instrument-type': 'Equity Option' }] }],
  ])('does not submit %s', async (_label, overrides) => {
    const broker = vi.fn();
    const result = await submitRinseRepeatOtocoIfSafe(validInput(overrides as Partial<RinseRepeatOtocoInput>), broker);
    expect(result.submitted).toBe(false);
    expect(broker).not.toHaveBeenCalled();
  });
});
