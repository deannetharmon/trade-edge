// lib/orders/tradeMapSend.ts
//
// ORDER-SEND-0001 S3c: the I/O steps of sending a Trade Map credit trade, with every outside call injected so the
// order of the steps and the safety rules are tested without a network. Rules (Ian, Quinn):
//   - validate: market open, fresh executable quotes re-read for the exact legs, re-price within tolerance, then a
//     broker dry run of the exact payload (tick-healed once, token-retried once; a dry run places nothing)
//   - place: only with a successful validation of the identical payload that is at most 15 seconds old, market
//     still open; one POST, never resent (a rejected or unanswered live order is shown, not retried)

import { postWithTickHeal } from '@/lib/entry-walk/tickHeal';
import { netQuoteFromLegs } from '@/lib/entry-walk/broker';
import { isTokenRejection, sendWithTokenRetry } from '@/lib/auth/tokenRetry';
import type { TickTable } from '@/lib/portfolio/tickSize';
import type { LegSpec, StrategyId } from '@/lib/trademap/strategies';
import {
  buildTradeMapEntryOrder, checkReprice, legsToOrderLegs, liveSubmitAllowed, VALIDATION_MAX_AGE_MS,
  type ValidationRecord,
} from './tradeMapEntry';

export interface QuoteRead { symbol: string; bid: number | null; ask: number | null; ageSeconds: number | null }
export interface BrokerResponse { ok: boolean; status: number; data: any }

export interface SendDeps {
  now(): number;
  marketOpen(): boolean;
  getToken(): Promise<string>;
  getAccountNumber(): Promise<string>;
  fetchQuotes(symbols: string[], token: string): Promise<QuoteRead[]>;
  /** POST JSON to the broker. Network failures throw. */
  post(path: string, token: string, body: unknown): Promise<BrokerResponse>;
}

export interface SendInput {
  strategy: StrategyId;
  specs: LegSpec[];
  isIndex: boolean;
  /** The net credit per share the trader saw (mid), used for the re-price check. */
  displayedCredit: number;
  quantity: number;
  tickTable: TickTable | null;
  /** Option root, the key the broker's learned tick is stored under. */
  root: string;
  gtcPct?: number;
  stopMultiple?: number;
}

export interface Validated {
  ok: true;
  accountNumber: string;
  payload: unknown;
  record: ValidationRecord;
  /** Entry credit per share actually sent (snapped), and the buyback and stop prices. */
  entry: number;
  profitBuyback: number;
  stopTrigger: number;
  stopLimit: number;
  /** Net credit at the fresh mid before snapping. */
  freshMid: number;
  healNote: { tick: number; entryBefore: number; entryAfter: number } | null;
}
export type ValidateResult = Validated | { ok: false; reason: string };

/** The broker nests the real reason under error.errors[]; show all of it. */
export function brokerErrorText(data: any, fallback: string): string {
  const parts: string[] = [];
  const top = data?.error?.message;
  if (top) parts.push(String(top));
  const details = Array.isArray(data?.error?.errors) ? data.error.errors : Array.isArray(data?.errors) ? data.errors : [];
  for (const d of details) {
    const m = d?.message ?? d?.code;
    if (m && !parts.includes(String(m))) parts.push(String(m));
  }
  return parts.length ? parts.join(' — ') : fallback;
}

const MAX_QUOTE_AGE_S = 15;

