// lib/scans/ccRsiChip.ts

// CC-WHEEL-0001 S3 -- the covered-call timing chip. Pure. Dean's rule (D3): sell a covered call when daily RSI is at or
// above the cutoff (default 50). Below it the chip reads Wait; this is a soft signal, not a block. Price under the cost
// basis reads Recovery (only far-out-of-the-money calls make sense there). RSI unknown fails closed to Wait.

export const DEFAULT_CC_RSI_CUTOFF = 50;

export type CcRsiChipState = 'ready' | 'recovery' | 'wait';

export interface CcRsiChip {
  state: CcRsiChipState;
  label: 'Ready' | 'Recovery' | 'Wait';
  /** One plain sentence for the tooltip. */
  reason: string;
}

/** A usable cutoff is a number from 1 to 99; anything else is the default. */
export function sanitizeCcRsiCutoff(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 99 ? n : DEFAULT_CC_RSI_CUTOFF;
}

/** `asOf` (e.g. "Fri 11/6") names the completed daily bar the RSI is from; when given, the tooltip says so and that today's session is not included. */
export function ccRsiChip(input: { rsi: number | null | undefined; price: number | null | undefined; costBasis: number | null | undefined; cutoff?: number; asOf?: string | null }): CcRsiChip {
  const cutoff = sanitizeCcRsiCutoff(input.cutoff);
  const { rsi } = input;
  if (typeof rsi !== 'number' || !Number.isFinite(rsi)) {
    return { state: 'wait', label: 'Wait', reason: 'Daily RSI is unavailable, so timing cannot be confirmed.' };
  }
  const bar = input.asOf ? ` (close of ${input.asOf}; today's session is not included)` : '';
  if (rsi < cutoff) {
    return { state: 'wait', label: 'Wait', reason: `Daily RSI ${rsi.toFixed(0)}${bar} is below your ${cutoff} cutoff: the stock is weak, and a call sold now may leave you selling a bounce too cheaply.` };
  }
  const basisKnown = typeof input.costBasis === 'number' && input.costBasis > 0;
  if (basisKnown && typeof input.price === 'number' && input.price > 0 && input.price < (input.costBasis as number)) {
    return { state: 'recovery', label: 'Recovery', reason: `Daily RSI ${rsi.toFixed(0)}${bar} is at or above your ${cutoff} cutoff, but the price is below your cost basis. Only calls above your basis make sense.` };
  }
  return { state: 'ready', label: 'Ready', reason: `Daily RSI ${rsi.toFixed(0)}${bar} is at or above your ${cutoff} cutoff.` };
}
