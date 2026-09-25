// lib/rinse-repeat/__tests__/otocoEntrySafety.test.ts

import { describe, expect, it, vi } from 'vitest';
import { buildRinseRepeatOtocoIfSafe, submitRinseRepeatOtocoIfSafe, type OtocoEntryLeg, type RinseRepeatOtocoInput } from '../otocoEntrySafety';

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

const leg = (symbol: string, action: string, quantity = 2): OtocoEntryLeg =>
  ({ symbol, quantity, action: action as OtocoEntryLeg['action'], 'instrument-type': 'Equity Option' });

const IC_LEGS: OtocoEntryLeg[] = [
  leg('SPY   260117P00595000', 'Buy to Open'),
  leg('SPY   260117P00600000', 'Sell to Open'),
  leg('SPY   260117C00650000', 'Sell to Open'),
  leg('SPY   260117C00655000', 'Buy to Open'),
];

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

describe('Rinse & Repeat OTOCO entry safety: guard coverage', () => {
  const oneLeg = [leg('SPY   260117P00600000', 'Sell to Open')];
  const threeLegs = [
    leg('SPY   260117P00600000', 'Sell to Open'),
    leg('SPY   260117P00595000', 'Buy to Open'),
    leg('SPY   260117C00650000', 'Sell to Open'),
  ];
  const pair = (action: string) => [leg('SPY   260117P00600000', action), leg('SPY   260117P00595000', 'Buy to Open')];

  it.each([
    ['quantity 0', { quantity: 0 }],
    ['negative quantity', { quantity: -1 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['NaN quantity', { quantity: NaN }],
    ['zero entry credit', { entryCreditPoints: 0 }],
    ['negative entry credit', { entryCreditPoints: -1.2 }],
    ['NaN entry credit', { entryCreditPoints: NaN }],
    ['zero profit target', { profitTargetDebitPoints: 0 }],
    ['negative profit target', { profitTargetDebitPoints: -0.6 }],
    ['zero stop trigger', { stopTriggerDebitPoints: 0 }],
    ['negative stop trigger', { stopTriggerDebitPoints: -2.4 }],
    ['profit target above the entry credit', { profitTargetDebitPoints: 1.5 }],
    ['stop trigger below the entry credit', { stopTriggerDebitPoints: 0.9 }],
    ['a single opening leg', { openingLegs: oneLeg }],
    ['an odd (3) leg count', { openingLegs: threeLegs }],
    ['an empty leg list', { openingLegs: [] }],
    ['an empty symbol', { openingLegs: [leg('', 'Sell to Open'), leg('SPY   260117P00595000', 'Buy to Open')] }],
    ['a whitespace-only symbol', { openingLegs: [leg('   ', 'Sell to Open'), leg('SPY   260117P00595000', 'Buy to Open')] }],
    ['a closing action (Buy to Close)', { openingLegs: pair('Buy to Close') }],
    ['a closing action (Sell to Close)', { openingLegs: pair('Sell to Close') }],
    ['an unknown action', { openingLegs: pair('Sell') }],
  ])('blocks %s and never calls the broker', async (_label, overrides) => {
    const input = validInput(overrides as Partial<RinseRepeatOtocoInput>);
    expect(buildRinseRepeatOtocoIfSafe(input).ok).toBe(false);
    const broker = vi.fn();
    const result = await submitRinseRepeatOtocoIfSafe(input, broker);
    expect(result.submitted).toBe(false);
    expect(broker).not.toHaveBeenCalled();
  });

  it('a 4-leg iron condor passes and builds the expected body', () => {
    const result = buildRinseRepeatOtocoIfSafe(validInput({ openingLegs: IC_LEGS }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const closing = [
      leg('SPY   260117P00595000', 'Sell to Close'),
      leg('SPY   260117P00600000', 'Buy to Close'),
      leg('SPY   260117C00650000', 'Buy to Close'),
      leg('SPY   260117C00655000', 'Sell to Close'),
    ];
    expect(result.body).toEqual({
      type: 'OTOCO',
      source: 'options-screener',
      'trigger-order': {
        'order-type': 'Limit', 'time-in-force': 'GTC', price: '1.20', 'price-effect': 'Credit',
        legs: IC_LEGS,
      },
      orders: [
        { 'order-type': 'Limit', 'time-in-force': 'GTC', price: '0.60', 'price-effect': 'Debit', legs: closing },
        { 'order-type': 'Stop', 'time-in-force': 'GTC', 'stop-trigger': '2.40', legs: closing },
      ],
    });
  });

  it('on success the broker callback is called exactly once with the built body', async () => {
    const input = validInput({ openingLegs: IC_LEGS });
    const built = buildRinseRepeatOtocoIfSafe(input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const broker = vi.fn().mockResolvedValue({ data: { order: { id: 'abc' } } });
    const result = await submitRinseRepeatOtocoIfSafe(input, broker);
    expect(broker).toHaveBeenCalledTimes(1);
    expect(broker).toHaveBeenCalledWith(built.body);
    expect(result).toEqual({ submitted: true, result: { data: { order: { id: 'abc' } } }, body: built.body });
    expect((result as { body: unknown }).body).toBe(broker.mock.calls[0][0]);
  });

  it('space-padded OCC symbols are preserved unmodified in the trigger and closing legs', () => {
    const result = buildRinseRepeatOtocoIfSafe(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const padded = ['SPY   260117P00600000', 'SPY   260117P00595000'];
    expect(result.body['trigger-order'].legs.map(l => l.symbol)).toEqual(padded);
    expect(result.body.orders[0].legs.map(l => l.symbol)).toEqual(padded);
    expect(result.body.orders[1].legs.map(l => l.symbol)).toEqual(padded);
    expect(padded.every(s => s.length === 21)).toBe(true);
  });
});