export async function validateSend(deps: SendDeps, input: SendInput): Promise<ValidateResult> {
  if (!deps.marketOpen()) return { ok: false, reason: 'The market is closed. Live quotes cannot be validated. Try again during regular market hours.' };
  const legs = legsToOrderLegs(input.specs, input.isIndex);
  if (!legs) return { ok: false, reason: 'The legs could not be turned into an order.' };
  const token = await deps.getToken();
  const symbols = legs.map(l => String(l.symbol));
  const quotes = await deps.fetchQuotes(symbols, token);
  const net = netQuoteFromLegs(legs.map(l => ({ symbol: String(l.symbol), action: String(l.action) })), quotes);
  if (!net || net.ageSeconds == null || net.ageSeconds > MAX_QUOTE_AGE_S) {
    return { ok: false, reason: 'Live quotes are unavailable, crossed, or older than 15 seconds. Nothing was sent.' };
  }
  const freshMid = Math.round(((net.netBid + net.netAsk) / 2) * 100) / 100;
  if (!(freshMid > 0)) return { ok: false, reason: 'The trade is not a credit at the current market. Nothing was sent.' };
  const reprice = checkReprice(input.displayedCredit, freshMid);
  if (!reprice.ok) {
    return { ok: false, reason: `The price moved $${reprice.moved.toFixed(2)} since you saw it. The credit is now $${freshMid.toFixed(2)}. Review it and try again.` };
  }
  const accountNumber = await deps.getAccountNumber();
  let lastBracket: { profitBuyback: number; stopTrigger: number; stopLimit: number } | null = null;
  const healed = await postWithTickHeal({
    root: input.root, chainTable: input.tickTable, entry: freshMid,
    build: (entry, table) => {
      const built = buildTradeMapEntryOrder({
        strategy: input.strategy, legs, entryCredit: entry, quantity: input.quantity, tickTable: table,
        gtcPct: input.gtcPct, stopMultiple: input.stopMultiple,
      });
      if (!built.ok) throw new Error(built.reason);
      lastBracket = { profitBuyback: built.bracket.profitBuyback, stopTrigger: built.bracket.stopTrigger, stopLimit: built.bracket.stopLimit };
      return built.order;
    },
    post: async payload => {
      const { response } = await sendWithTokenRetry(async tk => {
        const res = await deps.post(`/accounts/${accountNumber}/complex-orders/dry-run`, tk, payload);
        const message = res.ok ? '' : brokerErrorText(res.data, `Dry run failed (${res.status})`);
        return { response: { ok: res.ok, message, data: res.data }, tokenRejected: !res.ok && isTokenRejection(res.status, message) };
      }, { getToken: deps.getToken });
      return response;
    },
  }).catch((e: unknown) => ({ thrown: e instanceof Error ? e.message : 'The order could not be built.' }));
  if ('thrown' in healed) return { ok: false, reason: healed.thrown };
  if (!healed.ok) {
    const detail = healed.firstMessage ? `${healed.firstMessage} Retried once at the broker's tick: ${healed.message}` : healed.message;
    return { ok: false, reason: `The broker rejected the dry run. ${detail} Nothing was sent.` };
  }
  const b = lastBracket as { profitBuyback: number; stopTrigger: number; stopLimit: number } | null;
  if (!b) return { ok: false, reason: 'The order could not be built.' };
  return {
    ok: true, accountNumber, payload: healed.payload, entry: healed.entry, freshMid,
    profitBuyback: b.profitBuyback, stopTrigger: b.stopTrigger, stopLimit: b.stopLimit,
    healNote: healed.healed,
    record: { ok: true, payloadJson: JSON.stringify(healed.payload), atMs: deps.now() },
  };
}

export type PlaceResult = { ok: true; orderId: string } | { ok: false; reason: string; sent: boolean };

/** One live POST. `sent` tells the caller whether the broker may have received it (so it is never auto-resent). */
export async function placeSend(deps: SendDeps, validated: Validated): Promise<PlaceResult> {
  if (!liveSubmitAllowed(validated.record, validated.payload, deps.now(), VALIDATION_MAX_AGE_MS)) {
    return { ok: false, sent: false, reason: 'The validation is older than 15 seconds. Validate again before placing.' };
  }
  if (!deps.marketOpen()) return { ok: false, sent: false, reason: 'The market is closed. Nothing was sent.' };
  let res: BrokerResponse;
  try {
    res = await deps.post(`/accounts/${validated.accountNumber}/complex-orders`, await deps.getToken(), validated.payload);
  } catch {
    return { ok: false, sent: true, reason: 'No answer from the broker. The order may have been placed. Check Pending orders before trying again; nothing was resent.' };
  }
  if (!res.ok) return { ok: false, sent: true, reason: `${brokerErrorText(res.data, `Order failed (${res.status})`)} Nothing was resent. Review the order and place it again.` };
  const id = res.data?.data?.['complex-order']?.id ?? res.data?.data?.order?.id;
  if (id == null) return { ok: false, sent: true, reason: 'The broker did not return an order id. Check Pending orders before trying again.' };
  return { ok: true, orderId: String(id) };
}
