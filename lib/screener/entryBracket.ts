export interface EntryBracketLeg {
  action: string;
  quantity: number;
  [key: string]: unknown;
}

export interface CreditEntryBracketInput {
  entryCredit: number;
  profitBuyback: number;
  stopTrigger: number;
  stopLimit: number;
  quantity: number;
  legs: EntryBracketLeg[];
}

/**
 * Builds the single broker request for a defined-risk credit entry and both
 * exits. Keeping this independent of the Screener UI makes it difficult to
 * accidentally regress an entry back to a profit-only OTO.
 */
export function buildCreditEntryOtoco(input: CreditEntryBracketInput) {
  const values = [input.entryCredit, input.profitBuyback, input.stopTrigger, input.stopLimit];
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Entry quantity must be at least one contract');
  if (values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Entry and exit prices must be positive');
  if (input.profitBuyback >= input.entryCredit) throw new Error('Profit target must close below the entry credit');
  if (input.stopLimit < input.stopTrigger) throw new Error('Stop limit must not be below its trigger');
  if (input.legs.length === 0) throw new Error('Entry legs are required');

  const openingLegs = input.legs.map(leg => ({ ...leg, quantity: input.quantity }));
  const closingLegs = openingLegs.map(leg => ({
    ...leg,
    action: leg.action === 'Sell to Open' ? 'Buy to Close' : leg.action === 'Buy to Open' ? 'Sell to Close' : leg.action,
  }));

  return {
    type: 'OTOCO' as const,
    'trigger-order': {
      'time-in-force': 'GTC',
      'order-type': 'Limit',
      price: input.entryCredit.toFixed(2),
      'price-effect': 'Credit',
      legs: openingLegs,
    },
    orders: [
      {
        'time-in-force': 'GTC',
        'order-type': 'Limit',
        price: input.profitBuyback.toFixed(2),
        'price-effect': 'Debit',
        legs: closingLegs,
      },
      {
        'time-in-force': 'GTC',
        'order-type': 'Stop Limit',
        'stop-trigger': input.stopTrigger.toFixed(2),
        price: input.stopLimit.toFixed(2),
        'price-effect': 'Debit',
        legs: closingLegs,
      },
    ],
  };
}
