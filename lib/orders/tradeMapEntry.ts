// lib/orders/tradeMapEntry.ts
//
// ORDER-SEND-0001 S3a (Ian and Quinn, signed 2026-11-17): the pure pieces of sending a Trade Map
// credit trade to the broker. No I/O, no UI. It builds the order only from code the screener already
// uses (bracketForPrice, snapEntryCredit, buildCreditEntryOtoco), so both paths produce identical bodies.
//
// v1 rules: credit trades only (BPS, BCS, IC), entry at mid snapped to the tick, 50% profit target and a
// 2x-credit stop on every order, quantity a whole number of contracts, the data gate must read LIVE, and
// a live order is reachable only with a successful validation of the identical payload (<= 15s old).

import { bracketForPrice, type EntryBracket } from '@/lib/entry-walk/bracket';
import { snapEntryCredit, type TickTable } from '@/lib/portfolio/tickSize';
import { buildCreditEntryOtoco } from '@/lib/screener/entryBracket';
import type { GateStatus } from '@/lib/trademap/realtimeGate';
import { symbolKey } from '@/lib/trademap/chain';
import type { LegSpec, StrategyId } from '@/lib/trademap/strategies';

export const SEND_V1_STRATEGIES: StrategyId[] = ['bps', 'bcs', 'ic'];
export const DEFAULT_GTC_PCT = 50;
export const DEFAULT_STOP_MULTIPLE = 2;
export const REPRICE_TOLERANCE = 0.05;
export const VALIDATION_MAX_AGE_MS = 15_000;

export function sendSupported(id: StrategyId): boolean {
  return SEND_V1_STRATEGIES.indexOf(id) >= 0;
}

export interface OrderLeg {
  'instrument-type': string;
  symbol: string;
  quantity: number;
  action: 'Sell to Open' | 'Buy to Open';
  [key: string]: unknown;
}

/** Opening legs, exactly as the screener's buildOrderLegs makes them (symbols kept space padded). */
export function legsToOrderLegs(specs: LegSpec[], isIndex: boolean): OrderLeg[] | null {
  if (specs.length === 0) return null;
  const instrumentType = isIndex ? 'Index Option' : 'Equity Option';
  const out: OrderLeg[] = [];
  for (const s of specs) {
    if (!s.symbol) return null;
    out.push({ 'instrument-type': instrumentType, symbol: s.symbol, quantity: 1, action: s.side === 'short' ? 'Sell to Open' : 'Buy to Open' });
  }
  return out;
}

/** Net credit per share at the mid prices (short mids minus long mids); null if any leg has no mid. */
export function netCreditAtMid(specs: LegSpec[], mids: Record<string, number | null>): number | null {
  let net = 0;
  for (const s of specs) {
    const mid = mids[symbolKey(s.symbol)];
    if (mid == null || !Number.isFinite(mid) || mid <= 0) return null;
    net += s.side === 'short' ? mid : -mid;
  }
  return Math.round(net * 100) / 100;
}

export interface RepriceCheck {
  ok: boolean;
  /** The price the order would use now. */
  newPrice: number;
  moved: number;
}

/** Re-price just before submit: abort and show the new price if the net moved more than the tolerance. */
export function checkReprice(displayed: number, fresh: number, tolerance: number = REPRICE_TOLERANCE): RepriceCheck {
  const moved = Math.round(Math.abs(fresh - displayed) * 100) / 100;
  return { ok: Number.isFinite(moved) && moved <= tolerance + 1e-9, newPrice: fresh, moved };
}

export interface EntryOrderInput {
  strategy: StrategyId;
  legs: OrderLeg[];
  /** Entry credit per share (will be snapped to the tick). */
  entryCredit: number;
  quantity: number;
  tickTable: TickTable | null;
  gtcPct?: number;
  stopMultiple?: number;
}

export type EntryOrderResult =
  | { ok: true; order: ReturnType<typeof buildCreditEntryOtoco>; bracket: EntryBracket }
  | { ok: false; reason: string };

export function buildTradeMapEntryOrder(input: EntryOrderInput): EntryOrderResult {
  if (!sendSupported(input.strategy)) return { ok: false, reason: 'Sending is not available for this strategy yet.' };
  const expected = input.strategy === 'ic' ? 4 : 2;
  if (input.legs.length !== expected) return { ok: false, reason: `This strategy needs ${expected} legs.` };
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return { ok: false, reason: 'Quantity must be a whole number of contracts.' };
  const entry = snapEntryCredit(input.entryCredit, input.tickTable);
  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, reason: 'The entry price must be a positive credit.' };
  const bracket = bracketForPrice(entry, input.gtcPct ?? DEFAULT_GTC_PCT, input.stopMultiple ?? DEFAULT_STOP_MULTIPLE, input.tickTable);
  try {
    const order = buildCreditEntryOtoco({
      entryCredit: bracket.entryCredit,
      profitBuyback: bracket.profitBuyback,
      stopTrigger: bracket.stopTrigger,
      stopLimit: bracket.stopLimit,
      quantity: input.quantity,
      legs: input.legs,
    });
    return { ok: true, order, bracket };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The order could not be built.' };
  }
}

export interface SendGateInput {
  gateStatus: GateStatus;
  strategy: StrategyId;
  hasLegs: boolean;
  quantity: number;
}

/** Reasons Send must stay off. Empty means the Send button may open the confirm step. */
export function sendBlockers(i: SendGateInput): string[] {
  const out: string[] = [];
  if (!sendSupported(i.strategy)) out.push('Sending is available for bull put spreads, bear call spreads and iron condors only.');
  if (!i.hasLegs) out.push('Every leg needs a live two-sided quote.');
  if (i.gateStatus === 'warming') out.push('Waiting for fresh quotes.');
  if (i.gateStatus === 'stale') out.push('Quotes are not live.');
  if (!Number.isInteger(i.quantity) || i.quantity < 1) out.push('Quantity must be a whole number of contracts.');
  return out;
}

export interface ValidationRecord {
  ok: boolean;
  payloadJson: string;
  atMs: number;
}

/** A live order may go out only after a successful dry run of the identical payload, at most 15s ago. */
export function liveSubmitAllowed(validated: ValidationRecord | null, payload: unknown, nowMs: number, maxAgeMs: number = VALIDATION_MAX_AGE_MS): boolean {
  if (!validated || !validated.ok) return false;
  if (!(nowMs - validated.atMs >= 0 && nowMs - validated.atMs <= maxAgeMs)) return false;
  return validated.payloadJson === JSON.stringify(payload);
}
