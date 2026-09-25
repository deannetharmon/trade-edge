// ES-0003 — fail-closed broker boundary for Rinse & Repeat OTOCO entries.
// The caller supplies the candidate's opening legs and trader-entered prices;
// this module validates and builds the one payload that may reach the broker.

export type OpeningAction = 'Sell to Open' | 'Buy to Open';
export type ClosingAction = 'Buy to Close' | 'Sell to Close';

export interface OtocoEntryLeg {
  symbol: string;
  quantity: number;
  action: OpeningAction;
  'instrument-type': 'Equity Option' | 'Index Option';
}

export interface RinseRepeatOtocoInput {
  quantity: number;
  entryCreditPoints: number;
  profitTargetDebitPoints: number;
  stopTriggerDebitPoints: number;
  openingLegs: OtocoEntryLeg[];
}

export interface RinseRepeatOtocoBody {
  type: 'OTOCO';
  source: 'options-screener';
  'trigger-order': {
    'order-type': 'Limit';
    'time-in-force': 'GTC';
    price: string;
    'price-effect': 'Credit';
    legs: OtocoEntryLeg[];
  };
  orders: Array<{
    'order-type': 'Limit' | 'Stop';
    'time-in-force': 'GTC';
    price?: string;
    'stop-trigger'?: string;
    'price-effect'?: 'Debit';
    legs: Array<Omit<OtocoEntryLeg, 'action'> & { action: ClosingAction }>;
  }>;
}

export type OtocoEntrySafetyResult =
  | { ok: true; body: RinseRepeatOtocoBody }
  | { ok: false; reason: string };

function isPositiveCent(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function closeAction(action: OpeningAction): ClosingAction {
  return action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close';
}

/**
 * Checks the final execution intent and constructs the exact OTOCO body.
 * No caller may supply a separately-built body, avoiding plan/payload drift.
 */
export function buildRinseRepeatOtocoIfSafe(input: RinseRepeatOtocoInput): OtocoEntrySafetyResult {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, reason: 'Quantity must be a whole number of at least one contract.' };
  }
  if (!isPositiveCent(input.entryCreditPoints)) {
    return { ok: false, reason: 'Entry credit must be a positive whole-cent option price.' };
  }
  if (!isPositiveCent(input.profitTargetDebitPoints)) {
    return { ok: false, reason: 'Profit target must be a positive whole-cent option price.' };
  }
  if (!isPositiveCent(input.stopTriggerDebitPoints)) {
    return { ok: false, reason: 'Stop trigger must be a positive whole-cent option price.' };
  }
  if (input.profitTargetDebitPoints >= input.entryCreditPoints) {
    return { ok: false, reason: 'Profit target must close below the entry credit.' };
  }
  if (input.stopTriggerDebitPoints <= input.entryCreditPoints) {
    return { ok: false, reason: 'Stop trigger must be above the entry credit.' };
  }
  if (input.openingLegs.length < 2 || input.openingLegs.length % 2 !== 0) {
    return { ok: false, reason: 'An entry must contain a complete, even set of opening option legs.' };
  }

  const seenSymbols = new Set<string>();
  for (const leg of input.openingLegs) {
    if (!leg.symbol?.trim()) return { ok: false, reason: 'Every entry leg requires an exact OCC symbol.' };
    if (seenSymbols.has(leg.symbol)) return { ok: false, reason: `Duplicate entry leg symbol ${leg.symbol} is not allowed.` };
    seenSymbols.add(leg.symbol);
    if (leg.quantity !== input.quantity) return { ok: false, reason: 'Every entry leg quantity must match the requested quantity.' };
    if (leg.action !== 'Sell to Open' && leg.action !== 'Buy to Open') return { ok: false, reason: 'Every entry leg must be an opening action.' };
  }

  const openingLegs = input.openingLegs.map(leg => ({ ...leg }));
  const closingLegs = openingLegs.map(leg => ({ ...leg, action: closeAction(leg.action) }));
  return {
    ok: true,
    body: {
      type: 'OTOCO',
      source: 'options-screener',
      'trigger-order': {
        'order-type': 'Limit',
        'time-in-force': 'GTC',
        price: input.entryCreditPoints.toFixed(2),
        'price-effect': 'Credit',
        legs: openingLegs,
      },
      orders: [
        {
          'order-type': 'Limit',
          'time-in-force': 'GTC',
          price: input.profitTargetDebitPoints.toFixed(2),
          'price-effect': 'Debit',
          legs: closingLegs,
        },
        {
          'order-type': 'Stop',
          'time-in-force': 'GTC',
          'stop-trigger': input.stopTriggerDebitPoints.toFixed(2),
          legs: closingLegs,
        },
      ],
    },
  };
}

export type SubmitRinseRepeatOtocoResult<T> =
  | { submitted: true; result: T; body: RinseRepeatOtocoBody }
  | { submitted: false; reason: string };

/** The only broker boundary for this entry flow. */
export async function submitRinseRepeatOtocoIfSafe<T>(
  input: RinseRepeatOtocoInput,
  submitToBroker: (body: RinseRepeatOtocoBody) => Promise<T>,
): Promise<SubmitRinseRepeatOtocoResult<T>> {
  const safety = buildRinseRepeatOtocoIfSafe(input);
  if (!safety.ok) return { submitted: false, reason: safety.reason };
  const result = await submitToBroker(safety.body);
  return { submitted: true, result, body: safety.body };
}
